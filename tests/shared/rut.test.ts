import { describe, expect, it } from "vitest";
import {
  calculateRutVerifier,
  canonicalizeRut,
  isValidChileanRut,
  isValidRut,
} from "../../src/shared/rut";

describe("utilidad compartida de RUT chileno", () => {
  it.each([
    ["12.345.678-5", "12345678-5"],
    [" 12 345 678 - 5 ", "12345678-5"],
    ["123456785", "12345678-5"],
    ["12.345.670-k", "12345670-K"],
  ])("canonicaliza RUT equivalente %s", (value, expected) => {
    expect(canonicalizeRut(value)).toBe(expected);
    expect(isValidChileanRut(value)).toBe(true);
  });

  it.each([
    "12345678-9",
    "123-4",
    "01234567-4",
    "12345678-X",
    "1-2-3-4-5-6-7-8-5",
  ])(
    "rechaza RUT inválido %s",
    (value) => {
      expect(canonicalizeRut(value)).toBe("");
      expect(isValidChileanRut(value)).toBe(false);
    },
  );

  it("calcula dígitos verificadores numéricos y K", () => {
    expect(calculateRutVerifier("12345678")).toBe("5");
    expect(calculateRutVerifier("12345670")).toBe("K");
  });

  it("mantiene el contrato histórico de validación de usuarios", () => {
    expect(isValidRut("12.345.678-5")).toBe(true);
    expect(isValidRut("123456785")).toBe(false);
  });
});
