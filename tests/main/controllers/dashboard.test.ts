import { beforeEach, describe, expect, it, vi } from "vitest";

const allMock = vi.hoisted(() => vi.fn());

vi.mock("../../../src/db/client", () => ({
  db: {
    all: allMock,
  },
}));

import { dashboardController } from "../../../src/main/controllers/dashboard";
import { attendanceController } from "../../../src/main/controllers/attendance";

const claims = (rol: "dueno" | "trabajador", usuarioId = "usuario-1") => ({
  rol,
  usuarioId,
  usuarioRol: rol,
  passwordTemporal: false,
  sesionId: "session-1",
});
beforeEach(() => allMock.mockReset().mockResolvedValue([]));

describe("controlador de dashboard", () => {
  it("rechaza solicitudes sin un rol de desarrollo compatible", async () => {
    await expect(
      dashboardController.handle({}, { channel: "dashboard:cargar" }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        controllerId: "dashboard",
        message: "Se requiere una sesion valida para cargar el dashboard.",
      },
    });
  });

  it("rechaza solicitudes del dashboard de trabajador sin usuario autenticado", async () => {
    await expect(
      dashboardController.handle(
        { role: "trabajador" },
        { channel: "dashboard:cargar" },
      ),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        controllerId: "dashboard",
        message: "Se requiere una sesion valida para cargar el dashboard.",
      },
    });
  });

  it("carga los datos del dashboard para un rol de desarrollo compatible", async () => {
    allMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const response = await dashboardController.handle(
      { role: "trabajador" },
      { channel: "dashboard:cargar", claims: claims("dueno") },
    );

    expect(response.ok).toBe(true);
    expect(response).toMatchObject({
      ok: true,
      data: {
        sales: {
          currentAmount: 0,
          currentTransactions: 0,
          voidedAmount: 0,
          voidedTransactions: 0,
        },
        cashSummary: {
          status: "sin_registro",
          currentAmount: 0,
          currentTransactions: 0,
          voidedAmount: 0,
          voidedTransactions: 0,
          byPaymentMethod: {
            efectivo: {
              currentAmount: 0,
              currentTransactions: 0,
              voidedAmount: 0,
              voidedTransactions: 0,
            },
            debito: {
              currentAmount: 0,
              currentTransactions: 0,
              voidedAmount: 0,
              voidedTransactions: 0,
            },
            credito: {
              currentAmount: 0,
              currentTransactions: 0,
              voidedAmount: 0,
              voidedTransactions: 0,
            },
            transferencia: {
              currentAmount: 0,
              currentTransactions: 0,
              voidedAmount: 0,
              voidedTransactions: 0,
            },
          },
        },
        stockAlerts: [],
        expirationAlerts: {
          expired: [],
          expiringSoon: [],
        },
        attendance: {
          activeWorkers: 0,
          workersWithAttendance: 0,
          workersWithoutAttendance: 0,
          pendingWorkers: [],
        },
      },
    });
  });

  it("devuelve un error técnico cuando no se pueden leer los datos del dashboard", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    allMock.mockRejectedValueOnce(new Error("db unavailable"));

    await expect(
      dashboardController.handle(
        { role: "trabajador", usuarioId: "trabajador-1" },
        { channel: "dashboard:cargar", claims: claims("trabajador") },
      ),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "TECHNICAL_ERROR",
        controllerId: "dashboard",
        message: "No fue posible cargar los indicadores. Intente nuevamente",
      },
    });

    consoleError.mockRestore();
  });
});

describe("controlador de asistencia del dashboard", () => {
  it("rechaza resúmenes de trabajador sin usuario autenticado", async () => {
    await expect(
      attendanceController.handle(
        { role: "trabajador" },
        { channel: "asistencia:resumen-dashboard" },
      ),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        controllerId: "attendance",
        message:
          "Se requiere una sesion valida para cargar el resumen de asistencia.",
      },
    });
  });

  it("filtra la asistencia con identidad y rol de confianza, ignorando el payload falsificado", async () => {
    allMock
      .mockResolvedValueOnce([{ workerId: 2 }])
      .mockResolvedValueOnce([{ workerId: 2, fullName: "Luis Soto" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { workerId: 1, fullName: "Ana Perez" },
        { workerId: 2, fullName: "Luis Soto" },
      ])
      .mockResolvedValueOnce([{ workerId: 1 }]);
    const workerResponse = await attendanceController.handle(
      { role: "dueno", usuarioId: "usuario-ana" },
      {
        channel: "asistencia:resumen-dashboard",
        claims: claims("trabajador", "usuario-luis"),
      },
    );
    const ownerResponse = await attendanceController.handle(
      {},
      { channel: "asistencia:resumen-dashboard", claims: claims("dueno") },
    );
    expect(workerResponse).toEqual({
      ok: true,
      data: {
        scope: "own",
        workerId: 2,
        fullName: "Luis Soto",
        enteredAt: null,
        exitedAt: null,
      },
    });
    expect(ownerResponse).toMatchObject({
      ok: true,
      data: {
        scope: "global",
        activeWorkers: 2,
        workersWithAttendance: 1,
        workersWithoutAttendance: 1,
      },
    });
  });
});
