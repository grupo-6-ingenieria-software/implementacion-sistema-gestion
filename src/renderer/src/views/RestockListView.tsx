import {
  useCallback,
  useEffect,
  useState,
  type ReactElement,
} from "react";
import {
  RESTOCK_EMPTY_MESSAGE,
  RESTOCK_EXPORT_ERROR_MESSAGE,
  type RestockExportFormat,
  type RestockExportResult,
  type RestockItem,
} from "../../../shared/restock";

type Props = {
  usuarioId: string;
  onNavigate: (path: string) => void;
};

type Invoke = typeof window.appApi.invoke;

export async function loadRestockList(
  invoke: Invoke,
  usuarioId: string,
): Promise<RestockItem[]> {
  const response = await invoke<RestockItem[]>(
    "inventario:lista-reabastecimiento",
    { usuarioId },
  );

  if (!response.ok) throw new Error(response.error.message);
  return response.data;
}

export async function exportRestockList(
  invoke: Invoke,
  usuarioId: string,
  format: RestockExportFormat,
): Promise<RestockExportResult> {
  const channel =
    format === "pdf" ? "reporte:exportar-pdf" : "reporte:exportar-xlsx";
  const response = await invoke<RestockExportResult>(channel, { usuarioId });

  if (!response.ok) throw new Error(response.error.message);
  return response.data;
}

export function RestockListView({
  usuarioId,
  onNavigate,
}: Props): ReactElement {
  const [items, setItems] = useState<RestockItem[] | null>(null);
  const [format, setFormat] = useState<RestockExportFormat>("pdf");
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<{
    kind: "success" | "cancelled" | "error";
    message: string;
  } | null>(null);

  const refresh = useCallback((): void => {
    setIsLoading(true);
    setLoadError(null);

    void loadRestockList(window.appApi.invoke, usuarioId)
      .then((data) => {
        setItems(data);
        setIsLoading(false);
      })
      .catch((error: unknown) => {
        setLoadError(
          error instanceof Error
            ? error.message
            : "No fue posible cargar la lista de reabastecimiento.",
        );
        setIsLoading(false);
      });
  }, [usuarioId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleExport = (): void => {
    if (!items?.length || isExporting) return;

    setIsExporting(true);
    setExportNotice(null);
    void exportRestockList(window.appApi.invoke, usuarioId, format)
      .then((result) => {
        setIsExporting(false);
        setExportNotice(
          result.estado === "cancelled"
            ? { kind: "cancelled", message: "Exportación cancelada." }
            : {
                kind: "success",
                message: `Archivo guardado en ${result.ruta ?? "la ubicación seleccionada"}`,
              },
        );
      })
      .catch(() => {
        setIsExporting(false);
        setExportNotice({
          kind: "error",
          message: RESTOCK_EXPORT_ERROR_MESSAGE,
        });
      });
  };

  const hasItems = Boolean(items?.length);

  return (
    <section className="px-8 py-8">
      <article className="rounded-md border border-[#cbd5df] bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#cbd5df] px-6 py-4">
          <div>
            <h3 className="text-lg font-semibold text-[#17202a]">
              Productos por reabastecer
            </h3>
            <p className="mt-1 text-sm text-[#61717f]">
              Productos cuyo stock actual es igual o inferior al stock mínimo.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-xs font-semibold text-[#24313d]">
              Formato
              <select
                aria-label="Formato de exportación"
                className="rounded-md border border-[#9ba9b5] bg-white px-3 py-2 text-sm font-normal disabled:opacity-50"
                disabled={!hasItems || isExporting}
                value={format}
                onChange={(event) =>
                  setFormat(event.target.value as RestockExportFormat)
                }
              >
                <option value="pdf">PDF</option>
                <option value="xlsx">XLSX</option>
              </select>
            </label>
            <button
              className="rounded-md bg-[#2d6a4f] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#1b4332] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!hasItems || isExporting}
              type="button"
              onClick={handleExport}
            >
              {isExporting ? "Generando..." : "Exportar"}
            </button>
            <button
              className="rounded-md border border-[#9ba9b5] px-4 py-2 text-sm font-semibold text-[#24313d] transition hover:bg-[#f0f3f6] disabled:opacity-50"
              disabled={isLoading || isExporting}
              type="button"
              onClick={refresh}
            >
              {isLoading ? "Actualizando..." : "Actualizar"}
            </button>
            <button
              className="rounded-md border border-[#2d6a4f] px-4 py-2 text-sm font-semibold text-[#1b4332] transition hover:bg-[#edf7f1]"
              type="button"
              onClick={() => onNavigate("/app/proveedores/pedidos/nuevo")}
            >
              Registrar pedido
            </button>
          </div>
        </div>

        {loadError ? (
          <div
            className="m-6 flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#fecdca] bg-[#fff3f1] px-4 py-3 text-sm font-medium text-[#b42318]"
            role="alert"
          >
            <span>{loadError}</span>
            <button
              className="rounded-md border border-[#b42318] px-3 py-1 font-semibold disabled:opacity-50"
              disabled={isLoading}
              type="button"
              onClick={refresh}
            >
              Reintentar
            </button>
          </div>
        ) : null}

        {exportNotice ? (
          <p
            className={`mx-6 mt-6 rounded-md border px-4 py-3 text-sm font-medium ${
              exportNotice.kind === "error"
                ? "border-[#fecdca] bg-[#fff3f1] text-[#b42318]"
                : exportNotice.kind === "success"
                  ? "border-[#a7d7bd] bg-[#edf7f1] text-[#1b4332]"
                  : "border-[#cbd5df] bg-[#f6f7f9] text-[#24313d]"
            }`}
            role={exportNotice.kind === "error" ? "alert" : "status"}
          >
            {exportNotice.message}
          </p>
        ) : null}

        {isLoading && items === null ? (
          <p className="px-6 py-10 text-center text-sm text-[#61717f]">
            Cargando lista de reabastecimiento...
          </p>
        ) : null}

        {!isLoading && items?.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-[#61717f]">
            {RESTOCK_EMPTY_MESSAGE}
          </p>
        ) : null}

        {items && items.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[#cbd5df] bg-[#f6f7f9]">
                <tr>
                  <th className="px-4 py-3 font-semibold text-[#24313d]">Producto</th>
                  <th className="px-4 py-3 font-semibold text-[#24313d]">EAN-13</th>
                  <th className="px-4 py-3 font-semibold text-[#24313d]">Categoría</th>
                  <th className="px-4 py-3 text-right font-semibold text-[#24313d]">Stock actual</th>
                  <th className="px-4 py-3 text-right font-semibold text-[#24313d]">Stock mínimo</th>
                  <th className="px-4 py-3 text-right font-semibold text-[#24313d]">Cantidad sugerida</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    className="border-b border-[#edf0f3] hover:bg-[#f6f7f9]"
                    key={item.ean13}
                  >
                    <td className="px-4 py-3 font-semibold text-[#17202a]">{item.nombre}</td>
                    <td className="px-4 py-3 font-mono text-xs text-[#61717f]">{item.ean13}</td>
                    <td className="px-4 py-3 text-[#61717f]">{item.categoria}</td>
                    <td className="px-4 py-3 text-right">{item.stockActual}</td>
                    <td className="px-4 py-3 text-right">{item.stockMinimo}</td>
                    <td className="px-4 py-3 text-right font-semibold text-[#1b4332]">{item.cantidadSugerida}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </article>
    </section>
  );
}
