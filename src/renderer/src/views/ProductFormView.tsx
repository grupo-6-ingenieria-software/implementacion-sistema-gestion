import { useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  invalidEan13Message,
  isValidEan13,
  validateProductFormValues,
  type ProductCategoryOption,
  type ProductDetailResponse,
  type ProductFieldErrors,
  type ProductFormValues,
  type ProductListResponse,
  type ProductMutationResponse,
} from '../../../shared/products';
import { CampoEAN13Input } from '../components';

type ProductFormViewProps = {
  ean13?: string;
  mode: 'create' | 'edit';
  usuarioId: string;
  onNavigate: (path: string) => void;
};

type FormState = {
  ean13: string;
  nombre: string;
  categoriaId: string;
  precioCosto: string;
  precioVenta: string;
  stockMinimo: string;
};

const emptyForm: FormState = {
  ean13: '',
  nombre: '',
  categoriaId: '',
  precioCosto: '',
  precioVenta: '',
  stockMinimo: '',
};

export function ProductFormView({
  ean13,
  mode,
  usuarioId,
  onNavigate,
}: ProductFormViewProps): ReactElement {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [categories, setCategories] = useState<ProductCategoryOption[]>([]);
  const [fieldErrors, setFieldErrors] = useState<ProductFieldErrors>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const title = mode === 'create' ? 'Nuevo producto' : 'Editar producto';

  useEffect(() => {
    let isCurrent = true;

    async function loadForm(): Promise<void> {
      setLoading(true);
      setLoadError(null);
      setMessage(null);
      setFieldErrors({});

      const response =
        mode === 'edit'
          ? await window.appApi.invoke<ProductDetailResponse>('producto:estado', {
              ean13,
              usuarioId,
            })
          : await window.appApi.invoke<ProductListResponse>('producto:listar', {
              usuarioId,
            });

      if (!isCurrent) {
        return;
      }

      if (!response.ok) {
        setLoadError(response.error.message);
        setLoading(false);
        return;
      }

      if (mode === 'edit') {
        const detail = response.data as ProductDetailResponse;
        setCategories(detail.categories);
        setForm({
          ean13: detail.product.ean13,
          nombre: detail.product.nombre,
          categoriaId: String(detail.product.categoriaId),
          precioCosto: String(detail.product.precioCosto),
          precioVenta: String(detail.product.precioVenta),
          stockMinimo: String(detail.product.stockMinimo),
        });
      } else {
        const list = response.data as ProductListResponse;
        setCategories(list.categories);
        setForm(emptyForm);
      }

      setLoading(false);
    }

    loadForm().catch(() => {
      if (!isCurrent) {
        return;
      }

      setLoadError('No fue posible cargar el formulario. Intente nuevamente.');
      setLoading(false);
    });

    return () => {
      isCurrent = false;
    };
  }, [ean13, mode, usuarioId]);

  const parsedValues = useMemo<ProductFormValues>(
    () => ({
      ean13: form.ean13,
      nombre: form.nombre.trim(),
      categoriaId: Number(form.categoriaId),
      precioCosto: Number(form.precioCosto),
      precioVenta: Number(form.precioVenta),
      stockMinimo: Number(form.stockMinimo),
    }),
    [form],
  );

  const eanWarning =
    form.ean13.length === 13 && !isValidEan13(form.ean13)
      ? invalidEan13Message
      : undefined;

  async function handleSubmit(): Promise<void> {
    const nextFieldErrors = validateProductFormValues(parsedValues);
    setFieldErrors(nextFieldErrors);
    setMessage(null);

    if (Object.keys(nextFieldErrors).length > 0) {
      return;
    }

    setSaving(true);

    const response = await window.appApi.invoke<ProductMutationResponse>(
      mode === 'create' ? 'producto:registrar' : 'producto:editar',
      {
        ...parsedValues,
        originalEan13: mode === 'edit' ? ean13 : undefined,
        usuarioId,
      },
    );

    setSaving(false);

    if (!response.ok) {
      setFieldErrors(response.error.fieldErrors ?? {});
      setMessage(response.error.message);
      return;
    }

    setMessage(
      mode === 'create'
        ? 'Producto registrado correctamente.'
        : 'Producto actualizado correctamente.',
    );
    window.setTimeout(() => onNavigate('/app/inventario/productos'), 700);
  }

  return (
    <section className="px-8 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-[#2d6a4f]">Inventario</p>
          <h3 className="mt-2 text-2xl font-semibold text-[#17202a]">
            {title}
          </h3>
          <p className="mt-2 max-w-2xl text-sm text-[#61717f]">
            Completa los datos del producto. El codigo EAN-13 identifica al
            producto y no se modifica durante la edicion.
          </p>
        </div>
        <button
          className="rounded-md border border-[#9ba9b5] px-3 py-2 text-sm font-semibold text-[#24313d] transition hover:bg-[#f0f3f6]"
          type="button"
          onClick={() => onNavigate('/app/inventario/productos')}
        >
          Volver a productos
        </button>
      </div>

      <section className="mt-6 rounded-md border border-[#cbd5df] bg-white p-6 shadow-sm">
        {loading ? (
          <p className="text-sm font-semibold text-[#61717f]">
            Cargando formulario...
          </p>
        ) : null}

        {!loading && loadError ? (
          <div className="grid gap-3">
            <p className="text-sm font-semibold text-[#8a5a12]">{loadError}</p>
            <button
              className="w-fit rounded-md border border-[#9ba9b5] px-3 py-2 text-sm font-semibold text-[#24313d] transition hover:bg-[#f0f3f6]"
              type="button"
              onClick={() => onNavigate('/app/inventario/productos')}
            >
              Volver
            </button>
          </div>
        ) : null}

        {!loading && !loadError ? (
          <form
            className="grid gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSubmit();
            }}
          >
            <div className="grid gap-5 md:grid-cols-2">
              <Field label="EAN-13" error={fieldErrors.ean13 ?? eanWarning}>
                <CampoEAN13Input
                  disabled={mode === 'edit'}
                  value={form.ean13}
                  onChange={(value) =>
                    setForm((current) => ({ ...current, ean13: value }))
                  }
                />
              </Field>

              <Field label="Nombre" error={fieldErrors.nombre}>
                <input
                  className="w-full rounded-md border border-[#9ba9b5] px-3 py-2"
                  maxLength={100}
                  value={form.nombre}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      nombre: event.target.value,
                    }))
                  }
                />
              </Field>

              <Field label="Categoria" error={fieldErrors.categoriaId}>
                <select
                  className="w-full rounded-md border border-[#9ba9b5] px-3 py-2"
                  value={form.categoriaId}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      categoriaId: event.target.value,
                    }))
                  }
                >
                  <option value="">Seleccione categoria</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.nombre}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Stock minimo" error={fieldErrors.stockMinimo}>
                <NumberInput
                  value={form.stockMinimo}
                  onChange={(value) =>
                    setForm((current) => ({ ...current, stockMinimo: value }))
                  }
                />
              </Field>

              <Field label="Precio costo" error={fieldErrors.precioCosto}>
                <NumberInput
                  value={form.precioCosto}
                  onChange={(value) =>
                    setForm((current) => ({ ...current, precioCosto: value }))
                  }
                />
              </Field>

              <Field label="Precio venta" error={fieldErrors.precioVenta}>
                <NumberInput
                  value={form.precioVenta}
                  onChange={(value) =>
                    setForm((current) => ({ ...current, precioVenta: value }))
                  }
                />
              </Field>
            </div>

            {message ? (
              <p className="rounded-md bg-[#edf1f5] px-3 py-2 text-sm font-semibold text-[#24313d]">
                {message}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-3 border-t border-[#e3e8ee] pt-5">
              <button
                className="rounded-md bg-[#244d61] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#1f4354] disabled:cursor-not-allowed disabled:bg-[#9ba9b5]"
                disabled={saving}
                type="submit"
              >
                {saving ? 'Guardando...' : 'Guardar producto'}
              </button>
              <button
                className="rounded-md border border-[#9ba9b5] px-4 py-2 text-sm font-semibold text-[#24313d] transition hover:bg-[#f0f3f6]"
                type="button"
                onClick={() => onNavigate('/app/inventario/productos')}
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

function NumberInput({
  onChange,
  value,
}: {
  onChange: (value: string) => void;
  value: string;
}): ReactElement {
  return (
    <input
      className="w-full rounded-md border border-[#9ba9b5] px-3 py-2"
      inputMode="numeric"
      min={0}
      type="number"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
