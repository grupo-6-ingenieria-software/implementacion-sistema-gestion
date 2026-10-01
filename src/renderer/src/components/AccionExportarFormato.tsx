import { useEffect, useId, useRef, useState, type ReactElement } from "react";
import {
  INVENTORY_EXPORT_CHANNEL,
  INVENTORY_EXPORT_ERROR_MESSAGE,
  type InventoryExportFormat,
  type InventoryExportResult,
} from "../../../shared/inventory-export";

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

type InventoryExportActionProps = {
  invoke?: typeof window.appApi.invoke;
};

type ReportExportActionProps = {
  format: "pdf" | "xlsx";
  disabled: boolean;
  exporting: boolean;
  onFormatChange: (format: "pdf" | "xlsx") => void;
  onExport: () => void;
};

export function AccionExportarFormato(
  props: InventoryExportActionProps | ReportExportActionProps,
): ReactElement {
  return "format" in props ? (
    <ReportExportAction {...props} />
  ) : (
    <InventoryExportAction {...props} />
  );
}

/** UI06: no depende de las filas visibles ni de los permisos de costo de V06. */
function InventoryExportAction({
  invoke,
}: InventoryExportActionProps): ReactElement {
  const [selecting, setSelecting] = useState(false);
  const [format, setFormat] = useState<InventoryExportFormat | "">("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    message: string;
    tone: "success" | "warning" | "neutral" | "error";
  } | null>(null);
  const pending = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const wasSelecting = useRef(false);
  const formatId = useId();
  const panelId = useId();
  useEffect(() => {
    if (selecting) wasSelecting.current = true;
    else if (wasSelecting.current && !busy) {
      trigger.current?.focus();
      wasSelecting.current = false;
    }
  }, [selecting, busy]);
  const buttonClass =
    "min-h-11 rounded-md border border-[#9ba9b5] px-4 py-2 text-sm font-semibold text-[#24313d] transition hover:bg-[#f0f3f6] disabled:cursor-wait disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#244d61]";

  async function confirm(): Promise<void> {
    if (!format || pending.current) return;
    pending.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const result = await exportInventoryList(
        invoke ?? window.appApi.invoke,
        format,
      );
      setNotice(inventoryExportNotice(result));
      setSelecting(false);
      setFormat("");
    } catch (error) {
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
    }
  }

  return (
    <div className="w-full sm:w-auto" aria-busy={busy}>
      <div className="flex justify-end">
        <button
          ref={trigger}
          type="button"
          className={buttonClass}
          disabled={busy}
          aria-expanded={selecting}
          aria-controls={panelId}
          onClick={() => {
            setSelecting(true);
            setNotice(null);
          }}
        >
          {busy ? "Exportando..." : "Exportar listado"}
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
              Preparando el archivo. Complete el diálogo Guardar como.
            </p>
          ) : null}
        </form>
      ) : null}
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

function ReportExportAction({
  format,
  disabled,
  exporting,
  onFormatChange,
  onExport,
}: ReportExportActionProps): ReactElement {
  return <>
    <label className="grid gap-1 text-xs font-semibold text-[#24313d]">Formato
      <select aria-label="Formato de exportación" className="rounded-md border border-[#9ba9b5] bg-white px-3 py-2 text-sm font-normal" disabled={disabled || exporting} value={format} onChange={(event) => onFormatChange(event.target.value as "pdf" | "xlsx")}>
        <option value="pdf">PDF</option><option value="xlsx">XLSX</option>
      </select>
    </label>
    <button className="rounded-md border border-[#2d6a4f] px-4 py-2 text-sm font-semibold text-[#1b4332] disabled:opacity-50" disabled={disabled || exporting} onClick={onExport} type="button">{exporting ? "Exportando..." : "Exportar"}</button>
  </>;
}
