import type { ReactElement } from 'react';

type ResumenVentasDashboardProps = {
  total: number;
  transacciones: number;
};

export function ResumenVentasDashboard({
  total,
  transacciones,
}: ResumenVentasDashboardProps): ReactElement {
  return (
    <div className="rounded-md border border-[#d7dee6] bg-[#f8fafb] p-4">
      <p className="text-sm font-semibold text-[#61717f]">Ventas del dia</p>
      <p className="mt-2 text-2xl font-semibold text-[#17202a]">
        ${total.toLocaleString('es-CL')}
      </p>
      <p className="mt-1 text-sm text-[#61717f]">
        {transacciones} transacciones
      </p>
    </div>
  );
}
