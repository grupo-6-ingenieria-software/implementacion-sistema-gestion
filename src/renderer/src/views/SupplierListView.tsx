import { useEffect, useMemo, useState, type ReactElement } from "react";
import type { ControllerResponse } from "../../../shared/controllers";
import {
  normalizeSupplierListRequest,
  type SupplierCategoryOption,
  type SupplierListItem,
  type SupplierListRequest,
  type SupplierListResponse,
} from "../../../shared/suppliers";

export const SUPPLIER_SEARCH_DEBOUNCE_MS = 250;

export function SupplierListView({
  onNavigate,
  usuarioId,
}: {
  onNavigate: (path: string) => void;
  usuarioId: string;
}): ReactElement {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [suppliers, setSuppliers] = useState<SupplierListItem[]>([]);
  const [categories, setCategories] = useState<SupplierCategoryOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    const timeout = window.setTimeout(
      () => setDebouncedSearch(search),
      SUPPLIER_SEARCH_DEBOUNCE_MS,
    );

    return () => window.clearTimeout(timeout);
  }, [search]);

  const filters = useMemo(
    () => ({
      busqueda: debouncedSearch,
      categoriaId: categoryId ? Number(categoryId) : undefined,
    }),
    [categoryId, debouncedSearch],
  );

  useEffect(() => {
    let current = true;
    setLoading(true);
    setLoadError(null);

    void loadSupplierList(window.appApi.invoke, usuarioId, filters)
      .then((data) => {
        if (!current) return;
        setSuppliers(data.suppliers);
        setCategories(data.categories);
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
  }, [filters, retryToken, usuarioId]);

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

        <div className="mt-6 grid gap-4 md:grid-cols-[minmax(260px,1fr)_260px]">
          <label className="min-w-[260px] flex-1 text-sm font-semibold text-[#24313d]">
            Buscar por nombre o RUT
            <input
              className="mt-2 w-full rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
              placeholder="Ej.: Distribuidora o 12.345.678-5"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label className="grid gap-2 text-sm font-semibold text-[#24313d]">
            Categoría
            <select
              className="rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
            >
              <option value="">Todas las categorías</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.nombre}
                </option>
              ))}
            </select>
          </label>
        </div>

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
            No existen proveedores coincidentes
          </p>
        ) : null}

        {!loading && !loadError && suppliers.length > 0 ? (
          <div className="mt-6 overflow-x-auto rounded-md border border-[#cbd5df]">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-[#edf1f5] text-[#24313d]">
                <tr>
                  <th className="px-4 py-3 font-semibold">RUT</th>
                  <th className="px-4 py-3 font-semibold">Razón social</th>
                  <th className="px-4 py-3 font-semibold">Contacto</th>
                  <th className="px-4 py-3 font-semibold">Teléfono</th>
                  <th className="px-4 py-3 font-semibold">Correo</th>
                  <th className="px-4 py-3 font-semibold">Categorías</th>
                  <th className="px-4 py-3 text-right font-semibold">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((supplier) => (
                  <tr className="border-t border-[#d7dee6]" key={supplier.proveedorId}>
                    <td className="whitespace-nowrap px-4 py-3 text-[#61717f]">
                      {supplier.rut}
                    </td>
                    <td className="px-4 py-3 text-[#17202a]">
                      {supplier.nombreRazonSocial}
                    </td>
                    <td className="px-4 py-3 text-[#61717f]">
                      {supplier.nombreContacto}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-[#61717f]">
                      {supplier.telefono}
                    </td>
                    <td className="px-4 py-3 text-[#61717f]">
                      {supplier.correoElectronico}
                    </td>
                    <td className="px-4 py-3 text-[#61717f]">
                      {supplier.categorias.length > 0
                        ? supplier.categorias
                            .map((category) => category.nombre)
                            .join(", ")
                        : "Sin categorías"}
                    </td>
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
  filters: Pick<SupplierListRequest, "busqueda" | "categoriaId"> = {},
): Promise<SupplierListResponse> {
  const response = (await invoke<SupplierListResponse>(
    "proveedor:listar",
    buildSupplierListPayload(usuarioId, filters),
  )) as ControllerResponse<SupplierListResponse>;

  if (!response.ok) throw new Error(response.error.message);
  return response.data;
}

export function buildSupplierListPayload(
  usuarioId: string,
  filters: Pick<SupplierListRequest, "busqueda" | "categoriaId"> = {},
): SupplierListRequest {
  return normalizeSupplierListRequest({ ...filters, usuarioId });
}

export function buildSupplierEditPath(rut: string): string {
  return `/app/proveedores/${encodeURIComponent(rut)}/editar`;
}
