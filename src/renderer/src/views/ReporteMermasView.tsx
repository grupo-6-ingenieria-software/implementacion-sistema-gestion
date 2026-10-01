import {
  useCallback,
  useEffect,
  useState,
  type ReactElement,
} from "react";
import type {
  WasteReportData,
  WasteReportRequest,
} from "../../../shared/report-waste";
import {
  WASTE_REPORT_DATE_RANGE_ERROR,
  WASTE_REPORT_EMPTY_MESSAGE,
} from "../../../shared/report-waste";
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

const MOTIVO_LABELS: Record<string, string> = {
  vencimiento: "Vencimiento",
  dano: "Daño",
  robo: "Robo",
  error_registro: "Error de registro",
};

function getInitialDates(): { start: string; end: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return {
    start: `${year}-${month}-01`,
    end: `${year}-${month}-${day}`,
  };
}

export async function fetchWasteReport(
  invoke: typeof window.appApi.invoke,
  request: WasteReportRequest,
): Promise<WasteReportData> {
  const response = await invoke<WasteReportData>("reporte:mermas", request);
  if (!response.ok) {
    throw new Error(response.error.message);
  }
  return response.data;
}

export async function exportWasteReport(
  invoke: typeof window.appApi.invoke,
  payload: WasteReportRequest & { tipoReporte: "mermas" },
  format: RestockExportFormat,
): Promise<RestockExportResult> {
  const channel = format === "pdf" ? "reporte:exportar-pdf" : "reporte:exportar-xlsx";
  const response = await invoke<RestockExportResult>(channel, payload);
  if (!response.ok) {
    throw new Error(response.error.message);
  }
  return response.data;
}

