import { describe, expect, it, vi } from "vitest";
import { CHANNEL_ROLES } from "../../../src/main/controllers/auth-guard";
import { createDailySalesReportController } from "../../../src/main/controllers/daily-sales-report";
import { DailySalesReportValidationError } from "../../../src/main/controllers/daily-sales-report-service";
import type { DailySalesReport } from "../../../src/shared/reports";

const empty: DailySalesReport = {
  fecha: "2026-09-30", tieneVentas: false, ventas: [], topProductos: [],
  resumen: { ventasVigentes: 0, montoVigente: 0, porMetodoPago: {
    efectivo: { cantidad: 0, monto: 0 }, debito: { cantidad: 0, monto: 0 },
    credito: { cantidad: 0, monto: 0 }, transferencia: { cantidad: 0, monto: 0 },
  }, ventasAnuladas: 0, montoAnulado: 0 }, caja: { estado: "sin_registro" },
};
const claims = { usuarioId: "owner", rol: "dueno" as const, usuarioRol: "dueno", passwordTemporal: false, sesionId: "session" };

describe("CU46 acceso y C53", () => {
  it("asigna consulta y exportación solo al Dueño, sin cambiar inventario", () => {
    for (const channel of ["reporte:ventas-diarias", "reporte:exportar-pdf", "reporte:exportar-xlsx"]) {
      expect([...CHANNEL_ROLES.get(channel)!]).toEqual(["dueno"]);
    }
    for (const channel of ["inventario:reabastecimiento:exportar-pdf", "inventario:reabastecimiento:exportar-xlsx"]) {
      expect([...CHANNEL_ROLES.get(channel)!]).toEqual(["dueno", "trabajador"]);
    }
  });

  it("devuelve E1 y evita consultas de Trabajador por IPC directo", async () => {
    const load = vi.fn(async () => empty);
    const controller = createDailySalesReportController({ load });
    expect(await controller.handle({ fecha: empty.fecha }, { channel: "reporte:ventas-diarias", claims })).toEqual({ ok: true, data: empty });
    expect(await controller.handle({ fecha: empty.fecha }, { channel: "reporte:ventas-diarias", claims: { ...claims, rol: "trabajador" } })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(load).toHaveBeenCalledOnce();
  });

  it("distingue fecha inválida y fallo de base de datos", async () => {
    const controller = createDailySalesReportController({ load: async () => { throw new DailySalesReportValidationError("Ingrese una fecha válida."); } });
    expect(await controller.handle({}, { channel: "reporte:ventas-diarias", claims })).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    expect(await controller.handle({ fecha: "2026-02-30" }, { channel: "reporte:ventas-diarias", claims })).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    const broken = createDailySalesReportController({ load: async () => { throw new Error("db"); } });
    expect(await broken.handle({ fecha: empty.fecha }, { channel: "reporte:ventas-diarias", claims })).toMatchObject({ ok: false, error: { code: "DATABASE_ERROR" } });
  });
});
