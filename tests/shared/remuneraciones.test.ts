import { describe, expect, it } from "vitest";
import {
  calculateRemuneracion,
  hasRemuneracionFieldErrors,
  normalizeRemuneracionCreatePayload,
  normalizeRemuneracionPeriodoPayload,
  roundToNearestPeso,
  validateRemuneracionCreatePayload,
  validateRemuneracionPeriodo,
} from "../../src/shared/remuneraciones";

describe("remuneraciones shared module", () => {
  it("rounds each discount half up to the nearest peso", () => {
    expect(roundToNearestPeso(100.5)).toBe(101);
    expect(roundToNearestPeso(100.49)).toBe(100);
    expect(roundToNearestPeso(0.5)).toBe(1);
  });

  it("calculates discounts and net pay with the RF34 default rates", () => {
    const result = calculateRemuneracion(500000, [
      { tipo: "afp", porcentaje: 11.5 },
      { tipo: "salud", porcentaje: 7 },
      { tipo: "cesantia", porcentaje: 0.6 },
    ]);

    expect(result.descuentos).toEqual([
      { tipo: "afp", porcentaje: 11.5, monto: 57500 },
      { tipo: "salud", porcentaje: 7, monto: 35000 },
      { tipo: "cesantia", porcentaje: 0.6, monto: 3000 },
    ]);
    expect(result.montoLiquido).toBe(500000 - 57500 - 35000 - 3000);
  });

  it("normalizes text payloads into numeric fields", () => {
    expect(
      normalizeRemuneracionCreatePayload({
        usuarioId: "dueno",
        trabajadorId: "2",
        mes: "6",
        anio: "2026",
        montoBruto: "500000",
        observacion: "  turno extra  ",
      }),
    ).toEqual({
      usuarioId: "dueno",
      trabajadorId: 2,
      mes: 6,
      anio: 2026,
      montoBruto: 500000,
      observacion: "turno extra",
    });
  });

  it("rejects invalid periods and non positive gross amounts", () => {
    const errors = validateRemuneracionCreatePayload({
      trabajadorId: 0,
      mes: 13,
      anio: 1999,
      montoBruto: 0,
    });

    expect(hasRemuneracionFieldErrors(errors)).toBe(true);
    expect(errors.trabajadorId).toBeDefined();
    expect(errors.mes).toBeDefined();
    expect(errors.anio).toBeDefined();
    expect(errors.montoBruto).toBeDefined();
  });

  it("accepts a valid payload", () => {
    const errors = validateRemuneracionCreatePayload({
      trabajadorId: 2,
      mes: 6,
      anio: 2026,
      montoBruto: 500000,
    });

    expect(hasRemuneracionFieldErrors(errors)).toBe(false);
  });

  it("normalizes and validates a period payload independently of trabajador/bruto", () => {
    const normalized = normalizeRemuneracionPeriodoPayload({
      usuarioId: "dueno",
      mes: "13",
      anio: "2026",
    });

    expect(normalized).toEqual({ usuarioId: "dueno", mes: 13, anio: 2026 });

    const errors = validateRemuneracionPeriodo(normalized);
    expect(errors.mes).toBeDefined();
    expect(errors.anio).toBeUndefined();
  });
});
