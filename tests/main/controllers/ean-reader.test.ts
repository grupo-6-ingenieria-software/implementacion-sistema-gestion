import { describe, expect, it, vi } from "vitest";
import { createEanReaderController, eanReaderController } from "../../../src/main/controllers/ean-reader";
import type { ControllerContext } from "../../../src/main/controllers/base";
import { authorizeRequest, guardChannel, CHANNEL_ROLES } from "../../../src/main/controllers/auth-guard";
import { handleWithAudit } from "../../../src/main/controllers/audit-dispatch";

const claims = {
  usuarioId: "trusted-user", rol: "trabajador" as const, usuarioRol: "trabajador",
  passwordTemporal: false, sesionId: "trusted-session",
};
const context: ControllerContext = { channel: "ean:validar-captura", claims };
const failureContext: ControllerContext = { ...context, channel: "ean:registrar-fallo" };
const product = {
  ean13: "7802920000015", nombre: "Leche", categoriaId: 1,
  precioVenta: 1000, stockMinimo: 1, estado: "activo" as const,
};

function fixture() {
  const findProduct = vi.fn(async () => product);
  const report = vi.fn(async () => ({ ok: true as const, data: { registrado: true as const } }));
  return { findProduct, report, controller: createEanReaderController({ findProduct, report }) };
}

