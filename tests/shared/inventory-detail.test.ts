import { describe, expect, it } from "vitest";
import {
  normalizeStockAdjustmentPayload,
  validateStockAdjustmentPayload,
  hasStockAdjustmentFieldErrors,
  normalizeMovementHistoryFilters,
  movementTypeLabels,
} from "../../src/shared/inventory-detail";

describe("normalización del payload de ajuste de stock", () => {
  it("normaliza un payload válido", () => {
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

  it("devuelve valores por defecto para payload nulo o indefinido", () => {
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

  it("trunca justificacion a 200 caracteres", () => {
    const longText = "A".repeat(250);
    const result = normalizeStockAdjustmentPayload({
      ean13: "7802920000015",
      loteId: "lote-1",
      cantidad: 1,
      justificacion: longText,
    });

    expect(result.justificacion).toHaveLength(200);
  });

  it("convierte cantidad desde texto", () => {
    const result = normalizeStockAdjustmentPayload({
      ean13: "7802920000015",
      loteId: "lote-1",
      cantidad: "3",
      justificacion: "test",
    });

    expect(result.cantidad).toBe(3);
  });

  it("devuelve NaN para cantidad no numérica", () => {
    const result = normalizeStockAdjustmentPayload({
      ean13: "7802920000015",
      loteId: "lote-1",
      cantidad: "abc",
      justificacion: "test",
    });

    expect(Number.isNaN(result.cantidad)).toBe(true);
  });
});

describe("validación del payload de ajuste de stock", () => {
  it("no devuelve errores para un payload válido", () => {
    const errors = validateStockAdjustmentPayload({
      ean13: "7802920000015",
      loteId: "lote-abc",
      cantidad: -3,
      justificacion: "Ajuste por conteo fisico",
    });

    expect(errors).toEqual({});
    expect(hasStockAdjustmentFieldErrors(errors)).toBe(false);
  });

  it("rechaza un EAN-13 inválido", () => {
    const errors = validateStockAdjustmentPayload({
      ean13: "123",
      loteId: "lote-1",
      cantidad: 1,
      justificacion: "test",
    });

    expect(errors.ean13).toBeDefined();
    expect(hasStockAdjustmentFieldErrors(errors)).toBe(true);
  });

  it("rechaza un loteId vacío", () => {
    const errors = validateStockAdjustmentPayload({
      ean13: "7802920000015",
      loteId: "",
      cantidad: 1,
      justificacion: "test",
    });

    expect(errors.loteId).toBeDefined();
  });

  it("rechaza cantidad cero", () => {
    const errors = validateStockAdjustmentPayload({
      ean13: "7802920000015",
      loteId: "lote-1",
      cantidad: 0,
      justificacion: "test",
    });

    expect(errors.cantidad).toBeDefined();
  });

  it("rechaza cantidad no entera", () => {
    const errors = validateStockAdjustmentPayload({
      ean13: "7802920000015",
      loteId: "lote-1",
      cantidad: 2.5,
      justificacion: "test",
    });

    expect(errors.cantidad).toBeDefined();
  });

  it("rechaza justificacion vacía", () => {
    const errors = validateStockAdjustmentPayload({
      ean13: "7802920000015",
      loteId: "lote-1",
      cantidad: 1,
      justificacion: "",
    });

    expect(errors.justificacion).toBeDefined();
  });

  it("informa todos los errores de campo simultáneamente", () => {
    const errors = validateStockAdjustmentPayload({
      ean13: "",
      loteId: "",
      cantidad: 0,
      justificacion: "",
    });

    expect(Object.keys(errors)).toHaveLength(4);
  });
});

describe("normalización de filtros del historial de movimientos", () => {
  it("devuelve valores por defecto para payload vacío", () => {
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

  it("normaliza filtros válidos", () => {
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

  it("limita pageSize a 100", () => {
    const result = normalizeMovementHistoryFilters({ pageSize: 500 });
    expect(result.pageSize).toBe(100);
  });

  it("usa page 1 por defecto ante valores inválidos", () => {
    expect(normalizeMovementHistoryFilters({ page: 0 }).page).toBe(1);
    expect(normalizeMovementHistoryFilters({ page: -1 }).page).toBe(1);
    expect(normalizeMovementHistoryFilters({ page: 1.5 }).page).toBe(1);
  });

  it("ignora formatos de fecha inválidos", () => {
    const result = normalizeMovementHistoryFilters({
      fechaDesde: "01/01/2026",
      fechaHasta: "not-a-date",
    });

    expect(result.fechaDesde).toBeUndefined();
    expect(result.fechaHasta).toBeUndefined();
  });

  it("ignora tipo de movimiento inválido", () => {
    const result = normalizeMovementHistoryFilters({
      tipo: "tipo_invalido",
    });

    expect(result.tipo).toBeUndefined();
  });

  it("acepta todos los tipos de movimiento válidos", () => {
    for (const tipo of Object.keys(movementTypeLabels)) {
      const result = normalizeMovementHistoryFilters({ tipo });
      expect(result.tipo).toBe(tipo);
    }
  });

  it("ignora cadenas vacías en filtros opcionales", () => {
    const result = normalizeMovementHistoryFilters({
      ean13: "  ",
      loteId: "",
    });

    expect(result.ean13).toBeUndefined();
    expect(result.loteId).toBeUndefined();
  });
});
