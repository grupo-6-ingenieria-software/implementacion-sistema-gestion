import { beforeEach, describe, expect, it, vi } from "vitest";

const allMock = vi.hoisted(() => vi.fn());

vi.mock("../../../src/db/client", () => ({
  db: {
    all: allMock,
  },
}));

import { dailySalesTotalController } from "../../../src/main/controllers/daily-sales-total";

beforeEach(() => {
  allMock.mockReset().mockResolvedValue([]);
});

describe("controlador de total diario de ventas (CU44/C09)", () => {
  it("devuelve indicadores en cero cuando no hay ventas en el día chileno", async () => {
    await expect(
      dailySalesTotalController.handle(
        {},
        { channel: "dashboard:total-ventas-dia" },
      ),
    ).resolves.toEqual({
      ok: true,
      data: {
        currentAmount: 0,
        currentTransactions: 0,
        voidedAmount: 0,
        voidedTransactions: 0,
      },
    });
  });

  it("devuelve un error técnico genérico sin exponer detalles de la base de datos", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    allMock.mockRejectedValueOnce(
      new Error("SQLITE_IOERR at C:/private/ventas.db"),
    );

    const response = await dailySalesTotalController.handle(
      {},
      { channel: "dashboard:total-ventas-dia" },
    );

    expect(response).toEqual({
      ok: false,
      error: {
        code: "TECHNICAL_ERROR",
        controllerId: "daily-sales-total",
        message: "No fue posible cargar la informacion solicitada.",
      },
    });
    expect(JSON.stringify(response)).not.toContain("SQLITE_IOERR");
    expect(JSON.stringify(response)).not.toContain("private/ventas.db");
    consoleError.mockRestore();
  });
});
