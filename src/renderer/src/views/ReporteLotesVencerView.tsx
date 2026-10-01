import {
  useCallback,
  useEffect,
  useState,
  type ReactElement,
} from "react";
import type {
  ExpiringLotsCategoryOption,
  ExpiringLotsReportData,
  ExpiringLotsReportRequest,
} from "../../../shared/report-expiring-lots";
import {
  DEFAULT_EXPIRING_LOTS_HORIZON,
  EXPIRING_LOTS_EMPTY_MESSAGE,
  EXPIRING_LOTS_HORIZON_ERROR,
} from "../../../shared/report-expiring-lots";
import type { RestockExportFormat, RestockExportResult } from "../../../shared/restock";

type Props = {
  usuarioId: string;
  onNavigate?: (path: string) => void;
};

const currencyFormatter = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});

const numberFormatter = new Intl.NumberFormat("es-CL");

export function formatCurrency(value: number): string {
  return currencyFormatter.format(value);
}

export function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

export async function fetchExpiringLotsReport(
  invoke: typeof window.appApi.invoke,
  request: ExpiringLotsReportRequest,
): Promise<ExpiringLotsReportData> {
  const response = await invoke<ExpiringLotsReportData>(
    "reporte:lotes-por-vencer",
    request,
  );
  if (!response.ok) {
    throw new Error(response.error.message);
  }
  return response.data;
}

export async function exportExpiringLotsReport(
  invoke: typeof window.appApi.invoke,
  payload: ExpiringLotsReportRequest & { tipoReporte: "lotes-por-vencer" },
  format: RestockExportFormat,
): Promise<RestockExportResult> {
  const channel =
    format === "pdf" ? "reporte:exportar-pdf" : "reporte:exportar-xlsx";
  const response = await invoke<RestockExportResult>(channel, payload);
  if (!response.ok) {
    throw new Error(response.error.message);
  }
  return response.data;
}

