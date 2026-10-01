import { describe, expect, it } from "vitest";
import { formatWorkedHours, formatWorkedMinutes, getWorkedMinutes } from "../../src/shared/attendance";
import { buildMonthlyAttendancePath, getMonthlyAttendanceInitialRut, MONTHLY_ATTENDANCE_PATH, parseMonthlyAttendanceRequest } from "../../src/shared/monthly-attendance";
import { evaluateRouteAccess, getVisibleMenu, navigationTree } from "../../src/shared/navigation";
import { findControllerById, findControllerByChannel } from "../../src/shared/controllers";

const valid = { trabajadorId: 2, mes: 9, anio: 2026 };

describe("CU33 shared contract and navigation", () => {
  it.each([null, [], {}, { ...valid, trabajadorId: "2" }, { ...valid, trabajadorId: 0 },
    { ...valid, trabajadorId: 1.5 }, { ...valid, mes: 0 }, { ...valid, mes: 13 },
    { ...valid, mes: 2.5 }, { ...valid, anio: 1899 }, { ...valid, anio: 9999 },
    { ...valid, anio: "2026" }, { ...valid, anio: NaN }])("rejects invalid request %j", (input) => {
    expect(() => parseMonthlyAttendanceRequest(input)).toThrow(RangeError);
  });
  it("accepts future periods and both year boundaries without copying untrusted identity", () => {
    for (const anio of [1900, 2026, 9998]) expect(parseMonthlyAttendanceRequest({ ...valid, anio, usuarioId: "spoofed" })).toEqual({ ...valid, anio });
  });
  it("shares the existing minute truncation and allows totals above 24 hours", () => {
    expect(getWorkedMinutes("2026-09-08T12:00:45Z", "2026-09-08T20:01:44Z")).toBe(480);
    expect(formatWorkedHours("2026-09-08T12:00:45Z", "2026-09-08T20:01:44Z")).toBe("08:00");
    expect(formatWorkedMinutes(6001)).toBe("100:01");
    expect(formatWorkedMinutes(0)).toBe("00:00");
  });
  it("builds and reads editable worker preselection using normalized RUT", () => {
    expect(buildMonthlyAttendancePath()).toBe(MONTHLY_ATTENDANCE_PATH);
    const path = buildMonthlyAttendancePath("22.222.222-2");
    expect(getMonthlyAttendanceInitialRut(path)).toBe("22222222-2");
    expect(getMonthlyAttendanceInitialRut(MONTHLY_ATTENDANCE_PATH)).toBeUndefined();
  });
  it("registers V36 and C52 for the owner without reusing attendance mutation channels", () => {
    expect(navigationTree.find((node) => node.id === "attendance-monthly-summary")).toMatchObject({
      path: MONTHLY_ATTENDANCE_PATH, viewName: "ResumenMensualAsistenciaView", roles: ["dueno"], group: "personal", showInMenu: true,
    });
    expect(findControllerById("attendance-monthly-summary")).toMatchObject({ name: "ResumenAsistenciaHandler", channels: ["asistencia:resumen-mensual"] });
    expect(findControllerByChannel("trabajador:listar-para-resumen")?.id).toBe("worker");
    expect(getVisibleMenu("dueno").some((node) => node.id === "attendance-monthly-summary")).toBe(true);
    expect(getVisibleMenu("trabajador").some((node) => node.id === "attendance-monthly-summary")).toBe(false);
    expect(evaluateRouteAccess(MONTHLY_ATTENDANCE_PATH, { isAuthenticated: false }).status).toBe("redirect");
    expect(evaluateRouteAccess(MONTHLY_ATTENDANCE_PATH, { isAuthenticated: true, role: "trabajador" }).status).toBe("deny");
  });
});
