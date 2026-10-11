import { describe, expect, it } from "vitest";
import {
  LOCKOUT_MS,
  evaluateLockout,
  formatRemainingLockout,
  isValidUsernameFormat,
  validatePasswordComplexity,
  type LoginAttempt,
} from "../../src/shared/auth";

const BASE = Date.parse("2026-06-13T10:00:00.000Z");

function at(offsetMs: number): string {
  return new Date(BASE + offsetMs).toISOString();
}

function failuresEvery(count: number, stepMs = 1000): LoginAttempt[] {
  return Array.from({ length: count }, (_unused, index) => ({
    exitoso: false,
    fechaHora: at(index * stepMs),
  }));
}

describe("validatePasswordComplexity", () => {
  it("acepta una contraseña con mayúscula, minúscula y dígito, y 8 o más caracteres", () => {
    expect(validatePasswordComplexity("Huascar2026").valid).toBe(true);
  });

  it("rechaza contraseñas de menos de 8 caracteres", () => {
    expect(validatePasswordComplexity("Ab1cd").valid).toBe(false);
  });

  it("rechaza contraseñas sin letra mayúscula", () => {
    expect(validatePasswordComplexity("huascar2026").valid).toBe(false);
  });

  it("rechaza contraseñas sin letra minúscula", () => {
    expect(validatePasswordComplexity("HUASCAR2026").valid).toBe(false);
  });

  it("rechaza contraseñas sin dígito", () => {
    expect(validatePasswordComplexity("HuascarHuascar").valid).toBe(false);
  });
});

describe("isValidUsernameFormat", () => {
  it("acepta un nombre de usuario sin espacios y de menos de 50 caracteres", () => {
    expect(isValidUsernameFormat("12345678-9")).toBe(true);
  });

  it("rechaza nombres de usuario con espacios", () => {
    expect(isValidUsernameFormat("mi usuario")).toBe(false);
  });

  it("rechaza nombres de usuario vacíos", () => {
    expect(isValidUsernameFormat("")).toBe(false);
  });

  it("rechaza nombres de usuario de más de 50 caracteres", () => {
    expect(isValidUsernameFormat("a".repeat(51))).toBe(false);
  });
});

describe("evaluateLockout", () => {
  it("no queda bloqueado sin intentos", () => {
    expect(evaluateLockout([], BASE)).toEqual({
      locked: false,
      remainingMs: 0,
      failedCount: 0,
    });
  });

  it("no queda bloqueado con 4 fallos consecutivos", () => {
    const state = evaluateLockout(failuresEvery(4), BASE + 5000);
    expect(state.locked).toBe(false);
    expect(state.failedCount).toBe(4);
  });

  it("bloquea tras 5 fallos consecutivos dentro de la ventana", () => {
    const failures = failuresEvery(5);
    const state = evaluateLockout(failures, BASE + 5000);
    expect(state.locked).toBe(true);
    expect(state.remainingMs).toBeGreaterThan(0);
  });

  it("desbloquea cuando transcurre la ventana de 15 minutos desde el quinto fallo", () => {
    const failures = failuresEvery(5);
    const state = evaluateLockout(failures, BASE + LOCKOUT_MS + 10_000);
    expect(state.locked).toBe(false);
    expect(state.failedCount).toBe(0);
  });

  it("cuenta solo los fallos posteriores al último inicio de sesión exitoso", () => {
    const attempts: LoginAttempt[] = [
      ...failuresEvery(5),
      { exitoso: true, fechaHora: at(6000) },
      { exitoso: false, fechaHora: at(7000) },
    ];
    const state = evaluateLockout(attempts, BASE + 8000);
    expect(state.locked).toBe(false);
    expect(state.failedCount).toBe(1);
  });
});

describe("formatRemainingLockout", () => {
  it("redondea hacia arriba a minutos completos", () => {
    expect(formatRemainingLockout(61_000)).toBe("2 minutos");
  });

  it("usa singular para un minuto o menos", () => {
    expect(formatRemainingLockout(30_000)).toBe("1 minuto");
  });
});
