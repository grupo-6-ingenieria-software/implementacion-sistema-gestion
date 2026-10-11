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

describe("contrato de registro de proveedores CU13", () => {
  it("normaliza RUT, espacios, teléfono, correo y categorías duplicadas", () => {
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

  it("informa cada campo obligatorio", () => {
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
  ])("rechaza datos de campo inválidos", (rut, telefono, correo, field) => {
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

  it("acepta un payload completo y válido", () => {
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

describe("contratos de edición y consulta de proveedores CU14", () => {
  it("normaliza los campos de edición usando las reglas de CU13", () => {
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

  it("normaliza la búsqueda de listado y rechaza un RUT de consulta inválido", () => {
    expect(
      normalizeSupplierListRequest({
        busqueda: "  Distribuidora   SUR ",
        categoriaId: 2,
        usuarioId: " user ",
      }),
    ).toEqual({
      busqueda: "Distribuidora SUR",
      categoriaId: 2,
      usuarioId: "user",
    });
    expect(
      normalizeSupplierListRequest({ categoriaId: 0, usuarioId: " user " }),
    ).toEqual({ usuarioId: "user" });
    expect(normalizeSupplierLookupRequest({ rut: "12.345.678-9" })).toEqual({
      rut: "",
    });
  });
});
