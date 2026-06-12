import type { ReactElement } from 'react';

type ResumenVentasDashboardProps = {
  total: number;
  transacciones: number;
  montoAnulado: number;
  transaccionesAnuladas: number;
};

export function ResumenVentasDashboard({
  total,
  transacciones,
  montoAnulado,
  transaccionesAnuladas,
}: ResumenVentasDashboardProps): ReactElement {
  return (
    <article className="rounded-md border border-[#cbd5df] bg-white p-6 shadow-sm">
      <div className="flex items-center gap-3">
        <span
          className="flex h-10 w-10 items-center justify-center rounded-md bg-[#e8f3ed] text-[#2d6a4f]"
          aria-hidden="true"
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 6h18 M5 6v14h14V6 M8 10h8 M8 14h5" />
          </svg>
        </span>
        <p className="text-base font-semibold text-[#17202a]">Ventas del dia</p>
      </div>
      <p className="mt-4 text-3xl font-semibold text-[#17202a]">
        {formatClp(total)}
      </p>
      <p className="mt-1 text-sm text-[#61717f]">
        {transacciones} transacciones vigentes
      </p>
      {transaccionesAnuladas > 0 ? (
        <div className="mt-4 border-t border-[#e1e6eb] pt-3 text-sm text-[#8f4c4c]">
          <span className="font-semibold">
            {transaccionesAnuladas} anuladas
          </span>
          <span className="ml-2">({formatClp(montoAnulado)})</span>
        </div>
      ) : null}
    </article>
  );
}

function formatClp(value: number): string {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(value);
}
