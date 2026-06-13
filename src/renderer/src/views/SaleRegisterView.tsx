import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { CampoEAN13Input, SeccionesPagoVenta } from '../components';
import { isValidEan13 } from '../../../shared/ean13';
import {
  calculateSaleTotals,
  type PaymentMethod,
} from '../../../shared/sales';

type SessionForSale = {
  usuarioId?: string;
  trabajadorNombre?: string;
  usuarioRol?: string;
};

type ActiveProduct = {
  productoId: number;
  ean13: string;
  nombre: string;
  categoria: string;
  precioVenta: number;
  stockDisponible: number;
};

type CartItem = ActiveProduct & {
  cantidad: number;
};

type SaleReceipt = {
  ventaId: string;
  fechaHora: string;
  responsable: {
    usuarioId: string;
    nombre: string;
    rol: string;
  };
  metodoPago: PaymentMethod;
  subtotal: number;
  descuento: {
    tipo: 'ninguno' | 'monto';
    valor: number;
    razon?: string;
  };
  total: number;
  montoRecibido?: number;
  vuelto?: number;
  detalle: Array<{
    productoId: number;
    ean13: string;
    nombre: string;
    categoria: string;
    precioUnitario: number;
    cantidad: number;
    subtotal: number;
  }>;
};

type SaleRegisterViewProps = {
  session: SessionForSale;
};

