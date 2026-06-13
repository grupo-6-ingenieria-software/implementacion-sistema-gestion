import { useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  normalizeProductDeletePayload,
  validateProductDeletePayload,
  type ProductDeleteFieldErrors,
  type ProductDeletePayload,
  type ProductDeleteResponse,
  type ProductDetailResponse,
} from '../../../shared/products';
import { isValidEan13 } from '../../../shared/ean13';
import { CampoEAN13Input } from '../components';

type ProductDeleteViewProps = {
  initialEan13?: string;
  usuarioId: string;
  onNavigate: (path: string) => void;
};

export function ProductDeleteView({
  initialEan13,
  onNavigate,
  usuarioId,
}: ProductDeleteViewProps): ReactElement {
  const [ean13, setEan13] = useState(initialEan13 ?? '');
  const [loadedEan13, setLoadedEan13] = useState(initialEan13 ?? '');
  const [product, setProduct] = useState<ProductDetailResponse['product'] | null>(
    null,
  );
  const [categories, setCategories] = useState<ProductDetailResponse['categories']>(
    [],
  );
  const [confirmacion, setConfirmacion] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<ProductDeleteFieldErrors>({});
  const [loading, setLoading] = useState(Boolean(initialEan13));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    if (!initialEan13) {
      return;
    }

    setEan13(initialEan13);
    setLoadedEan13(initialEan13);
  }, [initialEan13]);

  useEffect(() => {
    if (!loadedEan13) {
      setLoading(false);
      return;
    }

    let isCurrent = true;

    async function loadProduct(): Promise<void> {
      setLoading(true);
      setLoadError(null);
      setMessage(null);
      setBlocked(false);
      setFieldErrors({});
      setConfirmacion(false);

      const response = await window.appApi.invoke<ProductDetailResponse>(
        'producto:estado',
        {
          ean13: loadedEan13,
          usuarioId,
        },
      );

      if (!isCurrent) {
        return;
      }

      if (!response.ok) {
        setProduct(null);
        setCategories([]);
        setLoadError(response.error.message);
        setLoading(false);
        return;
      }

      setProduct(response.data.product);
      setCategories(response.data.categories);
      setLoading(false);
    }

    loadProduct().catch(() => {
      if (!isCurrent) {
        return;
      }

      setProduct(null);
      setCategories([]);
      setLoadError('No fue posible cargar el producto. Intente nuevamente.');
      setLoading(false);
    });

    return () => {
      isCurrent = false;
    };
  }, [loadedEan13, usuarioId]);

  const payload = useMemo<ProductDeletePayload>(
    () =>
      normalizeProductDeletePayload({
        confirmacion,
        ean13: product?.ean13 ?? ean13,
        usuarioId,
      }),
    [confirmacion, ean13, product?.ean13, usuarioId],
  );

  const categoryName = useMemo(() => {
    if (!product) {
      return '';
    }

    return (
      categories.find((category) => category.id === product.categoriaId)
        ?.nombre ?? 'No disponible'
    );
  }, [categories, product]);

  function searchProduct(nextEan13 = ean13): void {
    setFieldErrors({});
    setMessage(null);
    setBlocked(false);

    if (!isValidEan13(nextEan13)) {
      setProduct(null);
      setLoadError(null);
      setFieldErrors({
        ean13: 'El codigo EAN-13 debe tener exactamente 13 digitos numericos.',
      });
      return;
    }

    setLoadedEan13(nextEan13);
  }

  async function submitDelete(): Promise<void> {
    const nextErrors = validateProductDeletePayload(payload);
    setFieldErrors(nextErrors);
    setMessage(null);
    setBlocked(false);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setSaving(true);

    const response = await window.appApi.invoke<ProductDeleteResponse>(
      'producto:eliminar',
      payload,
    );

    setSaving(false);

    if (!response.ok) {
      setFieldErrors(response.error.fieldErrors ?? {});
      setMessage(response.error.message);
      setBlocked(response.error.code === 'BUSINESS_RULE');
      return;
    }

    setMessage(`Producto ${response.data.ean13} eliminado correctamente.`);
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
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <label className="grid gap-2 text-sm font-semibold text-[#24313d]">
            Buscar producto por EAN-13
            <CampoEAN13Input
              disabled={loading || saving}
              value={ean13}
              onChange={setEan13}
              onValidSubmit={searchProduct}
            />
            {fieldErrors.ean13 ? (
              <span className="text-xs font-semibold text-[#9f2d20]">
                {fieldErrors.ean13}
              </span>
            ) : null}
          </label>
          <button
            className="self-end rounded-md bg-[#244d61] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#1f4354] disabled:cursor-not-allowed disabled:bg-[#9ba9b5]"
            disabled={loading || saving}
            type="button"
            onClick={() => searchProduct()}
          >
            Buscar
          </button>
        </div>

        {loading ? (
          <p className="mt-6 text-sm font-semibold text-[#61717f]">
            Cargando producto...
          </p>
        ) : null}

        {!loading && loadError ? (
          <p className="mt-6 rounded-md bg-[#fff3d6] px-3 py-2 text-sm font-semibold text-[#8a5a12]">
            {loadError}
          </p>
        ) : null}

        {!loading && !loadError && product ? (
          <form
            className="mt-6 grid gap-5 border-t border-[#e3e8ee] pt-5"
            onSubmit={(event) => {
              event.preventDefault();
              void submitDelete();
            }}
          >
            <div className="rounded-md border border-[#d7dee6] bg-[#f8fafb] p-4">
              <p className="text-sm font-semibold text-[#17202a]">
                {product.nombre}
              </p>
              <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                <Info label="EAN-13" value={product.ean13} />
                <Info label="Categoria" value={categoryName} />
                <Info label="Estado" value={formatStatus(product.estado)} />
              </dl>
            </div>

            <label className="flex items-start gap-3 rounded-md border border-[#d7dee6] bg-[#f8fafb] p-4 text-sm text-[#24313d]">
              <input
                checked={confirmacion}
                className="mt-1"
                disabled={saving}
                type="checkbox"
                onChange={(event) => setConfirmacion(event.target.checked)}
              />
              <span>
                <span className="block font-semibold text-[#17202a]">
                  Confirmo que deseo eliminar este producto.
                </span>
                <span className="mt-1 block text-[#61717f]">
                  La eliminacion solo se realiza si no existen ventas, mermas,
                  lotes ni movimientos de inventario asociados.
                </span>
              </span>
            </label>

            {fieldErrors.confirmacion ? (
              <p className="rounded-md bg-[#f8e7e3] px-3 py-2 text-sm font-semibold text-[#9f2d20]">
                {fieldErrors.confirmacion}
              </p>
            ) : null}

            {fieldErrors.usuarioId ? (
              <p className="rounded-md bg-[#f8e7e3] px-3 py-2 text-sm font-semibold text-[#9f2d20]">
                {fieldErrors.usuarioId}
              </p>
            ) : null}

            {message ? (
              <div className="grid gap-3 rounded-md bg-[#edf1f5] px-3 py-2 text-sm font-semibold text-[#24313d]">
                <p>{message}</p>
                {blocked ? (
                  <button
                    className="w-fit rounded-md border border-[#9ba9b5] px-3 py-2 text-sm font-semibold text-[#24313d] transition hover:bg-[#f0f3f6]"
                    type="button"
                    onClick={() =>
                      onNavigate(
                        `/app/inventario/productos/${encodeURIComponent(
                          product.ean13,
                        )}/estado`,
                      )
                    }
                  >
                    Ir a cambiar estado
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-3 border-t border-[#e3e8ee] pt-5">
              <button
                className="rounded-md bg-[#9f2d20] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#84251b] disabled:cursor-not-allowed disabled:bg-[#9ba9b5]"
                disabled={saving}
                type="submit"
              >
                {saving ? 'Eliminando...' : 'Eliminar producto'}
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

function formatStatus(status: 'activo' | 'inactivo'): string {
  return status === 'activo' ? 'Activo' : 'Inactivo';
}