export function ReporteMermasView({
  usuarioId,
}: Props): ReactElement {
  const initial = getInitialDates();
  const [fechaInicio, setFechaInicio] = useState(initial.start);
  const [fechaTermino, setFechaTermino] = useState(initial.end);
  const [reportData, setReportData] = useState<WasteReportData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<{
    kind: "success" | "cancelled" | "error";
    message: string;
  } | null>(null);

  const loadReport = useCallback(
    (start: string, end: string): void => {
      setValidationError(null);
      setError(null);
      setExportNotice(null);

      if (start > end) {
        setValidationError(WASTE_REPORT_DATE_RANGE_ERROR);
        return;
      }

      setIsLoading(true);
      void fetchWasteReport(window.appApi.invoke, {
        fechaInicio: start,
        fechaTermino: end,
        usuarioId,
      })
        .then((data) => {
          setReportData(data);
          setIsLoading(false);
        })
        .catch((err: unknown) => {
          const msg =
            err instanceof Error
              ? err.message
              : "No fue posible generar el reporte de mermas.";
          if (msg === WASTE_REPORT_DATE_RANGE_ERROR) {
            setValidationError(msg);
          } else {
            setError(msg);
          }
          setIsLoading(false);
        });
    },
    [usuarioId],
  );

  useEffect(() => {
    loadReport(fechaInicio, fechaTermino);
  }, []);

  const handleGenerate = (e: React.FormEvent): void => {
    e.preventDefault();
    loadReport(fechaInicio, fechaTermino);
  };

  const handleExport = (format: RestockExportFormat): void => {
    if (!reportData?.items.length || isExporting) return;

    setIsExporting(true);
    setExportNotice(null);

    void exportWasteReport(
      window.appApi.invoke,
      {
        tipoReporte: "mermas",
        fechaInicio,
        fechaTermino,
        usuarioId,
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
                message: `Archivo guardado exitosamente en ${result.ruta ?? "la ruta elegida"}.`,
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
              : "No fue posible exportar el reporte de mermas.",
        });
      });
  };

  const hasItems = (reportData?.items.length ?? 0) > 0;

  return (
    <section className="px-8 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-2xl font-semibold text-[#17202a]">
            Reporte de mermas
          </h3>
          <p className="mt-2 text-sm text-[#61717f]">
            Detalle de mermas registradas por período, motivo y costo histórico acumulado.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            id="btn-exportar-pdf"
            className="rounded-md border border-[#2d6a4f] bg-white px-4 py-2 text-sm font-semibold text-[#1b4332] transition hover:bg-[#edf7f1] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!hasItems || isExporting}
            type="button"
            onClick={() => handleExport("pdf")}
          >
            {isExporting ? "Exportando..." : "Exportar PDF"}
          </button>
          <button
            id="btn-exportar-xlsx"
            className="rounded-md bg-[#2d6a4f] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#1b4332] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!hasItems || isExporting}
            type="button"
            onClick={() => handleExport("xlsx")}
          >
            {isExporting ? "Exportando..." : "Exportar XLSX"}
          </button>
        </div>
      </div>

      <form
        onSubmit={handleGenerate}
        className="mt-6 flex flex-wrap items-end gap-4 rounded-md border border-[#cbd5df] bg-white p-5 shadow-sm"
      >
        <div>
          <label
            htmlFor="fechaInicio"
            className="block text-xs font-semibold uppercase tracking-wider text-[#475569]"
          >
            Fecha inicio
          </label>
          <input
            id="fechaInicio"
            type="date"
            value={fechaInicio}
            onChange={(e) => setFechaInicio(e.target.value)}
            className="mt-1 rounded-md border border-[#cbd5df] px-3 py-2 text-sm text-[#17202a] focus:border-[#2d6a4f] focus:outline-none"
            required
          />
        </div>

        <div>
          <label
            htmlFor="fechaTermino"
            className="block text-xs font-semibold uppercase tracking-wider text-[#475569]"
          >
            Fecha término
          </label>
          <input
            id="fechaTermino"
            type="date"
            value={fechaTermino}
            onChange={(e) => setFechaTermino(e.target.value)}
            className="mt-1 rounded-md border border-[#cbd5df] px-3 py-2 text-sm text-[#17202a] focus:border-[#2d6a4f] focus:outline-none"
            required
          />
        </div>

        <button
          id="btn-generar-reporte"
          type="submit"
          disabled={isLoading}
          className="rounded-md bg-[#1b4332] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[#143225] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoading ? "Generando..." : "Generar reporte"}
        </button>
      </form>

      {validationError ? (
        <div
          role="alert"
          className="mt-6 rounded-md border border-[#fecdca] bg-[#fff3f1] p-4 text-sm font-medium text-[#b42318]"
        >
          {validationError}
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#fecdca] bg-[#fff3f1] p-4 text-sm font-medium text-[#b42318]"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => loadReport(fechaInicio, fechaTermino)}
            className="rounded-md border border-[#b42318] px-3 py-1 text-xs font-semibold"
          >
            Reintentar
          </button>
        </div>
      ) : null}

      {exportNotice ? (
        <div
          role="status"
          className={`mt-6 rounded-md p-4 text-sm font-medium ${
            exportNotice.kind === "success"
              ? "border border-[#a7d7bd] bg-[#edf7f1] text-[#1b4332]"
              : exportNotice.kind === "cancelled"
                ? "border border-[#cbd5df] bg-[#f6f7f9] text-[#475569]"
                : "border border-[#fecdca] bg-[#fff3f1] text-[#b42318]"
          }`}
        >
          {exportNotice.message}
        </div>
      ) : null}

      {reportData && !validationError ? (
        <>
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <article className="rounded-md border border-[#cbd5df] bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase text-[#61717f]">
                Total unidades
              </p>
              <p className="mt-1 text-2xl font-bold text-[#17202a]">
                {formatNumber(reportData.resumen.totalUnidades)}
              </p>
            </article>

            <article className="rounded-md border border-[#a7d7bd] bg-[#edf7f1] p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase text-[#2d6a4f]">
                Costo total mermas
              </p>
              <p className="mt-1 text-2xl font-bold text-[#1b4332]">
                {formatCurrency(reportData.resumen.costoTotal)}
              </p>
            </article>

            <article className="rounded-md border border-[#cbd5df] bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase text-[#61717f]">
                Vencimiento
              </p>
              <p className="mt-1 text-2xl font-bold text-[#17202a]">
                {formatNumber(reportData.resumen.unidadesPorMotivo.vencimiento)}
              </p>
            </article>

            <article className="rounded-md border border-[#cbd5df] bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase text-[#61717f]">
                Daño
              </p>
              <p className="mt-1 text-2xl font-bold text-[#17202a]">
                {formatNumber(reportData.resumen.unidadesPorMotivo.dano)}
              </p>
            </article>

            <article className="rounded-md border border-[#cbd5df] bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase text-[#61717f]">
                Robo
              </p>
              <p className="mt-1 text-2xl font-bold text-[#17202a]">
                {formatNumber(reportData.resumen.unidadesPorMotivo.robo)}
              </p>
            </article>

            <article className="rounded-md border border-[#cbd5df] bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase text-[#61717f]">
                Error registro
              </p>
              <p className="mt-1 text-2xl font-bold text-[#17202a]">
                {formatNumber(reportData.resumen.unidadesPorMotivo.error_registro)}
              </p>
            </article>
          </div>

          <article className="mt-6 overflow-hidden rounded-md border border-[#cbd5df] bg-white shadow-sm">
            <div className="border-b border-[#cbd5df] px-6 py-4">
              <h4 className="text-lg font-semibold text-[#17202a]">
                Detalle de mermas
              </h4>
            </div>

            {reportData.items.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <p className="text-base font-medium text-[#17202a]">
                  Sin mermas en el período
                </p>
                <p className="mt-1 text-sm text-[#61717f]">
                  {WASTE_REPORT_EMPTY_MESSAGE}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-[#cbd5df] bg-[#f6f7f9]">
                    <tr>
                      <th className="px-4 py-3 font-semibold text-[#24313d]">
                        Fecha y hora
                      </th>
                      <th className="px-4 py-3 font-semibold text-[#24313d]">
                        Producto
                      </th>
                      <th className="px-4 py-3 font-semibold text-[#24313d]">
                        EAN-13
                      </th>
                      <th className="px-4 py-3 font-semibold text-[#24313d]">
                        Categoría
                      </th>
                      <th className="px-4 py-3 text-right font-semibold text-[#24313d]">
                        Cantidad
                      </th>
                      <th className="px-4 py-3 font-semibold text-[#24313d]">
                        Motivo
                      </th>
                      <th className="px-4 py-3 text-right font-semibold text-[#24313d]">
                        Costo unitario
                      </th>
                      <th className="px-4 py-3 text-right font-semibold text-[#24313d]">
                        Costo total
                      </th>
                      <th className="px-4 py-3 font-semibold text-[#24313d]">
                        Responsable
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e2e8f0]">
                    {reportData.items.map((item) => (
                      <tr key={item.id} className="hover:bg-[#f8fafc]">
                        <td className="px-4 py-3 whitespace-nowrap text-[#475569]">
                          {item.fechaHora}
                        </td>
                        <td className="px-4 py-3 font-medium text-[#17202a]">
                          {item.productoNombre}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-[#64748b]">
                          {item.productoEan13}
                        </td>
                        <td className="px-4 py-3 text-[#475569]">
                          {item.categoriaNombre}
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-[#17202a]">
                          {formatNumber(item.cantidad)}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                              item.motivo === "vencimiento"
                                ? "bg-[#fef3c7] text-[#92400e]"
                                : item.motivo === "dano"
                                  ? "bg-[#fee2e2] text-[#991b1b]"
                                  : item.motivo === "robo"
                                    ? "bg-[#ede9fe] text-[#5b21b6]"
                                    : "bg-[#e0f2fe] text-[#075985]"
                            }`}
                          >
                            {MOTIVO_LABELS[item.motivo] ?? item.motivo}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-[#475569]">
                          {formatCurrency(item.costoUnitario)}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-[#17202a]">
                          {formatCurrency(item.costoTotal)}
                        </td>
                        <td className="px-4 py-3 text-[#475569]">
                          {item.usuarioNombre}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>
        </>
      ) : null}
    </section>
  );
}
