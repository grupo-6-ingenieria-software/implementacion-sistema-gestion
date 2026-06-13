import { useEffect, useMemo, useState, type ReactElement } from 'react';
import type { ActiveProductSearchItem } from '../../../shared/products';
import {
  normalizeWasteRegisterPayload,
  validateWasteRegisterPayload,
  wasteReasons,
  type WasteFieldErrors,
  type WasteReason,
  type WasteRegisterPayload,
  type WasteRegisterResponse,
} from '../../../shared/waste';
import { CampoEAN13Input } from '../components';

type WasteCreateViewProps = {
  initialEan13?: string;
  usuarioId: string;
  onNavigate: (path: string) => void;
};

type FormState = {
  ean13: string;
  cantidad: string;
  motivo: WasteReason | '';
  observacion: string;
};

const emptyForm: FormState = {
  ean13: '',
  cantidad: '',
  motivo: '',
  observacion: '',
};

const reasonLabels: Record<WasteReason, string> = {
  vencimiento: 'Vencimiento',
  dano: 'Daño',
  robo: 'Robo',
  error_registro: 'Error de registro',
};

export function WasteCreateView({
  initialEan13,
  onNavigate,
  usuarioId,
}: WasteCreateViewProps): ReactElement {
  const [form, setForm] = useState<FormState>({
    ...emptyForm,
    ean13: initialEan13 ?? '',
  });
  const [selectedProduct, setSelectedProduct] =
    useState<ActiveProductSearchItem | null>(null);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<ActiveProductSearchItem[]>(
    [],
  );
  const [fieldErrors, setFieldErrors] = useState<WasteFieldErrors>({});
  const [loading, setLoading] = useState(Boolean(initialEan13));
  const [saving, setSaving] = useState(false);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!initialEan13) {
      setLoading(false);
      return;
    }

    let isCurrent = true;

    async function loadInitialProduct(): Promise<void> {
      setLoading(true);
      setLoadError(null);
      setMessage(null);
      setFieldErrors({});

      const response = await window.appApi.invoke<ActiveProductSearchItem[]>(
        'producto:buscar-activo',
        {
          ean13: initialEan13,
          limit: 1,
          usuarioId,
        },
      );

      if (!isCurrent) {
        return;
      }

      if (!response.ok) {
        setLoadError(response.error.message);
        setLoading(false);
        return;
      }

      selectProduct(response.data[0]);
      setLoading(false);
    }

    loadInitialProduct().catch(() => {
      if (!isCurrent) {
        return;
      }

      setLoadError('No fue posible cargar el producto inicial.');
      setLoading(false);
    });

    return () => {
      isCurrent = false;
    };
  }, [initialEan13, usuarioId]);

  const payload = useMemo<WasteRegisterPayload>(
    () =>
      normalizeWasteRegisterPayload({
        ...form,
        usuarioId,
      }),
    [form, usuarioId],
  );

  function selectProduct(product: ActiveProductSearchItem): void {
    setSelectedProduct(product);
    setSearchResults([]);
    setSearch('');
    setForm((current) => ({
      ...current,
      ean13: product.ean13,
    }));
    setFieldErrors((current) => ({ ...current, ean13: undefined }));
  }

  async function searchProducts(): Promise<void> {
    const query = form.ean13.trim() || search.trim();

    setMessage(null);

    if (!query) {
      setMessage('Ingrese un EAN-13 o nombre de producto para buscar.');
      return;
    }

    setSearching(true);

    const response = await window.appApi.invoke<ActiveProductSearchItem[]>(
      'producto:buscar-activo',
      {
        query,
        limit: 10,
        usuarioId,
      },
    );

    setSearching(false);

    if (!response.ok) {
      setSearchResults([]);
      setMessage(response.error.message);
      return;
    }

    setSearchResults(response.data);

    if (response.data.length === 0) {
      setMessage('No se encontraron productos activos para la busqueda.');
    }
  }

  async function submitForm(): Promise<void> {
    const nextErrors = validateWasteRegisterPayload(payload, {
      requireUser: true,
      stockDisponible: selectedProduct?.stockDisponible,
    });

    if (!selectedProduct) {
      nextErrors.ean13 = 'Seleccione un producto activo para registrar la merma.';
    }

    setFieldErrors(nextErrors);
    setMessage(null);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setSaving(true);

    const response = await window.appApi.invoke<WasteRegisterResponse>(
      'merma:registrar',
      payload,
    );

    setSaving(false);

    if (!response.ok) {
      setFieldErrors(response.error.fieldErrors ?? {});
      setMessage(response.error.message);
      return;
    }

    setMessage('Merma registrada correctamente.');
    window.setTimeout(() => onNavigate('/app/inventario/productos'), 700);
  }

  return (
    <section className="px-8 py-8">
      <div className="flex flex-wrap items-start justify-end gap-4">
        <button
          className="rounded-md border border-[#9ba9b5] px-3 py-2 text-sm font-semibold text-[#24313d] transition hover:bg-[#f0f3f6]"
          type="button"
          onClick={() => onNavigate('/app/inventario/productos')}
        >
          Volver a productos
        </button>
      </div>

      <section className="mt-4 rounded-md border border-[#cbd5df] bg-white p-6 shadow-sm">
        {loading ? (
          <p className="text-sm font-semibold text-[#61717f]">
            Cargando producto...
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
              void submitForm();
            }}
          >
            <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
              <section className="grid gap-4">
                <Field label="Producto" error={fieldErrors.ean13}>
                  <div className="grid gap-3">
                    <CampoEAN13Input
                      value={form.ean13}
                      onChange={(value) => {
                        setSelectedProduct(null);
                        setForm((current) => ({ ...current, ean13: value }));
                      }}
                      onValidSubmit={() => void searchProducts()}
                    />
                    <input
                      className="w-full rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
                      placeholder="Buscar por nombre"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                    />
                    <button
                      className="w-fit rounded-md border border-[#9ba9b5] px-3 py-2 text-sm font-semibold text-[#24313d] transition hover:bg-[#f0f3f6] disabled:cursor-not-allowed disabled:bg-[#edf1f5]"
                      disabled={searching}
                      type="button"
                      onClick={() => void searchProducts()}
                    >
                      {searching ? 'Buscando...' : 'Buscar producto'}
                    </button>
                  </div>
                </Field>

                {searchResults.length > 0 ? (
                  <div className="overflow-hidden rounded-md border border-[#d7dee6]">
                    {searchResults.map((product) => (
                      <button
                        className="grid w-full gap-1 border-t border-[#edf1f5] px-4 py-3 text-left first:border-t-0 transition hover:bg-[#f6f7f9]"
                        key={product.ean13}
                        type="button"
                        onClick={() => selectProduct(product)}
                      >
                        <span className="text-sm font-semibold text-[#17202a]">
                          {product.nombre}
                        </span>
                        <span className="text-xs text-[#61717f]">
                          {product.ean13} - {product.categoria} - Stock{' '}
                          {product.stockDisponible}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}

                {selectedProduct ? (
                  <ProductSummary product={selectedProduct} />
                ) : (
                  <p className="rounded-md bg-[#f6f7f9] px-3 py-2 text-sm font-semibold text-[#61717f]">
                    Seleccione un producto activo para registrar la merma.
                  </p>
                )}
              </section>

              <section className="grid gap-4">
                <Field label="Cantidad" error={fieldErrors.cantidad}>
                  <NumberInput
                    max={selectedProduct?.stockDisponible}
                    value={form.cantidad}
                    onChange={(value) =>
                      setForm((current) => ({ ...current, cantidad: value }))
                    }
                  />
                </Field>

                <Field label="Motivo" error={fieldErrors.motivo}>
                  <select
                    className="w-full rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
                    value={form.motivo}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        motivo: event.target.value as WasteReason | '',
                      }))
                    }
                  >
                    <option value="">Seleccione un motivo</option>
                    {wasteReasons.map((reason) => (
                      <option key={reason} value={reason}>
                        {reasonLabels[reason]}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Observacion" error={fieldErrors.observacion}>
                  <textarea
                    className="min-h-28 w-full rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
                    value={form.observacion}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        observacion: event.target.value,
                      }))
                    }
                  />
                </Field>
              </section>
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
                {saving ? 'Guardando...' : 'Registrar merma'}
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

function ProductSummary({
  product,
}: {
  product: ActiveProductSearchItem;
}): ReactElement {
  return (
    <div className="rounded-md border border-[#d7dee6] bg-[#f8fafb] p-4">
      <p className="text-sm font-semibold text-[#17202a]">{product.nombre}</p>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
        <Info label="EAN-13" value={product.ean13} />
        <Info label="Categoria" value={product.categoria} />
        <Info label="Stock disponible" value={String(product.stockDisponible)} />
        <Info
          label="Descuento"
          value={
            product.exigeVencimiento
              ? 'FEFO por vencimiento'
              : 'Fecha de ingreso'
          }
        />
      </dl>
    </div>
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

function Info({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase text-[#61717f]">
        {label}
      </dt>
      <dd className="mt-1 font-semibold text-[#24313d]">{value}</dd>
    </div>
  );
}

function NumberInput({
  max,
  onChange,
  value,
}: {
  max?: number;
  onChange: (value: string) => void;
  value: string;
}): ReactElement {
  return (
    <input
      className="w-full rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
      inputMode="numeric"
      max={max}
      min={0}
      type="number"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
