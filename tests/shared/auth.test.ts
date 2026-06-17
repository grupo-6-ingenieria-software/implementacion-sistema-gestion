import { describe, expect, it } from 'vitest';
import {
  LOCKOUT_MS,
  evaluateLockout,
  formatRemainingLockout,
  isValidUsernameFormat,
  validatePasswordComplexity,
  type LoginAttempt,
} from '../../src/shared/auth';

const BASE = Date.parse('2026-06-13T10:00:00.000Z');

function at(offsetMs: number): string {
  return new Date(BASE + offsetMs).toISOString();
}

function failuresEvery(count: number, stepMs = 1000): LoginAttempt[] {
  return Array.from({ length: count }, (_unused, index) => ({
    exitoso: false,
    fechaHora: at(index * stepMs),
  }));
}

describe('validatePasswordComplexity', () => {
  it('accepts a password with upper, lower and digit and 8+ chars', () => {
    expect(validatePasswordComplexity('Huascar2026').valid).toBe(true);
  });

  it('rejects passwords shorter than 8 characters', () => {
    expect(validatePasswordComplexity('Ab1cd').valid).toBe(false);
  });

  it('rejects passwords without an uppercase letter', () => {
    expect(validatePasswordComplexity('huascar2026').valid).toBe(false);
  });

  it('rejects passwords without a lowercase letter', () => {
    expect(validatePasswordComplexity('HUASCAR2026').valid).toBe(false);
  });

  it('rejects passwords without a digit', () => {
    expect(validatePasswordComplexity('HuascarHuascar').valid).toBe(false);
  });
});

describe('isValidUsernameFormat', () => {
  it('accepts a username without spaces under 50 chars', () => {
    expect(isValidUsernameFormat('12345678-9')).toBe(true);
  });

  it('rejects usernames with spaces', () => {
    expect(isValidUsernameFormat('mi usuario')).toBe(false);
  });

  it('rejects empty usernames', () => {
    expect(isValidUsernameFormat('')).toBe(false);
  });

  it('rejects usernames longer than 50 characters', () => {
    expect(isValidUsernameFormat('a'.repeat(51))).toBe(false);
  });
});

describe('evaluateLockout', () => {
  it('is not locked with no attempts', () => {
    expect(evaluateLockout([], BASE)).toEqual({
      locked: false,
      remainingMs: 0,
      failedCount: 0,
    });
  });

  it('is not locked with 4 consecutive failures', () => {
    const state = evaluateLockout(failuresEvery(4), BASE + 5000);
    expect(state.locked).toBe(false);
    expect(state.failedCount).toBe(4);
  });

  it('locks after 5 consecutive failures within the window', () => {
    const failures = failuresEvery(5);
    const state = evaluateLockout(failures, BASE + 5000);
    expect(state.locked).toBe(true);
    expect(state.remainingMs).toBeGreaterThan(0);
  });

  it('unlocks once the 15 minute window elapsed since the 5th failure', () => {
    const failures = failuresEvery(5);
    const state = evaluateLockout(failures, BASE + LOCKOUT_MS + 10_000);
    expect(state.locked).toBe(false);
    expect(state.failedCount).toBe(0);
  });

  it('counts only failures after the last successful login', () => {
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

describe('formatRemainingLockout', () => {
  it('rounds up to whole minutes', () => {
    expect(formatRemainingLockout(61_000)).toBe('2 minutos');
  });

  it('uses singular for one minute or less', () => {
    expect(formatRemainingLockout(30_000)).toBe('1 minuto');
  });
});
