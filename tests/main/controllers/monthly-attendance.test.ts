import { afterEach, describe, expect, it, vi } from "vitest";
import { createMonthlyAttendanceController } from "../../../src/main/controllers/monthly-attendance";
import { MonthlyAttendanceError } from "../../../src/main/controllers/monthly-attendance-service";
import { AccessDeniedError } from "../../../src/main/controllers/auth-context";
import { authenticateChannel, authorizeRequest, CHANNEL_ROLES, guardChannel } from "../../../src/main/controllers/auth-guard";
import { handleWithAudit } from "../../../src/main/controllers/audit-dispatch";
import { createWorkerController } from "../../../src/main/controllers/worker";
import type { SessionTokenClaims } from "../../../src/main/controllers/auth-jwt";
import type { MonthlyAttendanceSummary } from "../../../src/shared/monthly-attendance";

const claims: SessionTokenClaims = { usuarioId: "trusted-owner", rol: "dueno", usuarioRol: "dueno", passwordTemporal: false, sesionId: "session" };
const request = { trabajadorId: 2, mes: 9, anio: 2026 };
const context = { channel: "asistencia:resumen-mensual", claims };
const report: MonthlyAttendanceSummary = {
  trabajador: { trabajadorId: 2, rut: "22222222-2", nombreCompleto: "Luis Rojas", estado: "inactivo" },
  periodo: { mes: 9, anio: 2026 }, dias: [], semanas: [],
  totales: { diasTrabajados: 0, minutosTrabajados: 0, ausenciasJustificadas: 0, ausenciasInjustificadas: 0 },
};
afterEach(() => vi.restoreAllMocks());

function workerController() {
  const authorize = vi.fn(async () => ({ role: "dueno" as const, usuarioId: claims.usuarioId, usuarioRol: "dueno", trabajadorNombre: "Ana Soto" }));
  const list = vi.fn(async () => [report.trabajador]);
  const controller = createWorkerController({ authorize, listSummaryWorkers: list, listActiveWorkers: async () => [], listWorkers: async () => [],
    changeStatus: async () => ({ usuarioId: "unused" }), createWorker: async () => ({ usuarioId: "unused" }), updateWorker: async () => ({ usuarioId: "unused" }) });
  return { authorize, list, controller };
}

