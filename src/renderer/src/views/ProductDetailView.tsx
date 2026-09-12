import { useEffect, useState, type ReactElement } from "react";
import type { Role } from "../../../shared/navigation";
import type {
  ActiveLotItem,
  ProductDetailWithLotsResponse,
} from "../../../shared/inventory-detail";

type Props = {
  ean13: string;
  role: Role;
  usuarioId: string;
  onNavigate: (path: string) => void;
};

export function ProductDetailView({
  ean13,
  role,
  usuarioId,
  onNavigate,
}: Props): ReactElement {
  const [data, setData] = useState<ProductDetailWithLotsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    void window.appApi
      .invoke<ProductDetailWithLotsResponse>("producto:detalle-lotes", {
        ean13,
        usuarioId,
      })
      .then((response) => {
        if (cancelled) return;
        setIsLoading(false);

        if (response.ok) {
          setData(response.data);
        } else {
          setError(response.error.message);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setIsLoading(false);
          setError("No fue posible cargar el detalle del producto.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [ean13, usuarioId]);

  if (isLoading) {
    return (
      <section className="px-8 py-8">
        <p className="text-sm text-[#61717f]">Cargando detalle del producto...</p>
      </section>
    );
  }

  if (error || !data) {
    return (
      <section className="px-8 py-8">
        <article className="rounded-md border border-[#fecdca] bg-[#fff3f1] p-6">
          <p className="text-sm font-medium text-[#b42318]">
            {error ?? "No se encontro el producto solicitado."}
          </p>
        </article>
        <button
          className="mt-4 rounded-md border border-[#9ba9b5] px-4 py-2 text-sm font-semibold text-[#24313d] transition hover:bg-[#f0f3f6]"
          type="button"
          onClick={() => onNavigate("/app/inventario/productos")}
        >
          Volver a productos
        </button>
      </section>
    );
  }

  const { product, lots, stockTotal } = data;
  const stockCritico = stockTotal <= product.stockMinimo;

  return (
    <section className="px-8 py-8">
      {/* Info del producto */}
      <article className="rounded-md border border-[#cbd5df] bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-xl font-semibold text-[#17202a]">
              {product.nombre}
            </h3>
            <p className="mt-1 text-sm text-[#61717f]">
              EAN-13: {product.ean13}
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              product.estado === "activo"
                ? "bg-[#d1fae5] text-[#065f46]"
                : "bg-[#fee2e2] text-[#991b1b]"
            }`}
          >
            {product.estado === "activo" ? "Activo" : "Inactivo"}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <InfoField label="Categoria" value={product.categoria} />
          <InfoField
            label="Precio venta"
            value={`$${product.precioVenta.toLocaleString("es-CL")}`}
          />
          {role === "dueno" && product.precioCosto !== undefined ? (
            <InfoField
              label="Precio costo"
              value={`$${product.precioCosto.toLocaleString("es-CL")}`}
            />
          ) : null}
          <InfoField label="Stock minimo" value={String(product.stockMinimo)} />
        </div>

        {/* Resumen de stock */}
        <div className="mt-4 flex items-center gap-3">
          <span className="text-sm font-semibold text-[#24313d]">
            Stock total: {stockTotal}
          </span>
          {stockCritico ? (
            <span className="rounded-full bg-[#fef3c7] px-2 py-0.5 text-xs font-semibold text-[#92400e]">
              Stock critico
            </span>
          ) : null}
        </div>
      </article>

      {/* Tabla de lotes activos */}
      <article className="mt-6 rounded-md border border-[#cbd5df] bg-white shadow-sm">
        <div className="border-b border-[#cbd5df] px-6 py-4">
          <h4 className="text-lg font-semibold text-[#17202a]">
            Lotes activos ({lots.length})
          </h4>
        </div>

        {lots.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-[#61717f]">
            No hay lotes activos para este producto.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[#cbd5df] bg-[#f6f7f9]">
                <tr>
                  <th className="px-6 py-3 font-semibold text-[#24313d]">Lote</th>
                  <th className="px-6 py-3 font-semibold text-[#24313d]">Cantidad</th>
                  {role === "dueno" ? (
                    <th className="px-6 py-3 font-semibold text-[#24313d]">Costo</th>
                  ) : null}
                  <th className="px-6 py-3 font-semibold text-[#24313d]">Ingreso</th>
                  <th className="px-6 py-3 font-semibold text-[#24313d]">Vencimiento</th>
                </tr>
              </thead>
              <tbody>
                {lots.map((lot) => (
                  <LotRow key={lot.loteId} lot={lot} showCost={role === "dueno"} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>

      {/* Acciones */}
      <div className="mt-6 flex gap-3">
        <button
          className="rounded-md bg-[#244d61] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#1f4354]"
          type="button"
          onClick={() =>
            onNavigate(`/app/inventario/movimientos?ean13=${encodeURIComponent(ean13)}`)
          }
        >
          Ver movimientos
        </button>
        <button
          className="rounded-md border border-[#9ba9b5] px-4 py-2 text-sm font-semibold text-[#24313d] transition hover:bg-[#f0f3f6]"
          type="button"
          onClick={() => onNavigate("/app/inventario/productos")}
        >
          Volver a productos
        </button>
      </div>
    </section>
  );
}

function InfoField({
  label,
  value,
}: {
  label: string;
  value: string;
}): ReactElement {
  return (
    <div>
      <p className="text-xs font-semibold text-[#61717f]">{label}</p>
      <p className="mt-1 text-sm text-[#17202a]">{value}</p>
    </div>
  );
}

function LotRow({
  lot,
  showCost,
}: {
  lot: ActiveLotItem;
  showCost: boolean;
}): ReactElement {
  return (
    <tr className="border-b border-[#edf0f3] hover:bg-[#f6f7f9]">
      <td className="px-6 py-3 font-mono text-xs text-[#61717f]">
        {lot.loteId.slice(0, 8)}...
      </td>
      <td className="px-6 py-3">{lot.cantidadActual}</td>
      {showCost ? (
        <td className="px-6 py-3">
          {lot.precioCosto !== undefined
            ? `$${lot.precioCosto.toLocaleString("es-CL")}`
            : "-"}
        </td>
      ) : null}
      <td className="px-6 py-3 text-[#61717f]">
        {formatDate(lot.fechaIngreso)}
      </td>
      <td className="px-6 py-3">
        {lot.fechaVencimiento ? (
          <span className="text-[#61717f]">{lot.fechaVencimiento}</span>
        ) : (
          <span className="text-[#9ba9b5]">—</span>
        )}
      </td>
    </tr>
  );
}

function formatDate(isoDate: string): string {
  return isoDate.slice(0, 10);
}
