import { sql, type SQL } from "drizzle-orm";
import {
  allocateRecordedSaleDiscount,
  calculateRecordedSaleTotal,
  isValidSaleHistoryDate,
  type PaymentMethod,
  type SaleResponsibleSnapshot,
} from "../../shared/sales";
import type { DailySalesReport, DailySalesReportTopProduct } from "../../shared/reports";
import { getChileDateRange } from "./dashboard-date";

export type DailySalesReportDb = {
  all: <TRow = Record<string, unknown>>(query: SQL) => Promise<TRow[]>;
};

export class DailySalesReportValidationError extends Error {}

type SaleRow = {
  ventaId: string;
  fechaHora: string;
  metodoPago: PaymentMethod;
  estado: "completada" | "anulada";
  descuentoTipo: "ninguno" | "porcentaje" | "monto";
  descuentoValor: number | null;
  usuarioId: string;
  responsableNombre: string;
  responsableRol: SaleResponsibleSnapshot["rol"];
  anulacionVentaId: string | null;
  cierreCajaId: string;
  cajaEstado: "abierto" | "cerrado";
  cierreFechaHoraFin: string | null;
};

type DetailRow = {
  detalleVentaId: string;
  ventaId: string;
  productoId: number | null;
  ean13: string | null;
  nombre: string | null;
  cantidad: number;
  precioUnitario: number | null;
};

const methods: readonly PaymentMethod[] = ["efectivo", "debito", "credito", "transferencia"];

function emptyPayments(): DailySalesReport["resumen"]["porMetodoPago"] {
  return {
    efectivo: { cantidad: 0, monto: 0 },
    debito: { cantidad: 0, monto: 0 },
    credito: { cantidad: 0, monto: 0 },
    transferencia: { cantidad: 0, monto: 0 },
  };
}

