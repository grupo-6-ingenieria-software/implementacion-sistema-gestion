import type { ReactElement } from "react";

export function AccionExportarFormato({
  format,
  disabled,
  exporting,
  onFormatChange,
  onExport,
}: {
  format: "pdf" | "xlsx";
  disabled: boolean;
  exporting: boolean;
  onFormatChange: (format: "pdf" | "xlsx") => void;
  onExport: () => void;
}): ReactElement {
  return <>
    <label className="grid gap-1 text-xs font-semibold text-[#24313d]">Formato
      <select aria-label="Formato de exportación" className="rounded-md border border-[#9ba9b5] bg-white px-3 py-2 text-sm font-normal" disabled={disabled || exporting} value={format} onChange={(event) => onFormatChange(event.target.value as "pdf" | "xlsx")}>
        <option value="pdf">PDF</option><option value="xlsx">XLSX</option>
      </select>
    </label>
    <button className="rounded-md border border-[#2d6a4f] px-4 py-2 text-sm font-semibold text-[#1b4332] disabled:opacity-50" disabled={disabled || exporting} onClick={onExport} type="button">{exporting ? "Exportando..." : "Exportar"}</button>
  </>;
}
