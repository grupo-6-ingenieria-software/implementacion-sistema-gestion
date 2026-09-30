import { describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { CHANNEL_ROLES, guardChannel } from "../../../src/main/controllers/auth-guard";
import { createSaleCategoriesController } from "../../../src/main/controllers/sale-categories";
import type { SaleCategoryDb } from "../../../src/main/controllers/sale-categories-service";
import type { SessionTokenClaims } from "../../../src/main/controllers/auth-jwt";

const claims: SessionTokenClaims = {
  usuarioId: "trusted-worker",
  rol: "trabajador",
  usuarioRol: "trabajador",
  passwordTemporal: false,
  sesionId: "00000000-0000-4000-8000-000000000777",
};
const validRange = { fechaInicio: "2026-06-12", fechaTermino: "2026-06-12" };

describe("CU45 category controller and authorization", () => {
  it("grants both documented roles but rejects a missing session", async () => {
    expect(CHANNEL_ROLES.get("venta:por-categoria")).toEqual(new Set(["dueno", "trabajador"]));
    const denied = await guardChannel("venta:por-categoria", validRange, {
      verifyToken: () => null,
      audit: vi.fn(async () => undefined),
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok && !denied.response.ok) {
      expect(denied.response.error.code).toBe("FORBIDDEN");
    }
  });

  it("checks E1 after identity and before any sale read", async () => {
    const all = vi.fn(async () => []);
    const controller = createSaleCategoriesController({ all } as unknown as SaleCategoryDb);
    const noSession = await controller.handle(validRange, { channel: "venta:por-categoria" });
    expect(noSession).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    const reversed = await controller.handle(
      { fechaInicio: "2026-06-13", fechaTermino: "2026-06-12" },
      { channel: "venta:por-categoria", claims },
    );
    expect(reversed).toMatchObject({
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "La fecha de inicio no puede ser posterior a la fecha de término",
      },
    });
    expect(all).not.toHaveBeenCalled();
  });

  it("rejects impossible dates and reports E2 as a successful zero result", async () => {
    const all = vi.fn(async () => []);
    const controller = createSaleCategoriesController({ all } as unknown as SaleCategoryDb);
    expect(await controller.handle(
      { fechaInicio: "2026-02-29", fechaTermino: "2026-03-01" },
      { channel: "venta:por-categoria", claims },
    )).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    expect(all).not.toHaveBeenCalled();
    expect(await controller.handle(validRange, {
      channel: "venta:por-categoria", claims,
    })).toEqual({
      ok: true,
      data: { categorias: [], totales: { unidadesVendidas: 0, montoNeto: 0 } },
    });
  });

  it("uses the claim identity even if the payload spoofs a user", async () => {
    const all = vi.fn(async (_query: SQL) => []);
    const controller = createSaleCategoriesController({ all } as unknown as SaleCategoryDb);
    await controller.handle({ ...validRange, usuarioId: "other-user" }, {
      channel: "venta:por-categoria", claims,
    });
    const query = all.mock.calls[0][0];
    expect(JSON.stringify(query)).toContain("trusted-worker");
    expect(JSON.stringify(query)).not.toContain("other-user");
  });

  it("hides database details in technical errors", async () => {
    const controller = createSaleCategoriesController({
      all: vi.fn(async () => { throw new Error("SQL table and secret"); }),
    } as unknown as SaleCategoryDb);
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(await controller.handle(validRange, {
        channel: "venta:por-categoria", claims,
      })).toMatchObject({
        ok: false,
        error: {
          code: "TECHNICAL_ERROR",
          message: "No fue posible consultar las ventas por categoría.",
        },
      });
    } finally {
      spy.mockRestore();
    }
  });
});
