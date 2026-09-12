import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import type { ControllerResponse } from "../../../shared/controllers";
import { formatRutInput } from "../../../shared/rut";
import {
  emptySupplierRegistration,
  hasSupplierFieldErrors,
  normalizeSupplierEditPayload,
  normalizeSupplierRegistrationPayload,
  validateSupplierEditPayload,
  validateSupplierRegistrationPayload,
  type SupplierCategoryOption,
  type SupplierDetail,
  type SupplierEditPayload,
  type SupplierEditResponse,
  type SupplierFieldErrors,
  type SupplierRegistrationResponse,
} from "../../../shared/suppliers";

type SupplierFormViewProps = {
  usuarioId: string;
  onNavigate: (path: string) => void;
  rut?: string;
};

type SupplierFormData = {
  categories: SupplierCategoryOption[];
  supplier?: SupplierDetail;
};

export function SupplierFormView({
  usuarioId,
  onNavigate,
  rut,
}: SupplierFormViewProps): ReactElement {
  const isEdit = Boolean(rut);
  const [form, setForm] = useState<SupplierEditPayload>({
    ...emptySupplierRegistration,
  });
  const [categories, setCategories] = useState<SupplierCategoryOption[]>([]);
  const [fieldErrors, setFieldErrors] = useState<SupplierFieldErrors>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [saving, setSaving] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const submissionPending = useRef(false);

  useEffect(() => {
    let current = true;
    setLoadingData(true);
    setLoadError(null);
    setFieldErrors({});

    void loadSupplierFormData(window.appApi.invoke, usuarioId, rut)
      .then(({ categories: loadedCategories, supplier }) => {
        if (!current) return;
        setCategories(loadedCategories);

        if (supplier) {
          setForm(toSupplierFormPayload(supplier));
          return;
        }

        const availableIds = new Set(loadedCategories.map(({ id }) => id));
        setForm((previous) => ({
          ...previous,
          categoriaIds: previous.categoriaIds.filter((id) =>
            availableIds.has(id),
          ),
        }));
      })
      .catch((error: unknown) => {
        if (!current) return;
        setCategories([]);
        setLoadError(
          error instanceof Error
            ? error.message
            : isEdit
              ? "No fue posible cargar el proveedor. Intente nuevamente."
              : "No fue posible cargar las categorías. Intente nuevamente.",
        );
      })
      .finally(() => {
        if (current) setLoadingData(false);
      });

    return () => {
      current = false;
    };
  }, [isEdit, retryToken, rut, usuarioId]);

  const normalizedPayload = useMemo(
    () =>
      isEdit
        ? normalizeSupplierEditPayload({ ...form, usuarioId })
        : normalizeSupplierRegistrationPayload({ ...form, usuarioId }),
    [form, isEdit, usuarioId],
  );

  async function handleSubmit(): Promise<void> {
    if (submissionPending.current || categories.length === 0) return;

    setMessage(null);
    const localErrors = isEdit
      ? validateSupplierEditPayload(normalizedPayload)
      : validateSupplierRegistrationPayload(normalizedPayload);

    if (hasSupplierFieldErrors(localErrors)) {
      setFieldErrors(localErrors);
      setMessage("Revise los campos marcados antes de continuar.");
      return;
    }

    submissionPending.current = true;
    setSaving(true);
    setFieldErrors({});

    try {
      const response = await window.appApi.invoke<
        SupplierEditResponse | SupplierRegistrationResponse
      >(isEdit ? "proveedor:editar" : "proveedor:registrar", normalizedPayload);

      if (!response.ok) {
        setFieldErrors(response.error.fieldErrors ?? {});
        setMessage(response.error.message);
        return;
      }

      if (isEdit) {
        setForm({
          ...toSupplierFormPayload(normalizedPayload),
          rut: response.data.rut,
        });
        setMessage("Proveedor actualizado correctamente");
      } else {
        setForm({ ...emptySupplierRegistration });
        setMessage("Proveedor registrado correctamente");
      }
    } catch {
      setMessage(
        isEdit
          ? "No fue posible actualizar el proveedor. Intente nuevamente."
          : "No fue posible registrar el proveedor. Intente nuevamente.",
      );
    } finally {
      submissionPending.current = false;
      setSaving(false);
    }
  }

  const noCategories = !loadingData && !loadError && categories.length === 0;

  return (
    <section className="px-8 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-xl font-semibold text-[#17202a]">
            {isEdit ? "Editar proveedor" : "Registrar proveedor"}
          </h3>
          <p className="mt-1 text-sm text-[#61717f]">
            {isEdit
              ? "Actualice los datos de contacto y las categorías que suministra."
              : "Complete los datos de contacto y seleccione todas las categorías que suministra."}
          </p>
        </div>
        <button
          className="rounded-md border border-[#9ba9b5] px-3 py-2 text-sm font-semibold text-[#24313d] hover:bg-[#f0f3f6]"
          type="button"
          onClick={() => onNavigate("/app/proveedores/listado")}
        >
          Volver a proveedores
        </button>
      </div>

      <section className="mt-5 rounded-md border border-[#cbd5df] bg-white p-6 shadow-sm">
        {loadingData ? (
          <p className="text-sm text-[#61717f]">
            {isEdit ? "Cargando datos del proveedor..." : "Cargando categorías..."}
          </p>
        ) : null}

        {loadError ? (
          <div className="grid gap-4">
            <p className="text-sm font-semibold text-[#9f2d20]">{loadError}</p>
            <div className="flex flex-wrap gap-3">
              <button
                className="rounded-md bg-[#2d6a4f] px-3 py-2 text-sm font-semibold text-white hover:bg-[#255a43]"
                type="button"
                onClick={() => setRetryToken((current) => current + 1)}
              >
                Reintentar
              </button>
              <button
                className="rounded-md border border-[#9ba9b5] px-3 py-2 text-sm font-semibold text-[#24313d] hover:bg-[#f0f3f6]"
                type="button"
                onClick={() => onNavigate("/app/proveedores/listado")}
              >
                Volver al listado
              </button>
            </div>
          </div>
        ) : null}

        {!loadingData && !loadError ? (
          <form
            noValidate
            className="grid gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSubmit();
            }}
          >
            <div className="grid gap-5 md:grid-cols-2">
              <Field label="RUT" error={fieldErrors.rut}>
                <input
                  aria-invalid={Boolean(fieldErrors.rut)}
                  className="w-full rounded-md border border-[#9ba9b5] px-3 py-2 font-normal disabled:bg-[#edf1f5] disabled:text-[#61717f]"
                  disabled={isEdit}
                  inputMode="text"
                  placeholder="12345678-5"
                  value={form.rut}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      rut: formatRutInput(event.target.value),
                    }))
                  }
                />
              </Field>

              <Field label="Razón social" error={fieldErrors.nombreRazonSocial}>
                <input
                  aria-invalid={Boolean(fieldErrors.nombreRazonSocial)}
                  className="w-full rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
                  value={form.nombreRazonSocial}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      nombreRazonSocial: event.target.value,
                    }))
                  }
                />
              </Field>

              <Field label="Nombre de contacto" error={fieldErrors.nombreContacto}>
                <input
                  aria-invalid={Boolean(fieldErrors.nombreContacto)}
                  className="w-full rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
                  value={form.nombreContacto}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      nombreContacto: event.target.value,
                    }))
                  }
                />
              </Field>

              <Field label="Teléfono" error={fieldErrors.telefono}>
                <input
                  aria-invalid={Boolean(fieldErrors.telefono)}
                  className="w-full rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
                  inputMode="numeric"
                  maxLength={9}
                  placeholder="912345678"
                  value={form.telefono}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      telefono: event.target.value.replace(/\D/g, "").slice(0, 9),
                    }))
                  }
                />
              </Field>

              <Field label="Correo electrónico" error={fieldErrors.correoElectronico}>
                <input
                  aria-invalid={Boolean(fieldErrors.correoElectronico)}
                  className="w-full rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
                  inputMode="email"
                  type="email"
                  value={form.correoElectronico}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      correoElectronico: event.target.value,
                    }))
                  }
                />
              </Field>
            </div>

            <fieldset className="grid gap-3 rounded-md border border-[#d7dee6] bg-[#f8fafb] p-4">
              <legend className="px-1 text-sm font-semibold text-[#24313d]">
                Categorías suministradas
              </legend>

              {noCategories ? (
                <p className="text-sm font-semibold text-[#8a5a12]">
                  No hay categorías disponibles. No es posible guardar el proveedor.
                </p>
              ) : null}

              {categories.length > 0 ? (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {categories.map((category) => (
                    <label
                      className="flex items-center gap-2 rounded-md border border-[#d7dee6] bg-white px-3 py-2 text-sm text-[#24313d]"
                      key={category.id}
                    >
                      <input
                        checked={form.categoriaIds.includes(category.id)}
                        type="checkbox"
                        onChange={() =>
                          setForm((current) => ({
                            ...current,
                            categoriaIds: toggleSupplierCategory(
                              current.categoriaIds,
                              category.id,
                            ),
                          }))
                        }
                      />
                      {category.nombre}
                    </label>
                  ))}
                </div>
              ) : null}

              {fieldErrors.categoriaIds ? (
                <span className="text-xs font-semibold text-[#9f2d20]">
                  {fieldErrors.categoriaIds}
                </span>
              ) : null}
            </fieldset>

            {message ? (
              <p className="rounded-md bg-[#edf1f5] px-3 py-2 text-sm font-semibold text-[#24313d]">
                {message}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-3 border-t border-[#e3e8ee] pt-5">
              <button
                className="rounded-md bg-[#2d6a4f] px-4 py-2 text-sm font-semibold text-white hover:bg-[#255a43] disabled:cursor-not-allowed disabled:bg-[#9ba9b5]"
                disabled={saving || categories.length === 0}
                type="submit"
              >
                {saving
                  ? "Guardando..."
                  : isEdit
                    ? "Actualizar proveedor"
                    : "Guardar proveedor"}
              </button>
              <button
                className="rounded-md border border-[#9ba9b5] px-4 py-2 text-sm font-semibold text-[#24313d] hover:bg-[#f0f3f6]"
                disabled={saving}
                type="button"
                onClick={() => onNavigate("/app/proveedores/listado")}
              >
                Cancelar
              </button>
            </div>
          </form>
        ) : null}
      </section>
    </section>
  );
}

