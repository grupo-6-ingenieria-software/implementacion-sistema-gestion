import { describe, expect, it } from "vitest";
import {
  ATTENDANCE_REPORT_PATH, attendanceFilterLabel, attendanceReportValues,
  parseAttendanceReportRequest,
} from "../../src/shared/attendance-report";
import { findControllerByChannel } from "../../src/shared/controllers";
import { evaluateRouteAccess, getVisibleMenu, internalComponents, navigationTree } from "../../src/shared/navigation";

const valid = { mes: 9, anio: 2026 };
describe("CU52 contract and navigation", () => {
  it.each([null, [], {}, { ...valid, mes: 0 }, { ...valid, mes: 13 }, { ...valid, mes: 1.5 },
    { ...valid, anio: 1899 }, { ...valid, anio: 9999 }, { ...valid, anio: "2026" },
    { ...valid, rol: "todos" }, { ...valid, rol: null }])("rejects invalid input %j", (payload) => {
    expect(() => parseAttendanceReportRequest(payload)).toThrow(RangeError);
  });
  it("normalizes optional roles and ignores untrusted extra fields", () => {
    expect(parseAttendanceReportRequest({ ...valid, usuarioId: "fake", filas: [] })).toEqual(valid);
    for (const rol of ["dueno", "trabajador"]) expect(parseAttendanceReportRequest({ ...valid, rol })).toEqual({ ...valid, rol });
    for (const anio of [1900, 9998]) expect(parseAttendanceReportRequest({ ...valid, anio }).anio).toBe(anio);
  });
  it("formats totals over 24 hours, N/A, zero and missing accounts", () => {
    const row = { trabajadorId: 1, nombreCompleto: "Inés Pérez", rol: null, diasTrabajados: 3,
      ausenciasJustificadas: 2, ausenciasInjustificadas: 1, minutosTrabajados: 6001, promedioMinutosPorDia: null };
    expect(attendanceReportValues(row)).toEqual(["Inés Pérez", "Sin usuario", 3, 2, 1, "100:01", "N/A"]);
    expect(attendanceReportValues({ ...row, promedioMinutosPorDia: 0 }).at(-1)).toBe("00:00");
    expect(attendanceFilterLabel(null)).toBe("Todos");
  });
  it("registers V43, C59 and the internal export components exclusively for the owner", () => {
    expect(navigationTree.find((node) => node.id === "attendance-report")).toMatchObject({
      path: ATTENDANCE_REPORT_PATH, viewName: "ReporteAsistenciaView", roles: ["dueno"], group: "reportes", showInMenu: true,
      controllerIds: expect.arrayContaining(["session", "attendance-report", "report-export", "audit"]),
    });
    expect(findControllerByChannel("reporte:asistencia")).toMatchObject({ id: "attendance-report", name: "ReporteAsistenciaHandler", module: "reportes" });
    expect(getVisibleMenu("dueno").some((node) => node.id === "attendance-report")).toBe(true);
    expect(getVisibleMenu("trabajador").some((node) => node.group === "reportes")).toBe(false);
    expect(evaluateRouteAccess(ATTENDANCE_REPORT_PATH, { isAuthenticated: false }).status).toBe("redirect");
    expect(evaluateRouteAccess(ATTENDANCE_REPORT_PATH, { isAuthenticated: true, role: "trabajador" })).toMatchObject({ status: "deny", to: "/app/inicio" });
    for (const id of ["export-format-action", "report-print-view"]) {
      expect(internalComponents.find((component) => component.id === id)?.usedIn).toContain("attendance-report");
    }
  });
});
