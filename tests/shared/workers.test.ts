import { describe, expect, it } from "vitest";
import {
  normalizeWorkerFormValues,
  roleLabel,
  validateWorkerFormValues,
} from "../../src/shared/workers";

describe("contrato del formulario de trabajador", () => {
  it("normaliza los campos requeridos para registrar un trabajador", () => {
    expect(
      normalizeWorkerFormValues({
        rut: "12.345.678-9",
        nombreCompleto: "  Camila   Rojas  ",
        rol: "trabajador",
        telefono: "912 345 678",
        correo: " camila@huascar.cl ",
      }),
    ).toEqual({
      rut: "12345678-9",
      nombreCompleto: "Camila Rojas",
      rol: "trabajador",
      telefono: "912345678",
      correo: "camila@huascar.cl",
    });
  });

  it("informa los errores de campos de RF21 antes de guardar", () => {
    expect(
      validateWorkerFormValues({
        rut: "123",
        nombreCompleto: "",
        rol: "trabajador",
        telefono: "123",
        correo: "correo-invalido",
      }),
    ).toEqual({
      rut: "Ingrese un RUT valido.",
      nombreCompleto: "Ingrese el nombre completo.",
      telefono: "Ingrese un telefono de 9 digitos.",
      correo: "Ingrese un correo valido.",
    });
  });

  it("usa las etiquetas de rol del sistema en la lista y el formulario de trabajadores", () => {
    expect(roleLabel("dueno")).toBe("Dueno");
    expect(roleLabel("trabajador")).toBe("Trabajador");
  });
});
