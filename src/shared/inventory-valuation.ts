export type InventoryValuationRequest = {
  usuarioId?: string;
};

export type InventoryValuationCategory = {
  categoriaId: number;
  categoria: string;
  cantidadProductos: number;
  stockTotal: number;
  valorTotal: number;
};

export type InventoryValuationResult = {
  categorias: InventoryValuationCategory[];
  totalInventario: number;
};

export function normalizeInventoryValuationRequest(
  payload: unknown,
): InventoryValuationRequest {
  if (!isRecord(payload) || typeof payload.usuarioId !== "string") {
    return {};
  }

  const usuarioId = payload.usuarioId.trim();
  return usuarioId ? { usuarioId } : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
