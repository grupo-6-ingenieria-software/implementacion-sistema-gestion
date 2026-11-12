import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { sql } from "drizzle-orm";
import {
  demoQueryLogger, traceDemoCall, traceDemoRequest, traceDemoTransaction,
  loadDemoSqlViews, logDemoViewStep, traceDemoDatabase, withoutDemoTrace,
} from "../../src/main/demo-trace";

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

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

  it("muestra tablas, vistas SQL y retornos reales sin imprimir datos de las consultas", async () => {
    vi.stubEnv("HUASCAR_DEMO", "1");
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    const dir = await mkdtemp(join(tmpdir(), "huascar-demo-trace-"));
    const client = createClient({ url: `file:${join(dir, "trace.db").replace(/\\/g, "/")}` });
    const db = drizzle(traceDemoDatabase(client), { logger: demoQueryLogger });
    try {
      await client.executeMultiple(`
        CREATE TABLE producto(id INTEGER, nombre TEXT);
        CREATE TABLE lote(producto_id INTEGER);
        CREATE VIEW stock_visible AS SELECT producto_id FROM lote;
      `);
      await loadDemoSqlViews(client);
      await traceDemoRequest("venta:producto", () => traceDemoCall("C_ConsultaProductoHandler", "Buscar producto", async () => {
        await traceDemoTransaction(() => db.transaction(async (tx) => {
          await tx.run(sql`INSERT INTO producto VALUES (1, ${"dato privado"})`);
        }));
        await db.all(sql`SELECT * FROM producto p LEFT JOIN lote l ON p.id = l.producto_id`);
        await db.all(sql`SELECT * FROM main."stock_visible"`);
        await db.all(sql`WITH subtotals AS (SELECT id FROM producto) SELECT * FROM subtotals`);
        await expect(db.all(sql`SELECT columna_inexistente FROM producto`)).rejects.toThrow();
        await withoutDemoTrace(() => db.all(sql`SELECT * FROM lote`));
        return { ok: true, data: [] };
      }));
      const logs = output.mock.calls.flat().join("\n");
      expect(logs).toContain("C_ConsultaProductoHandler → C_drizzle → C_libsql → [producto]: INSERT solicitado");
      expect(logs).toContain("[producto, lote]: SELECT solicitado");
      expect(logs).toContain("[vista SQL: stock_visible]: SELECT solicitado");
      expect(logs).toContain("[vista SQL: stock_visible] → C_libsql → C_drizzle → C_ConsultaProductoHandler: SELECT completado (filas devueltas: 0)");
      expect(logs).toContain("[producto] → C_libsql → C_drizzle → C_ConsultaProductoHandler: INSERT completado (filas afectadas: 1)");
      expect(logs).toContain("SELECT rechazado en [producto]");
      expect(logs).toContain("Transacción iniciada");
      expect(logs).toContain("[producto]: SQL con CTE solicitado");
      expect(logs).not.toContain("subtotals");
      expect(logs).not.toContain("[lote]: SELECT");
      expect(logs).not.toContain("dato privado");
      expect(logs).not.toContain("INSERT INTO");
      expect(logs).toContain("Respuesta OK");
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
    logDemoViewStep("receptionShown");
    logDemoViewStep("mensaje arbitrario");
    expect(output).toHaveBeenCalledTimes(2);
    expect(output.mock.calls[0][0]).toContain("Dueño / Trabajador → V_RegistrarVentaView");
    expect(output.mock.calls[1][0]).toContain("V_ConfirmarRecepcionPedidoView → Dueño / Trabajador");
  });

  it("separa solicitudes simultáneas y numera sus pasos sin mezclarlos", async () => {
    vi.stubEnv("HUASCAR_DEMO", "1");
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    let resume!: () => void;
    const pending = new Promise<void>((resolve) => { resume = resolve; });
    const first = traceDemoRequest("venta:producto", () => traceDemoCall("C_ConsultaProductoHandler", "Buscar", async () => {
      await pending;
      demoQueryLogger.logQuery("SELECT * FROM producto", []);
      return { ok: true, data: [] };
    }));
    await traceDemoRequest("pedido:detalle", () => traceDemoCall("C_RecepcionPedidoHandler", "Consultar", async () => {
      demoQueryLogger.logQuery("SELECT * FROM pedido_proveedor", []);
      return { ok: true, data: [] };
    }));
    resume();
    await first;
    const lines = output.mock.calls.map(([line]) => String(line));
    for (const rf of ["RF18", "RF36"]) {
      const own = lines.filter((line) => line.startsWith(`[${rf}/`));
      expect(own.map((line) => Number(line.match(/· (\d+)\]/)?.[1])))
        .toEqual(own.map((_, index) => index + 1));
      expect(new Set(own.map((line) => line.match(/#(\d+)/)?.[1])).size).toBe(1);
    }
    expect(lines.find((line) => line.includes("[producto]:"))).toContain("[RF36/CU36");
    expect(lines.find((line) => line.includes("[pedido_proveedor]:"))).toContain("[RF18/CU18");
  });

  it("no confirma transacciones fallidas y conserva el rechazo del controlador", async () => {
    vi.stubEnv("HUASCAR_DEMO", "1");
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = new Error("fallo privado");
    await expect(traceDemoRequest("venta:registrar", () => traceDemoTransaction(async () => { throw error; }))).rejects.toBe(error);
    await traceDemoRequest("pedido:confirmar-recepcion", async () => ({
      ok: false, error: { code: "VALIDATION_ERROR", message: "Cantidad inválida" },
    }));
    const logs = output.mock.calls.flat().join("\n");
    expect(logs).toContain("Transacción rechazada; cambios no confirmados");
    expect(logs).toContain("Respuesta rechazada (VALIDATION_ERROR)");
    expect(logs).not.toContain("COMMIT completado");
    expect(logs).not.toContain("Respuesta OK");
    expect(logs).not.toContain("fallo privado");
  });

  it("un fallo de consola no cambia el resultado de la operación", async () => {
    vi.stubEnv("HUASCAR_DEMO", "1");
    vi.spyOn(console, "log").mockImplementation(() => { throw new Error("consola cerrada"); });
    expect(await traceDemoRequest("venta:registrar", async () => ({ ok: true, data: 42 })))
      .toEqual({ ok: true, data: 42 });
  });
});
