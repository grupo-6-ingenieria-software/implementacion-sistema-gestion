import { describe, expect, it } from "vitest";
import { isValidEan13, normalizeEan13 } from "../../src/shared/ean13";

describe("helpers de ean13", () => {
  it("normaliza la entrada del lector a solo dígitos", () => {
    expect(normalizeEan13(" 780-2920000015\n")).toBe("7802920000015");
  });

  it("acepta 13 dígitos con dígito verificador módulo 10 correcto", () => {
    expect(isValidEan13("7802920000015")).toBe(true);
    expect(isValidEan13("7802345600012")).toBe(true);
    expect(isValidEan13("4006381333931")).toBe(true);
  });

  it("rechaza 13 dígitos con dígito verificador incorrecto", () => {
    expect(isValidEan13("7802920000017")).toBe(false);
    expect(isValidEan13("7800000000123")).toBe(false);
    expect(isValidEan13("4006381333930")).toBe(false);
  });

  it("rechaza valores incompletos, demasiado largos o no numéricos", () => {
    expect(isValidEan13("780292")).toBe(false);
    expect(isValidEan13("78029200000155")).toBe(false);
    expect(isValidEan13("780292000001a")).toBe(false);
  });
});