describe("ean reader controller", () => {
  it("accepts a valid EAN-13 capture", async () => {
    const response = await eanReaderController.handle(
      { value: "7802920000015" },
      context,
    );

    expect(response).toEqual({
      ok: true,
      data: { ean13: "7802920000015" },
    });
  });

  it("rejects an EAN-13 capture with invalid length", async () => {
    const response = await eanReaderController.handle(
      { value: "780292000001" },
      context,
    );

    expect(response.ok).toBe(false);
    if (response.ok) {
      throw new Error("Expected EAN validation failure");
    }

    expect(response.error.code).toBe("VALIDATION_ERROR");
    expect(response.error.fieldErrors).toMatchObject({
      ean13: "El codigo EAN-13 debe tener exactamente 13 digitos numericos.",
    });
  });

  it.each(["", "78029200000155", "780292000001a", "x7802920000015", "780-2920000015", "7802920000017"])(
    "rejects malformed capture without sanitizing it into a valid code: %s", async (value) => {
      const { controller, findProduct } = fixture();
      expect(await controller.handle({ value, mode: "buscar-producto" }, context))
        .toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR", message: "Código inválido, intente escanear nuevamente" } });
      expect(findProduct).not.toHaveBeenCalled();
    },
  );

  it("accepts surrounding scanner whitespace and preserves validation-only mode for new products", async () => {
    const { controller, findProduct } = fixture();
    expect(await controller.handle({ value: " 4006381333931\r\n", mode: "validar" }, context))
      .toEqual({ ok: true, data: { ean13: "4006381333931" } });
    expect(findProduct).not.toHaveBeenCalled();
  });

  it("uses the product dependency only in lookup mode", async () => {
    const { controller, findProduct } = fixture();
    expect(await controller.handle({ value: product.ean13, mode: "buscar-producto" }, context))
      .toEqual({ ok: true, data: { ean13: product.ean13, producto: product } });
    expect(findProduct).toHaveBeenCalledExactlyOnceWith(product.ean13);
  });

  it("reports an unknown product and database failure without treating either as a capture success", async () => {
    const controller = createEanReaderController({
      findProduct: async () => null, report: fixture().report,
    });
    expect(await controller.handle({ value: product.ean13, mode: "buscar-producto" }, context))
      .toMatchObject({ ok: false, error: { code: "NOT_FOUND", message: "Producto no encontrado" } });
    const broken = createEanReaderController({
      findProduct: async () => { throw new Error("offline"); }, report: fixture().report,
    });
    expect(await broken.handle({ value: product.ean13, mode: "buscar-producto" }, context))
      .toMatchObject({ ok: false, error: { code: "DATABASE_ERROR" } });
  });

  it.each(["ean:validar-captura", "ean:registrar-fallo"])("requires trusted claims for %s", async (channel) => {
    expect(await eanReaderController.handle({ value: product.ean13, modulo: "ventas", usuarioId: "spoofed" }, { channel }))
      .toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("rejects unknown channels, modes and module contexts", async () => {
    const { controller, report } = fixture();
    expect(await controller.handle({}, { ...context, channel: "ean:otro" }))
      .toMatchObject({ ok: false, error: { code: "INVALID_CHANNEL" } });
    expect(await controller.handle({ value: product.ean13, mode: "otro" }, context))
      .toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    for (const payload of [null, {}, { modulo: "otro" }]) {
      expect(await controller.handle(payload, failureContext)).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    }
    expect(report).not.toHaveBeenCalled();
  });

  it.each(["dueno", "trabajador"] as const)("reports failure using trusted %s identity and server description, without EAN", async (rol) => {
    const { controller, report } = fixture();
    expect(CHANNEL_ROLES.get("ean:registrar-fallo")?.has(rol)).toBe(true);
    const response = await controller.handle({
      modulo: "ventas", usuarioId: "spoofed", rol: "dueno", ean13: product.ean13,
      descripcion: "inventada", fechaHora: "inventada",
    }, { ...failureContext, claims: { ...claims, rol } });
    expect(response).toEqual({ ok: true, data: { registrado: true } });
    expect(report).toHaveBeenCalledExactlyOnceWith({
      usuarioId: claims.usuarioId, modulo: "ventas", tipoAccion: "lectura_fallida",
      descripcion: "Lectura fallida reportada por el usuario. Se permite reintentar o ingresar el código manualmente.",
    });
  });

  it("propagates audit failure and permits a later retry", async () => {
    const report = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: { code: "DATABASE_ERROR", controllerId: "audit", message: "No fue posible registrar la auditoria." } })
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ ok: true, data: { registrado: true } });
    const controller = createEanReaderController({ findProduct: fixture().findProduct, report });
    for (let i = 0; i < 2; i++) {
      expect(await controller.handle({ modulo: "ventas" }, failureContext))
        .toMatchObject({ ok: false, error: { code: "DATABASE_ERROR", controllerId: "ean-reader" } });
    }
    expect(await controller.handle({ modulo: "ventas" }, failureContext)).toMatchObject({ ok: true });
  });

  it.each(["ean:validar-captura", "ean:registrar-fallo"])("the dispatcher rejects missing or invalid JWT for %s", async (channel) => {
    const session = vi.fn();
    for (const __authToken of [undefined, "invalid-token"]) {
      const result = await authorizeRequest(channel, { __authToken, usuarioId: "spoofed", modulo: "ventas" }, undefined, {
        identity: guardChannel, session,
      });
      expect(result).toMatchObject({ ok: false, response: { error: { code: "FORBIDDEN" } } });
    }
    expect(session).not.toHaveBeenCalled();
  });

  it.each(["ean:validar-captura", "ean:registrar-fallo"])("the dispatcher rejects expired persisted sessions for %s", async (channel) => {
    const identity = vi.fn(async () => ({ ok: true as const, context: { ...context, channel }, payload: { modulo: "ventas" } }));
    const result = await authorizeRequest(channel, {}, undefined, {
      identity, session: async () => ({ active: false, reason: "inactividad" }),
    });
    expect(result.ok).toBe(false);
  });

  it("records the explicit failure once without duplicating it in the audit dispatcher", async () => {
    const { controller, report } = fixture();
    const audit = vi.fn(async () => undefined);
    expect(await handleWithAudit(controller, { modulo: "ventas" }, failureContext, audit)).toMatchObject({ ok: true });
    expect(report).toHaveBeenCalledOnce();
    expect(audit).not.toHaveBeenCalled();
  });
});
