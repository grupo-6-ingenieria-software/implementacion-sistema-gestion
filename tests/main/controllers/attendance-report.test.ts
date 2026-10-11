import { afterEach, describe, expect, it, vi } from "vitest";
import { createAttendanceReportController } from "../../../src/main/controllers/attendance-report";
import { AccessDeniedError } from "../../../src/main/controllers/auth-context";
import { authenticateChannel, authorizeRequest, CHANNEL_ROLES, guardChannel } from "../../../src/main/controllers/auth-guard";
import { handleWithAudit } from "../../../src/main/controllers/audit-dispatch";
import { MonthlyAttendanceError } from "../../../src/main/controllers/monthly-attendance-calculation";
import type { SessionTokenClaims } from "../../../src/main/controllers/auth-jwt";
import type { AttendanceReport } from "../../../src/shared/attendance-report";

const claims: SessionTokenClaims = { usuarioId: "trusted-owner", rol: "dueno", usuarioRol: "dueno", passwordTemporal: false, sesionId: "session" };
const request = { mes: 9, anio: 2026, rol: "trabajador" as const };
const context = { channel: "reporte:asistencia", claims };
const report: AttendanceReport = { periodo: { mes: 9, anio: 2026 }, rol: "trabajador", filas: [] };
const user = { role: "dueno" as const, usuarioId: claims.usuarioId, usuarioRol: "dueno", trabajadorNombre: "Ana Soto" };
afterEach(() => vi.restoreAllMocks());

describe("controlador, acceso y auditoría de C59", () => {
  it("pasa al cargador solo filtros validados y contexto confiable, incluidos resultados vacíos", async () => {
    const load = vi.fn(async () => ({ report, user }));
    const controller = createAttendanceReportController(load);
    expect(await controller.handle({ ...request, usuarioId: "fake", filas: [{ nombreCompleto: "Fake" }] }, context)).toEqual({ ok: true, data: report });
    expect(load).toHaveBeenCalledExactlyOnceWith(request, context);
    expect(controller.metadata).toMatchObject({ id: "attendance-report", name: "ReporteAsistenciaHandler", module: "reportes", channels: ["reporte:asistencia"] });
  });
  it("rechaza canales incorrectos, filtros inválidos y llamadores no autorizados antes de cargar", async () => {
    const load = vi.fn(async () => ({ report, user }));
    const controller = createAttendanceReportController(load);
    expect(await controller.handle(request, { ...context, channel: "asistencia:entrada" })).toMatchObject({ ok: false, error: { code: "INVALID_CHANNEL" } });
    expect(await controller.handle({ ...request, mes: 0 }, context)).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    for (const identity of [undefined, { ...claims, rol: "trabajador" as const }]) {
      expect(await controller.handle({ ...request, usuarioId: "fake", __rolSesion: "dueno" }, { channel: context.channel, claims: identity })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    }
    expect(load).not.toHaveBeenCalled();
  });
  it("propaga conflictos y errores de autorización, sin exponer detalles de la base de datos", async () => {
    expect(await createAttendanceReportController(async () => { throw new MonthlyAttendanceError("BUSINESS_RULE", "Luis: 2026-09-08"); }).handle(request, context)).toMatchObject({ ok: false, error: { code: "BUSINESS_RULE", message: "Luis: 2026-09-08" } });
    expect(await createAttendanceReportController(async () => { throw new AccessDeniedError(); }).handle(request, context)).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await createAttendanceReportController(async () => { throw new Error("Secret details"); }).handle(request, context)).toMatchObject({ ok: false, error: { code: "DATABASE_ERROR", message: "No fue posible consultar el reporte de asistencia. Intente nuevamente." } });
  });
  it("exige identidad válida, sesión activa y el rol de dueño efectivo", async () => {
    expect([...CHANNEL_ROLES.get(context.channel)!]).toEqual(["dueno"]);
    const audit = vi.fn(async () => undefined);
    expect((await guardChannel(context.channel, {}, { verifyToken: () => null, audit })).ok).toBe(false);
    expect((await guardChannel(context.channel, {}, { verifyToken: () => ({ ...claims, rol: "trabajador" }), audit })).ok).toBe(false);
    expect(audit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ tipoAccion: "acceso_denegado", usuarioId: claims.usuarioId }));
    const identity = (channel: string, payload: unknown) => authenticateChannel(channel, payload, { verifyToken: () => ({ ...claims }), audit });
    expect((await authorizeRequest(context.channel, {}, undefined, { identity, session: async () => ({ active: false, reason: "inactividad" }), audit })).ok).toBe(false);
    expect((await authorizeRequest(context.channel, {}, undefined, { identity, session: async () => ({ active: true, rolEfectivo: "trabajador" }), audit })).ok).toBe(false);
    const allowed = await authorizeRequest(context.channel, { usuarioId: "fake" }, undefined, { identity, session: async () => ({ active: true, rolEfectivo: "dueno" }), audit });
    if (!allowed.ok) throw Error("Owner should be authorized");
    expect(allowed.payload).toMatchObject({ usuarioId: claims.usuarioId, __rolSesion: "dueno" });
  });
  it("audita los éxitos vacíos una sola vez y reporta fallos de auditoría; las consultas no exitosas no se convierten en éxitos", async () => {
    const controller = createAttendanceReportController(async () => ({ report, user }));
    const audit = vi.fn(async () => undefined);
    expect((await handleWithAudit(controller, request, context, audit)).ok).toBe(true);
    expect(audit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ modulo: "reportes", tipoAccion: "consulta", usuarioId: claims.usuarioId }));
    expect(await handleWithAudit(controller, request, context, async () => { throw Error("Audit failure"); })).toMatchObject({ ok: false, error: { code: "DATABASE_ERROR" } });
    audit.mockClear();
    await handleWithAudit(createAttendanceReportController(async () => { throw new MonthlyAttendanceError("BUSINESS_RULE", "Conflict"); }), request, context, audit);
    expect(audit).not.toHaveBeenCalled();
  });
});
