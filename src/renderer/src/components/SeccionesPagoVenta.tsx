import type { ReactElement } from 'react';
import type { PaymentMethod } from '../../../shared/sales';

type SeccionesPagoVentaProps = {
  metodo: PaymentMethod;
  total: number;
  montoRecibido: string;
  onMetodoChange: (metodo: PaymentMethod) => void;
  onMontoRecibidoChange: (value: string) => void;
};

export function SeccionesPagoVenta({
  metodo,
  total,
  montoRecibido,
  onMetodoChange,
  onMontoRecibidoChange,
}: SeccionesPagoVentaProps): ReactElement {
  const received = Number(montoRecibido || 0);
  const vuelto = Math.max(0, received - total);

  return (
    <div className="rounded-md border border-[#cbd5df] bg-white p-4">
      <div className="grid grid-cols-2 gap-2">
        {(['efectivo', 'debito', 'credito', 'transferencia'] as const).map(
          (option) => (
            <button
              className={`min-h-10 rounded-md px-3 py-2 text-sm font-semibold ${
                metodo === option
                  ? 'bg-[#244d61] text-white'
                  : 'border border-[#cbd5df] bg-[#f8fafb] text-[#24313d]'
              }`}
              key={option}
              type="button"
              onClick={() => onMetodoChange(option)}
            >
              {paymentLabels[option]}
            </button>
          ),
        )}
      </div>
      {metodo === 'efectivo' ? (
        <div className="mt-4 grid gap-3">
          <label className="grid gap-1 text-sm font-semibold text-[#24313d]">
            Monto recibido
            <input
              className="rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
              inputMode="numeric"
              min={0}
              value={montoRecibido}
              onChange={(event) =>
                onMontoRecibidoChange(event.target.value.replace(/\D/g, ''))
              }
            />
          </label>
          <div className="rounded-md border border-[#d7dee6] bg-[#f8fafb] px-3 py-2">
            <p className="text-xs font-semibold uppercase text-[#61717f]">
              Vuelto
            </p>
            <p className="mt-1 text-lg font-semibold text-[#17202a]">
              {formatCurrency(vuelto)}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const paymentLabels: Record<PaymentMethod, string> = {
  efectivo: 'Efectivo',
  debito: 'Débito',
  credito: 'Crédito',
  transferencia: 'Transferencia',
};

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(value);
}
