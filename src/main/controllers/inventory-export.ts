import { app, dialog, type SaveDialogOptions } from "electron";
import log from "electron-log/main";
import type { DB } from "../../db/client";
import * as schema from "../../db/schema";
import { controllers } from "../../shared/controllers";
import type { Role } from "../../shared/navigation";
import {
  INVENTORY_AUDIT_WARNING,
  INVENTORY_BUSINESS_NAME,
  INVENTORY_EMPTY_MESSAGE,
  INVENTORY_EXPORT_CHANNEL,
  INVENTORY_EXPORT_ERROR_MESSAGE,
  inventoryExportFormat,
  type InventoryExportFormat,
  type InventoryExportItem,
  type InventoryExportResult,
  type InventoryReportInput,
} from "../../shared/inventory-export";
import {
  AccessDeniedError,
  authorizeUser,
  registerAuditLog,
  type AuthenticatedUser,
} from "./auth-context";
import {
  controllerError,
  controllerSuccess,
  type ControllerHandler,
  type RegisteredController,
} from "./base";
import {
  InventoryExportDataError,
  queryInventoryExportWithExecutor,
} from "./inventory-export-query";
import {
  buildInventorySaveDialogOptions,
  confirmInventoryDestination,
  createInventoryPdfBuffer,
  createInventoryXlsxBuffer,
  saveInventoryFile,
  technicalErrorDetails,
} from "./inventory-export-file";
import {
  ensureExportExtension,
  formatDateTimeInSantiago,
} from "./restock-report-export";

export type InventoryExportDependencies = {
  authorize: (usuarioId: string, role: Role) => Promise<AuthenticatedUser>;
  query: () => Promise<InventoryExportItem[]>;
  showSaveDialog: (
    options: SaveDialogOptions,
  ) => Promise<{ canceled: boolean; filePath?: string }>;
  confirmDestination: (
    outputPath: string,
    selectedPath: string,
  ) => Promise<boolean>;
  createPdf: (input: InventoryReportInput) => Promise<Buffer>;
  createXlsx: (input: InventoryReportInput) => Promise<Buffer>;
  save: (path: string, contents: Buffer) => Promise<void>;
  audit: (
    usuarioId: string,
    format: InventoryExportFormat,
    count: number,
  ) => Promise<void>;
  now: () => Date;
  documentsPath: () => string;
  logError: (stage: string, error: unknown) => void;
};

export async function auditInventoryExportWithExecutor(
  executor: DB,
  usuarioId: string,
  format: InventoryExportFormat,
  count: number,
): Promise<void> {
  await executor.transaction(async (tx) => {
    await registerAuditLog(tx, schema, {
      usuarioId,
      tipoAccion: "exportacion",
      modulo: "inventario",
      descripcion: `Exportación de listado de inventario en ${format.toUpperCase()}: ${count} productos.`,
    });
  });
}

