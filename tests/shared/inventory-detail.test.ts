import { describe, expect, it } from "vitest";
import {
  normalizeStockAdjustmentPayload,
  validateStockAdjustmentPayload,
  hasStockAdjustmentFieldErrors,
  normalizeMovementHistoryFilters,
  movementTypeLabels,
} from "../../src/shared/inventory-detail";

describe("stock adjustment payload normalization", () => {
  it("normalizes a valid payload", () => {
    const result = normalizeStockAdjustmentPayload({
      ean13: "  7802920000015  ",
      loteId: " lote-abc ",
      cantidad: 5,
      justificacion: "  Ajuste por conteo fisico  ",
      usuarioId: " user-1 ",
    });

    expect(result).toEqual({
      ean13: "7802920000015",
      loteId: "lote-abc",
      cantidad: 5,
      justificacion: "Ajuste por conteo fisico",
      usuarioId: "user-1",
    });
  });

  it("returns defaults for null or undefined payload", () => {
    expect(normalizeStockAdjustmentPayload(null)).toEqual({
      ean13: "",
      loteId: "",
      cantidad: NaN,
      justificacion: "",
      usuarioId: undefined,
    });

    expect(normalizeStockAdjustmentPayload(undefined)).toEqual({
      ean13: "",
      loteId: "",
      cantidad: NaN,
      justificacion: "",
      usuarioId: undefined,
    });
  });

  it("truncates justificacion to 200 characters", () => {
    const longText = "A".repeat(250);
    const result = normalizeStockAdjustmentPayload({
      ean13: "7802920000015",
      loteId: "lote-1",
      cantidad: 1,
      justificacion: longText,
    });

    expect(result.justificacion).toHaveLength(200);
  });

  it("parses cantidad from string", () => {
    const result = normalizeStockAdjustmentPayload({
      ean13: "7802920000015",
      loteId: "lote-1",
      cantidad: "3",
      justificacion: "test",
    });

    expect(result.cantidad).toBe(3);
  });

  it("returns NaN for non-numeric cantidad", () => {
    const result = normalizeStockAdjustmentPayload({
      ean13: "7802920000015",
      loteId: "lote-1",
      cantidad: "abc",
      justificacion: "test",
    });

    expect(Number.isNaN(result.cantidad)).toBe(true);
  });
});

describe("stock adjustment payload validation", () => {
  it("returns no errors for a valid payload", () => {
    const errors = validateStockAdjustmentPayload({
      ean13: "7802920000015",
      loteId: "lote-abc",
      cantidad: -3,
      justificacion: "Ajuste por conteo fisico",
    });

    expect(errors).toEqual({});
    expect(hasStockAdjustmentFieldErrors(errors)).toBe(false);
  });

  it("rejects an invalid EAN-13", () => {
    const errors = validateStockAdjustmentPayload({
      ean13: "123",
      loteId: "lote-1",
      cantidad: 1,
      justificacion: "test",
    });

    expect(errors.ean13).toBeDefined();
    expect(hasStockAdjustmentFieldErrors(errors)).toBe(true);
  });

  it("rejects an empty loteId", () => {
    const errors = validateStockAdjustmentPayload({
      ean13: "7802920000015",
      loteId: "",
      cantidad: 1,
      justificacion: "test",
    });

    expect(errors.loteId).toBeDefined();
  });

  it("rejects cantidad zero", () => {
    const errors = validateStockAdjustmentPayload({
      ean13: "7802920000015",
      loteId: "lote-1",
      cantidad: 0,
      justificacion: "test",
    });

    expect(errors.cantidad).toBeDefined();
  });

  it("rejects non-integer cantidad", () => {
    const errors = validateStockAdjustmentPayload({
      ean13: "7802920000015",
      loteId: "lote-1",
      cantidad: 2.5,
      justificacion: "test",
    });

    expect(errors.cantidad).toBeDefined();
  });

  it("rejects empty justificacion", () => {
    const errors = validateStockAdjustmentPayload({
      ean13: "7802920000015",
      loteId: "lote-1",
      cantidad: 1,
      justificacion: "",
    });

    expect(errors.justificacion).toBeDefined();
  });

  it("reports all field errors simultaneously", () => {
    const errors = validateStockAdjustmentPayload({
      ean13: "",
      loteId: "",
      cantidad: 0,
      justificacion: "",
    });

    expect(Object.keys(errors)).toHaveLength(4);
  });
});

describe("movement history filters normalization", () => {
  it("returns defaults for empty payload", () => {
    const result = normalizeMovementHistoryFilters({});

    expect(result).toEqual({
      ean13: undefined,
      fechaDesde: undefined,
      fechaHasta: undefined,
      tipo: undefined,
      loteId: undefined,
      page: 1,
      pageSize: 50,
      usuarioId: undefined,
    });
  });

  it("normalizes valid filters", () => {
    const result = normalizeMovementHistoryFilters({
      ean13: " 7802920000015 ",
      fechaDesde: "2026-01-01",
      fechaHasta: "2026-12-31",
      tipo: "merma",
      loteId: " lote-abc ",
      page: 2,
      pageSize: 25,
      usuarioId: " user-1 ",
    });

    expect(result).toEqual({
      ean13: "7802920000015",
      fechaDesde: "2026-01-01",
      fechaHasta: "2026-12-31",
      tipo: "merma",
      loteId: "lote-abc",
      page: 2,
      pageSize: 25,
      usuarioId: "user-1",
    });
  });

  it("caps pageSize at 100", () => {
    const result = normalizeMovementHistoryFilters({ pageSize: 500 });
    expect(result.pageSize).toBe(100);
  });

  it("defaults page to 1 for invalid values", () => {
    expect(normalizeMovementHistoryFilters({ page: 0 }).page).toBe(1);
    expect(normalizeMovementHistoryFilters({ page: -1 }).page).toBe(1);
    expect(normalizeMovementHistoryFilters({ page: 1.5 }).page).toBe(1);
  });

  it("ignores invalid date formats", () => {
    const result = normalizeMovementHistoryFilters({
      fechaDesde: "01/01/2026",
      fechaHasta: "not-a-date",
    });

    expect(result.fechaDesde).toBeUndefined();
    expect(result.fechaHasta).toBeUndefined();
  });

  it("ignores invalid movement type", () => {
    const result = normalizeMovementHistoryFilters({
      tipo: "tipo_invalido",
    });

    expect(result.tipo).toBeUndefined();
  });

  it("accepts all valid movement types", () => {
    for (const tipo of Object.keys(movementTypeLabels)) {
      const result = normalizeMovementHistoryFilters({ tipo });
      expect(result.tipo).toBe(tipo);
    }
  });

  it("ignores empty strings for optional filters", () => {
    const result = normalizeMovementHistoryFilters({
      ean13: "  ",
      loteId: "",
    });

    expect(result.ean13).toBeUndefined();
    expect(result.loteId).toBeUndefined();
  });
});