export async function loadDailySalesReport(
  database: DailySalesReportDb,
  fecha: string,
): Promise<DailySalesReport> {
  if (!isValidSaleHistoryDate(fecha)) {
    throw new DailySalesReportValidationError("Ingrese una fecha válida.");
  }
  const { startUtc, endUtc } = getChileDateRange(fecha, fecha);
  const saleRows = await database.all<SaleRow>(sql`
    SELECT v.venta_id AS ventaId,
      v.venta_fecha_hora AS fechaHora,
      v.venta_metodo_pago AS metodoPago,
      v.venta_estado AS estado,
      v.venta_descuento_tipo AS descuentoTipo,
      v.venta_descuento_valor AS descuentoValor,
      v.usuario_cajero_id AS usuarioId,
      v.venta_responsable_nombre AS responsableNombre,
      v.venta_responsable_rol AS responsableRol,
      av.anulacion_venta_id AS anulacionVentaId,
      c.cierre_caja_id AS cierreCajaId,
      c.cierre_estado AS cajaEstado,
      c.cierre_fecha_hora_fin AS cierreFechaHoraFin
    FROM venta v
    JOIN cierre_caja c ON c.cierre_caja_id = v.cierre_caja_id
    LEFT JOIN anulacion_venta av ON av.venta_id = v.venta_id
    WHERE datetime(v.venta_fecha_hora) >= datetime(${startUtc})
      AND datetime(v.venta_fecha_hora) < datetime(${endUtc})
    ORDER BY datetime(v.venta_fecha_hora) ASC, v.venta_id ASC
  `);
  const resumen: DailySalesReport["resumen"] = {
    ventasVigentes: 0,
    montoVigente: 0,
    porMetodoPago: emptyPayments(),
    ventasAnuladas: 0,
    montoAnulado: 0,
  };
  if (saleRows.length === 0) {
    return {
      fecha,
      tieneVentas: false,
      ventas: [],
      resumen,
      topProductos: [],
      caja: { estado: "sin_registro" },
    };
  }
  const cashId = saleRows[0].cierreCajaId;
  if (saleRows.some((row) => row.cierreCajaId !== cashId)) {
    throw new Error("El día contiene más de una caja asociada; no hay criterio documental para consolidarlas.");
  }

  const detailRows = await database.all<DetailRow>(sql`
    SELECT dv.detalle_venta_id AS detalleVentaId,
      dv.venta_id AS ventaId,
      p.producto_id AS productoId,
      p.producto_ean_13 AS ean13,
      p.producto_nombre AS nombre,
      dv.detalle_venta_cantidad AS cantidad,
      hp.historial_precio_venta AS precioUnitario
    FROM detalle_venta dv
    JOIN venta v ON v.venta_id = dv.venta_id
    LEFT JOIN historial_precio_producto hp
      ON hp.historial_precio_producto_id = dv.historial_precio_producto_id
    LEFT JOIN producto p ON p.producto_id = dv.producto_id
    WHERE datetime(v.venta_fecha_hora) >= datetime(${startUtc})
      AND datetime(v.venta_fecha_hora) < datetime(${endUtc})
    ORDER BY dv.venta_id ASC, dv.detalle_venta_id ASC
  `);
  const bySale = new Map<string, DetailRow[]>();
  for (const detail of detailRows) {
    const group = bySale.get(detail.ventaId) ?? [];
    group.push(detail);
    bySale.set(detail.ventaId, group);
  }

  const topByProduct = new Map<number, DailySalesReportTopProduct>();
  const ventas: DailySalesReport["ventas"] = [];
  for (const row of saleRows) {
    const details = bySale.get(row.ventaId) ?? [];
    if (details.length === 0) throw new Error(`La venta ${row.ventaId} no tiene detalle.`);
    let subtotal = 0;
    const allocationInput = details.map((detail) => {
      const cantidad = Number(detail.cantidad);
      const precio = detail.precioUnitario === null ? NaN : Number(detail.precioUnitario);
      if (!detail.productoId || !detail.ean13 || !detail.nombre ||
          !Number.isSafeInteger(cantidad) || cantidad <= 0 ||
          !Number.isSafeInteger(precio) || precio < 0 ||
          !Number.isSafeInteger(cantidad * precio)) {
        throw new Error(`El detalle de la venta ${row.ventaId} está incompleto o es inválido.`);
      }
      const lineSubtotal = cantidad * precio;
      subtotal += lineSubtotal;
      if (!Number.isSafeInteger(subtotal)) throw new Error("El subtotal de la venta excede el rango permitido.");
      return { id: detail.detalleVentaId, subtotal: lineSubtotal };
    });
    const total = calculateRecordedSaleTotal({
      subtotal,
      discountType: row.descuentoTipo,
      discountValue: row.descuentoValor,
    });
    if (!Number.isSafeInteger(total) || total < 0) throw new Error("El total de la venta es inválido.");
    const allocation = allocateRecordedSaleDiscount(allocationInput, {
      discountType: row.descuentoTipo,
      discountValue: row.descuentoValor,
    });
    if (allocation.reduce((sum, line) => sum + line.neto, 0) !== total) {
      throw new Error("El detalle neto no coincide con el total de la venta.");
    }
    const anulada = row.estado === "anulada" || row.anulacionVentaId !== null;
    ventas.push({
      ventaId: row.ventaId,
      fechaHora: row.fechaHora,
      responsable: {
        usuarioId: row.usuarioId,
        nombre: row.responsableNombre,
        rol: row.responsableRol,
      },
      estado: anulada ? "anulada" : "confirmada",
      metodoPago: row.metodoPago,
      total,
    });
    if (anulada) {
      resumen.ventasAnuladas += 1;
      resumen.montoAnulado += total;
      continue;
    }
    if (!methods.includes(row.metodoPago)) throw new Error("Método de pago inválido en venta registrada.");
    resumen.ventasVigentes += 1;
    resumen.montoVigente += total;
    resumen.porMetodoPago[row.metodoPago].cantidad += 1;
    resumen.porMetodoPago[row.metodoPago].monto += total;

    for (let index = 0; index < details.length; index += 1) {
      const detail = details[index];
      const productoId = Number(detail.productoId);
      const current = topByProduct.get(productoId) ?? {
        productoId,
        ean13: detail.ean13!,
        nombre: detail.nombre!,
        unidades: 0,
        montoNeto: 0,
      };
      current.unidades += Number(detail.cantidad);
      current.montoNeto += allocation[index].neto;
      topByProduct.set(productoId, current);
    }
  }
  const topProductos = [...topByProduct.values()]
    .sort((a, b) => b.unidades - a.unidades || a.productoId - b.productoId)
    .slice(0, 5);
  const cash = saleRows[0];
  if (cash.cajaEstado === "cerrado" && !cash.cierreFechaHoraFin) {
    throw new Error("La caja cerrada no tiene hora de cierre.");
  }
  return {
    fecha,
    tieneVentas: true,
    ventas,
    resumen,
    topProductos,
    caja: cash.cajaEstado === "cerrado"
      ? { estado: "cerrada", fechaHoraCierre: cash.cierreFechaHoraFin! }
      : { estado: "abierta" },
  };
}
