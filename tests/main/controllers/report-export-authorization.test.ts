import { describe, expect, it, vi } from "vitest";
import { authenticateChannel, authorizeRequest, guardChannel } from "../../../src/main/controllers/auth-guard";
import { signSessionToken, type SessionTokenClaims } from "../../../src/main/controllers/auth-jwt";

const channels = ["reporte:exportar-pdf", "reporte:exportar-xlsx", "reporte:conciliar-exportacion"];
const claims: SessionTokenClaims = { usuarioId: "trusted", rol: "dueno", usuarioRol: "dueno", passwordTemporal: false, sesionId: "session" };
const descriptor = { tipo: "ventas-mensuales", periodo: { mes: 9, anio: 2026 } };

describe("autorización IPC de CU54 y sesión autoritativa", () => {
  it.each(channels)("rechaza JWT inválido en %s antes de consultar la sesión", async (channel) => {
    const session = vi.fn();
    const result = await authorizeRequest(channel, { ...descriptor, __authToken: "invalid", usuarioId: "spoofed" }, undefined,
      { identity: authenticateChannel, session });
    expect(result).toMatchObject({ ok: false, response: { error: { code: "FORBIDDEN" } } });
    expect(session).not.toHaveBeenCalled();
  });
  it.each(channels)("rechaza solicitudes directas de trabajador en %s", async (channel) => {
    const result = await guardChannel(channel, descriptor, {
      verifyToken: () => ({ ...claims, rol: "trabajador", usuarioRol: "trabajador" }), audit: vi.fn(async () => undefined),
    });
    expect(result).toMatchObject({ ok: false, response: { error: { code: "FORBIDDEN" } } });
  });
  it.each(channels)("confía en el rol efectivo de la sesión y rechaza dueños degradados en %s", async (channel) => {
    const result = await authorizeRequest(channel, { ...descriptor, __authToken: signSessionToken(claims), __rolSesion: "dueno" }, undefined, {
      identity: authenticateChannel, session: async () => ({ active: true, rolEfectivo: "trabajador" }), audit: vi.fn(async () => undefined),
    });
    expect(result).toMatchObject({ ok: false, response: { error: { code: "FORBIDDEN" } } });
  });
  it.each(["sistema", "inactividad", "sesion-inexistente"] as const)("rechaza sesiones %s para exportación y verificación", async (reason) => {
    for (const channel of channels) {
      const result = await authorizeRequest(channel, { ...descriptor, __authToken: signSessionToken(claims) }, undefined, {
        identity: authenticateChannel, session: async () => ({ active: false, reason }),
      });
      expect(result).toMatchObject({ ok: false, response: { error: { code: "FORBIDDEN" } } });
    }
  });
  it.each(channels)("usa la identidad firmada y no la identidad del renderer en %s", async (channel) => {
    const result = await authorizeRequest(channel, { ...descriptor, usuarioId: "spoofed", __authToken: signSessionToken(claims) }, undefined, {
      identity: authenticateChannel, session: async () => ({ active: true, rolEfectivo: "dueno" }),
    });
    expect(result).toMatchObject({ ok: true, context: { claims: { usuarioId: "trusted" } }, payload: { usuarioId: "trusted" } });
  });
});
