import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMonthlySalesMoney, type MonthlySalesDay } from "../../../shared/monthly-sales";

export function monthlySalesChartImage(dias: readonly MonthlySalesDay[]): string {
  const width = 1000;
  const height = 300;
  const maximum = Math.max(1, ...dias.map((day) => day.monto));
  const step = 880 / Math.max(1, dias.length);
  const bars = dias.map((day, index) => {
    const x = 95 + index * step;
    const barHeight = day.monto / maximum * 225;
    return `<rect x="${x}" y="${250 - barHeight}" width="${step * 0.7}" height="${barHeight}" fill="#2d6a4f"/><text x="${x + step * 0.35}" y="270" text-anchor="middle">${index + 1}</text>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="white"/><g font-family="Arial" font-size="12" fill="#17202a"><text x="8" y="22">Monto CLP</text><text x="8" y="42">${maximum}</text><text x="65" y="250">0</text><line x1="90" y1="250" x2="985" y2="250" stroke="#9ba9b5"/>${bars}<text x="500" y="295" text-anchor="middle">Día del mes</text></g></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

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
