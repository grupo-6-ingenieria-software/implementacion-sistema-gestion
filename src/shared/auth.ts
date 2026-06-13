/**
 * Reglas compartidas de autenticación (RF55, RF56, RF58).
 *
 * Este módulo es seguro para el renderer: no importa APIs de Node. Contiene
 * constantes, validadores puros y el cálculo de bloqueo por intentos fallidos
 * que también usa el proceso main. La generación de contraseñas temporales y la
 * firma de JWT viven en el proceso main (requieren node:crypto / jsonwebtoken).
 */

export const MAX_LOGIN_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;
export const INACTIVITY_MINUTES = 30;
export const TEMP_PASSWORD_HOURS = 24;
export const TEMP_PASSWORD_LENGTH = 8;

export const LOCKOUT_MS = LOCKOUT_MINUTES * 60 * 1000;
export const INACTIVITY_MS = INACTIVITY_MINUTES * 60 * 1000;
export const TEMP_PASSWORD_MS = TEMP_PASSWORD_HOURS * 60 * 60 * 1000;

export const USERNAME_MAX_LENGTH = 50;
export const PASSWORD_MIN_LENGTH = 8;

/** Mensaje genérico exigido por RF55: no revela cuál campo es el incorrecto. */
export const GENERIC_LOGIN_ERROR = 'Usuario o contraseña incorrectos';
/** Mensaje exigido por RF55 al expirar la sesión por inactividad. */
export const SESSION_EXPIRED_MESSAGE = 'Su sesión ha expirado por inactividad';
/** Canal IPC push (webContents.send) para avisar expiración de sesión. */
export const SESSION_EXPIRED_EVENT = 'session:expirada';

export type PasswordComplexityResult = {
  valid: boolean;
  message?: string;
};

/**
 * Valida la complejidad de contraseña exigida por RF55: mínimo 8 caracteres,
 * al menos una mayúscula, una minúscula y un número.
 */
export function validatePasswordComplexity(
  password: unknown,
): PasswordComplexityResult {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    return {
      valid: false,
      message: `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`,
    };
  }

  if (!/[A-Z]/.test(password)) {
    return {
      valid: false,
      message: 'La contraseña debe incluir al menos una letra mayúscula.',
    };
  }

  if (!/[a-z]/.test(password)) {
    return {
      valid: false,
      message: 'La contraseña debe incluir al menos una letra minúscula.',
    };
  }

  if (!/[0-9]/.test(password)) {
    return {
      valid: false,
      message: 'La contraseña debe incluir al menos un número.',
    };
  }

  return { valid: true };
}

/**
 * Valida el formato del nombre de usuario exigido por RF55: texto sin espacios,
 * máximo 50 caracteres y no vacío.
 */
export function isValidUsernameFormat(usuario: unknown): usuario is string {
  return (
    typeof usuario === 'string' &&
    usuario.length > 0 &&
    usuario.length <= USERNAME_MAX_LENGTH &&
    !/\s/.test(usuario)
  );
}

export type LoginAttempt = {
  exitoso: boolean;
  fechaHora: string;
};

export type LockoutState = {
  /** Verdadero si la cuenta está bloqueada en este instante. */
  locked: boolean;
  /** Milisegundos restantes de bloqueo (0 si no está bloqueada). */
  remainingMs: number;
  /** Intentos fallidos vigentes acumulados (tras descartar bloqueos vencidos). */
  failedCount: number;
};

/**
 * Determina el estado de bloqueo por intentos fallidos (RF55).
 *
 * Regla: tras 5 intentos fallidos consecutivos la cuenta se bloquea 15 minutos.
 * El contador se reinicia tras un inicio de sesión exitoso o una vez transcurrido
 * el período de bloqueo de 15 minutos.
 *
 * @param attempts Todos los intentos del usuario (exitosos y fallidos).
 * @param nowMs    Instante actual en milisegundos.
 */
export function evaluateLockout(
  attempts: readonly LoginAttempt[],
  nowMs: number,
): LockoutState {
  const sorted = [...attempts].sort(
    (a, b) => toMs(a.fechaHora) - toMs(b.fechaHora),
  );

  const lastSuccessMs = sorted
    .filter((attempt) => attempt.exitoso)
    .reduce((latest, attempt) => Math.max(latest, toMs(attempt.fechaHora)), -1);

  // Solo cuentan los fallos posteriores al último login exitoso.
  let failures = sorted
    .filter((attempt) => !attempt.exitoso && toMs(attempt.fechaHora) > lastSuccessMs)
    .map((attempt) => toMs(attempt.fechaHora));

  // Descartar bloqueos ya vencidos: cada vez que se acumulan 5 fallos y el
  // bloqueo expiró, esos fallos se reinician.
  while (failures.length >= MAX_LOGIN_ATTEMPTS) {
    const triggerMs = failures[MAX_LOGIN_ATTEMPTS - 1];
    const unlockMs = triggerMs + LOCKOUT_MS;

    if (nowMs < unlockMs) {
      return {
        locked: true,
        remainingMs: unlockMs - nowMs,
        failedCount: failures.length,
      };
    }

    failures = failures.slice(MAX_LOGIN_ATTEMPTS);
  }

  return { locked: false, remainingMs: 0, failedCount: failures.length };
}

/** Formatea milisegundos restantes como texto legible para el usuario. */
export function formatRemainingLockout(remainingMs: number): string {
  const totalMinutes = Math.ceil(remainingMs / 60000);

  if (totalMinutes <= 1) {
    return '1 minuto';
  }

  return `${totalMinutes} minutos`;
}

function toMs(fechaHora: string): number {
  const parsed = Date.parse(fechaHora);
  return Number.isNaN(parsed) ? 0 : parsed;
}
