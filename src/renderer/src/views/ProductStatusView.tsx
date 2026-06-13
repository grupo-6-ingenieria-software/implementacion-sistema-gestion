import { useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  normalizeProductStatusPayload,
  validateProductStatusPayload,
  type ProductDetailResponse,
  type ProductStatus,
  type ProductStatusFieldErrors,
  type ProductStatusPayload,
  type ProductStatusResponse,
} from '../../../shared/products';

type ProductStatusViewProps = {
  ean13?: string;
  usuarioId: string;
  onNavigate: (path: string) => void;
};

export function ProductStatusView({
  ean13,
  onNavigate,
  usuarioId,
}: ProductStatusViewProps): ReactElement {
  const [product, setProduct] = useState<ProductDetailResponse['product'] | null>(
    null,
  );
  const [nextStatus, setNextStatus] = useState<ProductStatus>('inactivo');
  const [fieldErrors, setFieldErrors] = useState<ProductStatusFieldErrors>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let isCurrent = true;

    async function loadProduct(): Promise<void> {
      setLoading(true);
      setLoadError(null);
      setMessage(null);
      setFieldErrors({});

      const response = await window.appApi.invoke<ProductDetailResponse>(
        'producto:estado',
        {
          ean13,
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

      const loadedProduct = response.data.product;
      setProduct(loadedProduct);
      setNextStatus(loadedProduct.estado === 'activo' ? 'inactivo' : 'activo');
      setLoading(false);
    }

    loadProduct().catch(() => {
      if (!isCurrent) {
        return;
      }

      setLoadError('No fue posible cargar el producto. Intente nuevamente.');
      setLoading(false);
    });

    return () => {
      isCurrent = false;
    };
  }, [ean13, usuarioId]);

  const payload = useMemo<ProductStatusPayload>(
    () =>
      normalizeProductStatusPayload({
        ean13: product?.ean13 ?? ean13,
        estado: nextStatus,
        usuarioId,
      }),
    [ean13, nextStatus, product?.ean13, usuarioId],
  );

  async function submitStatusChange(): Promise<void> {
    const nextErrors = validateProductStatusPayload(payload);
    setFieldErrors(nextErrors);
    setMessage(null);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setSaving(true);

    const response = await window.appApi.invoke<ProductStatusResponse>(
      'producto:cambiar-estado',
      payload,
    );

    setSaving(false);

    if (!response.ok) {
      setFieldErrors(response.error.fieldErrors ?? {});
      setMessage(response.error.message);
      return;
    }

    setMessage(`Producto cambiado a estado ${response.data.estado}.`);
    window.setTimeout(() => onNavigate('/app/inventario/productos'), 700);
  }

  return (
    <section className="px-8 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-[#2d6a4f]">Inventario</p>
          <h3 className="mt-2 text-2xl font-semibold text-[#17202a]">
            Cambiar estado
          </h3>
          <p className="mt-2 max-w-2xl text-sm text-[#61717f]">
            Activa o inactiva un producto conservando su historial operativo.
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

        {!loading && !loadError && product ? (
          <form
            className="grid gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              void submitStatusChange();
            }}
          >
            <div className="rounded-md border border-[#d7dee6] bg-[#f8fafb] p-4">
              <p className="text-sm font-semibold text-[#17202a]">
                {product.nombre}
              </p>
              <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                <Info label="EAN-13" value={product.ean13} />
                <Info label="Estado actual" value={product.estado} />
                <Info label="Precio venta" value={`$${product.precioVenta}`} />
                <Info label="Stock minimo" value={String(product.stockMinimo)} />
              </dl>
            </div>

            <Field label="Nuevo estado" error={fieldErrors.estado}>
              <select
                className="w-full rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
                value={nextStatus}
                onChange={(event) =>
                  setNextStatus(event.target.value as ProductStatus)
                }
              >
                <option value="activo">Activo</option>
                <option value="inactivo">Inactivo</option>
              </select>
            </Field>

            {fieldErrors.ean13 ? (
              <p className="rounded-md bg-[#f8e7e3] px-3 py-2 text-sm font-semibold text-[#9f2d20]">
                {fieldErrors.ean13}
              </p>
            ) : null}

            {message ? (
              <p className="rounded-md bg-[#edf1f5] px-3 py-2 text-sm font-semibold text-[#24313d]">
                {message}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-3 border-t border-[#e3e8ee] pt-5">
              <button
                className="rounded-md bg-[#244d61] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#1f4354] disabled:cursor-not-allowed disabled:bg-[#9ba9b5]"
                disabled={saving || nextStatus === product.estado}
                type="submit"
              >
                {saving ? 'Guardando...' : 'Cambiar estado'}
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
