import type {
  PaymentMethod,
  SaleDiscountInput,
} from "../../shared/sales";

export const SALE_DRAFT_STORAGE_KEY = "huascar:venta-borrador:cu43";
export const SALE_PENDING_USER_STORAGE_KEY = "huascar:venta-retorno:cu43";
export const SALE_DRAFT_VERSION = 1;

export type SaleDraftCartItem = {
  productoId: number;
  ean13: string;
  nombre: string;
  categoria: string;
  precioVenta: number;
  stockDisponible: number;
  cantidad: number;
};

export type SaleDraft = {
  version: typeof SALE_DRAFT_VERSION;
  usuarioId: string;
  cart: SaleDraftCartItem[];
  metodoPago: PaymentMethod;
  montoRecibido: string;
  descuento: SaleDiscountInput | null;
};

export function readSaleDraft(
  storage: Pick<Storage, "getItem" | "removeItem"> | null = getStorage(),
): SaleDraft | null {
  if (!storage) return null;

  try {
    const raw = storage.getItem(SALE_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (isSaleDraft(parsed)) return parsed;
    storage.removeItem(SALE_DRAFT_STORAGE_KEY);
  } catch {
    try {
      storage.removeItem(SALE_DRAFT_STORAGE_KEY);
    } catch {}
  }

  return null;
}

export function writeSaleDraft(
  draft: SaleDraft,
  storage: Pick<Storage, "setItem"> | null = getStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(SALE_DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {}
}

export function clearSaleDraft(
  storage: Pick<Storage, "removeItem"> | null = getStorage(),
): void {
  if (!storage) return;
  try {
    storage.removeItem(SALE_DRAFT_STORAGE_KEY);
  } catch {}
}

export function readPendingSaleUserId(
  storage: Pick<Storage, "getItem"> | null = getStorage(),
): string | null {
  if (!storage) return null;
  try {
    const userId = storage.getItem(SALE_PENDING_USER_STORAGE_KEY);
    return userId?.trim() ? userId : null;
  } catch {
    return null;
  }
}

export function markSaleDraftForResume(
  usuarioId: string,
  storage: Pick<Storage, "setItem"> | null = getStorage(),
): void {
  if (!storage || !usuarioId.trim()) return;
  try {
    storage.setItem(SALE_PENDING_USER_STORAGE_KEY, usuarioId);
  } catch {}
}

export function clearPendingSaleResume(
  storage: Pick<Storage, "removeItem"> | null = getStorage(),
): void {
  if (!storage) return;
  try {
    storage.removeItem(SALE_PENDING_USER_STORAGE_KEY);
  } catch {}
}

function isSaleDraft(value: unknown): value is SaleDraft {
  if (!isRecord(value)) return false;
  if (value.version !== SALE_DRAFT_VERSION) return false;
  if (typeof value.usuarioId !== "string" || !value.usuarioId.trim()) {
    return false;
  }
  if (!Array.isArray(value.cart) || value.cart.length === 0) return false;
  if (!value.cart.every(isSaleDraftCartItem)) return false;
  if (!isPaymentMethod(value.metodoPago)) return false;
  if (typeof value.montoRecibido !== "string") return false;
  return value.descuento === null || isSaleDiscount(value.descuento);
}

function isSaleDraftCartItem(value: unknown): value is SaleDraftCartItem {
  if (!isRecord(value)) return false;
  return (
    Number.isSafeInteger(value.productoId) &&
    Number(value.productoId) > 0 &&
    typeof value.ean13 === "string" &&
    value.ean13.trim().length > 0 &&
    typeof value.nombre === "string" &&
    value.nombre.trim().length > 0 &&
    typeof value.categoria === "string" &&
    Number.isSafeInteger(value.precioVenta) &&
    Number(value.precioVenta) >= 0 &&
    Number.isSafeInteger(value.stockDisponible) &&
    Number(value.stockDisponible) >= 0 &&
    Number.isSafeInteger(value.cantidad) &&
    Number(value.cantidad) > 0
  );
}

function isSaleDiscount(value: unknown): value is SaleDiscountInput {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.monto) &&
    Number(value.monto) >= 0 &&
    typeof value.razon === "string"
  );
}

function isPaymentMethod(value: unknown): value is PaymentMethod {
  return (
    value === "efectivo" ||
    value === "debito" ||
    value === "credito" ||
    value === "transferencia"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.sessionStorage;
}
