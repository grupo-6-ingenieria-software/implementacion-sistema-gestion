import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError } from "../../../src/main/controllers/auth-context";
import { handleWithAudit } from "../../../src/main/controllers/audit-dispatch";
import { createReportExportController } from "../../../src/main/controllers/report-export";
import { ReportCommitUncertainError } from "../../../src/main/controllers/report-export-audit";
import { ReportFileStore } from "../../../src/main/controllers/report-export-file";
import { createReportExportHandler } from "../../../src/main/controllers/report-export-service";
import { createMonthlySalesReportAdapter, createReportRegistry } from "../../../src/main/controllers/report-registry";
import { REPORT_EXPORT_ERROR_MESSAGE, REPORT_RECONCILE_CHANNEL } from "../../../src/shared/reports";
import { context, report, reportDependencies, request, user } from "./report-export-fixture";

let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "cu54-service-")); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
const filename = "VentasMensuales_2026-09_30-09-2026.pdf";
const verifyContext = { ...context, channel: REPORT_RECONCILE_CHANNEL };

describe("CU54 main flow, E1 and reconciliation", () => {
  it.each(["pdf", "xlsx"] as const)("recalculates trusted data and publishes fixed-name %s with one audit", async (format) => {
    const load = vi.fn(async () => ({ report, user }));
    const pdf = vi.fn(async () => Buffer.from("pdf")); const xlsx = vi.fn(async () => Buffer.from("xlsx"));
    const deps = reportDependencies(directory, { registry: createReportRegistry([createMonthlySalesReportAdapter(load, pdf, xlsx)]) });
    const finalize = vi.spyOn(deps.audit, "finalize");
    const duplicateAudit = vi.fn(); const ctx = { ...context, channel: `reporte:exportar-${format}` };
    const result = await handleWithAudit(createReportExportController(createReportExportHandler(deps)),
      { ...request, dias: [{ monto: 999999 }], usuario: "Fake", ruta: "Fake" }, ctx, duplicateAudit);
    expect(result).toMatchObject({ ok: true, data: { estado: "saved", formato: format, cantidadFilas: 30, ruta: join(directory, filename.replace("pdf", format)) } });
    expect(load).toHaveBeenCalledWith(report.periodo, ctx);
    expect((format === "pdf" ? pdf : xlsx)).toHaveBeenCalledWith(expect.objectContaining({ usuario: user.trabajadorNombre, header: expect.objectContaining({ tipo: "Reporte mensual de ventas", periodo: "septiembre de 2026", usuario: user.trabajadorNombre }) }));
    expect((format === "pdf" ? xlsx : pdf)).not.toHaveBeenCalled();
    expect(finalize).toHaveBeenCalledOnce();
    expect(finalize.mock.calls[0][0]).toMatchObject({ usuarioId: "owner", request });
    expect(duplicateAudit).not.toHaveBeenCalled(); expect(await readdir(join(directory, "evidence"))).toEqual([]);
  });
  it.each([0, 1])("uses transaction count for emptiness, including zero amounts (%i)", async (transacciones) => {
    const selectDirectory = vi.fn(async () => directory);
    const deps = reportDependencies(directory, { selectDirectory,
      registry: createReportRegistry([createMonthlySalesReportAdapter(async () => ({ report: { ...report, transacciones, montoTotal: 0 }, user }), async () => Buffer.from("free"))]),
    });
    const result = await createReportExportHandler(deps)(request, context);
    if (transacciones) expect(result).toMatchObject({ ok: true, data: { estado: "saved" } });
    else {
      expect(result).toMatchObject({ ok: false, error: { code: "BUSINESS_RULE", message: REPORT_EXPORT_ERROR_MESSAGE } });
      expect(selectDirectory).not.toHaveBeenCalled(); expect(await readdir(directory)).toEqual([]);
    }
  });
  it.each([["2026-10-01T02:59:59Z", "30-09-2026"], ["2026-10-01T03:00:00Z", "01-10-2026"],
    ["2026-09-06T03:59:59Z", "05-09-2026"], ["2026-09-06T04:00:00Z", "06-09-2026"]])("uses one Chilean clock for filename, header and audit at %s", async (timestamp, expectedDate) => {
    const now = vi.fn(() => new Date(timestamp)); const pdf = vi.fn(async () => Buffer.from("pdf"));
    const deps = reportDependencies(directory, { now, registry: createReportRegistry([createMonthlySalesReportAdapter(async () => ({ report, user }), pdf)]) });
    const finalize = vi.spyOn(deps.audit, "finalize");
    const result = await createReportExportHandler(deps)(request, context);
    expect(result).toMatchObject({ ok: true, data: { ruta: join(directory, `VentasMensuales_2026-09_${expectedDate}.pdf`), fechaGeneracion: new Date(timestamp).toISOString() } });
    expect(pdf).toHaveBeenCalledWith(expect.objectContaining({ fecha: expect.stringContaining(expectedDate) }));
    expect(new Date(finalize.mock.calls[0][0].auditFechaHora).toISOString()).toBe(new Date(timestamp).toISOString());
    expect(now).toHaveBeenCalledOnce();
  });
  it("refuses an incomplete trusted institutional header before opening the destination dialog", async () => {
    const deps = reportDependencies(directory, { registry: createReportRegistry([createMonthlySalesReportAdapter(async () => ({ report, user: { ...user, trabajadorNombre: "" } }))]) });
    const dialog = vi.spyOn(deps, "selectDirectory"); const audit = vi.spyOn(deps.audit, "finalize");
    expect(await createReportExportHandler(deps)(request, context)).toMatchObject({ ok: false, error: { message: REPORT_EXPORT_ERROR_MESSAGE } });
    expect(dialog).not.toHaveBeenCalled(); expect(audit).not.toHaveBeenCalled();
  });
  it.each([{ tipo: "unknown", periodo: {} }, { periodo: report.periodo }, { filtros: {} }, [], { tipo: "ventas-mensuales", periodo: { mes: 13, anio: 2026 } }, { ...request, filtros: { usuario: "other" } }])("rejects malformed descriptors without legacy fallback: %j", async (payload) => {
    const legacy = { metadata: createReportExportController().metadata, handle: vi.fn() };
    const controller = createReportExportController(createReportExportHandler(reportDependencies(directory)), legacy);
    expect(await controller.handle(payload, context)).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    expect(legacy.handle).not.toHaveBeenCalled(); expect(await readdir(directory)).toEqual([]);
  });
  it("rejects documented reports without a producer", async () => {
    expect(await createReportExportHandler(reportDependencies(directory))({ tipo: "ventas-diarias", periodo: "2026-09-30" }, context))
      .toMatchObject({ ok: false, error: { code: "NOT_IMPLEMENTED", message: REPORT_EXPORT_ERROR_MESSAGE } });
    expect(await readdir(directory)).toEqual([]);
  });
  it("keeps legacy identity-only requests on C33", async () => {
    const legacy = { metadata: createReportExportController().metadata, handle: vi.fn(async () => ({ ok: true as const, data: "legacy" })) };
    expect(await createReportExportController(createReportExportHandler(reportDependencies(directory)), legacy)
      .handle({ usuarioId: "worker", __authToken: "token", __rolSesion: "trabajador" }, context)).toEqual({ ok: true, data: "legacy" });
  });
  it.each(["trabajador", "temporary", "missing"])("rejects %s before loading, including reconciliation", async (mode) => {
    const load = vi.fn(); const deps = reportDependencies(directory, { registry: createReportRegistry([createMonthlySalesReportAdapter(load)]) });
    const claims = mode === "missing" ? undefined : { ...context.claims!, rol: mode === "trabajador" ? "trabajador" as const : "dueno" as const, passwordTemporal: mode === "temporary" };
    expect(await createReportExportHandler(deps)(request, { ...context, claims })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(await createReportExportHandler(deps)({ operacionId: "invalid" }, { ...verifyContext, claims })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(load).not.toHaveBeenCalled();
  });
  it.each(["directory", "overwrite"])("treats %s cancellation as normal without generating or auditing", async (kind) => {
    if (kind === "overwrite") await writeFile(join(directory, filename), "old");
    const pdf = vi.fn(); const finalize = vi.fn();
    const deps = reportDependencies(directory, { selectDirectory: async () => kind === "directory" ? null : directory, confirmOverwrite: async () => false,
      registry: createReportRegistry([createMonthlySalesReportAdapter(async () => ({ report, user }), pdf)]), audit: { finalize, confirmed: async () => true } });
    expect(await createReportExportHandler(deps)(request, context)).toMatchObject({ ok: true, data: { estado: "cancelled" } });
    expect(pdf).not.toHaveBeenCalled(); expect(finalize).not.toHaveBeenCalled();
    if (kind === "overwrite") expect(await readFile(join(directory, filename), "utf8")).toBe("old");
  });
  it("rechecks session after the destination dialog and never publishes after revocation", async () => {
    const finalize = vi.fn();
    const deps = reportDependencies(directory, { revalidate: async () => { throw new AccessDeniedError(); }, audit: { finalize, confirmed: async () => true } });
    expect(await createReportExportHandler(deps)(request, context)).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(finalize).not.toHaveBeenCalled(); expect(await readdir(directory)).toEqual([]);
  });
  it("restores an overwritten file after a known finalization failure", async () => {
    await writeFile(join(directory, filename), "old");
    const deps = reportDependencies(directory, { audit: { finalize: async (_op, publish) => { await publish(); throw new Error("known rollback"); }, confirmed: async () => false } });
    expect(await createReportExportHandler(deps)(request, context)).toMatchObject({ ok: false, error: { message: REPORT_EXPORT_ERROR_MESSAGE } });
    expect(await readFile(join(directory, filename), "utf8")).toBe("old");
    expect(await readdir(join(directory, "evidence"))).toEqual([]);
    expect((await readdir(directory)).filter((name) => /\.(tmp|bak)$/.test(name))).toEqual([]);
  });
  it.each([true, false])("persists uncertain evidence and reconciles confirmed=%s without a new export", async (confirmed) => {
    await writeFile(join(directory, filename), "old");
    const deps = reportDependencies(directory, { audit: {
      finalize: async (_op, publish) => { await publish(); throw new ReportCommitUncertainError(); }, confirmed: async () => confirmed,
    } });
    const finalize = vi.spyOn(deps.audit, "finalize"); const handler = createReportExportHandler(deps);
    const result = await handler(request, context);
    expect(result).toMatchObject({ ok: false, error: { code: "EXPORT_RECONCILIATION_REQUIRED", message: REPORT_EXPORT_ERROR_MESSAGE } });
    if (result.ok) throw new Error("Expected pending");
    const id = result.error.operacionId!;
    expect(await handler(request, context)).toMatchObject({ ok: false, error: { operacionId: id } });
    expect(finalize).toHaveBeenCalledOnce();
    deps.files = new ReportFileStore(join(directory, "evidence"));
    expect(await createReportExportHandler(deps)({ operacionId: id }, verifyContext)).toMatchObject({ ok: true, data: { estado: confirmed ? "saved" : "reverted", operacionId: id } });
    expect(await readFile(join(directory, filename), "utf8")).toBe(confirmed ? "pdf" : "old");
    expect(await readdir(join(directory, "evidence"))).toEqual([]); expect(finalize).toHaveBeenCalledOnce();
  });
  it.each(["offline", "altered"])("keeps %s reconciliation pending and preserves evidence", async (kind) => {
    const deps = reportDependencies(directory, { audit: {
      finalize: async (_op, publish) => { await publish(); throw new ReportCommitUncertainError(); },
      confirmed: async () => { if (kind === "offline") throw new Error("network"); return true; },
    } });
    const handler = createReportExportHandler(deps); const result = await handler(request, context);
    if (result.ok) throw new Error("Expected pending");
    if (kind === "altered") await writeFile(join(directory, filename), "external");
    expect(await handler({ operacionId: result.error.operacionId }, verifyContext)).toMatchObject({ ok: true, data: { estado: "pending" } });
    expect(await readFile(join(directory, filename), "utf8")).toBe(kind === "altered" ? "external" : "pdf");
    expect((await readdir(join(directory, "evidence"))).filter((name) => name.endsWith(".json"))).toHaveLength(1);
  });
  it("does not reconcile a live operation before its audit completes", async () => {
    let unblock!: () => void; let operationId!: string;
    const barrier = new Promise<void>((resolve) => { unblock = resolve; }); const entered = vi.fn();
    const deps = reportDependencies(directory, { audit: {
      finalize: async (op, publish) => { operationId = op.operacionId; entered(); await barrier; await publish(); },
      confirmed: vi.fn(async () => false),
    } });
    const handler = createReportExportHandler(deps); const running = handler(request, context);
    await vi.waitFor(() => expect(entered).toHaveBeenCalled());
    expect(await handler({ operacionId: operationId }, verifyContext)).toMatchObject({ ok: true, data: { estado: "pending" } });
    expect(await handler(request, context)).toMatchObject({ ok: false, error: { code: "EXPORT_RECONCILIATION_REQUIRED", operacionId: operationId } });
    expect(deps.audit.confirmed).not.toHaveBeenCalled(); unblock();
    expect(await running).toMatchObject({ ok: true, data: { estado: "saved" } });
  });
  it("recovers explicitly after a verifier process ended without deleting its stale lease", async () => {
    const deps = reportDependencies(directory, { audit: {
      finalize: async (_op, publish) => { await publish(); throw new ReportCommitUncertainError(); }, confirmed: async () => true,
    } });
    const handler = createReportExportHandler(deps); const result = await handler(request, context);
    if (result.ok) throw new Error("Expected pending");
    const names = await readdir(join(directory, "evidence"));
    const lease = join(directory, "evidence", `${names[0]}.verify-1073741824-00000000-0000-4000-8000-000000000054`);
    await writeFile(lease, result.error.operacionId!);
    deps.files = new ReportFileStore(join(directory, "evidence"));
    expect(await createReportExportHandler(deps)({ operacionId: result.error.operacionId }, verifyContext))
      .toMatchObject({ ok: true, data: { estado: "saved" } });
    expect(await readFile(lease, "utf8")).toBe(result.error.operacionId);
    // The ended verifier's lease also cannot block a subsequent export.
    expect(await createReportExportHandler({ ...deps, audit: { finalize: async (_op, publish) => publish(), confirmed: async () => true } })(request, context))
      .toMatchObject({ ok: true, data: { estado: "saved" } });
  });
  it("serializes explicit verifications across store instances", async () => {
    const deps = reportDependencies(directory, { audit: {
      finalize: async (_op, publish) => { await publish(); throw new ReportCommitUncertainError(); }, confirmed: async () => true,
    } });
    const result = await createReportExportHandler(deps)(request, context);
    if (result.ok) throw new Error("Expected pending");
    const operation = (await deps.files.find(result.error.operacionId!))!;
    expect(await deps.files.beginVerification(operation)).toBe(true);
    const other = new ReportFileStore(join(directory, "evidence"));
    expect(await other.beginVerification(operation)).toBe(false);
    await deps.files.endVerification(operation);
    expect(await other.beginVerification(operation)).toBe(true);
    await other.endVerification(operation);
  });
});
