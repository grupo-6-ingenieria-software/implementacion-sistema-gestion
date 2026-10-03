import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMonthlySalesMoney, type MonthlySalesDay } from "../../../shared/monthly-sales";

export function GraficoVentasMensual({ dias }: { dias: MonthlySalesDay[] }) {
  return (
    <div aria-label="Evolución diaria del monto vendido" className="h-80 w-full" role="img">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={dias} margin={{ top: 16, right: 16, bottom: 12, left: 28 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="fecha" tickFormatter={(value: string) => value.slice(-2)} interval={0} tick={{ fontSize: 11 }} />
          <YAxis tickFormatter={(value: number) => new Intl.NumberFormat("es-CL", { notation: "compact" }).format(value)} />
          <Tooltip formatter={(value) => formatMonthlySalesMoney(Number(value))} labelFormatter={(label) => `Fecha: ${label}`} />
          <Bar name="Monto vendido" dataKey="monto" fill="#2d6a4f" isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
