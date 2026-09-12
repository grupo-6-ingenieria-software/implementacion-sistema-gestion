import { describe, expect, it } from "vitest";
import {
  hasSupplierFieldErrors,
  normalizeSupplierEditPayload,
  normalizeSupplierListRequest,
  normalizeSupplierLookupRequest,
  normalizeSupplierRegistrationPayload,
  validateSupplierRegistrationPayload,
  validateSupplierEditPayload,
} from "../../src/shared/suppliers";

describe("CU13 supplier registration contract", () => {
  it("normalizes RUT, whitespace, phone, email and duplicate categories", () => {
    expect(
      normalizeSupplierRegistrationPayload({
        rut: " 12.345.670-k ",
        nombreRazonSocial: "  Distribuidora   del Sur  ",
        nombreContacto: "  Ana   Pérez ",
        telefono: "912 345 678",
        correoElectronico: " ventas@sur.cl ",
        categoriaIds: [2, 1, 2, -1, "3"],
        usuarioId: " owner ",
      }),
    ).toEqual({
      rut: "12345670-K",
      nombreRazonSocial: "Distribuidora del Sur",
      nombreContacto: "Ana Pérez",
      telefono: "912345678",
      correoElectronico: "ventas@sur.cl",
      categoriaIds: [2, 1],
      usuarioId: "owner",
    });
  });

  it("reports every required field", () => {
    const input = normalizeSupplierRegistrationPayload({});
    expect(validateSupplierRegistrationPayload(input)).toEqual({
      rut: "Ingrese un RUT chileno válido.",
      nombreRazonSocial: "Ingrese la razón social.",
      nombreContacto: "Ingrese el nombre de contacto.",
      telefono: "Ingrese el teléfono de contacto.",
      correoElectronico: "Ingrese el correo electrónico.",
      categoriaIds: "Seleccione al menos una categoría.",
    });
  });

  it.each([
    ["12345678-9", "912345678", "ventas@sur.cl", "rut"],
    ["12345678-5", "12345", "ventas@sur.cl", "telefono"],
    ["12345678-5", "912345678", "correo-invalido", "correoElectronico"],
  ])("rejects invalid field data", (rut, telefono, correo, field) => {
    const input = normalizeSupplierRegistrationPayload({
      rut,
      nombreRazonSocial: "Distribuidora",
      nombreContacto: "Ana Pérez",
      telefono,
      correoElectronico: correo,
      categoriaIds: [1],
    });
    const errors = validateSupplierRegistrationPayload(input);
    expect(errors[field as keyof typeof errors]).toBeDefined();
    expect(hasSupplierFieldErrors(errors)).toBe(true);
  });

  it("accepts a complete valid payload", () => {
    const input = normalizeSupplierRegistrationPayload({
      rut: "12345678-5",
      nombreRazonSocial: "Distribuidora",
      nombreContacto: "Ana Pérez",
      telefono: "912345678",
      correoElectronico: "ventas@sur.cl",
      categoriaIds: [1],
    });
    expect(validateSupplierRegistrationPayload(input)).toEqual({});
  });
});

describe("CU14 supplier edit and query contracts", () => {
  it("normalizes the edit fields using the CU13 rules", () => {
    const input = normalizeSupplierEditPayload({
      rut: " 12.345.670-k ",
      nombreRazonSocial: "  Nueva   razón ",
      nombreContacto: " Ana   Pérez ",
      telefono: "912 345 678",
      correoElectronico: " contacto@ejemplo.cl ",
      categoriaIds: [2, 2, 1],
    });

    expect(input).toMatchObject({
      rut: "12345670-K",
      nombreRazonSocial: "Nueva razón",
      nombreContacto: "Ana Pérez",
      telefono: "912345678",
      correoElectronico: "contacto@ejemplo.cl",
      categoriaIds: [2, 1],
    });
    expect(validateSupplierEditPayload(input)).toEqual({});
  });

  it("normalizes list search and rejects an invalid lookup RUT", () => {
    expect(
      normalizeSupplierListRequest({
        busqueda: "  Distribuidora   SUR ",
        usuarioId: " user ",
      }),
    ).toEqual({ busqueda: "Distribuidora SUR", usuarioId: "user" });
    expect(normalizeSupplierLookupRequest({ rut: "12.345.678-9" })).toEqual({
      rut: "",
    });
  });
});
