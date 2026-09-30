import { afterEach, describe, expect, it, vi } from "vitest";
import { createAbsenceController } from "../../../src/main/controllers/absence";
import { AbsenceError } from "../../../src/main/controllers/absence-service";
import { guardChannel, CHANNEL_ROLES } from "../../../src/main/controllers/auth-guard";
import type { SessionTokenClaims } from "../../../src/main/controllers/auth-jwt";
import type { DbExecutor } from "../../../src/main/controllers/sale-service";
import type { AbsenceResult } from "../../../src/shared/absence";

const claims: SessionTokenClaims = { usuarioId: "11111111-1", rol: "dueno", usuarioRol: "dueno", passwordTemporal: false, sesionId: "00000000-0000-4000-8000-000000000701" };
const result: AbsenceResult = { ausenciaId: "created", trabajadorId: 2, trabajadorNombre: "Ana Soto", fecha: "2026-09-08", tipo: "justificada", registradoAt: "2026-09-08T15:00:00Z" };
const database = {} as DbExecutor;
afterEach(() => vi.restoreAllMocks());

describe("C51 absence controller and channel access", () => {
  it("passes claims separately from payload identity and returns the standard contract", async () => {
    const register = vi.fn(async () => result);
    const controller = createAbsenceController(register, database);
    const payload = { trabajadorId: 2, usuarioId: "spoofed", rol: "dueno" };
    expect(await controller.handle(payload, { channel: "ausencia:registrar", claims })).toEqual({ ok: true, data: result });
    expect(register).toHaveBeenCalledWith(database, payload, claims);
    expect(controller.metadata).toMatchObject({ id: "absence", name: "AusenciaHandler" });
  });
  it("rejects direct calls without an owner session before executing the service", async () => {
    const register = vi.fn(async () => result);
    const controller = createAbsenceController(register, database);
    for (const identity of [undefined, { ...claims, rol: "trabajador" as const }]) {
      expect(await controller.handle({}, { channel: "ausencia:registrar", claims: identity })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    }
    expect(register).not.toHaveBeenCalled();
  });
  it.each(["VALIDATION_ERROR", "NOT_FOUND", "BUSINESS_RULE", "FORBIDDEN"] as const)("returns %s with field detail", async (code) => {
    const controller = createAbsenceController(async () => { throw new AbsenceError(code, "Domain error", { fecha: "Fecha inválida" }); }, database);
    expect(await controller.handle({}, { channel: "ausencia:registrar", claims })).toMatchObject({ ok: false, error: { code, controllerId: "absence", fieldErrors: { fecha: "Fecha inválida" } } });
  });
  it("returns a safe technical error and handles an unknown channel", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const controller = createAbsenceController(async () => { throw new Error("internal failure"); }, database);
    expect(await controller.handle({}, { channel: "ausencia:registrar", claims })).toMatchObject({ ok: false, error: { code: "TECHNICAL_ERROR", message: "No fue posible registrar la ausencia. Intente nuevamente." } });
    expect(await controller.handle({}, { channel: "invalid", claims })).toMatchObject({ ok: false, error: { code: "INVALID_CHANNEL" } });
  });
  it("enforces owner-only IPC access and overwrites a spoofed account", async () => {
    expect([...CHANNEL_ROLES.get("ausencia:registrar")!]).toEqual(["dueno"]);
    const audit = vi.fn(async () => undefined);
    const denied = await guardChannel("ausencia:registrar", { usuarioId: "spoofed" }, { verifyToken: () => ({ ...claims, rol: "trabajador" }), audit });
    expect(denied.ok).toBe(false);
    expect(audit).toHaveBeenCalledOnce();
    const allowed = await guardChannel("ausencia:registrar", { usuarioId: "spoofed" }, { verifyToken: () => claims, audit });
    expect(allowed.ok).toBe(true);
    if (allowed.ok) expect(allowed.payload).toMatchObject({ usuarioId: claims.usuarioId });
    expect((await guardChannel("ausencia:registrar", {}, { verifyToken: () => null, audit })).ok).toBe(false);
  });
});
