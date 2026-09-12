import { useEffect, useState, type ReactElement } from "react";
import type { Role } from "../../../shared/navigation";
import {
  movementTypeLabels,
  type MovementHistoryItem,
  type MovementHistoryResponse,
  type MovementType,
} from "../../../shared/inventory-detail";

type Props = {
  role: Role;
  usuarioId: string;
  onNavigate: (path: string) => void;
  initialEan13?: string;
};

const PAGE_SIZE = 50;

export function MovementHistoryView({
  role,
  usuarioId,
  onNavigate,
  initialEan13,
}: Props): ReactElement {
  const [ean13, setEan13] = useState(initialEan13 ?? "");
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [tipo, setTipo] = useState<MovementType | "">("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<MovementHistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchMovements = (currentPage: number): void => {
    setIsLoading(true);
    setError(null);

    void window.appApi
      .invoke<MovementHistoryResponse>("movimiento:historial", {
        ean13: ean13 || undefined,
        fechaDesde: fechaDesde || undefined,
        fechaHasta: fechaHasta || undefined,
        tipo: tipo || undefined,
        page: currentPage,
        pageSize: PAGE_SIZE,
        usuarioId,
      })
      .then((response) => {
        setIsLoading(false);

        if (response.ok) {
          setData(response.data);
        } else {
          setError(response.error.message);
        }
      })
      .catch(() => {
        setIsLoading(false);
        setError("No fue posible cargar los movimientos.");
      });
  };

  useEffect(() => {
    fetchMovements(1);
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ean13, fechaDesde, fechaHasta, tipo, usuarioId]);

  const handlePageChange = (newPage: number): void => {
    setPage(newPage);
    fetchMovements(newPage);
  };

  const totalPages = data ? Math.ceil(data.total / data.pageSize) : 0;

  return (
    <section className="px-8 py-8">
      {/* Filtros */}
      <article className="rounded-md border border-[#cbd5df] bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-[#17202a]">Filtros</h3>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="grid gap-1 text-sm font-semibold text-[#24313d]">
            Producto (EAN-13)
            <input
              className="rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
              maxLength={13}
              placeholder="EAN-13"
              value={ean13}
              onChange={(e) => setEan13(e.target.value)}
            />
          </label>

          <label className="grid gap-1 text-sm font-semibold text-[#24313d]">
            Tipo de movimiento
            <select
              className="rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
              value={tipo}
              onChange={(e) => setTipo(e.target.value as MovementType | "")}
            >
              <option value="">Todos</option>
              {Object.entries(movementTypeLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-sm font-semibold text-[#24313d]">
            Desde
            <input
              className="rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
              type="date"
              value={fechaDesde}
              onChange={(e) => setFechaDesde(e.target.value)}
            />
          </label>

          <label className="grid gap-1 text-sm font-semibold text-[#24313d]">
            Hasta
            <input
              className="rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
              type="date"
              value={fechaHasta}
              onChange={(e) => setFechaHasta(e.target.value)}
            />
          </label>
        </div>
      </article>

      {/* Error */}
      {error ? (
        <div className="mt-4 rounded-md border border-[#fecdca] bg-[#fff3f1] px-4 py-3 text-sm font-medium text-[#b42318]">
          {error}
        </div>
      ) : null}

      {/* Tabla */}
      <article className="mt-6 rounded-md border border-[#cbd5df] bg-white shadow-sm">
        <div className="border-b border-[#cbd5df] px-6 py-4 flex items-center justify-between">
          <h4 className="text-lg font-semibold text-[#17202a]">
            Movimientos {data ? `(${data.total})` : ""}
          </h4>
          {isLoading ? (
            <span className="text-xs text-[#61717f]">Cargando...</span>
          ) : null}
        </div>

        {data && data.movements.length === 0 && !isLoading ? (
          <p className="px-6 py-8 text-center text-sm text-[#61717f]">
            No se encontraron movimientos para los filtros seleccionados.
          </p>
        ) : null}

        {data && data.movements.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-[#cbd5df] bg-[#f6f7f9]">
                  <tr>
                    <th className="px-4 py-3 font-semibold text-[#24313d]">Fecha</th>
                    <th className="px-4 py-3 font-semibold text-[#24313d]">Tipo</th>
                    <th className="px-4 py-3 font-semibold text-[#24313d]">Producto</th>
                    <th className="px-4 py-3 font-semibold text-[#24313d]">Lote</th>
                    <th className="px-4 py-3 font-semibold text-[#24313d]">Cantidad</th>
                    <th className="px-4 py-3 font-semibold text-[#24313d]">Descripcion</th>
                    <th className="px-4 py-3 font-semibold text-[#24313d]">Usuario</th>
                  </tr>
                </thead>
                <tbody>
                  {data.movements.map((movement) => (
                    <MovementRow key={movement.id} movement={movement} />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Paginacion */}
            {totalPages > 1 ? (
              <div className="flex items-center justify-between border-t border-[#cbd5df] px-6 py-3">
                <span className="text-xs text-[#61717f]">
                  Pagina {page} de {totalPages}
                </span>
                <div className="flex gap-2">
                  <button
                    className="rounded-md border border-[#9ba9b5] px-3 py-1 text-sm font-semibold text-[#24313d] transition hover:bg-[#f0f3f6] disabled:opacity-40"
                    disabled={page <= 1}
                    type="button"
                    onClick={() => handlePageChange(page - 1)}
                  >
                    Anterior
                  </button>
                  <button
                    className="rounded-md border border-[#9ba9b5] px-3 py-1 text-sm font-semibold text-[#24313d] transition hover:bg-[#f0f3f6] disabled:opacity-40"
                    disabled={page >= totalPages}
                    type="button"
                    onClick={() => handlePageChange(page + 1)}
                  >
                    Siguiente
                  </button>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </article>
    </section>
  );
}

function MovementRow({
  movement,
}: {
  movement: MovementHistoryItem;
}): ReactElement {
  const isPositive = movement.cantidad > 0;

  return (
    <tr className="border-b border-[#edf0f3] hover:bg-[#f6f7f9]">
      <td className="px-4 py-3 text-[#61717f]">
        {movement.fecha.slice(0, 16).replace("T", " ")}
      </td>
      <td className="px-4 py-3">
        <span className="rounded-full bg-[#f6f7f9] px-2 py-0.5 text-xs font-semibold text-[#24313d]">
          {movementTypeLabels[movement.tipo] ?? movement.tipo}
        </span>
      </td>
      <td className="px-4 py-3">
        <span className="font-semibold">{movement.productoNombre}</span>
        <span className="ml-1 text-xs text-[#61717f]">
          {movement.productoEan13}
        </span>
      </td>
      <td className="px-4 py-3 font-mono text-xs text-[#61717f]">
        {movement.loteId ? `${movement.loteId.slice(0, 8)}...` : "—"}
      </td>
      <td
        className={`px-4 py-3 font-semibold ${
          isPositive ? "text-[#065f46]" : "text-[#b42318]"
        }`}
      >
        {isPositive ? "+" : ""}
        {movement.cantidad}
      </td>
      <td className="max-w-[200px] truncate px-4 py-3 text-[#61717f]">
        {movement.descripcion}
      </td>
      <td className="px-4 py-3 text-[#61717f]">{movement.usuario}</td>
    </tr>
  );
}
