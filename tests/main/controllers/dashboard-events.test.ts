import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DASHBOARD_UPDATED_EVENT } from "../../../src/shared/dashboard";
import {
  SALE_ANNULLED_EVENT,
  type SaleAnnulmentResult,
} from "../../../src/shared/sales";

const {
  cashDatabase,
  inspectDailyCashRegister,
  send,
  getAllWindows,
  logError,
  registerSale,
} = vi.hoisted(() => {
  const sendMock = vi.fn();

  // Ejecutor mínimo: basta para que closeCashRegister (ahora en cash-closing.ts)
  // complete una caja sin ventas y registre la auditoría.
  const sqlText = (value: unknown): string => {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map(sqlText).join(" ");
    if (!value || typeof value !== "object") return "";
    const record = value as { value?: unknown; queryChunks?: unknown };
    return `${sqlText(record.value)} ${sqlText(record.queryChunks)}`;
  };
  const cashDatabaseMock = {
    all: async (query: unknown): Promise<unknown[]> => {
      const text = sqlText(query);
      if (text.includes("usuario_version")) {
        return [{ usuarioVersionId: "version-1" }];
      }
      if (text.includes("usuario_rol IN")) {
        return [{ trabajadorId: 1, usuarioId: "usuario-1", usuarioRol: "dueno" }];
      }
      if (text.includes("FROM trabajador")) {
        return [{ trabajadorNombre: "Trabajador", trabajadorApellido: "Prueba" }];
      }
      return [];
    },
    run: async () => ({ rowsAffected: 1 }),
    transaction: async <T,>(callback: (tx: unknown) => Promise<T>) =>
      callback(cashDatabaseMock),
  };

  return {
    send: sendMock,
    cashDatabase: cashDatabaseMock,
    getAllWindows: vi.fn(),
    logError: vi.fn(),
    registerSale: vi.fn(),
    inspectDailyCashRegister: vi.fn(),
  };
});

vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows,
  },
}));

vi.mock("../../../src/main/controllers/VerificacionCajaHandler", async () => {
  const actual = await vi.importActual<
    typeof import("../../../src/main/controllers/VerificacionCajaHandler")
  >("../../../src/main/controllers/VerificacionCajaHandler");
  return { ...actual, inspectDailyCashRegister };
});

vi.mock("electron-log/main", () => ({
  default: {
    error: logError,
  },
}));

vi.mock("../../../src/db/client", () => ({
  db: cashDatabase,
}));

vi.mock("../../../src/main/controllers/RegistroVentaAuxiliar", async () => {
  const actual = await vi.importActual<
    typeof import("../../../src/main/controllers/RegistroVentaAuxiliar")
  >("../../../src/main/controllers/RegistroVentaAuxiliar");

  return {
    ...actual,
    registerSale,
  };
});

import { notifyDashboardUpdated } from "../../../src/main/controllers/EventosDashboardAuxiliar";
import { notifySaleAnnulled } from "../../../src/main/controllers/AnulacionVentaHandler";
import {
  SaleBusinessError,
} from "../../../src/main/controllers/RegistroVentaAuxiliar";
import type { SaleReceipt } from "../../../src/shared/sales";
import { ventaHandler } from "../../../src/main/controllers/VentaHandler";
import { cierreCajaHandler } from "../../../src/main/controllers/CierreCajaHandler";

const saleContext = {
  channel: "venta:registrar",
  claims: {
    usuarioId: "usuario-1",
    sesionId: "00000000-0000-4000-8000-000000000091",
    rol: "trabajador" as const,
    usuarioRol: "trabajador",
    passwordTemporal: false,
  },
};