export async function loadSupplierFormData(
  invoke: typeof window.appApi.invoke,
  usuarioId: string,
  rut?: string,
): Promise<SupplierFormData> {
  const [categories, supplier] = await Promise.all([
    loadSupplierCategories(invoke, usuarioId),
    rut ? loadSupplierDetail(invoke, usuarioId, rut) : Promise.resolve(undefined),
  ]);
  return { categories, supplier };
}

export async function loadSupplierCategories(
  invoke: typeof window.appApi.invoke,
  usuarioId: string,
): Promise<SupplierCategoryOption[]> {
  const response = (await invoke<SupplierCategoryOption[]>(
    "proveedor:categorias",
    { usuarioId },
  )) as ControllerResponse<SupplierCategoryOption[]>;

  if (!response.ok) throw new Error(response.error.message);
  return response.data;
}

export async function loadSupplierDetail(
  invoke: typeof window.appApi.invoke,
  usuarioId: string,
  rut: string,
): Promise<SupplierDetail> {
  const response = (await invoke<SupplierDetail>(
    "proveedor:buscar-existente",
    { rut, usuarioId },
  )) as ControllerResponse<SupplierDetail>;

  if (!response.ok) throw new Error(response.error.message);
  return response.data;
}

export function toggleSupplierCategory(
  selectedIds: readonly number[],
  categoryId: number,
): number[] {
  return selectedIds.includes(categoryId)
    ? selectedIds.filter((id) => id !== categoryId)
    : [...selectedIds, categoryId];
}

function toSupplierFormPayload(
  supplier: SupplierEditPayload,
): SupplierEditPayload {
  return {
    rut: supplier.rut,
    nombreRazonSocial: supplier.nombreRazonSocial,
    nombreContacto: supplier.nombreContacto,
    telefono: supplier.telefono,
    correoElectronico: supplier.correoElectronico,
    categoriaIds: [...supplier.categoriaIds],
  };
}

function Field({
  children,
  error,
  label,
}: {
  children: ReactElement;
  error?: string;
  label: string;
}): ReactElement {
  return (
    <label className="grid gap-2 text-sm font-semibold text-[#24313d]">
      {label}
      {children}
      {error ? (
        <span className="text-xs font-semibold text-[#9f2d20]">{error}</span>
      ) : null}
    </label>
  );
}
