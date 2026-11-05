import { sql } from "drizzle-orm";
import { db } from "../../db/client";

/** Etapas de negocio, no una traza del orden de las sentencias SQL. */
export function demoLog(rf: "RF18" | "RF36", message: () => string): void {
  if (process.env.HUASCAR_DEMO === "1") console.log(`[${rf}] ${message()}`);
}

type DemoProduct = { productoId: number; nombre: string; ean13: string; stock: number };

export async function demoStockSnapshot(): Promise<DemoProduct[]> {
  if (process.env.HUASCAR_DEMO !== "1") return [];
  try {
    return await db.all<DemoProduct>(sql`
      SELECT p.producto_id AS productoId, p.producto_nombre AS nombre,
        p.producto_ean_13 AS ean13, COALESCE(SUM(l.lote_cantidad_actual), 0) AS stock
      FROM producto p LEFT JOIN lote l USING (producto_id)
      GROUP BY p.producto_id ORDER BY p.producto_id
    `);
  } catch (error) {
    // Los logs nunca deben convertir una operación válida en un error para la UI.
    console.warn("[DEMO] No se pudo consultar el stock para el log.", error);
    return [];
  }
}

export async function logDemoStockChanges(rf: "RF18" | "RF36", before: DemoProduct[]): Promise<void> {
  if (process.env.HUASCAR_DEMO !== "1") return;
  for (const product of await demoStockSnapshot()) {
    const previous = before.find((row) => row.productoId === product.productoId);
    if (previous && previous.stock !== product.stock) {
      demoLog(rf, () => `${product.nombre} | EAN-13 ${product.ean13} | stock ${previous.stock} → ${product.stock} | movimiento ${product.stock > previous.stock ? "+" : ""}${product.stock - previous.stock}.`);
    }
  }
}
