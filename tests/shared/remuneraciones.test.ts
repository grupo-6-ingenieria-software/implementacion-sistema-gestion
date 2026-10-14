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

describe("módulo compartido de remuneraciones", () => {
  it("interpreta miles del bruto sin truncar importes inválidos", () => {
    expect(normalizeRemuneracionCreatePayload({ montoBruto: "500.000" }).montoBruto).toBe(500000);
    expect(normalizeRemuneracionCreatePayload({ montoBruto: "500.99" }).montoBruto).toBeNaN();
    expect(normalizeRemuneracionCreatePayload({ montoBruto: 500.99 }).montoBruto).toBeNaN();
  });
  it("redondea cada descuento al peso más cercano, con mitad hacia arriba", () => {
    expect(roundToNearestPeso(100.5)).toBe(101);
    expect(roundToNearestPeso(100.49)).toBe(100);
    expect(roundToNearestPeso(0.5)).toBe(1);
    expect(roundToNearestPeso(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("rechaza una suma previsional fuera de rango aunque sus descuentos sean seguros", () => {
    expect(() => calculateRemuneracion(Number.MAX_SAFE_INTEGER, [
      { tipo: "afp", porcentaje: 100 },
      { tipo: "salud", porcentaje: 100 },
    ])).toThrow("rango permitido");
  });

  it("calcula descuentos y sueldo líquido con las tasas por defecto de RF34", () => {
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

  it("normaliza payloads de texto a campos numéricos", () => {
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

  it("rechaza periodos inválidos y montos brutos no positivos", () => {
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

  it("acepta un payload válido", () => {
    const errors = validateRemuneracionCreatePayload({
      trabajadorId: 2,
      mes: 6,
      anio: 2026,
      montoBruto: 500000,
    });

    expect(hasRemuneracionFieldErrors(errors)).toBe(false);
  });

  it("normaliza y valida un payload de periodo de forma independiente de trabajador/bruto", () => {
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