export function SaleRegisterView({
  session,
}: SaleRegisterViewProps): ReactElement {
  const [ean13, setEan13] = useState('');
  const [query, setQuery] = useState('');
  const [products, setProducts] = useState<ActiveProduct[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [metodoPago, setMetodoPago] = useState<PaymentMethod>('efectivo');
  const [montoRecibido, setMontoRecibido] = useState('');
  const [descuentoMonto, setDescuentoMonto] = useState('');
  const [descuentoRazon, setDescuentoRazon] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [cashAvailable, setCashAvailable] = useState(true);
  const [receipt, setReceipt] = useState<SaleReceipt | null>(null);

  const totals = useMemo(
    () =>
      calculateSaleTotals(
        cart.map((item) => ({
          cantidad: item.cantidad,
          precioUnitario: item.precioVenta,
        })),
        Number(descuentoMonto || 0),
      ),
    [cart, descuentoMonto],
  );

  useEffect(() => {
    void checkCash();
    void loadProducts();
  }, []);

  async function checkCash(): Promise<void> {
    const response = await window.appApi.invoke('caja:verificar-disponible');

    if (!response.ok) {
      setCashAvailable(false);
      setError(response.error.message);
    }
  }

  async function loadProducts(search?: string): Promise<void> {
    const response = await window.appApi.invoke<ActiveProduct[]>(
      'producto:listar',
      { query: search, limit: 20 },
    );

    if (response.ok) {
      setProducts(response.data);
    } else {
      setProducts([]);
      setError(response.error.message);
    }
  }

  async function addByEan13(code: string): Promise<void> {
    setError(null);
    setMessage(null);

    if (!isValidEan13(code)) {
      setError('Ingrese un código EAN-13 válido.');
      return;
    }

    const response = await window.appApi.invoke<ActiveProduct[]>(
      'producto:buscar-activo',
      { ean13: code, limit: 1, usuarioId: session.usuarioId },
    );

    if (!response.ok) {
      setError(response.error.message);
      return;
    }

    addToCart(response.data[0]);
    setEan13('');
  }

  function addToCart(product: ActiveProduct): void {
    setReceipt(null);
    setCart((current) => {
      const existing = current.find(
        (item) => item.productoId === product.productoId,
      );

      if (!existing) {
        return [...current, { ...product, cantidad: 1 }];
      }

      return current.map((item) =>
        item.productoId === product.productoId
          ? {
              ...item,
              cantidad: Math.min(item.stockDisponible, item.cantidad + 1),
            }
          : item,
      );
    });
  }

  function updateQuantity(productoId: number, value: string): void {
    const quantity = Number(value);

    setCart((current) =>
      current.map((item) =>
        item.productoId === productoId
          ? {
              ...item,
              cantidad:
                Number.isInteger(quantity) && quantity > 0
                  ? Math.min(quantity, item.stockDisponible)
                  : 1,
            }
          : item,
      ),
    );
  }

  function removeFromCart(productoId: number): void {
    setCart((current) =>
      current.filter((item) => item.productoId !== productoId),
    );
  }

  async function confirmSale(): Promise<void> {
    setError(null);
    setMessage(null);

    if (!session.usuarioId) {
      setError('No hay un trabajador responsable para registrar la venta.');
      return;
    }

    if (!cashAvailable) {
      setError('La caja se encuentra cerrada. No es posible registrar ventas.');
      return;
    }

    if (cart.length === 0) {
      setError('Agregue al menos un producto al carrito.');
      return;
    }

    if (Number(descuentoMonto || 0) > 0 && !descuentoRazon.trim()) {
      setError('Ingrese la razón del descuento antes de confirmar.');
      return;
    }

    if (metodoPago === 'efectivo' && Number(montoRecibido || 0) < totals.total) {
      setError('El monto recibido es insuficiente para confirmar la venta.');
      return;
    }

    setIsSaving(true);

    const response = await window.appApi.invoke<SaleReceipt>('venta:registrar', {
      usuarioId: session.usuarioId,
      items: cart.map((item) => ({
        productoId: item.productoId,
        ean13: item.ean13,
        cantidad: item.cantidad,
      })),
      metodoPago,
      montoRecibido:
        metodoPago === 'efectivo' ? Number(montoRecibido || 0) : undefined,
      descuento:
        Number(descuentoMonto || 0) > 0
          ? {
              monto: Number(descuentoMonto),
              razon: descuentoRazon,
            }
          : undefined,
    });

    setIsSaving(false);

    if (!response.ok) {
      setError(response.error.message);
      return;
    }

    setReceipt(response.data);
    setMessage(`Venta registrada por ${formatCurrency(response.data.total)}.`);
    setCart([]);
    setMontoRecibido('');
    setDescuentoMonto('');
    setDescuentoRazon('');
    await loadProducts(query);
  }

  return (
    <section className="px-8 py-8">
      <div className="grid items-start gap-6 xl:grid-cols-[1fr_380px]">
        <div className="grid auto-rows-max content-start gap-6">
          <section className="rounded-md border border-[#cbd5df] bg-white p-5 shadow-sm">
            <div className="grid gap-4 lg:grid-cols-[280px_1fr_auto]">
              <label className="grid gap-2 text-sm font-semibold text-[#24313d]">
                Código EAN-13
                <CampoEAN13Input
                  value={ean13}
                  onChange={setEan13}
                  onValidSubmit={addByEan13}
                />
              </label>
              <label className="grid gap-2 text-sm font-semibold text-[#24313d]">
                Buscar producto
                <input
                  className="rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
                  value={query}
                  onChange={(event) => {
                    const value = event.target.value;
                    setQuery(value);
                    void loadProducts(value);
                  }}
                />
              </label>
              <button
                className="self-end rounded-md bg-[#244d61] px-4 py-2 font-semibold text-white transition hover:bg-[#1f4354]"
                type="button"
                onClick={() => void addByEan13(ean13)}
              >
                Agregar
              </button>
            </div>
          </section>

          <section className="rounded-md border border-[#cbd5df] bg-white p-5 shadow-sm">
            <h3 className="text-lg font-semibold text-[#17202a]">
              Productos activos
            </h3>
            <div className="mt-4 overflow-hidden rounded-md border border-[#d7dee6]">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-[#f0f3f6] text-left text-[#61717f]">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Producto</th>
                    <th className="px-3 py-2 font-semibold">Stock</th>
                    <th className="px-3 py-2 font-semibold">Precio</th>
                    <th className="px-3 py-2 font-semibold"></th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((product) => (
                    <tr className="border-t border-[#e1e7ee]" key={product.productoId}>
                      <td className="px-3 py-3">
                        <p className="font-semibold text-[#17202a]">
                          {product.nombre}
                        </p>
                        <p className="text-xs text-[#61717f]">
                          {product.ean13} · {product.categoria}
                        </p>
                      </td>
                      <td className="px-3 py-3">{product.stockDisponible}</td>
                      <td className="px-3 py-3">
                        {formatCurrency(product.precioVenta)}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <button
                          className="rounded-md border border-[#9ba9b5] px-3 py-2 font-semibold text-[#24313d] transition hover:bg-[#f0f3f6] disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={product.stockDisponible <= 0}
                          type="button"
                          onClick={() => addToCart(product)}
                        >
                          Sumar
                        </button>
                      </td>
                    </tr>
                  ))}
                  {products.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-[#61717f]" colSpan={4}>
                        No hay productos activos para mostrar.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-md border border-[#cbd5df] bg-white p-5 shadow-sm">
            <h3 className="text-lg font-semibold text-[#17202a]">Carrito</h3>
            <div className="mt-4 grid gap-3">
              {cart.map((item) => (
                <div
                  className="grid gap-3 rounded-md border border-[#d7dee6] p-3 md:grid-cols-[1fr_110px_120px_90px]"
                  key={item.productoId}
                >
                  <div>
                    <p className="font-semibold text-[#17202a]">{item.nombre}</p>
                    <p className="text-xs text-[#61717f]">
                      {formatCurrency(item.precioVenta)} · Stock {item.stockDisponible}
                    </p>
                  </div>
                  <input
                    className="rounded-md border border-[#9ba9b5] px-3 py-2"
                    inputMode="numeric"
                    min={1}
                    value={item.cantidad}
                    onChange={(event) =>
                      updateQuantity(item.productoId, event.target.value)
                    }
                  />
                  <p className="self-center font-semibold text-[#17202a]">
                    {formatCurrency(item.cantidad * item.precioVenta)}
                  </p>
                  <button
                    className="rounded-md border border-[#b42318] px-3 py-2 font-semibold text-[#b42318] transition hover:bg-[#fff3f1]"
                    type="button"
                    onClick={() => removeFromCart(item.productoId)}
                  >
                    Quitar
                  </button>
                </div>
              ))}
              {cart.length === 0 ? (
                <p className="rounded-md border border-dashed border-[#cbd5df] px-4 py-8 text-center text-[#61717f]">
                  Agregue productos para iniciar una venta.
                </p>
              ) : null}
            </div>
          </section>
        </div>

        <aside className="grid content-start gap-6">
          <section className="rounded-md border border-[#cbd5df] bg-white p-5 shadow-sm">
            <h3 className="text-lg font-semibold text-[#17202a]">Pago</h3>
            <div className="mt-4 grid gap-4">
              <div className="grid gap-3">
                <label className="grid gap-1 text-sm font-semibold text-[#24313d]">
                  Descuento
                  <input
                    className="rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
                    inputMode="numeric"
                    value={descuentoMonto}
                    onChange={(event) =>
                      setDescuentoMonto(event.target.value.replace(/\D/g, ''))
                    }
                  />
                </label>
                {Number(descuentoMonto || 0) > 0 ? (
                  <label className="grid gap-1 text-sm font-semibold text-[#24313d]">
                    Razón
                    <input
                      className="rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
                      value={descuentoRazon}
                      onChange={(event) => setDescuentoRazon(event.target.value)}
                    />
                  </label>
                ) : null}
              </div>

              <SeccionesPagoVenta
                metodo={metodoPago}
                total={totals.total}
                montoRecibido={montoRecibido}
                onMetodoChange={setMetodoPago}
                onMontoRecibidoChange={setMontoRecibido}
              />

              <dl className="grid gap-2 rounded-md border border-[#d7dee6] bg-[#f8fafb] p-4">
                <SummaryLine label="Subtotal" value={totals.subtotal} />
                <SummaryLine label="Descuento" value={totals.descuento} />
                <SummaryLine label="Total" value={totals.total} strong />
              </dl>

              {error ? (
                <p className="rounded-md border border-[#fecdca] bg-[#fff3f1] px-3 py-2 text-sm font-medium text-[#b42318]">
                  {error}
                </p>
              ) : null}
              {message ? (
                <p className="rounded-md border border-[#b8e6cc] bg-[#effaf3] px-3 py-2 text-sm font-medium text-[#255a43]">
                  {message}
                </p>
              ) : null}

              <button
                className="rounded-md bg-[#2d6a4f] px-4 py-3 font-semibold text-white transition hover:bg-[#255a43] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isSaving || cart.length === 0 || !cashAvailable}
                type="button"
                onClick={() => void confirmSale()}
              >
                {isSaving ? 'Registrando...' : 'Confirmar venta'}
              </button>
            </div>
          </section>

          {receipt ? <ReceiptPanel receipt={receipt} /> : null}
        </aside>
      </div>
    </section>
  );
}

function SummaryLine({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: number;
  strong?: boolean;
}): ReactElement {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className={strong ? 'font-semibold text-[#17202a]' : 'text-[#61717f]'}>
        {label}
      </dt>
      <dd className={strong ? 'text-xl font-semibold text-[#17202a]' : 'font-semibold'}>
        {formatCurrency(value)}
      </dd>
    </div>
  );
}

function ReceiptPanel({ receipt }: { receipt: SaleReceipt }): ReactElement {
  return (
    <section className="rounded-md border border-[#cbd5df] bg-white p-5 shadow-sm">
      <h3 className="text-lg font-semibold text-[#17202a]">Comprobante</h3>
      <dl className="mt-4 grid gap-2 text-sm">
        <Info label="Venta" value={receipt.ventaId} />
        <Info label="Fecha" value={new Date(receipt.fechaHora).toLocaleString('es-CL')} />
        <Info label="Responsable" value={receipt.responsable.nombre} />
        <Info label="Método" value={receipt.metodoPago} />
      </dl>
      <div className="mt-4 grid gap-2">
        {receipt.detalle.map((line) => (
          <div
            className="rounded-md border border-[#e1e7ee] px-3 py-2 text-sm"
            key={line.productoId}
          >
            <p className="font-semibold text-[#17202a]">{line.nombre}</p>
            <p className="text-[#61717f]">
              {line.cantidad} x {formatCurrency(line.precioUnitario)} ={' '}
              {formatCurrency(line.subtotal)}
            </p>
          </div>
        ))}
      </div>
      <dl className="mt-4 grid gap-2 rounded-md bg-[#f8fafb] p-3 text-sm">
        <SummaryLine label="Subtotal" value={receipt.subtotal} />
        <SummaryLine label="Descuento" value={receipt.descuento.valor} />
        <SummaryLine label="Total" value={receipt.total} strong />
        {receipt.montoRecibido !== undefined ? (
          <SummaryLine label="Monto recibido" value={receipt.montoRecibido} />
        ) : null}
        {receipt.vuelto !== undefined ? (
          <SummaryLine label="Vuelto" value={receipt.vuelto} />
        ) : null}
      </dl>
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase text-[#61717f]">{label}</dt>
      <dd className="mt-1 font-medium text-[#24313d]">{value}</dd>
    </div>
  );
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(value);
}
