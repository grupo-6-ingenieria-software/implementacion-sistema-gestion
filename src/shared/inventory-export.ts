export const INVENTORY_EXPORT_CHANNEL = "inventario:exportar-productos";
export const INVENTORY_EMPTY_MESSAGE = "No hay productos para exportar";
export const INVENTORY_EXPORT_ERROR_MESSAGE =
  "No fue posible generar el archivo";
export const INVENTORY_AUDIT_WARNING =
  "El archivo se guardó, pero no se pudo registrar la auditoría.";
export const INVENTORY_BUSINESS_NAME = "Minimarket y Panadería Huáscar";
export const INVENTORY_EXPORT_COLUMNS = [
  "EAN-13",
  "Nombre",
  "Categoría",
  "Stock actual",
  "Stock mínimo",
  "Precio costo",
  "Precio venta",
  "Estado",
] as const;

export type InventoryExportFormat = "pdf" | "xlsx";
export type InventoryExportRequest = { formato: InventoryExportFormat };
export type InventoryExportItem = {
  productoId: number;
  ean13: string;
  nombre: string;
  categoria: string;
  stockActual: number;
  stockMinimo: number;
  precioCosto: number;
  precioVenta: number;
  estado: "activo" | "inactivo";
};
export type InventoryReportInput = {
  negocio: string;
  fecha: string;
  fechaGeneracion: string;
  usuario: string;
  items: readonly InventoryExportItem[];
};
type InventoryExportBase = {
  formato: InventoryExportFormat;
  cantidadFilas: number;
  fechaGeneracion: string;
};
export type InventoryExportResult = InventoryExportBase &
  (
    | { estado: "cancelled" }
    | { estado: "saved"; ruta: string; auditoria: "registrada" }
    | {
        estado: "saved";
        ruta: string;
        auditoria: "fallida";
        advertencia: string;
      }
  );

export function inventoryExportFormat(
  payload: unknown,
): InventoryExportFormat | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return null;
  const format = (payload as Record<string, unknown>).formato;
  return format === "pdf" || format === "xlsx" ? format : null;
}
