import { describe, expect, it } from "vitest";
import {
  hasWasteFieldErrors,
  normalizeWasteRegisterPayload,
  validateWasteRegisterPayload,
} from "../../src/shared/waste";

describe("helpers de merma", () => {
  it("normaliza los payloads de registro de merma", () => {
    expect(
      normalizeWasteRegisterPayload({
        ean13: " 7802920000015 ",
        cantidad: "4.9",
        motivo: " dano ",
        observacion: "  Envase quebrado  ",
        usuarioId: " 12345678-9 ",
      }),
    ).toEqual({
      ean13: "7802920000015",
      cantidad: 4.9,
      motivo: "dano",
      observacion: "Envase quebrado",
      usuarioId: "12345678-9",
    });
  });

  it("descarta observaciones vacías y motivos inválidos durante la normalización", () => {
    expect(
      normalizeWasteRegisterPayload({
        ean13: "7802920000015",
        cantidad: 1,
        motivo: "perdida",
        observacion: "   ",
      }),
    ).toMatchObject({
      motivo: "",
      observacion: undefined,
    });
  });

  it("valida campos obligatorios y límites de stock", () => {
    const errors = validateWasteRegisterPayload(
      {
        ean13: "780292",
        cantidad: 7,
        motivo: "",
        usuarioId: "",
      },
      { requireUser: true, stockDisponible: 3 },
    );

    expect(errors).toMatchObject({
      ean13: expect.any(String),
      cantidad: expect.stringContaining("stock disponible"),
      motivo: expect.any(String),
      usuarioId: expect.any(String),
    });
    expect(hasWasteFieldErrors(errors)).toBe(true);
  });

  it("rechaza cantidades no enteras en lugar de truncarlas", () => {
    const payload = normalizeWasteRegisterPayload({
      ean13: "7802920000015",
      cantidad: "4.9",
      motivo: "dano",
    });

    expect(validateWasteRegisterPayload(payload).cantidad).toBe(
      "La cantidad debe ser un entero mayor que 0.",
    );
  });

  it("acepta un payload válido con la observación opcional omitida", () => {
    expect(
      validateWasteRegisterPayload(
        {
          ean13: "7802920000015",
          cantidad: 2,
          motivo: "error_registro",
          usuarioId: "12345678-9",
        },
        { requireUser: true, stockDisponible: 2 },
      ),
    ).toEqual({});
  });
});