export function createInventoryExportController(
  dependencies: InventoryExportDependencies = defaultDependencies,
): RegisteredController<unknown, InventoryExportResult> {
  const metadata = controllers.find(
    (controller) => controller.id === "inventory-export",
  )!;
  const fail = (code: Parameters<typeof controllerError>[0], message: string) =>
    controllerError(code, message, metadata.id);
  const reportError = (stage: string, error: unknown) => {
    // Un fallo del logger tampoco puede convertir un archivo guardado en error.
    try {
      dependencies.logError(stage, error);
    } catch {
      /* best effort */
    }
  };
  const handle: ControllerHandler<unknown, InventoryExportResult> = async (
    payload,
    context,
  ) => {
    if (context.channel !== INVENTORY_EXPORT_CHANNEL)
      return fail("INVALID_CHANNEL", "Canal IPC no registrado.");
    const claims = context.claims;
    if (
      !claims?.usuarioId ||
      (claims.rol !== "dueno" && claims.rol !== "trabajador")
    ) {
      return fail(
        "FORBIDDEN",
        "No hay una sesión válida para realizar esta acción.",
      );
    }
    const format = inventoryExportFormat(payload);
    if (!format) return fail("VALIDATION_ERROR", "Seleccione Excel o PDF.");
    let stage = "autorizacion";
    try {
      const user = await dependencies.authorize(claims.usuarioId, claims.rol);
      stage = "consulta";
      const items = await dependencies.query();
      if (!items.length) return fail("BUSINESS_RULE", INVENTORY_EMPTY_MESSAGE);
      const generatedAt = dependencies.now();
      const base = {
        formato: format,
        cantidadFilas: items.length,
        fechaGeneracion: generatedAt.toISOString(),
      };
      const cancelled = () =>
        controllerSuccess<InventoryExportResult>({
          ...base,
          estado: "cancelled",
        });
      stage = "destino";
      const destination = await dependencies.showSaveDialog(
        buildInventorySaveDialogOptions(
          format,
          generatedAt,
          dependencies.documentsPath(),
        ),
      );
      if (destination.canceled || !destination.filePath) return cancelled();
      const path = ensureExportExtension(destination.filePath, format);
      if (!(await dependencies.confirmDestination(path, destination.filePath)))
        return cancelled();
      const input: InventoryReportInput = {
        negocio: INVENTORY_BUSINESS_NAME,
        fecha: formatDateTimeInSantiago(generatedAt),
        fechaGeneracion: base.fechaGeneracion,
        usuario: user.trabajadorNombre,
        items,
      };
      stage = "generacion";
      const contents =
        format === "pdf"
          ? await dependencies.createPdf(input)
          : await dependencies.createXlsx(input);
      if (!contents.length) throw new Error("EmptyExportBuffer");
      stage = "guardado";
      await dependencies.save(path, contents);
      try {
        await dependencies.audit(user.usuarioId, format, items.length);
        return controllerSuccess<InventoryExportResult>({
          ...base,
          estado: "saved",
          ruta: path,
          auditoria: "registrada",
        });
      } catch (error) {
        reportError("auditoria", error);
        return controllerSuccess<InventoryExportResult>({
          ...base,
          estado: "saved",
          ruta: path,
          auditoria: "fallida",
          advertencia: INVENTORY_AUDIT_WARNING,
        });
      }
    } catch (error) {
      if (error instanceof AccessDeniedError)
        return fail("FORBIDDEN", error.message);
      reportError(stage, error);
      return fail(
        error instanceof InventoryExportDataError
          ? "BUSINESS_RULE"
          : stage === "consulta" || stage === "autorizacion"
            ? "DATABASE_ERROR"
            : "TECHNICAL_ERROR",
        INVENTORY_EXPORT_ERROR_MESSAGE,
      );
    }
  };
  return { metadata, handle };
}

const defaultDependencies: InventoryExportDependencies = {
  authorize: async (usuarioId, role) => {
    const { db, schema } = await import("../../db/client");
    return authorizeUser(db, schema, usuarioId, ["dueno", "trabajador"], role);
  },
  query: async () =>
    queryInventoryExportWithExecutor((await import("../../db/client")).db),
  showSaveDialog: (options) => dialog.showSaveDialog(options),
  confirmDestination: confirmInventoryDestination,
  createPdf: createInventoryPdfBuffer,
  createXlsx: createInventoryXlsxBuffer,
  save: saveInventoryFile,
  audit: async (id, format, count) =>
    auditInventoryExportWithExecutor(
      (await import("../../db/client")).db,
      id,
      format,
      count,
    ),
  now: () => new Date(),
  documentsPath: () => app.getPath("documents"),
  logError: (stage, error) =>
    log.error(
      `[CU20] ${stage}`,
      technicalErrorDetails(error),
      error instanceof InventoryExportDataError ? error.productos : undefined,
    ),
};
export const inventoryExportController = createInventoryExportController();
