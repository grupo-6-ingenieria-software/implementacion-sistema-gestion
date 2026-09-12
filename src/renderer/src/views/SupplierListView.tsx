import { useEffect, useState, type ReactElement } from "react";
import type { ControllerResponse } from "../../../shared/controllers";
import type { SupplierListItem } from "../../../shared/suppliers";

export function SupplierListView({
  onNavigate,
  usuarioId,
}: {
  onNavigate: (path: string) => void;
  usuarioId: string;
}): ReactElement {
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [suppliers, setSuppliers] = useState<SupplierListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setLoadError(null);

    void loadSupplierList(window.appApi.invoke, usuarioId, appliedSearch)
      .then((items) => {
        if (current) setSuppliers(items);
      })
      .catch((error: unknown) => {
        if (!current) return;
        setSuppliers([]);
        setLoadError(
          error instanceof Error
            ? error.message
            : "No fue posible cargar los proveedores. Intente nuevamente.",
        );
      })
      .finally(() => {
        if (current) setLoading(false);
      });

    return () => {
      current = false;
    };
  }, [appliedSearch, retryToken, usuarioId]);

  return (
    <section className="px-8 py-8">
      <article className="rounded-md border border-[#cbd5df] bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-xl font-semibold text-[#17202a]">Proveedores</h3>
            <p className="mt-2 max-w-2xl text-sm text-[#61717f]">
              Busque un proveedor por nombre o RUT para actualizar sus datos.
            </p>
          </div>
          <button
            className="rounded-md bg-[#2d6a4f] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#255a43]"
            type="button"
            onClick={() => onNavigate("/app/proveedores/nuevo")}
          >
            Registrar proveedor
          </button>
        </div>

        <form
          className="mt-6 flex flex-wrap gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            setAppliedSearch(search.trim());
          }}
        >
          <label className="min-w-[260px] flex-1 text-sm font-semibold text-[#24313d]">
            Buscar por nombre o RUT
            <input
              className="mt-2 w-full rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
              placeholder="Ej.: Distribuidora o 12.345.678-5"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <button
            className="self-end rounded-md border border-[#2d6a4f] px-4 py-2 text-sm font-semibold text-[#2d6a4f] hover:bg-[#edf7f1]"
            disabled={loading}
            type="submit"
          >
            Buscar
          </button>
        </form>

        {loading ? (
          <p className="mt-6 text-sm text-[#61717f]">Cargando proveedores...</p>
        ) : null}

        {loadError ? (
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <p className="text-sm font-semibold text-[#9f2d20]">{loadError}</p>
            <button
              className="rounded-md border border-[#9ba9b5] px-3 py-2 text-sm font-semibold text-[#24313d] hover:bg-[#f0f3f6]"
              type="button"
              onClick={() => setRetryToken((current) => current + 1)}
            >
              Reintentar
            </button>
          </div>
        ) : null}

        {!loading && !loadError && suppliers.length === 0 ? (
          <p className="mt-6 rounded-md border border-dashed border-[#cbd5df] bg-[#f8fafb] px-4 py-6 text-sm text-[#61717f]">
            No se encontraron proveedores.
          </p>
        ) : null}

        {!loading && !loadError && suppliers.length > 0 ? (
          <div className="mt-6 overflow-x-auto rounded-md border border-[#cbd5df]">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-[#edf1f5] text-[#24313d]">
                <tr>
                  <th className="px-4 py-3 font-semibold">Razón social</th>
                  <th className="px-4 py-3 font-semibold">RUT</th>
                  <th className="px-4 py-3 text-right font-semibold">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((supplier) => (
                  <tr className="border-t border-[#d7dee6]" key={supplier.proveedorId}>
                    <td className="px-4 py-3 text-[#17202a]">
                      {supplier.nombreRazonSocial}
                    </td>
                    <td className="px-4 py-3 text-[#61717f]">{supplier.rut}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        className="font-semibold text-[#2d6a4f] hover:underline"
                        type="button"
                        onClick={() => onNavigate(buildSupplierEditPath(supplier.rut))}
                      >
                        Editar
                      </button>
                    </td>
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

export async function loadSupplierList(
  invoke: typeof window.appApi.invoke,
  usuarioId: string,
  busqueda = "",
): Promise<SupplierListItem[]> {
  const response = (await invoke<SupplierListItem[]>("proveedor:listar", {
    ...(busqueda.trim() ? { busqueda: busqueda.trim() } : {}),
    usuarioId,
  })) as ControllerResponse<SupplierListItem[]>;

  if (!response.ok) throw new Error(response.error.message);
  return response.data;
}

export function buildSupplierEditPath(rut: string): string {
  return `/app/proveedores/${encodeURIComponent(rut)}/editar`;
}
