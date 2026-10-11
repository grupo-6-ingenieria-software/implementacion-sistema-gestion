import { describe, expect, it } from "vitest";
import { isReportExportRequest, parseReportExportRequest, REPORT_RECONCILE_CHANNEL, reportExportFormat } from "../../src/shared/reports";
import { createReportRegistry } from "../../src/main/controllers/report-registry";

describe("contrato compartido CU54", () => {
  it.each(["reporte:exportar-pdf", "reporte:exportar-xlsx"])("mantiene %s legado solo con identidad y clasifica descriptores malformados como reportes", (channel) => {
    expect(isReportExportRequest(channel, { usuarioId: "owner", __authToken: "token", __rolSesion: "dueno" })).toBe(false);
    for (const payload of [{ tipo: "unknown" }, { periodo: {} }, { filtros: {} }, [], "bad", { filas: [] }, Object.create({ tipo: "inherited" })])
      expect(isReportExportRequest(channel, payload)).toBe(true);
  });
  it("clasifica siempre la conciliación como exclusiva del dueño, sin importar el payload", () => {
    expect(isReportExportRequest(REPORT_RECONCILE_CHANNEL, null)).toBe(true);
    expect(isReportExportRequest("venta:registrar", { tipo: "irrelevant" })).toBe(false);
    expect(reportExportFormat(REPORT_RECONCILE_CHANNEL)).toBeNull();
  });
  it("conserva solo el descriptor, nunca filas, identidad o destino", () => {
    const request = { tipo: "ventas-mensuales", periodo: { mes: 9, anio: 2026 }, filtros: {} };
    expect(parseReportExportRequest({ ...request, filas: [{ monto: 100 }], usuarioId: "fake", ruta: "fake" })).toEqual(request);
  });
  it("no permite identidades de adaptador duplicadas", () => {
    const adapter = { tipo: "duplicate", normalize: (request: any) => request, load: async () => { throw new Error("unused"); } };
    expect(() => createReportRegistry([adapter, adapter])).toThrow("DuplicateReportAdapter");
  });
});
