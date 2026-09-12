import { canonicalizeRut } from "./rut";

export interface SupplierRegistrationPayload {
  rut: string;
  nombreRazonSocial: string;
  nombreContacto: string;
  telefono: string;
  correoElectronico: string;
  categoriaIds: number[];
  usuarioId?: string;
}

export interface SupplierRegistrationResponse {
  proveedorId: number;
  rut: string;
}

export interface SupplierEditPayload {
  rut: string;
  nombreRazonSocial: string;
  nombreContacto: string;
  telefono: string;
  correoElectronico: string;
  categoriaIds: number[];
  usuarioId?: string;
}

export interface SupplierEditResponse {
  proveedorId: number;
  rut: string;
}

export interface SupplierListRequest {
  busqueda?: string;
  usuarioId?: string;
}

export interface SupplierLookupRequest {
  rut: string;
  usuarioId?: string;
}

export interface SupplierListItem {
  proveedorId: number;
  rut: string;
  nombreRazonSocial: string;
}

export interface SupplierDetail extends SupplierEditPayload {
  proveedorId: number;
}

export interface SupplierCategoryOption {
  id: number;
  nombre: string;
}

export type SupplierFieldErrors = Partial<
  Record<
    | "rut"
    | "nombreRazonSocial"
    | "nombreContacto"
    | "telefono"
    | "correoElectronico"
    | "categoriaIds",
    string
  >
>;

export const emptySupplierRegistration: SupplierRegistrationPayload = {
  rut: "",
  nombreRazonSocial: "",
  nombreContacto: "",
  telefono: "",
  correoElectronico: "",
  categoriaIds: [],
};

export function normalizeSupplierRegistrationPayload(
  payload: unknown,
): SupplierRegistrationPayload {
  const record = isRecord(payload) ? payload : {};

  return {
    rut: typeof record.rut === "string" ? canonicalizeRut(record.rut) : "",
    nombreRazonSocial: normalizeText(record.nombreRazonSocial),
    nombreContacto: normalizeText(record.nombreContacto),
    telefono:
      typeof record.telefono === "string"
        ? record.telefono.replace(/\s/g, "")
        : "",
    correoElectronico:
      typeof record.correoElectronico === "string"
        ? record.correoElectronico.trim()
        : "",
    categoriaIds: normalizeCategoryIds(record.categoriaIds),
    usuarioId:
      typeof record.usuarioId === "string" && record.usuarioId.trim()
        ? record.usuarioId.trim()
        : undefined,
  };
}

export function normalizeSupplierEditPayload(
  payload: unknown,
): SupplierEditPayload {
  return normalizeSupplierRegistrationPayload(payload);
}

export function normalizeSupplierListRequest(
  payload: unknown,
): SupplierListRequest {
  const record = isRecord(payload) ? payload : {};
  const busqueda = normalizeText(record.busqueda);
  const usuarioId = normalizeOptionalUserId(record.usuarioId);

  return {
    ...(busqueda ? { busqueda } : {}),
    ...(usuarioId ? { usuarioId } : {}),
  };
}

export function normalizeSupplierLookupRequest(
  payload: unknown,
): SupplierLookupRequest {
  const record = isRecord(payload) ? payload : {};
  const usuarioId = normalizeOptionalUserId(record.usuarioId);

  return {
    rut: typeof record.rut === "string" ? canonicalizeRut(record.rut) : "",
    ...(usuarioId ? { usuarioId } : {}),
  };
}

export function normalizeSupplierCategoryRequest(payload: unknown): {
  usuarioId?: string;
} {
  if (!isRecord(payload) || typeof payload.usuarioId !== "string") {
    return {};
  }

  const usuarioId = payload.usuarioId.trim();
  return usuarioId ? { usuarioId } : {};
}

export function validateSupplierRegistrationPayload(
  payload: SupplierRegistrationPayload,
): SupplierFieldErrors {
  const errors: SupplierFieldErrors = {};

  if (!payload.rut) {
    errors.rut = "Ingrese un RUT chileno válido.";
  }

  if (!payload.nombreRazonSocial) {
    errors.nombreRazonSocial = "Ingrese la razón social.";
  }

  if (!payload.nombreContacto) {
    errors.nombreContacto = "Ingrese el nombre de contacto.";
  }

  if (!payload.telefono) {
    errors.telefono = "Ingrese el teléfono de contacto.";
  } else if (!/^\d{9}$/.test(payload.telefono)) {
    errors.telefono = "El teléfono debe tener exactamente 9 dígitos.";
  }

  if (!payload.correoElectronico) {
    errors.correoElectronico = "Ingrese el correo electrónico.";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(payload.correoElectronico)) {
    errors.correoElectronico = "Ingrese un correo electrónico válido.";
  }

  if (payload.categoriaIds.length === 0) {
    errors.categoriaIds = "Seleccione al menos una categoría.";
  }

  return errors;
}

export function validateSupplierEditPayload(
  payload: SupplierEditPayload,
): SupplierFieldErrors {
  return validateSupplierRegistrationPayload(payload);
}

export function hasSupplierFieldErrors(errors: SupplierFieldErrors): boolean {
  return Object.values(errors).some(Boolean);
}

function normalizeCategoryIds(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value.filter(
        (categoryId): categoryId is number =>
          typeof categoryId === "number" &&
          Number.isInteger(categoryId) &&
          categoryId > 0,
      ),
    ),
  ];
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function normalizeOptionalUserId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
