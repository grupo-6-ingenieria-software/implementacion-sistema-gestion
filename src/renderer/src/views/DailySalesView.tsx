import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type {
  DailySalesHistory,
  DailySalesSummary,
  PaymentMethod,
  SaleState,
} from '../../../shared/sales';
import { formatChileanPeso } from '../../../shared/sales';

type DailySalesState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: DailySalesHistory };

const paymentMethods: PaymentMethod[] = [
  'efectivo',
  'debito',
  'credito',
  'transferencia',
];

const paymentMethodLabels: Record<PaymentMethod, string> = {
  efectivo: 'Efectivo',
  debito: 'Debito',
  credito: 'Credito',
  transferencia: 'Transferencia',
};

export function DailySalesView({
  usuarioId,
}: {
  usuarioId: string;
}): ReactElement {
  const [state, setState] = useState<DailySalesState>({ status: 'loading' });

  const loadSales = useCallback(async (): Promise<void> => {
    setState({ status: 'loading' });

    try {
      const response = await window.appApi.invoke<DailySalesHistory>(
        'venta:historial-dia',
        { usuarioId },
      );

      if (!response.ok) {
        setState({ status: 'error', message: response.error.message });
        return;
      }

      setState({ status: 'ready', data: response.data });
    } catch {
      setState({
        status: 'error',
        message: 'No fue posible comunicarse con el proceso principal.',
      });
    }
  }, [usuarioId]);

  useEffect(() => {
    void loadSales();
  }, [loadSales]);

  if (state.status === 'loading') {
    return (
      <section className="px-8 py-8" aria-live="polite">
        <div className="rounded-md border border-[#cbd5df] bg-white p-8 shadow-sm">
          <p className="font-semibold text-[#244d61]">
            Cargando ventas del dia...
          </p>
        </div>
      </section>
    );
  }

  if (state.status === 'error') {
    return (
      <section className="px-8 py-8" aria-live="assertive">
        <div className="rounded-md border border-[#dba7a7] bg-[#fff7f7] p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-[#8f2727]">
            No se pudieron cargar las ventas del dia
          </h3>
          <p className="mt-2 text-sm text-[#6f3333]">{state.message}</p>
          <button
            className="mt-5 rounded-md bg-[#244d61] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#1f4354]"
            type="button"
            onClick={() => void loadSales()}
          >
            Reintentar
          </button>
        </div>
      </section>
    );
  }

  const { ventas, resumen } = state.data;

  return (
    <section className="space-y-6 px-8 py-8">
      <div>
        <h3 className="text-2xl font-semibold text-[#17202a]">
          Historial de ventas del dia
        </h3>
        <p className="mt-1 text-sm text-[#61717f]">
          Ventas registradas durante la jornada actual.
        </p>
      </div>

      <article className="overflow-hidden rounded-md border border-[#cbd5df] bg-white shadow-sm">
        {ventas.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm font-medium text-[#61717f]">
            No hay ventas registradas en el dia.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-[#f0f3f6] text-[#61717f]">
                <tr>
                  <th className="px-4 py-3 font-semibold">Numero de venta</th>
                  <th className="px-4 py-3 font-semibold">Hora</th>
                  <th className="px-4 py-3 font-semibold">Trabajador</th>
                  <th className="px-4 py-3 text-right font-semibold">
                    Productos
                  </th>
                  <th className="px-4 py-3 text-right font-semibold">Total</th>
                  <th className="px-4 py-3 font-semibold">Metodo de pago</th>
                  <th className="px-4 py-3 font-semibold">Estado</th>
                </tr>
              </thead>
              <tbody>
                {ventas.map((venta) => (
                  <tr
                    className="border-t border-[#e1e7ee]"
                    key={venta.ventaId}
                  >
                    <td className="px-4 py-4 font-medium text-[#24313d]">
                      {venta.ventaId}
                    </td>
                    <td className="px-4 py-4 text-[#61717f]">
                      {formatTime(venta.fechaHora)}
                    </td>
                    <td className="px-4 py-4 text-[#24313d]">
                      {venta.trabajadorResponsable}
                    </td>
                    <td className="px-4 py-4 text-right text-[#24313d]">
                      {venta.cantidadProductos}
                    </td>
                    <td className="px-4 py-4 text-right font-semibold text-[#17202a]">
                      {formatChileanPeso(venta.total)}
                    </td>
                    <td className="px-4 py-4 text-[#24313d]">
                      {paymentMethodLabels[venta.metodoPago]}
                    </td>
                    <td className="px-4 py-4">
                      <SaleStatus status={venta.estado} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>

      <DailySummary summary={resumen} />
    </section>
  );
}

function DailySummary({
  summary,
}: {
  summary: DailySalesSummary;
}): ReactElement {
  return (
    <section className="grid gap-5 xl:grid-cols-[1fr_2fr]">
      <article className="rounded-md border border-[#cbd5df] bg-white p-6 shadow-sm">
        <h4 className="font-semibold text-[#17202a]">Resumen del dia</h4>
        <dl className="mt-4 grid gap-3">
          <SummaryLine
            label="Ventas vigentes"
            value={String(summary.ventasVigentes)}
          />
          <SummaryLine
            label="Monto total vendido"
            value={formatChileanPeso(summary.montoVigente)}
            strong
          />
        </dl>
      </article>

      <article className="rounded-md border border-[#cbd5df] bg-white p-6 shadow-sm">
        <h4 className="font-semibold text-[#17202a]">
          Desglose por metodo de pago
        </h4>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {paymentMethods.map((method) => {
            const payment = summary.porMetodoPago[method];
            return (
              <dl
                className="rounded-md border border-[#d7dee6] bg-[#f8fafb] p-4"
                key={method}
              >
                <dt className="text-sm font-semibold text-[#244d61]">
                  {paymentMethodLabels[method]}
                </dt>
                <dd className="mt-2 text-lg font-semibold text-[#17202a]">
                  {formatChileanPeso(payment.monto)}
                </dd>
                <dd className="mt-1 text-xs text-[#61717f]">
                  {payment.cantidadVentas}{' '}
                  {payment.cantidadVentas === 1 ? 'venta' : 'ventas'}
                </dd>
              </dl>
            );
          })}
        </div>
      </article>

      {summary.ventasAnuladas > 0 ? (
        <article className="rounded-md border border-[#dba7a7] bg-[#fff7f7] p-5 shadow-sm xl:col-span-2">
          <h4 className="font-semibold text-[#8f2727]">Ventas anuladas</h4>
          <p className="mt-2 text-sm text-[#6f3333]">
            {summary.ventasAnuladas}{' '}
            {summary.ventasAnuladas === 1 ? 'venta anulada' : 'ventas anuladas'}
            {' por '}
            <span className="font-semibold">
              {formatChileanPeso(summary.montoAnulado)}
            </span>
            . Este monto no forma parte del total vendido.
          </p>
        </article>
      ) : null}
    </section>
  );
}

function SummaryLine({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}): ReactElement {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-sm text-[#61717f]">{label}</dt>
      <dd
        className={
          strong
            ? 'text-xl font-semibold text-[#17202a]'
            : 'font-semibold text-[#24313d]'
        }
      >
        {value}
      </dd>
    </div>
  );
}

function SaleStatus({ status }: { status: SaleState }): ReactElement {
  const isVoided = status === 'anulada';

  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
        isVoided
          ? 'bg-[#fff0f0] text-[#9a3333]'
          : 'bg-[#e8f3ed] text-[#2d6a4f]'
      }`}
    >
      {isVoided ? 'Anulada' : 'Vigente'}
    </span>
  );
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
}
