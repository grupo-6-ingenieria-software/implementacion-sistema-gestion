import { describe, expect, it } from "vitest";
import {
  normalizeLotRegisterPayload,
  validateLotRegisterPayload,
} from "../../src/shared/lots";

const validPayload = {
  ean13: "7802920000015",
  cantidad: 10,
  precioCosto: 700,
  proveedorId: 1,
  usuarioId: "12345678-9",
};

describe("helpers de validación de lotes", () => {
  it("rechaza cantidad, costo y proveedor inválidos", () => {
    const errors = validateLotRegisterPayload(
      normalizeLotRegisterPayload({
        ...validPayload,
        cantidad: "0",
        precioCosto: "-1",
        proveedorId: "",
      }),
    );

    expect(errors).toMatchObject({
      cantidad: "La cantidad debe ser un entero mayor que 0.",
      precioCosto: "El costo del lote debe ser un entero mayor que 0.",
      proveedorId: "Seleccione un proveedor existente.",
    });
  });

  it("rechaza cantidad y costo decimales en lugar de truncarlos", () => {
    const errors = validateLotRegisterPayload(
      normalizeLotRegisterPayload({
        ...validPayload,
        cantidad: "2.5",
        precioCosto: "700.5",
      }),
    );

    expect(errors).toMatchObject({
      cantidad: "La cantidad debe ser un entero mayor que 0.",
      precioCosto: "El costo del lote debe ser un entero mayor que 0.",
    });
  });

  it("rechaza una selección de producto ausente", () => {
    expect(
      validateLotRegisterPayload({
        ...validPayload,
        ean13: "",
      }),
    ).toMatchObject({
      ean13: "Seleccione un producto activo para registrar el lote.",
    });
  });

  it("exige una fecha de vencimiento futura cuando la categoría lo requiere", () => {
    const missingDate = validateLotRegisterPayload(validPayload, {
      productRequiresExpiration: true,
      today: "2026-06-12",
    });
    const pastDate = validateLotRegisterPayload(
      {
        ...validPayload,
        fechaVencimiento: "2026-06-12",
      },
      {
        productRequiresExpiration: true,
        today: "2026-06-12",
      },
    );

    expect(missingDate).toMatchObject({
      fechaVencimiento:
        "La fecha de vencimiento es obligatoria para esta categoria.",
    });
    expect(pastDate).toMatchObject({
      fechaVencimiento: "La fecha de vencimiento debe ser posterior a hoy.",
    });
  });
});
