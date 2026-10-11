import { describe, expect, it } from "vitest";
import {
  filterAndSortUserList,
  formatRoleLabel,
  formatRutInput,
  hasUserFieldErrors,
  normalizeRut,
  normalizeUserFormPayload,
  normalizeUserListPayload,
  normalizeUserRole,
  normalizeUserStatusChangePayload,
  validateUserFormValues,
  type UserListItem,
} from "../../src/shared/users";

describe("formatRutInput", () => {
  it("inserta el guion antes del dígito verificador automáticamente", () => {
    expect(formatRutInput("226024395")).toBe("22602439-5");
  });

  it("ignora el guion escrito por el usuario y lo vuelve a insertar", () => {
    expect(formatRutInput("22602439-5")).toBe("22602439-5");
    expect(formatRutInput("2-2-6")).toBe("22-6");
  });

  it("mueve el guion dinámicamente a medida que se escriben más dígitos", () => {
    expect(formatRutInput("1")).toBe("1");
    expect(formatRutInput("12")).toBe("1-2");
    expect(formatRutInput("123")).toBe("12-3");
  });

  it("mantiene el verificador K y lo convierte a mayúscula", () => {
    expect(formatRutInput("12345670k")).toBe("12345670-K");
  });

  it("elimina puntos, espacios y otros caracteres", () => {
    expect(formatRutInput("22.602.439-5")).toBe("22602439-5");
  });
});

const users: UserListItem[] = [
  {
    usuarioId: "12345678-9",
    rut: "12345678-9",
    nombreCompleto: "Maria Huascar",
    rol: "dueno",
    telefono: "987654321",
    correoElectronico: "maria@huascar.cl",
    fechaIngreso: "2024-01-01",
    estado: "activo",
  },
  {
    usuarioId: "23456789-0",
    rut: "23456789-0",
    nombreCompleto: "Camila Rojas",
    rol: "trabajador",
    telefono: "912345678",
    fechaIngreso: "2025-06-15",
    estado: "activo",
  },
  {
    usuarioId: "34567890-1",
    rut: "34567890-1",
    nombreCompleto: "Luis Soto",
    rol: "trabajador",
    telefono: "923456789",
    correoElectronico: "luis@huascar.cl",
    fechaIngreso: "2023-03-10",
    estado: "inactivo",
  },
];

describe("auxiliares de listado de usuarios", () => {
  it("normaliza los roles heredados al modelo de dos roles", () => {
    expect(normalizeUserRole("dueño")).toBe("dueno");
    expect(normalizeUserRole("dueÃ±o")).toBe("dueno");
    expect(normalizeUserRole("cajero")).toBe("trabajador");
    expect(normalizeUserRole("reponedor")).toBe("trabajador");
    expect(formatRoleLabel("dueno")).toBe("Dueño");
  });

  it("filtra por búsqueda, rol y estado", () => {
    const filters = normalizeUserListPayload({
      search: "rojas",
      rol: "trabajador",
      estado: "activo",
    });

    expect(
      filterAndSortUserList(users, filters).map((user) => user.usuarioId),
    ).toEqual(["23456789-0"]);
  });

  it("ordena los usuarios por fecha de ingreso descendente", () => {
    const filters = normalizeUserListPayload({
      sortBy: "fechaIngreso",
      sortDirection: "desc",
    });

    expect(
      filterAndSortUserList(users, filters).map((user) => user.usuarioId),
    ).toEqual(["23456789-0", "12345678-9", "34567890-1"]);
  });

  it("normaliza y valida los valores del formulario de cuenta de trabajador RF21", () => {
    const payload = normalizeUserFormPayload({
      correoElectronico: " ana@huascar.cl ",
      nombreCompleto: " Ana   Soto ",
      rol: "trabajador",
      rut: "12.345.678-5",
      telefono: "987 654 321",
    });

    expect(payload).toEqual({
      correoElectronico: "ana@huascar.cl",
      nombreCompleto: "Ana Soto",
      rol: "trabajador",
      rut: "12345678-5",
      telefono: "987654321",
      usuarioId: undefined,
    });
    expect(normalizeRut("12.345.678-k")).toBe("12345678-K");
  });

  it("devuelve errores de campo para valores RF21 inválidos", () => {
    const errors = validateUserFormValues({
      correoElectronico: "correo-invalido",
      nombreCompleto: "",
      rol: "trabajador",
      rut: "123",
      telefono: "123",
    });

    expect(hasUserFieldErrors(errors)).toBe(true);
    expect(errors.rut).toBeDefined();
    expect(errors.nombreCompleto).toBeDefined();
    expect(errors.telefono).toBeDefined();
    expect(errors.correoElectronico).toBeDefined();
  });

  it("permite valores de RUT heredados no editables durante actualizaciones RF22", () => {
    const errors = validateUserFormValues(
      {
        nombreCompleto: "Maria Huascar",
        rol: "dueno",
        rut: "12345678-9",
        telefono: "987654321",
      },
      { validateRutFormat: false },
    );

    expect(hasUserFieldErrors(errors)).toBe(false);
  });
});

describe("normalizeUserStatusChangePayload", () => {
  it("mantiene la confirmación explícita y la establece en false por defecto", () => {
    expect(
      normalizeUserStatusChangePayload({
        confirmacion: true,
        estado: "inactivo",
        usuarioObjetivoId: "23456789-0",
      }),
    ).toEqual({
      confirmacion: true,
      estado: "inactivo",
      usuarioId: undefined,
      usuarioObjetivoId: "23456789-0",
    });

    expect(
      normalizeUserStatusChangePayload({
        estado: "activo",
        usuarioObjetivoId: "23456789-0",
      }).confirmacion,
    ).toBe(false);
  });
});
