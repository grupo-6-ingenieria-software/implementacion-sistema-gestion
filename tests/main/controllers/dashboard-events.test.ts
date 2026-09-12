import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DASHBOARD_UPDATED_EVENT } from "../../../src/shared/dashboard";
import {
  SALE_ANNULLED_EVENT,
  type SaleAnnulmentResult,
} from "../../../src/shared/sales";

const {
  closeCashRegister,
  inspectDailyCashRegister,
  send,
  getAllWindows,
  logError,
  registerSale,
} = vi.hoisted(() => {
  const sendMock = vi.fn();

  return {
    send: sendMock,
    closeCashRegister: vi.fn(),
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

vi.mock("../../../src/main/controllers/cash-check", async () => {
  const actual = await vi.importActual<
    typeof import("../../../src/main/controllers/cash-check")
  >("../../../src/main/controllers/cash-check");
  return { ...actual, inspectDailyCashRegister };
});

vi.mock("electron-log/main", () => ({
  default: {
    error: logError,
  },
}));

vi.mock("../../../src/db/client", () => ({
  db: {},
}));

vi.mock("../../../src/main/controllers/sale-service", async () => {
  const actual = await vi.importActual<
    typeof import("../../../src/main/controllers/sale-service")
  >("../../../src/main/controllers/sale-service");

  return {
    ...actual,
    registerSale,
  };
});

vi.mock("../../../src/main/controllers/cash-closing-service", async () => {
  const actual = await vi.importActual<
    typeof import("../../../src/main/controllers/cash-closing-service")
  >("../../../src/main/controllers/cash-closing-service");

  return {
    ...actual,
    closeCashRegister,
  };
});

import { notifyDashboardUpdated } from "../../../src/main/controllers/dashboard-events";
import { notifySaleAnnulled } from "../../../src/main/controllers/sale-annulment-events";
import {
  SaleBusinessError,
} from "../../../src/main/controllers/sale-service";
import type { SaleReceipt } from "../../../src/shared/sales";
import { saleController } from "../../../src/main/controllers/sale";
import { cashClosingController } from "../../../src/main/controllers/cash-closing";
import type { CashCloseResult } from "../../../src/shared/cash";

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
  closeCashRegister.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("dashboard update events", () => {
  it("emits the CU38 event and dashboard refresh only after annulment commit", () => {
    const result = createAnnulmentResult();

    notifySaleAnnulled(result);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(1, SALE_ANNULLED_EVENT, result);
    expect(send).toHaveBeenNthCalledWith(2, DASHBOARD_UPDATED_EVENT);
  });

  it("still requests the dashboard refresh if the specific CU38 event fails", () => {
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

  it("emits the dashboard update event to every open window", () => {
    notifyDashboardUpdated();

    expect(getAllWindows).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(DASHBOARD_UPDATED_EVENT);
  });

  it("continues notifying other windows when one send fails", () => {
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

  it("emits an update after a sale is registered successfully", async () => {
    registerSale.mockResolvedValueOnce(createSaleReceipt());

    const response = await saleController.handle(
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

  it("keeps a successful sale response when dashboard notification fails", async () => {
    send.mockImplementationOnce(() => {
      throw new Error("renderer unavailable");
    });
    registerSale.mockResolvedValueOnce(createSaleReceipt());

    const response = await saleController.handle(
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

  it("does not emit an update when sale registration fails", async () => {
    registerSale.mockRejectedValueOnce(
      new SaleBusinessError("La caja se encuentra cerrada."),
    );

    const response = await saleController.handle(
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

  it("emits an update after cash closing succeeds", async () => {
    closeCashRegister.mockResolvedValueOnce(createCashCloseResult());

    const response = await cashClosingController.handle(
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

function createCashCloseResult(): CashCloseResult {
  return {
    cierreCajaId: "caja-1",
    closedAt: "2026-06-12T20:00:00.000Z",
    closedBy: {
      usuarioId: "usuario-1",
      nombre: "Trabajador Prueba",
    },
    currentAmount: 1000,
    currentTransactions: 1,
    generatedAt: "2026-06-12T20:00:00.000Z",
    openedAt: "2026-06-12T08:00:00.000Z",
    payments: {
      efectivo: {
        currentAmount: 0,
        currentTransactions: 0,
        voidedAmount: 0,
        voidedTransactions: 0,
      },
      debito: {
        currentAmount: 1000,
        currentTransactions: 1,
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
    status: "cerrada",
    voidedAmount: 0,
    voidedTransactions: 0,
  };
}
