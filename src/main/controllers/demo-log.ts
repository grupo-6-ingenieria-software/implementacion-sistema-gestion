import { sql } from "drizzle-orm";
import { db } from "../../db/client";
import { demoOutput, demoTraceLabel, withoutDemoTrace } from "../demo-trace";

let previousBlock = "";
const money = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP" });
export const demoMoney = (value: number): string => money.format(value);

/** Etapas de negocio, no una traza del orden de las sentencias SQL. */
export function demoLog(
  rf: "RF18" | "RF36",
  title: string,
  fields: () => Record<string, string | number>,
): void {
  if (process.env.HUASCAR_DEMO !== "1") return;
  let values: Record<string, string | number>;
  try { values = fields(); } catch { return; }
  const trace = demoTraceLabel();
  const entries = Object.entries({ ...(trace ? { Secuencia: trace } : {}), ...values });
  const width = Math.max(...entries.map(([label]) => label.length));
  const block = `[${rf}] ${title}\n${entries.map(([label, value]) => `  ${label.padEnd(width)} : ${value}`).join("\n")}`;
  if (block === previousBlock) return;
  previousBlock = block;
  demoOutput(`\n${block}`);
}

type DemoProduct = { productoId: number; nombre: string; ean13: string; stock: number };

export async function demoStockSnapshot(): Promise<DemoProduct[]> {
  if (process.env.HUASCAR_DEMO !== "1") return [];
  try {
    return await withoutDemoTrace(() => db.all<DemoProduct>(sql`
      SELECT p.producto_id AS productoId, p.producto_nombre AS nombre,
        p.producto_ean_13 AS ean13, COALESCE(SUM(l.lote_cantidad_actual), 0) AS stock
      FROM producto p LEFT JOIN lote l USING (producto_id)
      GROUP BY p.producto_id ORDER BY p.producto_id
    `));
  } catch (error) {
    // Los logs nunca deben convertir una operación válida en un error para la UI.
    console.warn("[Registro] No se pudo consultar el stock para el log.", error);
    return [];
  }
}

export async function logDemoStockChanges(rf: "RF18" | "RF36", before: DemoProduct[]): Promise<void> {
  if (process.env.HUASCAR_DEMO !== "1") return;
  for (const product of await demoStockSnapshot()) {
    const previous = before.find((row) => row.productoId === product.productoId);
    if (previous && previous.stock !== product.stock) {
      demoLog(rf, product.stock > previous.stock ? "Entrada de inventario" : "Salida de inventario", () => ({
        Controlador: rf === "RF18" ? "C_RecepcionPedidoHandler" : "C_DescuentoStockHandler",
        Tablas: rf === "RF18" ? "lote, detalle_recepcion (producto consultado)" : "lote, venta_lote (producto consultado)",
        Producto: product.nombre,
        "EAN-13": product.ean13,
        Stock: `${previous.stock} → ${product.stock}`,
        Movimiento: `${product.stock > previous.stock ? "+" : ""}${product.stock - previous.stock} ${Math.abs(product.stock - previous.stock) === 1 ? "unidad" : "unidades"}`,
      }));
    }
  }
}