beforeEach(() => {
  send.mockClear();
  getAllWindows.mockReset();
  getAllWindows.mockReturnValue([{ webContents: { send } }]);
  logError.mockReset();
  registerSale.mockReset();
  inspectDailyCashRegister.mockReset();
  inspectDailyCashRegister.mockResolvedValue({
    status: "abierta",
    cierreCajaId: "caja-1",
    openedAt: "2026-06-12T08:00:00.000Z",
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("eventos de actualización del dashboard", () => {
  it("emite el evento CU38 y la actualización del dashboard solo después del commit de anulación", () => {
    const result = createAnnulmentResult();

    notifySaleAnnulled(result);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(1, SALE_ANNULLED_EVENT, result);
    expect(send).toHaveBeenNthCalledWith(2, DASHBOARD_UPDATED_EVENT);
  });

  it("solicita igualmente la actualización del dashboard si falla el evento específico CU38", () => {
    send.mockImplementationOnce(() => {
      throw new Error("sale event unavailable");
    });

    notifySaleAnnulled(createAnnulmentResult());

    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(2, DASHBOARD_UPDATED_EVENT);
    expect(logError).toHaveBeenCalledWith(
      "No fue posible notificar la anulación de venta.",
      expect.any(Error),
    );
  });

  it("emite el evento de actualización del dashboard a cada ventana abierta", () => {
    notifyDashboardUpdated();

    expect(getAllWindows).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(DASHBOARD_UPDATED_EVENT);
  });

  it("sigue notificando a otras ventanas cuando falla un envío", () => {
    const failedSend = vi.fn(() => {
      throw new Error("window closed");
    });
    const successfulSend = vi.fn();
    getAllWindows.mockReturnValue([
      { webContents: { send: failedSend } },
      { webContents: { send: successfulSend } },
    ]);

    expect(() => notifyDashboardUpdated()).not.toThrow();

    expect(failedSend).toHaveBeenCalledWith(DASHBOARD_UPDATED_EVENT);
    expect(successfulSend).toHaveBeenCalledWith(DASHBOARD_UPDATED_EVENT);
    expect(logError).toHaveBeenCalledWith(
      "No fue posible notificar la actualizacion del dashboard.",
      expect.any(Error),
    );
  });

  it("emite una actualización después de registrar una venta con éxito", async () => {
    registerSale.mockResolvedValueOnce(createSaleReceipt());

    const response = await ventaHandler.handle(
      {
        usuarioId: "usuario-1",
        items: [{ productoId: 1, cantidad: 1 }],
        metodoPago: "debito",
      },
      saleContext,
    );

    expect(response.ok).toBe(true);
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(DASHBOARD_UPDATED_EVENT);
  });

  it("mantiene la respuesta exitosa de venta cuando falla la notificación del dashboard", async () => {
    send.mockImplementationOnce(() => {
      throw new Error("renderer unavailable");
    });
    registerSale.mockResolvedValueOnce(createSaleReceipt());

    const response = await ventaHandler.handle(
      {
        usuarioId: "usuario-1",
        items: [{ productoId: 1, cantidad: 1 }],
        metodoPago: "debito",
      },
      saleContext,
    );

    expect(response).toEqual({
      ok: true,
      data: createSaleReceipt(),
    });
    expect(logError).toHaveBeenCalledWith(
      "No fue posible notificar la actualizacion del dashboard.",
      expect.any(Error),
    );
  });

  it("no emite actualización cuando falla el registro de venta", async () => {
    registerSale.mockRejectedValueOnce(
      new SaleBusinessError("La caja se encuentra cerrada."),
    );

    const response = await ventaHandler.handle(
      {
        usuarioId: "usuario-1",
        items: [{ productoId: 1, cantidad: 1 }],
        metodoPago: "debito",
      },
      saleContext,
    );

    expect(response.ok).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("emite una actualización después de que el cierre de caja termina con éxito", async () => {
    const response = await cierreCajaHandler.handle(
      { confirmacion: true, usuarioId: "usuario-1" },
      { channel: "caja:cerrar" },
    );

    expect(response.ok).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(1, "caja:actualizada");
    expect(send).toHaveBeenCalledWith(DASHBOARD_UPDATED_EVENT);
  });
});

function createSaleReceipt(): SaleReceipt {
  return {
    ventaId: "venta-1",
    fechaHora: "2026-06-12T12:00:00.000Z",
    responsable: {
      usuarioId: "usuario-1",
      nombre: "Trabajador Prueba",
      rol: "trabajador",
    },
    metodoPago: "debito",
    subtotal: 1000,
    descuento: {
      tipo: "ninguno",
      valor: 0,
    },
    total: 1000,
    detalle: [],
  };
}

function createAnnulmentResult(): SaleAnnulmentResult {
  return {
    ventaId: "00000000-0000-4000-8000-000000000401",
    fechaHora: "2026-06-12T18:00:00.000Z",
    razon: "Cliente devolvió la compra",
    responsable: {
      usuarioId: "usuario-1",
      nombre: "Trabajador Prueba",
    },
    lotesRestituidos: 2,
    unidadesRestituidas: 3,
  };
}
