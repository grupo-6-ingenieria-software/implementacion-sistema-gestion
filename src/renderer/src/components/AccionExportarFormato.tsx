import { useEffect, useId, useRef, useState, type ReactElement } from "react";
import {
  INVENTORY_EXPORT_CHANNEL,
  INVENTORY_EXPORT_ERROR_MESSAGE,
  type InventoryExportFormat,
  type InventoryExportResult,
} from "../../../shared/inventory-export";
import {
  REPORT_EXPORT_ERROR_MESSAGE, REPORT_RECONCILE_CHANNEL,
  type ReportExportRequest, type ReportExportResult, type ReportReconcileResult,
} from "../../../shared/reports";

export class ReportActionError extends Error {
  constructor(message: string, readonly code?: string, readonly operacionId?: string) { super(message); }
}

export async function exportGeneratedReport(invoke: typeof window.appApi.invoke, format: InventoryExportFormat, request: ReportExportRequest): Promise<ReportExportResult> {
  const response = await invoke<ReportExportResult>(`reporte:exportar-${format}`, {
    tipo: request.tipo, periodo: request.periodo,
    ...(request.filtros !== undefined ? { filtros: request.filtros } : {}),
  }).catch(() => { throw new ReportActionError(REPORT_EXPORT_ERROR_MESSAGE); });
  if (!response.ok) throw new ReportActionError(response.error.message, response.error.code, response.error.operacionId);
  return response.data;
}

export async function verifyGeneratedReport(invoke: typeof window.appApi.invoke, operacionId: string): Promise<ReportReconcileResult> {
  const response = await invoke<ReportReconcileResult>(REPORT_RECONCILE_CHANNEL, { operacionId })
    .catch(() => { throw new ReportActionError(REPORT_EXPORT_ERROR_MESSAGE); });
  if (!response.ok) throw new ReportActionError(response.error.message, response.error.code, response.error.operacionId);
  return response.data;
}

type ExportActionProps = { invoke?: typeof window.appApi.invoke } & (
  | { mode?: "inventory" }
  | { mode: "report"; request: ReportExportRequest; disabled?: boolean; onBusyChange?: (busy: boolean) => void; onForbidden?: () => void }
);

export async function exportInventoryList(
  invoke: typeof window.appApi.invoke,
  formato: InventoryExportFormat,
): Promise<InventoryExportResult> {
  const response = await invoke<InventoryExportResult>(
    INVENTORY_EXPORT_CHANNEL,
    { formato },
  ).catch(() => {
    throw new Error(INVENTORY_EXPORT_ERROR_MESSAGE);
  });
  if (!response.ok)
    throw new Error(response.error.message || INVENTORY_EXPORT_ERROR_MESSAGE);
  return response.data;
}

export function inventoryExportNotice(result: InventoryExportResult): {
  message: string;
  tone: "success" | "warning" | "neutral";
} {
  if (result.estado === "cancelled")
    return { message: "Exportación cancelada.", tone: "neutral" };
  const saved = `Archivo guardado en ${result.ruta}.`;
  return result.auditoria === "fallida"
    ? { message: `${saved} ${result.advertencia}`, tone: "warning" }
    : { message: saved, tone: "success" };
}

