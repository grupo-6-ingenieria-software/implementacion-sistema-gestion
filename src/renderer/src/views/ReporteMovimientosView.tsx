import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactElement,
} from "react";
import {
  MOVEMENT_REPORT_DATE_RANGE_ERROR,
  MOVEMENT_REPORT_EMPTY_MESSAGE,
  MOVEMENT_TYPE_LABELS,
  type MovementReportCategoryOption,
  type MovementReportData,
  type MovementReportRequest,
  type MovementReportType,
  type MovementReportUserOption,
} from "../../../shared/report-movements";
import type { RestockExportFormat, RestockExportResult } from "../../../shared/restock";

type Props = {
  usuarioId: string;
  onNavigate?: (path: string) => void;
};

const numberFormatter = new Intl.NumberFormat("es-CL");

export function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

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

export async function fetchMovementReport(
  invoke: typeof window.appApi.invoke,
  request: MovementReportRequest,
): Promise<MovementReportData> {
  const response = await invoke<MovementReportData>(
    "reporte:movimientos-inventario",
    request,
  );
  if (!response.ok) {
    throw new Error(response.error.message);
  }
  return response.data;
}

export async function exportMovementReport(
  invoke: typeof window.appApi.invoke,
  payload: MovementReportRequest & { tipoReporte: "movimientos-inventario" },
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

export function ReporteMovimientosView({
  usuarioId: _usuarioId,
}: Props): ReactElement {
  const initial = getInitialDates();
  const [fechaInicio, setFechaInicio] = useState(initial.start);
  const [fechaTermino, setFechaTermino] = useState(initial.end);
  const [tipo, setTipo] = useState<string>("");
  const [categoriaId, setCategoriaId] = useState<string>("");
  const [usuarioIdFiltro, setUsuarioIdFiltro] = useState<string>("");

  const [categorias, setCategorias] = useState<
    readonly MovementReportCategoryOption[]
  >([]);
  const [usuarios, setUsuarios] = useState<
    readonly MovementReportUserOption[]
  >([]);

  const [reportData, setReportData] = useState<MovementReportData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<{
    kind: "success" | "cancelled" | "error";
    message: string;
  } | null>(null);

  const loadReport = useCallback(
    (
      start: string,
      end: string,
      tipoVal?: string,
      catVal?: string,
      usrVal?: string,
    ): void => {
      setValidationError(null);
      setError(null);
      setExportNotice(null);

      if (start > end) {
        setValidationError(MOVEMENT_REPORT_DATE_RANGE_ERROR);
        return;
      }

      setIsLoading(true);
      const req: MovementReportRequest = {
        fechaInicio: start,
        fechaTermino: end,
        tipo: tipoVal ? (tipoVal as MovementReportType) : undefined,
        categoriaId: catVal ? Number(catVal) : undefined,
        usuarioFiltroId: usrVal || undefined,
      };

      void fetchMovementReport(window.appApi.invoke, req)
        .then((data) => {
          setReportData(data);
          if (data.categorias.length > 0) {
            setCategorias(data.categorias);
          }
          if (data.usuarios.length > 0) {
            setUsuarios(data.usuarios);
          }
          setIsLoading(false);
        })
        .catch((err: unknown) => {
          const msg =
            err instanceof Error
              ? err.message
              : "No fue posible generar el reporte de movimientos de inventario.";
          if (msg === MOVEMENT_REPORT_DATE_RANGE_ERROR) {
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
    loadReport(fechaInicio, fechaTermino, tipo, categoriaId, usuarioIdFiltro);
  }, []);

  const handleGenerate = (e: FormEvent): void => {
    e.preventDefault();
    loadReport(fechaInicio, fechaTermino, tipo, categoriaId, usuarioIdFiltro);
  };

  const handleExport = async (format: RestockExportFormat): Promise<void> => {
    if (!reportData || reportData.items.length === 0) return;
    setIsExporting(true);
    setExportNotice(null);

    const payload = {
      tipoReporte: "movimientos-inventario" as const,
      fechaInicio,
      fechaTermino,
      tipo: tipo ? (tipo as MovementReportType) : undefined,
      categoriaId: categoriaId ? Number(categoriaId) : undefined,
      usuarioFiltroId: usuarioIdFiltro || undefined,
    };

    try {
      const result = await exportMovementReport(
        window.appApi.invoke,
        payload,
        format,
      );
      if (result.estado === "saved") {
        setExportNotice({
          kind: "success",
          message: `Reporte exportado exitosamente (${result.formato.toUpperCase()}) en: ${result.ruta ?? "Documentos"}`,
        });
      } else {
        setExportNotice({
          kind: "cancelled",
          message: "La exportación fue cancelada por el usuario.",
        });
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : "No fue posible generar el archivo de exportación.";
      setExportNotice({
        kind: "error",
        message: msg,
      });
    } finally {
      setIsExporting(false);
    }
  };

  const getTypeBadgeStyle = (t: MovementReportType) => {
    switch (t) {
      case "ingreso_lote":
        return "bg-[#d8f3dc] text-[#1b4332] border-[#b7eb8f]";
      case "venta":
        return "bg-[#e6f4ea] text-[#137333] border-[#ceead6]";
      case "restitucion":
        return "bg-[#e8f0fe] text-[#1a73e8] border-[#d2e3fc]";
      case "merma":
        return "bg-[#fee2e2] text-[#991b1b] border-[#fecaca]";
      case "ajuste_manual":
        return "bg-[#fef3c7] text-[#92400e] border-[#fde68a]";
      default:
        return "bg-[#f1f5f9] text-[#475569] border-[#cbd5e1]";
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Encabezado */}
      <header className="flex flex-col gap-2 border-b border-[#d8e0e8] pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#17202a]">
            Auditoría de Movimientos de Inventario
          </h1>
          <p className="text-sm text-[#4a5568]">
            Trazabilidad histórica completa, saldos resultantes y movimientos por producto.
          </p>
        </div>

        {/* Acciones de exportación (UI06) */}
        <div className="flex items-center gap-2">
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
            htmlFor="fecha-inicio-input"
            className="text-xs font-semibold uppercase tracking-wider text-[#4a5568]"
          >
            Fecha inicio
          </label>
          <input
            id="fecha-inicio-input"
            type="date"
            value={fechaInicio}
            onChange={(e) => setFechaInicio(e.target.value)}
            className="rounded-md border border-[#c8d2dc] px-3 py-1.5 text-sm text-[#17202a] focus:border-[#2d6a4f] focus:outline-none"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="fecha-termino-input"
            className="text-xs font-semibold uppercase tracking-wider text-[#4a5568]"
          >
            Fecha término
          </label>
          <input
            id="fecha-termino-input"
            type="date"
            value={fechaTermino}
            onChange={(e) => setFechaTermino(e.target.value)}
            className="rounded-md border border-[#c8d2dc] px-3 py-1.5 text-sm text-[#17202a] focus:border-[#2d6a4f] focus:outline-none"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="tipo-select"
            className="text-xs font-semibold uppercase tracking-wider text-[#4a5568]"
          >
            Tipo de movimiento
          </label>
          <select
            id="tipo-select"
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
            className="min-w-[170px] rounded-md border border-[#c8d2dc] px-3 py-1.5 text-sm text-[#17202a] focus:border-[#2d6a4f] focus:outline-none"
          >
            <option value="">Todos los tipos</option>
            <option value="ingreso_lote">{MOVEMENT_TYPE_LABELS.ingreso_lote}</option>
            <option value="venta">{MOVEMENT_TYPE_LABELS.venta}</option>
            <option value="restitucion">{MOVEMENT_TYPE_LABELS.restitucion}</option>
            <option value="merma">{MOVEMENT_TYPE_LABELS.merma}</option>
            <option value="ajuste_manual">{MOVEMENT_TYPE_LABELS.ajuste_manual}</option>
          </select>
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
            value={categoriaId}
            onChange={(e) => setCategoriaId(e.target.value)}
            className="min-w-[170px] rounded-md border border-[#c8d2dc] px-3 py-1.5 text-sm text-[#17202a] focus:border-[#2d6a4f] focus:outline-none"
          >
            <option value="">Todas las categorías</option>
            {categorias.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.nombre}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="usuario-select"
            className="text-xs font-semibold uppercase tracking-wider text-[#4a5568]"
          >
            Usuario
          </label>
          <select
            id="usuario-select"
            value={usuarioIdFiltro}
            onChange={(e) => setUsuarioIdFiltro(e.target.value)}
            className="min-w-[170px] rounded-md border border-[#c8d2dc] px-3 py-1.5 text-sm text-[#17202a] focus:border-[#2d6a4f] focus:outline-none"
          >
            <option value="">Todos los usuarios</option>
            {usuarios.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nombre}
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

      {/* Alerta de validación (E2 fecha rango inválido) */}
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
          Cargando movimientos de inventario...
        </div>
      ) : null}

      {/* Contenido del Reporte */}
      {!isLoading && reportData ? (
        <>
          {/* Tarjetas de Resumen KPI */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-[#d8e0e8] bg-white p-4 shadow-sm">
              <span className="text-xs font-semibold uppercase text-[#718096]">
                Total movimientos
              </span>
              <p className="mt-1 text-2xl font-bold text-[#17202a]">
                {formatNumber(reportData.resumen.totalMovimientos)}
              </p>
              <p className="mt-0.5 text-xs text-[#718096]">
                En el período seleccionado
              </p>
            </div>

            <div className="rounded-lg border border-[#d8e0e8] bg-white p-4 shadow-sm">
              <span className="text-xs font-semibold uppercase text-[#718096]">
                Total entradas
              </span>
              <p className="mt-1 text-2xl font-bold text-[#1b4332]">
                +{formatNumber(reportData.resumen.totalEntradas)}
              </p>
              <p className="mt-0.5 text-xs text-[#718096]">
                Unidades incorporadas al inventario
              </p>
            </div>

            <div className="rounded-lg border border-[#d8e0e8] bg-white p-4 shadow-sm">
              <span className="text-xs font-semibold uppercase text-[#718096]">
                Total salidas
              </span>
              <p className="mt-1 text-2xl font-bold text-[#b42318]">
                -{formatNumber(reportData.resumen.totalSalidas)}
              </p>
              <p className="mt-0.5 text-xs text-[#718096]">
                Unidades descontadas por ventas, mermas o ajustes
              </p>
            </div>
          </div>

          {/* Resumen por tipo de movimiento */}
          {reportData.resumen.resumenPorTipo.length > 0 && (
            <div className="rounded-lg border border-[#d8e0e8] bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-[#4a5568]">
                Resumen por tipo de movimiento
              </h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {reportData.resumen.resumenPorTipo.map((rt) => (
                  <div
                    key={rt.tipo}
                    className="flex flex-col rounded-md border border-[#e2e8f0] bg-[#f8fafc] p-2.5"
                  >
                    <span className="text-xs font-semibold text-[#475569]">
                      {rt.tipoLabel}
                    </span>
                    <span className="text-lg font-bold text-[#1e293b]">
                      {formatNumber(rt.totalMovimientos)}{" "}
                      <span className="text-xs font-normal text-[#64748b]">movs</span>
                    </span>
                    <span className="text-xs text-[#64748b]">
                      {formatNumber(rt.totalUnidades)} unid.
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tabla de movimientos detallados */}
          <div className="overflow-hidden rounded-lg border border-[#d8e0e8] bg-white shadow-sm">
            <div className="border-b border-[#d8e0e8] bg-[#f8fafc] px-4 py-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-[#4a5568]">
                Detalle cronológico de movimientos
              </h2>
            </div>

            {reportData.items.length === 0 ? (
              <div
                role="status"
                className="flex flex-col items-center justify-center p-12 text-center"
              >
                <p className="text-base font-semibold text-[#4a5568]">
                  {MOVEMENT_REPORT_EMPTY_MESSAGE}
                </p>
                <p className="mt-1 text-sm text-[#718096]">
                  Pruebe seleccionando un rango de fechas más amplio o eliminando los filtros aplicados.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-[#d8e0e8] bg-[#f1f5f9] text-xs font-bold uppercase tracking-wider text-[#475569]">
                    <tr>
                      <th className="px-4 py-3">Fecha y Hora</th>
                      <th className="px-4 py-3">Producto</th>
                      <th className="px-4 py-3">EAN-13</th>
                      <th className="px-4 py-3">Categoría</th>
                      <th className="px-4 py-3">Tipo</th>
                      <th className="px-4 py-3 text-right">Cantidad</th>
                      <th className="px-4 py-3 text-right">Saldo</th>
                      <th className="px-4 py-3">Lote</th>
                      <th className="px-4 py-3">Descripción</th>
                      <th className="px-4 py-3">Responsable</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e2e8f0]">
                    {reportData.items.map((item) => (
                      <tr key={item.id} className="hover:bg-[#f8fafc]">
                        <td className="whitespace-nowrap px-4 py-3 font-medium text-[#1e293b]">
                          {item.fechaHora}
                        </td>
                        <td className="px-4 py-3 font-semibold text-[#1e293b]">
                          {item.productoNombre}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-[#64748b]">
                          {item.productoEan13}
                        </td>
                        <td className="px-4 py-3 text-[#475569]">
                          {item.categoriaNombre}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <span
                            className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold ${getTypeBadgeStyle(
                              item.tipo,
                            )}`}
                          >
                            {item.tipoLabel}
                          </span>
                        </td>
                        <td
                          className={`whitespace-nowrap px-4 py-3 text-right font-bold ${
                            item.cantidad > 0 ? "text-[#16a34a]" : "text-[#dc2626]"
                          }`}
                        >
                          {item.cantidad > 0
                            ? `+${formatNumber(item.cantidad)}`
                            : formatNumber(item.cantidad)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-extrabold text-[#0f172a]">
                          {formatNumber(item.saldo)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-[#64748b]">
                          {item.loteId ? item.loteId.slice(0, 8) : "-"}
                        </td>
                        <td className="px-4 py-3 text-[#334155]">
                          {item.descripcion}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-[#475569]">
                          {item.usuarioNombre}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
