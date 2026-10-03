import { app, dialog } from "electron";
import log from "electron-log/main";
import { randomUUID } from "node:crypto";
import { basename, join } from "node:path";
import { getAuditTimestamp } from "../../shared/audit";
import {
  REPORT_BUSINESS_NAME, REPORT_EXPORT_ERROR_MESSAGE, REPORT_RECONCILE_CHANNEL,
  isReportOperationId, parseReportExportRequest, reportExportFormat,
  type ReportExportResult, type ReportHeader, type ReportReconcileResult,
} from "../../shared/reports";
import { AccessDeniedError, authorizeUser } from "./auth-context";
import { controllerError, controllerSuccess, type ControllerContext, type ControllerHandler } from "./base";
import { technicalErrorDetails } from "./inventory-export-file";
import { createReportAuditStorage, ReportCommitUncertainError, type ReportAuditStorage } from "./report-export-audit";
import { ReportFileStore, ReportPendingError, type ReportFileOperation } from "./report-export-file";
import { findReportAdapter, reportRegistry, ReportNotAvailableError, type ReportAdapter } from "./report-registry";
import { formatDateTimeInSantiago } from "./restock-report-export";

export type ReportExportDependencies = {
  registry: ReadonlyMap<string, ReportAdapter>;
  files: ReportFileStore;
  audit: ReportAuditStorage;
  selectDirectory: () => Promise<string | null>;
  confirmOverwrite: (path: string) => Promise<boolean>;
  revalidate: (context: ControllerContext) => Promise<void>;
  now: () => Date;
  id: () => string;
  logError: (stage: string, error: unknown) => void;
};

let defaultFiles: ReportFileStore | undefined;
async function defaultDependencies(): Promise<ReportExportDependencies> {
  const { db, schema } = await import("../../db/client");
  defaultFiles ??= new ReportFileStore(join(app.getPath("userData"), "report-export-pending"), undefined,
    (error) => log.error("[CU54:cleanup]", technicalErrorDetails(error)));
  return {
    registry: reportRegistry, files: defaultFiles, audit: createReportAuditStorage(db),
    selectDirectory: async () => {
      const selected = await dialog.showOpenDialog({
        title: "Seleccionar carpeta para el reporte", defaultPath: app.getPath("documents"),
        properties: ["openDirectory", "createDirectory"],
      });
      return selected.canceled ? null : selected.filePaths[0] ?? null;
    },
    confirmOverwrite: async (path) => (await dialog.showMessageBox({
      type: "warning", title: "Reemplazar reporte", message: "Ya existe un archivo con el nombre del reporte.",
      detail: path, buttons: ["Reemplazar", "Cancelar"], defaultId: 1, cancelId: 1,
    })).response === 0,
    revalidate: async (context) => {
      const claims = context.claims;
      if (!claims || claims.rol !== "dueno") throw new AccessDeniedError();
      const { validateAndRefreshActiveSession } = await import("./session");
      const session = await validateAndRefreshActiveSession(db, schema, claims.sesionId, claims.usuarioId, false);
      if (!session.active || session.rolEfectivo !== "dueno") throw new AccessDeniedError("No hay una sesión válida para realizar esta acción.");
      await authorizeUser(db, schema, claims.usuarioId, ["dueno"], session.rolEfectivo);
    },
    now: () => new Date(), id: randomUUID,
    logError: (stage, error) => log.error(`[CU54:${stage}]`, technicalErrorDetails(error)),
  };
}

function pendingResponse(operacionId: string) {
  return { ok: false as const, error: {
    code: "EXPORT_RECONCILIATION_REQUIRED" as const, message: REPORT_EXPORT_ERROR_MESSAGE, operacionId,
  } };
}
function safeLog(deps: ReportExportDependencies, stage: string, error: unknown): void {
  try { deps.logError(stage, error); } catch { /* diagnostics are best effort */ }
}

async function reconcile(payload: unknown, context: ControllerContext, deps: ReportExportDependencies) {
  const id = (payload as { operacionId?: unknown } | null)?.operacionId;
  if (!isReportOperationId(id)) return controllerError("VALIDATION_ERROR", "Operación de exportación no válida.");
  const operation = await deps.files.find(id);
  if (!operation) return controllerError("NOT_FOUND", "No se encontró una exportación pendiente de verificación.");
  const result = (estado: "reverted" | "pending") => controllerSuccess<ReportReconcileResult>({ operacionId: id, estado });
  if (!(await deps.files.beginVerification(operation))) return result("pending");
  try {
    await deps.revalidate(context);
    const confirmed = await deps.audit.confirmed(operation);
    if (confirmed) {
      if (!(await deps.files.matchesPublished(operation))) return result("pending");
      await deps.files.finish(operation);
      return controllerSuccess<ReportReconcileResult>({ operacionId: id, estado: "saved", exportacion: operation.result });
    }
    await deps.files.revert(operation);
    return result("reverted");
  } catch (error) {
    if (error instanceof AccessDeniedError) return controllerError("FORBIDDEN", error.message);
    safeLog(deps, "conciliacion", error);
    return result("pending");
  } finally { await deps.files.endVerification(operation); }
}

