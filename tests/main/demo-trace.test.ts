import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { sql } from "drizzle-orm";
import {
  demoQueryLogger, enterDemoHandler, traceDemoCall, traceDemoRequest, traceDemoTransaction,
  logDemoViewStep, rememberDemoActor, withoutDemoTrace,
} from "../../src/main/demo-trace";

// Las comparaciones usan texto plano; los colores tienen su propio test.
beforeEach(() => { vi.stubEnv("NO_COLOR", "1"); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

/** Quita el relleno de columnas para comparar mensajes. */
const lines = (output: { mock: { calls: unknown[][] } }): string[] =>
  output.mock.calls.map(([line]) => String(line).replace(/ {2,}/g, " "));

describe("secuencias de la demo", () => {
  it("permanece silenciosa fuera de la demo y en canales ajenos", async () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    const action = vi.fn(async () => {
      demoQueryLogger.logQuery("SELECT * FROM producto", []);
      return { ok: true as const, data: "resultado" };
    });
    vi.stubEnv("HUASCAR_DEMO", "0");
    expect(await traceDemoRequest("venta:producto", action)).toEqual({ ok: true, data: "resultado" });
    vi.stubEnv("HUASCAR_DEMO", "1");
    await traceDemoRequest("dashboard:cargar", action);
    expect(action).toHaveBeenCalledTimes(2);
    expect(output).not.toHaveBeenCalled();
  });

  it("sigue el diagrama: vista → handler → control de acceso → handler → vista", async () => {
    vi.stubEnv("HUASCAR_DEMO", "1");
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    await traceDemoRequest("venta:verificar-caja", async () => {
      await traceDemoCall("C_jsonwebtoken", "Verificar token", async () => undefined);
      return enterDemoHandler(async () => {
        await traceDemoCall("C_VerificacionCajaHandler", "Verificar caja", async () => undefined);
        return { ok: true as const, data: { status: "sin_registro" } };
      });
    });
    expect(lines(output)).toEqual([
      "[CU36] V_RegistrarVentaView -> C_VentaHandler: venta:verificar-caja (JWT)",
      "[CU36] C_VentaHandler -> C_ControlAcceso: Validar JWT, rol y sesión",
      "[CU36] C_ControlAcceso -> C_jsonwebtoken: Verificar token",
      "[CU36] C_ControlAcceso --> C_VentaHandler: Acceso concedido",
      "[CU36] C_VentaHandler -> C_VerificacionCajaHandler: Verificar caja",
      "[CU36] C_VentaHandler --> V_RegistrarVentaView: Caja disponible; se abre con la primera venta",
    ]);
  });

  it("muestra cada consulta como handler → C_drizzle → C_libsql → tabla, sin datos ni tablas ajenas al diagrama", async () => {
    vi.stubEnv("HUASCAR_DEMO", "1");
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    const dir = await mkdtemp(join(tmpdir(), "huascar-demo-trace-"));
    const client = createClient({ url: `file:${join(dir, "trace.db").replace(/\\/g, "/")}` });
    const db = drizzle(client, { logger: demoQueryLogger });
    try {
      await client.executeMultiple(`
        CREATE TABLE producto(producto_id INTEGER, producto_nombre TEXT);
        CREATE TABLE lote(producto_id INTEGER);
        CREATE TABLE categoria(categoria_id INTEGER);
      `);
      await traceDemoRequest("venta:registrar", () => enterDemoHandler(async () => {
        await traceDemoTransaction(() => db.transaction(async (tx) => {
          await tx.run(sql`INSERT INTO producto VALUES (1, ${"dato privado"})`);
        }));
        await db.all(sql`SELECT * FROM producto p LEFT JOIN lote l ON p.producto_id = l.producto_id`);
        await db.all(sql`SELECT * FROM categoria`);
        await db.all(sql`SELECT 1`);
        await withoutDemoTrace(() => db.all(sql`SELECT * FROM lote`));
        return { ok: true, data: { metodoPago: "efectivo", total: 3000, vuelto: 2000 } };
      }));
      const logs = lines(output);
      const start = logs.indexOf("[CU36] C_VentaHandler -> C_drizzle: Iniciar transacción");
      expect(logs.slice(start, start + 7)).toEqual([
        "[CU36] C_VentaHandler -> C_drizzle: Iniciar transacción",
        "[CU36] C_drizzle -> C_libsql: BEGIN",
        "[CU36] C_VentaHandler -> C_drizzle: Insertar producto",
        "[CU36] C_drizzle -> C_libsql: Ejecutar SQL",
        "[CU36] C_libsql -> producto: INSERT",
        "[CU36] C_VentaHandler -> C_drizzle: Confirmar transacción",
        "[CU36] C_drizzle -> C_libsql: COMMIT",
      ]);
      expect(logs).toContain("[CU36] C_libsql -> producto: SELECT (con lote)");
      expect(logs.filter((line) => line.includes("-> lote:"))).toEqual([]);
      expect(logs.join("\n")).not.toMatch(/categoria|dato privado|INSERT INTO/);
      expect(logs.at(-1)).toBe("[CU36] C_VentaHandler --> V_RegistrarVentaView: Venta registrada · efectivo · total $3.000 · vuelto $2.000");
    } finally {
      client.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("identifica al actor y a las vistas de ambos casos con pasos permitidos en modo demo", () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubEnv("HUASCAR_DEMO", "0");
    logDemoViewStep("saleOpened");
    expect(output).not.toHaveBeenCalled();
    vi.stubEnv("HUASCAR_DEMO", "1");
    logDemoViewStep("saleOpened");
    logDemoViewStep("eanAccepted");
    logDemoViewStep("receptionShown");
    logDemoViewStep("mensaje arbitrario");
    expect(lines(output)).toEqual([
      "[CU36] Dueño/Trabajador -> V_RegistrarVentaView: Selecciona Registrar venta",
      "[CU36] V_RegistrarVentaView -> V_RegistrarVentaView: Validar formato EAN-13: correcto",
      "[CU18] V_ConfirmarRecepcionPedidoView --> Dueño/Trabajador: Mostrar éxito y saldos actualizados",
    ]);
  });

  it("separa el listado de pedidos de la siguiente acción del usuario", () => {
    vi.stubEnv("HUASCAR_DEMO", "1");
    const output = vi.spyOn(console, "log").mockImplementation(() => {});

    logDemoViewStep("ordersShown");
    logDemoViewStep("orderSelected");

    expect(lines(output)).toEqual([
      "[CU18] V_ConfirmarRecepcionPedidoView --> Dueño/Trabajador: Mostrar pedidos pendientes, parciales y terminados",
      "[CU18] ────────── Listado de pedidos listo ──────────",
      "[CU18] Dueño/Trabajador -> V_ConfirmarRecepcionPedidoView: Selecciona un pedido",
    ]);
  });

  it("nombra al actor con el rol efectivo de la sesión verificada", () => {
    vi.stubEnv("HUASCAR_DEMO", "1");
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    rememberDemoActor("trabajador");
    logDemoViewStep("saleOpened");
    rememberDemoActor("rol desconocido");
    logDemoViewStep("receptionShown");
    rememberDemoActor("dueno");
    logDemoViewStep("orderSelected");
    expect(lines(output)).toEqual([
      "[CU36] Trabajador -> V_RegistrarVentaView: Selecciona Registrar venta",
      "[CU18] V_ConfirmarRecepcionPedidoView --> Trabajador: Mostrar éxito y saldos actualizados",
      "[CU18] Dueño -> V_ConfirmarRecepcionPedidoView: Selecciona un pedido",
    ]);
  });

  it("asigna cada consulta al caso de uso de su solicitud aunque se intercalen", async () => {
    vi.stubEnv("HUASCAR_DEMO", "1");
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    let resume!: () => void;
    const pending = new Promise<void>((resolve) => { resume = resolve; });
    const first = traceDemoRequest("venta:producto", () => enterDemoHandler(async () => {
      await pending;
      demoQueryLogger.logQuery("SELECT * FROM producto", []);
      return { ok: true, data: [] };
    }));
    await traceDemoRequest("pedido:detalle", () => enterDemoHandler(async () => {
      demoQueryLogger.logQuery("SELECT * FROM pedido_proveedor", []);
      return { ok: true, data: { estado: "pendiente", lineas: [] } };
    }));
    resume();
    await first;
    const logs = lines(output);
    expect(logs).toContain("[CU36] C_libsql -> producto: SELECT");
    expect(logs).toContain("[CU18] C_libsql -> pedido_proveedor: SELECT");
    expect(logs).toContain("[CU18] C_RecepcionPedidoHandler -> C_drizzle: Consultar pedido y su estado");
  });

  it("no confirma transacciones fallidas y conserva el rechazo del controlador", async () => {
    vi.stubEnv("HUASCAR_DEMO", "1");
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = new Error("fallo privado");
    await expect(traceDemoRequest("venta:registrar", () => traceDemoTransaction(async () => { throw error; }))).rejects.toBe(error);
    await traceDemoRequest("pedido:confirmar-recepcion", async () => ({
      ok: false, error: { code: "VALIDATION_ERROR", message: "Cantidad inválida" },
    }));
    const logs = lines(output).join("\n");
    expect(logs).toContain("ROLLBACK; no se guarda ningún cambio");
    expect(logs).toContain("Error; solicitud no completada");
    expect(logs).toContain("Rechazado (VALIDATION_ERROR)");
    expect(logs).not.toContain("COMMIT");
    expect(logs).not.toContain("fallo privado");
  });

  it("pinta vistas, controladores, librerías y tablas con los colores de los diagramas", async () => {
    vi.stubEnv("HUASCAR_DEMO", "1");
    vi.stubEnv("NO_COLOR", "");
    vi.stubEnv("FORCE_COLOR", "1");
    vi.stubEnv("COLORTERM", "truecolor");
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    await traceDemoRequest("venta:producto", () => enterDemoHandler(async () => {
      demoQueryLogger.logQuery("SELECT * FROM producto", []);
      return { ok: true, data: [] };
    }));
    const logs = output.mock.calls.map(([line]) => String(line)).join("\n");
    const colored = (rgb: string, name: string) => `\x1b[38;2;${rgb}m${name}\x1b[0m`;
    expect(logs).toContain(colored("108;142;191", "V_RegistrarVentaView"));
    expect(logs).toContain(colored("130;179;102", "C_VentaHandler"));
    expect(logs).toContain(colored("130;179;102", "C_ControlAcceso"));
    expect(logs).toContain(colored("184;84;80", "C_drizzle"));
    expect(logs).toContain(colored("184;84;80", "C_libsql"));
    expect(logs).toContain(colored("150;115;166", "producto"));
    vi.stubEnv("COLORTERM", "");
    output.mockClear();
    logDemoViewStep("saleShown");
    expect(String(output.mock.calls[0][0])).toContain("\x1b[38;5;67mV_RegistrarVentaView\x1b[0m");
  });

  it("muestra el canal de impresión y su resultado bajo CU36", async () => {
    vi.stubEnv("HUASCAR_DEMO", "1");
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    await traceDemoRequest("boleta:imprimir", () => enterDemoHandler(async () => ({
      ok: true,
      data: { copia: false },
    })));

    expect(lines(output)).toEqual([
      "[CU36] ────────── Imprimir boleta ──────────",
      "[CU36] VistaElectron -> C_ImpresionBoletaHandler: boleta:imprimir (venta, copia, JWT)",
      "[CU36] C_ImpresionBoletaHandler -> C_ControlAcceso: Validar JWT, rol y sesión",
      "[CU36] C_ControlAcceso --> C_ImpresionBoletaHandler: Acceso concedido",
      "[CU36] C_ImpresionBoletaHandler --> VistaElectron: Boleta enviada a impresión",
    ]);
  });

  it("un fallo de consola no cambia el resultado de la operación", async () => {
    vi.stubEnv("HUASCAR_DEMO", "1");
    vi.spyOn(console, "log").mockImplementation(() => { throw new Error("consola cerrada"); });
    expect(await traceDemoRequest("venta:registrar", async () => ({ ok: true, data: 42 })))
      .toEqual({ ok: true, data: 42 });
  });
});