/** UI06: no depende de las filas visibles ni de los permisos de costo de V06. */
export function AccionExportarFormato(props: ExportActionProps): ReactElement {
  const { invoke } = props;
  const isReport = props.mode === "report";
  const [selecting, setSelecting] = useState(false);
  const [format, setFormat] = useState<InventoryExportFormat | "">("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    message: string;
    tone: "success" | "warning" | "neutral" | "error";
  } | null>(null);
  const [operationId, setOperationId] = useState<string | null>(null);
  const pending = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const verificationButton = useRef<HTMLButtonElement>(null);
  const wasSelecting = useRef(false);
  const formatId = useId();
  const panelId = useId();
  useEffect(() => {
    if (selecting) wasSelecting.current = true;
    else if (wasSelecting.current && !busy) {
      (operationId ? verificationButton : trigger).current?.focus();
      wasSelecting.current = false;
    }
  }, [selecting, busy, operationId]);
  const buttonClass =
    "min-h-11 rounded-md border border-[#9ba9b5] px-4 py-2 text-sm font-semibold text-[#24313d] transition hover:bg-[#f0f3f6] disabled:cursor-wait disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#244d61]";

  async function confirm(): Promise<void> {
    if (!format || pending.current || operationId || (props.mode === "report" && props.disabled)) return;
    pending.current = true;
    setBusy(true);
    if (props.mode === "report") props.onBusyChange?.(true);
    setNotice(null);
    try {
      if (props.mode === "report") {
        const result = await exportGeneratedReport(invoke ?? window.appApi.invoke, format, props.request);
        setNotice({ tone: result.estado === "saved" ? "success" : "neutral", message: result.estado === "saved" ? "Reporte guardado correctamente." : "Exportación cancelada." });
      } else {
        const result = await exportInventoryList(invoke ?? window.appApi.invoke, format);
        setNotice(inventoryExportNotice(result));
      }
      setSelecting(false);
      setFormat("");
    } catch (error) {
      if (error instanceof ReportActionError && props.mode === "report") {
        if (error.code === "FORBIDDEN") props.onForbidden?.();
        if (error.code === "EXPORT_RECONCILIATION_REQUIRED" && error.operacionId) {
          setOperationId(error.operacionId);
          setSelecting(false);
        }
      }
      setNotice({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : INVENTORY_EXPORT_ERROR_MESSAGE,
      });
    } finally {
      pending.current = false;
      setBusy(false);
      if (props.mode === "report") props.onBusyChange?.(false);
    }
  }

  async function verify(): Promise<void> {
    if (!operationId || pending.current) return;
    pending.current = true;
    wasSelecting.current = true;
    setBusy(true);
    if (props.mode === "report") props.onBusyChange?.(true);
    try {
      const result = await verifyGeneratedReport(invoke ?? window.appApi.invoke, operationId);
      if (result.estado === "pending") setNotice({ tone: "warning", message: "La exportación sigue pendiente de verificación." });
      else {
        setOperationId(null);
        setNotice({ tone: result.estado === "saved" ? "success" : "error", message: result.estado === "saved" ? "Reporte guardado correctamente." : REPORT_EXPORT_ERROR_MESSAGE });
      }
    } catch (error) {
      if (error instanceof ReportActionError && error.code === "FORBIDDEN" && props.mode === "report") props.onForbidden?.();
      setNotice({ tone: "error", message: error instanceof Error ? error.message : REPORT_EXPORT_ERROR_MESSAGE });
    } finally {
      pending.current = false;
      setBusy(false);
      if (props.mode === "report") props.onBusyChange?.(false);
    }
  }

  return (
    <div className="w-full sm:w-auto" aria-busy={busy}>
      <div className="flex justify-end">
        <button
          ref={trigger}
          type="button"
          className={buttonClass}
          disabled={busy || !!operationId || (props.mode === "report" && props.disabled)}
          aria-expanded={selecting}
          aria-controls={panelId}
          onClick={() => {
            setSelecting(true);
            setNotice(null);
          }}
        >
          {busy ? (operationId ? "Verificando..." : "Exportando...") : isReport ? "Exportar reporte" : "Exportar listado"}
        </button>
      </div>
      {selecting ? (
        <form
          id={panelId}
          className="mt-3 grid gap-3 rounded-md border border-[#cbd5df] bg-white p-4 shadow-sm"
          onSubmit={(event) => {
            event.preventDefault();
            void confirm();
          }}
        >
          <label
            htmlFor={formatId}
            className="text-sm font-semibold text-[#24313d]"
          >
            Formato de exportación
          </label>
          <select
            id={formatId}
            autoFocus
            disabled={busy}
            value={format}
            className="min-h-11 rounded-md border border-[#9ba9b5] px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-[#244d61]"
            onChange={(event) =>
              setFormat(event.target.value as InventoryExportFormat | "")
            }
          >
            <option value="">Seleccione un formato</option>
            <option value="xlsx">Excel (.xlsx)</option>
            <option value="pdf">PDF (.pdf)</option>
          </select>
          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              className={buttonClass}
              disabled={!format || busy}
            >
              {busy ? "Exportando..." : "Confirmar exportación"}
            </button>
            <button
              type="button"
              className={buttonClass}
              disabled={busy}
              onClick={() => {
                setSelecting(false);
                setFormat("");
                setNotice(null);
              }}
            >
              Cancelar
            </button>
          </div>
          {busy ? (
            <p role="status" className="text-sm text-[#61717f]">
              {isReport ? "Preparando el archivo. Seleccione la carpeta de destino." : "Preparando el archivo. Complete el diálogo Guardar como."}
            </p>
          ) : null}
        </form>
      ) : null}
      {operationId ? <div className="mt-3 space-y-2">
        <p role="status" className="text-sm text-[#61717f]">La exportación requiere verificación antes de volver a guardar en ese destino.</p>
        <button ref={verificationButton} type="button" className={buttonClass} disabled={busy} onClick={() => void verify()}>Verificar exportación</button>
      </div> : null}
      {notice ? (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={`mt-3 max-w-xl break-words rounded-md border p-3 text-sm ${
            notice.tone === "error"
              ? "border-[#dba7a7] bg-[#fff7f7] text-[#8f2727]"
              : notice.tone === "warning"
                ? "border-[#e3ad72] bg-[#fff8ed] text-[#6b4a24]"
                : notice.tone === "success"
                  ? "border-[#9bc8ae] bg-[#eef8f1] text-[#246044]"
                  : "border-[#cbd5df] bg-white text-[#61717f]"
          }`}
        >
          {notice.message}
        </p>
      ) : null}
    </div>
  );
}
