import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/db/client", () => ({ db: {} }));

import { AccessDeniedError } from "../../../src/main/controllers/auth-context";
import { createSaleAnnulmentController } from "../../../src/main/controllers/sale-annulment";
import {
  SaleAnnulmentBusinessError,
  SaleAnnulmentNotFoundError,
  SaleAnnulmentValidationError,
} from "../../../src/main/controllers/sale-annulment-service";
import type { SaleAnnulmentResult } from "../../../src/shared/sales";

const result: SaleAnnulmentResult = {
  ventaId: "00000000-0000-4000-8000-000000000401",
  fechaHora: "2026-06-12T18:00:00.000Z",
  razon: "Error de cobro",
  responsable: { usuarioId: "usuario-1", nombre: "Maria Huascar" },
  lotesRestituidos: 2,
  unidadesRestituidas: 3,
};

function dependencies() {
  return {
    annul: vi.fn().mockResolvedValue(result),
    notify: vi.fn(),
  };
}

describe("CU38 sale annulment controller", () => {
  it("notifies only after the annulment transaction resolves", async () => {
    const deps = dependencies();
    let finish!: (value: SaleAnnulmentResult) => void;
    deps.annul.mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)),
    );
    const request = createSaleAnnulmentController(deps).handle(
      { ventaId: result.ventaId, razon: result.razon, usuarioId: "usuario-1" },
      { channel: "venta:anular" },
    );

    await vi.waitFor(() => expect(deps.annul).toHaveBeenCalledOnce());
    expect(deps.notify).not.toHaveBeenCalled();
    finish(result);

    await expect(request).resolves.toEqual({ ok: true, data: result });
    expect(deps.notify).toHaveBeenCalledWith(result);
  });

  it.each([
    [new SaleAnnulmentValidationError("Razón obligatoria"), "VALIDATION_ERROR"],
    [new SaleAnnulmentNotFoundError("No encontrada"), "NOT_FOUND"],
    [new SaleAnnulmentBusinessError("Caja cerrada"), "BUSINESS_RULE"],
    [new AccessDeniedError("Sin permiso"), "FORBIDDEN"],
  ])("maps domain error %# without notifying", async (error, code) => {
    const deps = dependencies();
    deps.annul.mockRejectedValueOnce(error);

    const response = await createSaleAnnulmentController(deps).handle(
      {},
      { channel: "venta:anular" },
    );

    expect(response).toMatchObject({ ok: false, error: { code } });
    expect(deps.notify).not.toHaveBeenCalled();
  });

  it("hides unexpected persistence details", async () => {
    const deps = dependencies();
    deps.annul.mockRejectedValueOnce(new Error("database secret"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await createSaleAnnulmentController(deps).handle(
      {},
      { channel: "venta:anular" },
    );

    expect(response).toEqual({
      ok: false,
      error: {
        code: "TECHNICAL_ERROR",
        controllerId: "sale-annulment",
        message: "No fue posible anular la venta. Intente nuevamente.",
      },
    });
    expect(deps.notify).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
