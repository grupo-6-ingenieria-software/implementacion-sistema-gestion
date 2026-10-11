import { describe, expect, it, vi } from "vitest";
import { controllers } from "../../../src/shared/controllers";
import { AUDITED_QUERY_CHANNELS, handleWithAudit } from "../../../src/main/controllers/audit-dispatch";
import type { ControllerContext, RegisteredController } from "../../../src/main/controllers/base";

function context(channel: string): ControllerContext {
  return { channel, claims: {
    usuarioId: "trusted-owner", rol: "dueno", usuarioRol: "dueno",
    passwordTemporal: false, sesionId: "session",
  } };
}

function controller(channel: string, data: unknown = {}): RegisteredController {
  return {
    metadata: controllers.find((entry) => (entry.channels as readonly string[]).includes(channel))!,
    handle: vi.fn(async () => ({ ok: true as const, data })),
  };
}

describe("RF58 auditoría de consultas y exportaciones de negocio", () => {
  it.each([...AUDITED_QUERY_CHANNELS])("audita la consulta exitosa %s con la identidad confiable", async (channel) => {
    const audit = vi.fn(async () => undefined);
    const handler = controller(channel);
    const response = await handleWithAudit(handler, { usuarioId: "spoofed" }, context(channel), audit);
    expect(response.ok).toBe(true);
    expect(audit).toHaveBeenCalledExactlyOnceWith({
      descripcion: `Consulta realizada mediante ${channel}.`,
      modulo: handler.metadata.module, tipoAccion: "consulta", usuarioId: "trusted-owner",
    });
  });

  it.each(["inventario:reabastecimiento:exportar-pdf", "inventario:reabastecimiento:exportar-xlsx"])("audita la exportación guardada %s, pero no las cancelaciones", async (channel) => {
    const audit = vi.fn(async () => undefined);
    await handleWithAudit(controller(channel, { estado: "saved" }), {}, context(channel), audit);
    expect(audit).toHaveBeenCalledOnce();
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ tipoAccion: "exportacion" }));
    audit.mockClear();
    await handleWithAudit(controller(channel, { estado: "cancelled" }), {}, context(channel), audit);
    expect(audit).not.toHaveBeenCalled();
  });

  it("no duplica registros de mutación, inicio de sesión, consulta de auditoría o heartbeat", async () => {
    const audit = vi.fn(async () => undefined);
    for (const channel of ["producto:registrar", "producto:editar", "venta:anular", "auth:login",
      "auditoria:consultar", "auditoria:registrar", "auth:verificar-sesion", "ean:validar-captura"]) {
      await handleWithAudit(controller(channel), {}, context(channel), audit);
    }
    expect(audit).not.toHaveBeenCalled();
  });

  it("no registra como exitosas las consultas fallidas", async () => {
    const audit = vi.fn(async () => undefined);
    const handler = controller("producto:listar");
    handler.handle = async () => ({ ok: false, error: { code: "DATABASE_ERROR", message: "error" } });
    expect((await handleWithAudit(handler, {}, context("producto:listar"), audit)).ok).toBe(false);
    expect(audit).not.toHaveBeenCalled();
  });

  it("informa el fallo de persistencia de la auditoría, incluyendo si la exportación fue guardada", async () => {
    const audit = vi.fn(async () => { throw new Error("database unavailable"); });
    expect(await handleWithAudit(controller("producto:listar"), {}, context("producto:listar"), audit))
      .toMatchObject({ ok: false, error: { code: "DATABASE_ERROR" } });
    expect(await handleWithAudit(controller("inventario:reabastecimiento:exportar-pdf", { estado: "saved" }), {}, context("inventario:reabastecimiento:exportar-pdf"), audit))
      .toMatchObject({ ok: false, error: { message: "El archivo fue guardado, pero no fue posible registrar su auditoría." } });
  });
});
