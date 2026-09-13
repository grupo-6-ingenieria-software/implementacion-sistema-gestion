import {
  useCallback,
  useEffect,
  useState,
  type ReactElement,
} from "react";
import type { InventoryValuationResult } from "../../../shared/inventory-valuation";

type Props = {
  usuarioId: string;
};

type Invoke = typeof window.appApi.invoke;

const currencyFormatter = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});

const countFormatter = new Intl.NumberFormat("es-CL");

export function formatInventoryCurrency(value: number): string {
  return currencyFormatter.format(value);
}

export function formatInventoryCount(value: number): string {
  return countFormatter.format(value);
}

export async function loadInventoryValuation(
  invoke: Invoke,
  usuarioId: string,
): Promise<InventoryValuationResult> {
  const response = await invoke<InventoryValuationResult>(
    "inventario:valorizacion",
    { usuarioId },
  );

  if (!response.ok) throw new Error(response.error.message);
  return response.data;
}

export function ValorizacionInventarioView({
  usuarioId,
}: Props): ReactElement {
  const [result, setResult] = useState<InventoryValuationResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback((): void => {
    setIsLoading(true);
    setError(null);

    void loadInventoryValuation(window.appApi.invoke, usuarioId)
      .then((data) => {
        setResult(data);
        setIsLoading(false);
      })
      .catch((reason: unknown) => {
        setError(
          reason instanceof Error
            ? reason.message
            : "No fue posible cargar el valor del inventario.",
        );
        setIsLoading(false);
      });
  }, [usuarioId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <section className="px-8 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-2xl font-semibold text-[#17202a]">
            Valorización total del inventario
          </h3>
          <p className="mt-2 text-sm text-[#61717f]">
            Valorización por costo de las existencias actuales; no representa
            rentabilidad ni valor de venta.
          </p>
        </div>
        <button
          className="rounded-md border border-[#2d6a4f] px-4 py-2 text-sm font-semibold text-[#1b4332] transition hover:bg-[#edf7f1] disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isLoading}
          type="button"
          onClick={refresh}
        >
          {isLoading ? "Actualizando..." : "Actualizar"}
        </button>
      </div>

      {error ? (
        <div
          className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#fecdca] bg-[#fff3f1] px-4 py-3 text-sm font-medium text-[#b42318]"
          role="alert"
        >
          <span>{error}</span>
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

      {isLoading && result === null ? (
        <p className="mt-6 rounded-md border border-[#cbd5df] bg-white px-6 py-10 text-center text-sm text-[#61717f] shadow-sm">
          Calculando el valor del inventario...
        </p>
      ) : null}

      {result ? <InventoryValuationContent result={result} /> : null}
    </section>
  );
}

export function InventoryValuationContent({
  result,
}: {
  result: InventoryValuationResult;
}): ReactElement {
  return (
    <>
      <article className="mt-6 rounded-md border border-[#a7d7bd] bg-[#edf7f1] px-6 py-5 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-[#2d6a4f]">
          Valor total a costo
        </p>
        <p className="mt-2 text-3xl font-bold text-[#1b4332]">
          {formatInventoryCurrency(result.totalInventario)}
        </p>
      </article>

      <article className="mt-6 overflow-hidden rounded-md border border-[#cbd5df] bg-white shadow-sm">
        <div className="border-b border-[#cbd5df] px-6 py-4">
          <h4 className="text-lg font-semibold text-[#17202a]">
            Desglose por categoría
          </h4>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[#cbd5df] bg-[#f6f7f9]">
              <tr>
                <th className="px-4 py-3 font-semibold text-[#24313d]">
                  Categoría
                </th>
                <th className="px-4 py-3 text-right font-semibold text-[#24313d]">
                  Cantidad de productos
                </th>
                <th className="px-4 py-3 text-right font-semibold text-[#24313d]">
                  Stock total
                </th>
                <th className="px-4 py-3 text-right font-semibold text-[#24313d]">
                  Valor total
                </th>
              </tr>
            </thead>
            <tbody>
              {result.categorias.length === 0 ? (
                <tr>
                  <td
                    className="px-6 py-10 text-center text-[#61717f]"
                    colSpan={4}
                  >
                    No hay existencias disponibles para valorizar.
                  </td>
                </tr>
              ) : (
                result.categorias.map((categoria) => (
                  <tr
                    className="border-b border-[#edf0f3] hover:bg-[#f6f7f9]"
                    key={categoria.categoriaId}
                  >
                    <td className="px-4 py-3 font-semibold text-[#17202a]">
                      {categoria.categoria}
                    </td>
                    <td className="px-4 py-3 text-right text-[#24313d]">
                      {formatInventoryCount(categoria.cantidadProductos)}
                    </td>
                    <td className="px-4 py-3 text-right text-[#24313d]">
                      {formatInventoryCount(categoria.stockTotal)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-[#1b4332]">
                      {formatInventoryCurrency(categoria.valorTotal)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </article>
    </>
  );
}
