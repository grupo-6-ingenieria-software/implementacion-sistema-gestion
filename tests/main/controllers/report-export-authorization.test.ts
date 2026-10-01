import { describe, expect, it, vi } from "vitest";
import { authenticateChannel, authorizeRequest, guardChannel } from "../../../src/main/controllers/auth-guard";
import { signSessionToken, type SessionTokenClaims } from "../../../src/main/controllers/auth-jwt";

const channels = ["reporte:exportar-pdf", "reporte:exportar-xlsx", "reporte:conciliar-exportacion"];
const claims: SessionTokenClaims = { usuarioId: "trusted", rol: "dueno", usuarioRol: "dueno", passwordTemporal: false, sesionId: "session" };
const descriptor = { tipo: "ventas-mensuales", periodo: { mes: 9, anio: 2026 } };

describe("CU54 IPC authorization and authoritative session", () => {
  it.each(channels)("rejects invalid JWT on %s before consulting the session", async (channel) => {
    const session = vi.fn();
    const result = await authorizeRequest(channel, { ...descriptor, __authToken: "invalid", usuarioId: "spoofed" }, undefined,
      { identity: authenticateChannel, session });
    expect(result).toMatchObject({ ok: false, response: { error: { code: "FORBIDDEN" } } });
    expect(session).not.toHaveBeenCalled();
  });
  it.each(channels)("rejects direct worker requests on %s", async (channel) => {
    const result = await guardChannel(channel, descriptor, {
      verifyToken: () => ({ ...claims, rol: "trabajador", usuarioRol: "trabajador" }), audit: vi.fn(async () => undefined),
    });
    expect(result).toMatchObject({ ok: false, response: { error: { code: "FORBIDDEN" } } });
  });
  it.each(channels)("trusts the effective session role and rejects demoted owners on %s", async (channel) => {
    const result = await authorizeRequest(channel, { ...descriptor, __authToken: signSessionToken(claims), __rolSesion: "dueno" }, undefined, {
      identity: authenticateChannel, session: async () => ({ active: true, rolEfectivo: "trabajador" }), audit: vi.fn(async () => undefined),
    });
    expect(result).toMatchObject({ ok: false, response: { error: { code: "FORBIDDEN" } } });
  });
  it.each(["sistema", "inactividad", "sesion-inexistente"] as const)("rejects %s sessions for export and verification", async (reason) => {
    for (const channel of channels) {
      const result = await authorizeRequest(channel, { ...descriptor, __authToken: signSessionToken(claims) }, undefined, {
        identity: authenticateChannel, session: async () => ({ active: false, reason }),
      });
      expect(result).toMatchObject({ ok: false, response: { error: { code: "FORBIDDEN" } } });
    }
  });
  it.each(channels)("uses the signed identity rather than renderer identity on %s", async (channel) => {
    const result = await authorizeRequest(channel, { ...descriptor, usuarioId: "spoofed", __authToken: signSessionToken(claims) }, undefined, {
      identity: authenticateChannel, session: async () => ({ active: true, rolEfectivo: "dueno" }),
    });
    expect(result).toMatchObject({ ok: true, context: { claims: { usuarioId: "trusted" } }, payload: { usuarioId: "trusted" } });
  });
});
