import type { ReactElement } from 'react';

type SeccionesPagoVentaProps = {
  metodo: 'efectivo' | 'electronico';
  onMetodoChange: (metodo: 'efectivo' | 'electronico') => void;
};

export function SeccionesPagoVenta({
  metodo,
  onMetodoChange,
}: SeccionesPagoVentaProps): ReactElement {
  return (
    <div className="grid grid-cols-2 gap-2 rounded-md border border-[#d7dee6] bg-[#f8fafb] p-2">
      {(['efectivo', 'electronico'] as const).map((option) => (
        <button
          className={`rounded-md px-3 py-2 text-sm font-semibold ${
            metodo === option
              ? 'bg-[#244d61] text-white'
              : 'bg-white text-[#24313d]'
          }`}
          key={option}
          type="button"
          onClick={() => onMetodoChange(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
