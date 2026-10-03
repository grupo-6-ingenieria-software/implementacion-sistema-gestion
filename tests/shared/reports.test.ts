import { describe, expect, it } from "vitest";
import { isReportExportRequest, parseReportExportRequest, REPORT_RECONCILE_CHANNEL, reportExportFormat } from "../../src/shared/reports";
import { createReportRegistry } from "../../src/main/controllers/report-registry";

describe("CU54 shared contract", () => {
  it.each(["reporte:exportar-pdf", "reporte:exportar-xlsx"])("keeps identity-only %s legacy and classifies malformed descriptors as reports", (channel) => {
    expect(isReportExportRequest(channel, { usuarioId: "owner", __authToken: "token", __rolSesion: "dueno" })).toBe(false);
    for (const payload of [{ tipo: "unknown" }, { periodo: {} }, { filtros: {} }, [], "bad", { filas: [] }, Object.create({ tipo: "inherited" })])
      expect(isReportExportRequest(channel, payload)).toBe(true);
  });
  it("always classifies reconciliation as owner-only regardless of payload", () => {
    expect(isReportExportRequest(REPORT_RECONCILE_CHANNEL, null)).toBe(true);
    expect(isReportExportRequest("venta:registrar", { tipo: "irrelevant" })).toBe(false);
    expect(reportExportFormat(REPORT_RECONCILE_CHANNEL)).toBeNull();
  });
  it("retains only the descriptor, never rows, identity or destination", () => {
    const request = { tipo: "ventas-mensuales", periodo: { mes: 9, anio: 2026 }, filtros: {} };
    expect(parseReportExportRequest({ ...request, filas: [{ monto: 100 }], usuarioId: "fake", ruta: "fake" })).toEqual(request);
  });
  it("does not allow duplicate adapter identities", () => {
    const adapter = { tipo: "duplicate", normalize: (request: any) => request, load: async () => { throw new Error("unused"); } };
    expect(() => createReportRegistry([adapter, adapter])).toThrow("DuplicateReportAdapter");
  });
});