describe("C52 monthly attendance controller, permissions and audit", () => {
  it("passes the validated request and trusted claims to the loader and returns an empty success", async () => {
    const load = vi.fn(async () => report);
    const controller = createMonthlyAttendanceController(load);
    expect(await controller.handle({ ...request, usuarioId: "spoofed", rol: "trabajador" }, context)).toEqual({ ok: true, data: report });
    expect(load).toHaveBeenCalledExactlyOnceWith(request, context);
    expect(controller.metadata).toMatchObject({ id: "attendance-monthly-summary", name: "ResumenAsistenciaHandler" });
  });
  it("rejects a missing session, a worker role and an unknown channel before loading records", async () => {
    const load = vi.fn(async () => report);
    const controller = createMonthlyAttendanceController(load);
    for (const identity of [undefined, { ...claims, rol: "trabajador" as const }]) {
      expect(await controller.handle(request, { ...context, claims: identity })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    }
    expect(await controller.handle(request, { ...context, channel: "invalid" })).toMatchObject({ ok: false, error: { code: "INVALID_CHANNEL" } });
    expect(load).not.toHaveBeenCalled();
  });
  it("validates inputs before performing database reads", async () => {
    const load = vi.fn(async () => report);
    expect(await createMonthlyAttendanceController(load).handle({ ...request, mes: 13 }, context)).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    expect(load).not.toHaveBeenCalled();
  });
  it.each(["NOT_FOUND", "BUSINESS_RULE"] as const)("preserves the %s domain error", async (code) => {
    const controller = createMonthlyAttendanceController(async () => { throw new MonthlyAttendanceError(code, "2026-09-08: conflicto"); });
    expect(await controller.handle(request, context)).toMatchObject({ ok: false, error: { code, message: "2026-09-08: conflicto" } });
  });
  it("reports authorization and database errors without leaking technical detail", async () => {
    expect(await createMonthlyAttendanceController(async () => { throw new AccessDeniedError(); }).handle(request, context)).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await createMonthlyAttendanceController(async () => { throw new Error("secret connection detail"); }).handle(request, context)).toMatchObject({ ok: false, error: { code: "DATABASE_ERROR", message: "No fue posible consultar el resumen de asistencia. Intente nuevamente." } });
  });
  it("loads summary worker choices exclusively with the owner claim identity", async () => {
    const { controller, authorize, list } = workerController();
    expect(await controller.handle({ usuarioId: "spoofed", __rolSesion: "trabajador" }, { channel: "trabajador:listar-para-resumen", claims })).toEqual({ ok: true, data: [report.trabajador] });
    expect(authorize).toHaveBeenCalledExactlyOnceWith(claims.usuarioId, ["dueno"], "dueno");
    expect(list).toHaveBeenCalledOnce();
    for (const identity of [undefined, { ...claims, rol: "trabajador" as const }]) {
      expect(await controller.handle({ usuarioId: "spoofed", __rolSesion: "dueno" }, { channel: "trabajador:listar-para-resumen", claims: identity })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    }
    expect(list).toHaveBeenCalledOnce();
  });
  it.each(["asistencia:resumen-mensual", "trabajador:listar-para-resumen"])("guards %s with the effective session role and trusted identity", async (channel) => {
    expect([...CHANNEL_ROLES.get(channel)!]).toEqual(["dueno"]);
    const audit = vi.fn(async () => undefined);
    expect((await guardChannel(channel, {}, { verifyToken: () => null, audit })).ok).toBe(false);
    expect((await guardChannel(channel, {}, { verifyToken: () => ({ ...claims, rol: "trabajador" }), audit })).ok).toBe(false);
    const allowed = await guardChannel(channel, { usuarioId: "spoofed" }, { verifyToken: () => ({ ...claims }), audit });
    if (!allowed.ok) throw new Error("Owner should be authorized");
    expect(allowed.payload).toMatchObject({ usuarioId: claims.usuarioId });
    const identity = (name: string, payload: unknown) => authenticateChannel(name, payload, { verifyToken: () => ({ ...claims }), audit });
    expect((await authorizeRequest(channel, {}, undefined, { identity, session: async () => ({ active: true, rolEfectivo: "trabajador" }), audit })).ok).toBe(false);
    expect((await authorizeRequest(channel, {}, undefined, { identity, session: async () => ({ active: false, reason: "inactividad" }), audit })).ok).toBe(false);
  });
  it("audits both successful queries once, including empty summaries, and fails when audit cannot be persisted", async () => {
    const audit = vi.fn(async () => undefined);
    const controller = createMonthlyAttendanceController(async () => report);
    expect((await handleWithAudit(controller, request, context, audit)).ok).toBe(true);
    expect(audit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ usuarioId: claims.usuarioId, tipoAccion: "consulta", modulo: "personal" }));
    audit.mockClear();
    expect((await handleWithAudit(workerController().controller, {}, { channel: "trabajador:listar-para-resumen", claims }, audit)).ok).toBe(true);
    expect(audit).toHaveBeenCalledOnce();
    expect(await handleWithAudit(controller, request, context, async () => { throw new Error("database unavailable"); })).toMatchObject({ ok: false, error: { code: "DATABASE_ERROR", message: "No fue posible registrar la auditoría de la consulta. Intente nuevamente." } });
    audit.mockClear();
    await handleWithAudit(createMonthlyAttendanceController(async () => { throw new MonthlyAttendanceError("BUSINESS_RULE", "conflict"); }), request, context, audit);
    expect(audit).not.toHaveBeenCalled();
  });
});
