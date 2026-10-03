import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { MonthlySalesReport } from "../../../src/shared/monthly-sales";
import type { ControllerContext } from "../../../src/main/controllers/base";
import { ReportFileStore } from "../../../src/main/controllers/report-export-file";
import type { ReportExportDependencies } from "../../../src/main/controllers/report-export-service";
import { createMonthlySalesReportAdapter, createReportRegistry } from "../../../src/main/controllers/report-registry";

export const report: MonthlySalesReport = {
  periodo: { mes: 9, anio: 2026 }, transacciones: 1, montoTotal: 2500, montoMesAnterior: 0, variacionPorcentual: null,
  dias: Array.from({ length: 30 }, (_, index) => ({ fecha: `2026-09-${String(index + 1).padStart(2, "0")}`, transacciones: index === 0 ? 1 : 0, monto: index === 0 ? 2500 : 0 })),
  metodos: [{ metodo: "efectivo", transacciones: 1, monto: 2500 }],
};
export const user = { usuarioId: "owner", role: "dueno" as const, usuarioRol: "dueno", trabajadorNombre: "Ana <Dueña>" };
export const context: ControllerContext = { channel: "reporte:exportar-pdf", claims: {
  usuarioId: "owner", rol: "dueno", usuarioRol: "dueno", passwordTemporal: false, sesionId: "session",
} };
export const request = { tipo: "ventas-mensuales", periodo: report.periodo };
export function reportDependencies(directory: string, overrides: Partial<ReportExportDependencies> = {}): ReportExportDependencies {
  return {
    registry: createReportRegistry([createMonthlySalesReportAdapter(async () => ({ report, user }),
      async () => Buffer.from("pdf"), async () => Buffer.from("xlsx"))]),
    files: new ReportFileStore(join(directory, "evidence")),
    audit: { finalize: async (_op, publish) => publish(), confirmed: async () => true },
    selectDirectory: async () => directory, confirmOverwrite: async () => true,
    revalidate: async () => undefined, now: () => new Date("2026-09-30T13:00:00Z"), id: randomUUID,
    logError: () => undefined, ...overrides,
  };
}
