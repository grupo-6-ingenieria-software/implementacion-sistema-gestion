import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import type { ControllerResponse } from '../../../shared/controllers';
import {
  cashPaymentMethodLabels,
  cashPaymentMethods,
  type CashCloseResult,
  type CashClosingSummary,
} from '../../../shared/cash';
import type { PaymentMethod } from '../../../shared/sales';

type CashClosingViewProps = {
  displayName?: string;
  usuarioId?: string;
};

type CashClosingState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      closeError?: string;
      isClosing: boolean;
      isRefreshing: boolean;
      showConfirmation: boolean;
      status: 'ready';
      summary: CashClosingSummary;
    };

export function CashClosingView({
  displayName,
  usuarioId,
}: CashClosingViewProps): ReactElement {
  const [state, setState] = useState<CashClosingState>({ status: 'loading' });

  const loadSummary = useCallback(
    async (options: { preserveData?: boolean } = {}): Promise<void> => {
      setState((current) => {
        if (options.preserveData && current.status === 'ready') {
          return {
            ...current,
            closeError: undefined,
            isRefreshing: true,
          };
        }

        return { status: 'loading' };
      });

      if (!usuarioId?.trim()) {
        setState({
          status: 'error',
          message: 'Se requiere una sesion valida para cerrar caja.',
        });
        return;
      }

      try {
        const response = await window.appApi.invoke<CashClosingSummary>(
          'caja:resumen-cierre',
          { usuarioId },
        );

        if (!response.ok) {
          setState({
            status: 'error',
            message: response.error.message,
          });
          return;
        }

        setState({
          status: 'ready',
          summary: response.data,
          isClosing: false,
          isRefreshing: false,
          showConfirmation: false,
        });
      } catch {
        setState({
          status: 'error',
          message: 'No fue posible comunicarse con el proceso principal.',
        });
      }
    },
    [usuarioId],
  );

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const activePayments = useMemo(() => {
    if (state.status !== 'ready') {
      return [];
    }

    return cashPaymentMethods.filter((method) => {
      const summary = state.summary.payments[method];
      return (
        summary.currentAmount > 0 ||
        summary.currentTransactions > 0 ||
        summary.voidedAmount > 0 ||
        summary.voidedTransactions > 0
      );
    });
  }, [state]);

  const requestClose = (): void => {
    setState((current) =>
      current.status === 'ready'
        ? { ...current, closeError: undefined, showConfirmation: true }
        : current,
    );
  };

  const cancelClose = (): void => {
    setState((current) =>
      current.status === 'ready'
        ? { ...current, closeError: undefined, showConfirmation: false }
        : current,
    );
  };

  const confirmClose = async (): Promise<void> => {
    if (state.status !== 'ready' || !usuarioId?.trim()) {
      return;
    }

    setState({
      ...state,
      closeError: undefined,
      isClosing: true,
    });

    try {
      const response: ControllerResponse<CashCloseResult> =
        await window.appApi.invoke('caja:cerrar', {
          confirmacion: true,
          usuarioId,
        });

      if (!response.ok) {
        setState({
          ...state,
          closeError: response.error.message,
          isClosing: false,
          showConfirmation: false,
        });
        return;
      }

      setState({
        status: 'ready',
        summary: response.data,
        isClosing: false,
        isRefreshing: false,
        showConfirmation: false,
      });
    } catch {
      setState({
        ...state,
        closeError: 'No fue posible comunicarse con el proceso principal.',
        isClosing: false,
      });
    }
  };

  if (state.status === 'loading') {
    return (
      <section className="px-8 py-8" aria-live="polite">
        <div className="rounded-md border border-[#cbd5df] bg-white p-8 shadow-sm">
          <p className="font-semibold text-[#244d61]">
            Cargando resumen de caja...
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
            No se pudo cargar el cierre de caja
          </h3>
          <p className="mt-2 text-sm text-[#6f3333]">{state.message}</p>
          <button
            className="mt-5 rounded-md bg-[#244d61] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#1f4354]"
            type="button"
            onClick={() => void loadSummary()}
          >
            Reintentar
          </button>
        </div>
      </section>
    );
  }

  const { summary } = state;
  const isClosed = summary.status === 'cerrada';
  const canClose = summary.status === 'abierta' && !state.isClosing;

  return (
    <section className="space-y-6 px-8 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-2xl font-semibold text-[#17202a]">
            Cierre de caja diaria
          </h3>
          <p className="mt-1 text-sm text-[#61717f]">
            Resumen del {formatDate(summary.generatedAt)}
          </p>
        </div>
        <button
          className="rounded-md border border-[#9ba9b5] px-4 py-2 text-sm font-semibold text-[#24313d] transition hover:bg-[#f0f3f6]"
          disabled={state.isRefreshing || state.isClosing}
          type="button"
          onClick={() => void loadSummary({ preserveData: true })}
        >
          {state.isRefreshing ? 'Actualizando...' : 'Actualizar'}
        </button>
      </div>

      {isClosed ? (
        <StatusMessage
          tone="success"
          title="La caja de este dia ya fue cerrada"
          message={
            summary.closedAt
              ? `Cierre registrado a las ${formatTime(summary.closedAt)} por ${summary.closedBy?.nombre ?? summary.closedBy?.usuarioId ?? 'usuario registrado'}.`
              : 'El cierre ya se encuentra registrado.'
          }
        />
      ) : null}

      {summary.status === 'sin_registro' ? (
        <StatusMessage
          tone="warning"
          title="No hay caja registrada para hoy"
          message="No existe una caja abierta disponible para cerrar."
        />
      ) : null}

      {state.closeError ? (
        <StatusMessage
          tone="error"
          title="No se pudo cerrar la caja"
          message={state.closeError}
        />
      ) : null}

      <div className="grid gap-4 xl:grid-cols-3">
        <SummaryCard
          label="Ventas vigentes"
          primary={formatCurrency(summary.currentAmount)}
          secondary={`${summary.currentTransactions} transacciones`}
        />
        <SummaryCard
          label="Anulaciones"
          primary={formatCurrency(summary.voidedAmount)}
          secondary={`${summary.voidedTransactions} transacciones anuladas`}
          muted={summary.voidedTransactions === 0}
        />
        <SummaryCard
          label="Estado"
          primary={getCashStatusLabel(summary.status)}
          secondary={getCashTimingLabel(summary)}
        />
      </div>

      <article className="rounded-md border border-[#cbd5df] bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h4 className="text-lg font-semibold text-[#17202a]">
              Métodos de pago
            </h4>
            <p className="mt-1 text-sm text-[#61717f]">
              Totales calculados desde ventas vigentes y anuladas del día.
            </p>
          </div>
          <span className="rounded-md bg-[#e8f3ed] px-3 py-1 text-sm font-semibold text-[#2d6a4f]">
            {formatCurrency(summary.currentAmount)}
          </span>
        </div>

        {activePayments.length === 0 ? (
          <p className="mt-5 rounded-md bg-[#f5f8f6] px-4 py-4 text-sm font-medium text-[#466456]">
            No hay ventas registradas para la caja del día.
          </p>
        ) : (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[#d7dee6] text-[#61717f]">
                  <th className="px-3 py-3 font-semibold">Método</th>
                  <th className="px-3 py-3 text-right font-semibold">
                    Ventas
                  </th>
                  <th className="px-3 py-3 text-right font-semibold">Monto</th>
                  <th className="px-3 py-3 text-right font-semibold">
                    Anuladas
                  </th>
                  <th className="px-3 py-3 text-right font-semibold">
                    Monto anulado
                  </th>
                </tr>
              </thead>
              <tbody>
                {activePayments.map((method) => (
                  <PaymentRow
                    key={method}
                    method={method}
                    summary={summary}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>

      <article className="rounded-md border border-[#cbd5df] bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h4 className="text-lg font-semibold text-[#17202a]">
              Confirmación de cierre
            </h4>
            <p className="mt-1 text-sm text-[#61717f]">
              Responsable actual: {displayName ?? usuarioId ?? 'sesion activa'}.
            </p>
          </div>
          <button
            className="rounded-md bg-[#244d61] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#1f4354] disabled:cursor-not-allowed disabled:bg-[#9ba9b5]"
            disabled={!canClose}
            type="button"
            onClick={requestClose}
          >
            {state.isClosing ? 'Cerrando...' : 'Cerrar caja'}
          </button>
        </div>

        {state.showConfirmation ? (
          <div className="mt-5 rounded-md border border-[#e3ad72] bg-[#fff8ed] p-4">
            <p className="font-semibold text-[#7a3f0c]">
              Confirma que deseas cerrar la caja del día.
            </p>
            <p className="mt-1 text-sm text-[#6b4a24]">
              Después del cierre no se podrán registrar nuevas ventas en esta caja.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                className="rounded-md border border-[#9ba9b5] bg-white px-4 py-2 text-sm font-semibold text-[#24313d] transition hover:bg-[#f0f3f6]"
                disabled={state.isClosing}
                type="button"
                onClick={cancelClose}
              >
                Cancelar
              </button>
              <button
                className="rounded-md bg-[#8a3b2d] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#743125] disabled:cursor-not-allowed disabled:bg-[#c9a59d]"
                disabled={state.isClosing}
                type="button"
                onClick={() => void confirmClose()}
              >
                Confirmar cierre
              </button>
            </div>
          </div>
        ) : null}
      </article>
    </section>
  );
}

function PaymentRow({
  method,
  summary,
}: {
  method: PaymentMethod;
  summary: CashClosingSummary;
}): ReactElement {
  const payment = summary.payments[method];

  return (
    <tr className="border-b border-[#edf0f3] last:border-0">
      <td className="px-3 py-3 font-medium text-[#24313d]">
        {cashPaymentMethodLabels[method]}
      </td>
      <td className="px-3 py-3 text-right text-[#61717f]">
        {payment.currentTransactions}
      </td>
      <td className="px-3 py-3 text-right font-semibold text-[#17202a]">
        {formatCurrency(payment.currentAmount)}
      </td>
      <td className="px-3 py-3 text-right text-[#8f4c4c]">
        {payment.voidedTransactions}
      </td>
      <td className="px-3 py-3 text-right font-semibold text-[#8f4c4c]">
        {formatCurrency(payment.voidedAmount)}
      </td>
    </tr>
  );
}

function SummaryCard({
  label,
  muted = false,
  primary,
  secondary,
}: {
  label: string;
  muted?: boolean;
  primary: string;
  secondary: string;
}): ReactElement {
  return (
    <article className="rounded-md border border-[#cbd5df] bg-white p-6 shadow-sm">
      <p className="text-sm font-semibold text-[#61717f]">{label}</p>
      <p
        className={`mt-3 text-2xl font-semibold ${
          muted ? 'text-[#61717f]' : 'text-[#17202a]'
        }`}
      >
        {primary}
      </p>
      <p className="mt-1 text-sm text-[#61717f]">{secondary}</p>
    </article>
  );
}

function StatusMessage({
  message,
  title,
  tone,
}: {
  message: string;
  title: string;
  tone: 'error' | 'success' | 'warning';
}): ReactElement {
  const styles = {
    error: 'border-[#dba7a7] bg-[#fff7f7] text-[#8f2727]',
    success: 'border-[#a9cfb9] bg-[#f2faf5] text-[#22583f]',
    warning: 'border-[#e3ad72] bg-[#fff8ed] text-[#7a3f0c]',
  };

  return (
    <div className={`rounded-md border p-4 ${styles[tone]}`} role="status">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-sm">{message}</p>
    </div>
  );
}

function getCashStatusLabel(status: CashClosingSummary['status']): string {
  if (status === 'abierta') {
    return 'Caja abierta';
  }

  if (status === 'cerrada') {
    return 'Caja cerrada';
  }

  return 'Sin registro';
}

function getCashTimingLabel(summary: CashClosingSummary): string {
  if (!summary.openedAt) {
    return 'Sin horario de apertura registrado';
  }

  if (summary.closedAt) {
    return `Inicio ${formatTime(summary.openedAt)} - cierre ${formatTime(summary.closedAt)}`;
  }

  return `Inicio ${formatTime(summary.openedAt)}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago',
    dateStyle: 'long',
  }).format(new Date(value));
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(value);
}