export function ReporteLotesVencerView({
  usuarioId: _usuarioId,
}: Props): ReactElement {
  const [horizonteInput, setHorizonteInput] = useState<string>(
    String(DEFAULT_EXPIRING_LOTS_HORIZON),
  );
  const [categoriaIdInput, setCategoriaIdInput] = useState<string>("");
  const [categorias, setCategorias] = useState<
    readonly ExpiringLotsCategoryOption[]
  >([]);
  const [reportData, setReportData] =
    useState<ExpiringLotsReportData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<{
    kind: "success" | "cancelled" | "error";
    message: string;
  } | null>(null);

  const loadReport = useCallback(
    (horizonteVal: string, categoriaVal: string): void => {
      setValidationError(null);
      setError(null);
      setExportNotice(null);

      const parsedHorizon = Number(horizonteVal);
      if (
        !horizonteVal.trim() ||
        Number.isNaN(parsedHorizon) ||
        !Number.isInteger(parsedHorizon) ||
        parsedHorizon < 1 ||
        parsedHorizon > 31
      ) {
        setValidationError(EXPIRING_LOTS_HORIZON_ERROR);
        return;
      }

      setIsLoading(true);
      const req: ExpiringLotsReportRequest = {
        horizonte: parsedHorizon,
        categoriaId: categoriaVal ? Number(categoriaVal) : undefined,
      };

      void fetchExpiringLotsReport(window.appApi.invoke, req)
        .then((data) => {
          setReportData(data);
          if (data.categorias.length > 0) {
            setCategorias(data.categorias);
          }
          setIsLoading(false);
        })
        .catch((err: unknown) => {
          const msg =
            err instanceof Error
              ? err.message
              : "No fue posible generar el reporte de lotes por vencer.";
          if (msg === EXPIRING_LOTS_HORIZON_ERROR) {
            setValidationError(msg);
          } else {
            setError(msg);
          }
          setIsLoading(false);
        });
    },
    [],
  );

  useEffect(() => {
    loadReport(horizonteInput, categoriaIdInput);
  }, []);

  const handleGenerate = (e: React.FormEvent): void => {
    e.preventDefault();
    loadReport(horizonteInput, categoriaIdInput);
  };

  const handleExport = (format: RestockExportFormat): void => {
    if (!reportData?.items.length || isExporting) return;

    setIsExporting(true);
    setExportNotice(null);

    void exportExpiringLotsReport(
      window.appApi.invoke,
      {
        tipoReporte: "lotes-por-vencer",
        horizonte: reportData.horizonte,
        categoriaId: reportData.categoriaId ?? undefined,
      },
      format,
    )
      .then((result) => {
        setIsExporting(false);
        setExportNotice(
          result.estado === "cancelled"
            ? { kind: "cancelled", message: "Exportación cancelada." }
            : {
                kind: "success",
                message: `Archivo guardado exitosamente en ${result.ruta ?? "la ruta seleccionada"}.`,
              },
        );
      })
      .catch((err: unknown) => {
        setIsExporting(false);
        setExportNotice({
          kind: "error",
          message:
            err instanceof Error
              ? err.message
              : "No fue posible exportar el reporte de lotes por vencer.",
        });
      });
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Encabezado */}
      <header className="flex flex-col gap-1 border-b border-[#d8e0e8] pb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#17202a]">
              Reporte de Lotes Próximos a Vencer
            </h1>
            <p className="text-sm text-[#4a5568]">
              Monitoreo y valorización de inventario perecible por expirar.
            </p>
          </div>
          {/* Botones de Exportación UI06 */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => handleExport("pdf")}
              disabled={!reportData?.items.length || isExporting || isLoading}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#c8d2dc] bg-white px-3 py-1.5 text-sm font-semibold text-[#17202a] shadow-sm hover:bg-[#f6f9fb] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Exportar PDF
            </button>
            <button
              type="button"
              onClick={() => handleExport("xlsx")}
              disabled={!reportData?.items.length || isExporting || isLoading}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#2d6a4f] bg-[#2d6a4f] px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-[#1b4332] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Exportar Excel
            </button>
          </div>
        </div>
      </header>

      {/* Notificación de exportación */}
      {exportNotice ? (
        <div
          className={`flex items-center justify-between rounded-md border p-3 text-sm font-medium ${
            exportNotice.kind === "success"
              ? "border-[#b7eb8f] bg-[#f6ffed] text-[#389e0d]"
              : exportNotice.kind === "cancelled"
                ? "border-[#d9d9d9] bg-[#fafafa] text-[#595959]"
                : "border-[#fecdca] bg-[#fff3f1] text-[#b42318]"
          }`}
        >
          <span>{exportNotice.message}</span>
          <button
            type="button"
            onClick={() => setExportNotice(null)}
            className="text-xs underline hover:no-underline"
          >
            Cerrar
          </button>
        </div>
      ) : null}

      {/* Formulario de Filtros */}
      <form
        onSubmit={handleGenerate}
        className="flex flex-wrap items-end gap-4 rounded-lg border border-[#d8e0e8] bg-white p-4 shadow-sm"
      >
        <div className="flex flex-col gap-1">
          <label
            htmlFor="horizonte-input"
            className="text-xs font-semibold uppercase tracking-wider text-[#4a5568]"
          >
            Horizonte de días (1 a 31)
          </label>
          <input
            id="horizonte-input"
            type="number"
            min={1}
            max={31}
            value={horizonteInput}
            onChange={(e) => setHorizonteInput(e.target.value)}
            className="w-36 rounded-md border border-[#c8d2dc] px-3 py-1.5 text-sm text-[#17202a] focus:border-[#2d6a4f] focus:outline-none"
            placeholder="7"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="categoria-select"
            className="text-xs font-semibold uppercase tracking-wider text-[#4a5568]"
          >
            Categoría
          </label>
          <select
            id="categoria-select"
            value={categoriaIdInput}
            onChange={(e) => setCategoriaIdInput(e.target.value)}
            className="min-w-[180px] rounded-md border border-[#c8d2dc] px-3 py-1.5 text-sm text-[#17202a] focus:border-[#2d6a4f] focus:outline-none"
          >
            <option value="">Todas las categorías</option>
            {categorias.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.nombre}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="rounded-md bg-[#2d6a4f] px-4 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-[#1b4332] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoading ? "Consultando..." : "Consultar"}
        </button>
      </form>

      {/* Alerta de validación (E1 horizonte inválido) */}
      {validationError ? (
        <div
          role="alert"
          className="rounded-md border border-[#fecdca] bg-[#fff3f1] p-4 text-sm font-semibold text-[#b42318]"
        >
          {validationError}
        </div>
      ) : null}

      {/* Error técnico */}
      {error ? (
        <div
          role="alert"
          className="rounded-md border border-[#fecdca] bg-[#fff3f1] p-4 text-sm font-semibold text-[#b42318]"
        >
          {error}
        </div>
      ) : null}

      {/* Indicador de carga */}
      {isLoading ? (
        <div className="flex items-center justify-center p-12 text-sm text-[#4a5568]">
          Cargando reporte de lotes próximos a vencer...
        </div>
      ) : null}

      {/* Contenido del Reporte */}
      {!isLoading && reportData ? (
        <>
          {/* Tarjetas de Resumen KPI */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-[#d8e0e8] bg-white p-4 shadow-sm">
              <span className="text-xs font-semibold uppercase text-[#718096]">
                Lotes por vencer
              </span>
              <p className="mt-1 text-2xl font-bold text-[#17202a]">
                {formatNumber(reportData.resumen.totalLotes)}
              </p>
              <p className="mt-0.5 text-xs text-[#718096]">
                En horizonte de {reportData.horizonte} días
              </p>
            </div>

            <div className="rounded-lg border border-[#d8e0e8] bg-white p-4 shadow-sm">
              <span className="text-xs font-semibold uppercase text-[#718096]">
                Unidades en riesgo
              </span>
              <p className="mt-1 text-2xl font-bold text-[#b42318]">
                {formatNumber(reportData.resumen.totalUnidades)}
              </p>
              <p className="mt-0.5 text-xs text-[#718096]">
                Stock físico comprometido
              </p>
            </div>

            <div className="rounded-lg border border-[#d8e0e8] bg-white p-4 shadow-sm">
              <span className="text-xs font-semibold uppercase text-[#718096]">
                Costo total en riesgo
              </span>
              <p className="mt-1 text-2xl font-bold text-[#b42318]">
                {formatCurrency(reportData.resumen.costoTotalEnRiesgo)}
              </p>
              <p className="mt-0.5 text-xs text-[#718096]">
                Valorizado a precio costo de lote
              </p>
            </div>

            <div className="rounded-lg border border-[#d8e0e8] bg-white p-4 shadow-sm">
              <span className="text-xs font-semibold uppercase text-[#718096]">
                Categorías afectadas
              </span>
              <p className="mt-1 text-2xl font-bold text-[#17202a]">
                {formatNumber(reportData.resumen.porCategoria.length)}
              </p>
              <p className="mt-0.5 text-xs text-[#718096]">
                Familias de productos
              </p>
            </div>
          </div>

          {/* Desglose por Categoría */}
          {reportData.resumen.porCategoria.length > 0 ? (
            <section className="rounded-lg border border-[#d8e0e8] bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-base font-bold text-[#17202a]">
                Costo en Riesgo por Categoría
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-[#e2e8f0] bg-[#f8fafc] text-xs font-semibold uppercase text-[#475569]">
                    <tr>
                      <th className="px-4 py-2.5">Categoría</th>
                      <th className="px-4 py-2.5 text-right">Lotes</th>
                      <th className="px-4 py-2.5 text-right">Unidades</th>
                      <th className="px-4 py-2.5 text-right">Costo en Riesgo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e2e8f0]">
                    {reportData.resumen.porCategoria.map((cat) => (
                      <tr key={cat.categoriaId} className="hover:bg-[#f1f5f9]">
                        <td className="px-4 py-2 font-medium text-[#1e293b]">
                          {cat.categoriaNombre}
                        </td>
                        <td className="px-4 py-2 text-right text-[#475569]">
                          {formatNumber(cat.totalLotes)}
                        </td>
                        <td className="px-4 py-2 text-right text-[#475569]">
                          {formatNumber(cat.totalUnidades)}
                        </td>
                        <td className="px-4 py-2 text-right font-semibold text-[#b42318]">
                          {formatCurrency(cat.costoEnRiesgo)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {/* Listado Detallado de Lotes */}
          {reportData.items.length === 0 ? (
            <div className="rounded-lg border border-[#d8e0e8] bg-white p-8 text-center text-[#718096] shadow-sm">
              <p className="text-base font-medium">
                {EXPIRING_LOTS_EMPTY_MESSAGE}
              </p>
              <p className="mt-1 text-xs">
                No hay lotes con unidades disponibles cuya fecha de vencimiento esté dentro de los próximos {reportData.horizonte} días.
              </p>
            </div>
          ) : (
            <section className="rounded-lg border border-[#d8e0e8] bg-white shadow-sm">
              <div className="border-b border-[#e2e8f0] px-4 py-3">
                <h2 className="text-base font-bold text-[#17202a]">
                  Detalle de Lotes Próximos a Vencer
                </h2>
                <p className="text-xs text-[#718096]">
                  Ordenado por proximidad de fecha de vencimiento.
                </p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-[#e2e8f0] bg-[#f8fafc] text-xs font-semibold uppercase text-[#475569]">
                    <tr>
                      <th className="px-4 py-3">Producto</th>
                      <th className="px-4 py-3">Categoría</th>
                      <th className="px-4 py-3">Proveedor</th>
                      <th className="px-4 py-3">Lote</th>
                      <th className="px-4 py-3 text-right">Unidades</th>
                      <th className="px-4 py-3">Vencimiento</th>
                      <th className="px-4 py-3 text-center">Días Rest.</th>
                      <th className="px-4 py-3 text-right">Costo Unit.</th>
                      <th className="px-4 py-3 text-right">Costo en Riesgo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e2e8f0]">
                    {reportData.items.map((item) => {
                      const isUrgent = item.diasRestantes <= 2;
                      const isWarning = item.diasRestantes <= 7;
                      return (
                        <tr key={item.loteId} className="hover:bg-[#f1f5f9]">
                          <td className="px-4 py-2.5">
                            <div className="font-medium text-[#1e293b]">
                              {item.productoNombre}
                            </div>
                            <div className="font-mono text-xs text-[#64748b]">
                              {item.productoEan13}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-[#475569]">
                            {item.categoriaNombre}
                          </td>
                          <td className="px-4 py-2.5 text-[#475569]">
                            {item.proveedorNombre ?? (
                              <span className="italic text-[#94a3b8]">
                                Sin proveedor
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-xs text-[#64748b]">
                            {item.loteId.slice(0, 8)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-medium text-[#1e293b]">
                            {formatNumber(item.cantidad)}
                          </td>
                          <td className="px-4 py-2.5 font-medium text-[#1e293b]">
                            {item.fechaVencimiento}
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <span
                              className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                                isUrgent
                                  ? "bg-[#fee2e2] text-[#991b1b]"
                                  : isWarning
                                    ? "bg-[#fef3c7] text-[#92400e]"
                                    : "bg-[#ecfdf5] text-[#065f46]"
                              }`}
                            >
                              {item.diasRestantes}{" "}
                              {item.diasRestantes === 1 ? "día" : "días"}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right text-[#475569]">
                            {formatCurrency(item.precioCosto)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-semibold text-[#b42318]">
                            {formatCurrency(item.costoEnRiesgo)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      ) : null}
    </div>
  );
}