export function createReportExportHandler(dependencies?: ReportExportDependencies): ControllerHandler<unknown, ReportExportResult | ReportReconcileResult> {
  return async (payload, context) => {
    if (!context.claims?.usuarioId || context.claims.rol !== "dueno" || context.claims.passwordTemporal)
      return controllerError("FORBIDDEN", "No tiene permiso para realizar esta acción.");
    const format = reportExportFormat(context.channel);
    if (!format && context.channel !== REPORT_RECONCILE_CHANNEL)
      return controllerError("INVALID_CHANNEL", "Formato de exportación no válido.");
    let deps: ReportExportDependencies | undefined;
    let operation: ReportFileOperation | undefined;
    let committed = false;
    let stage = "consulta";
    try {
      deps = dependencies ?? await defaultDependencies();
      if (context.channel === REPORT_RECONCILE_CHANNEL) return await reconcile(payload, context, deps);
      const raw = parseReportExportRequest(payload);
      const adapter = findReportAdapter(deps.registry, raw.tipo);
      const request = adapter.normalize(raw);
      const report = await adapter.load(request, context);
      if (!report.hasData) return controllerError("BUSINESS_RULE", REPORT_EXPORT_ERROR_MESSAGE);
      const now = deps.now();
      const header: ReportHeader = {
        negocio: REPORT_BUSINESS_NAME, tipo: report.tipoEtiqueta, periodo: report.periodoEtiqueta,
        fecha: formatDateTimeInSantiago(now), usuario: report.usuario,
      };
      if (Object.values(header).some((field) => typeof field !== "string" || !field.trim()))
        throw new Error("IncompleteReportHeader");
      const filename = `${report.tipoArchivo}_${report.periodoArchivo}_${header.fecha.slice(0, 10)}.${format}`;
      const base = { formato: format!, cantidadFilas: report.cantidadFilas, fechaGeneracion: now.toISOString() };
      const cancelled = () => controllerSuccess<ReportExportResult>({ ...base, estado: "cancelled" });
      stage = "destino";
      const directory = await deps.selectDirectory();
      if (!directory) return cancelled();
      const destination = await deps.files.inspect(directory, filename);
      const previous = await deps.files.pendingAt(destination.path);
      if (previous) return pendingResponse(previous.operacionId);
      if (destination.originalHash !== null && !(await deps.confirmOverwrite(destination.path))) return cancelled();
      stage = "generacion";
      const contents = await report[format!](header);
      if (!contents.length) throw new Error("EmptyExportBuffer");
      stage = "autorizacion";
      await deps.revalidate(context);
      stage = "temporal";
      const id = deps.id();
      if (!isReportOperationId(id)) throw new Error("InvalidReportOperationId");
      const saved: ReportExportResult = { ...base, estado: "saved", ruta: destination.path };
      operation = await deps.files.stage(destination, contents, {
        operacionId: id, request, usuarioId: context.claims.usuarioId,
        auditFechaHora: getAuditTimestamp(now), result: saved,
        auditDescripcion: `Exportación ${request.tipo} (${report.periodoEtiqueta}) en ${format!.toUpperCase()}: ${report.cantidadFilas} filas. Archivo: ${basename(destination.path)}.`,
      });
      stage = "auditoria";
      await deps.audit.finalize(operation, () => deps!.files.publish(operation!));
      committed = true;
      stage = "confirmacion";
      await deps.files.finish(operation);
      return controllerSuccess(saved);
    } catch (error) {
      if (deps) safeLog(deps, stage, error);
      if (error instanceof ReportPendingError) return pendingResponse(error.operacionId);
      if (operation && deps) {
        if (committed || error instanceof ReportCommitUncertainError) return pendingResponse(operation.operacionId);
        try { await deps.files.revert(operation); }
        catch (cleanupError) {
          safeLog(deps, "compensacion", cleanupError);
          return pendingResponse(operation.operacionId);
        }
      }
      if (error instanceof AccessDeniedError) return controllerError("FORBIDDEN", error.message);
      if (error instanceof RangeError) return controllerError("VALIDATION_ERROR", error.message);
      if (error instanceof ReportNotAvailableError) return controllerError("NOT_IMPLEMENTED", REPORT_EXPORT_ERROR_MESSAGE);
      return controllerError(stage === "consulta" || stage === "auditoria" ? "DATABASE_ERROR" : "TECHNICAL_ERROR", REPORT_EXPORT_ERROR_MESSAGE);
    } finally { if (operation && deps) deps.files.release(operation); }
  };
}
