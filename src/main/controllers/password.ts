/**
 * PasswordHandler — Cambio y restablecimiento de contraseña (RF55, RF58, CU56b).
 *
 * Canales:
 *  - auth:cambiar-password      Cambio obligatorio/voluntario por el propio usuario.
 *  - auth:restablecer-password  El dueño genera una temporal de 24h para otro usuario.
 */

import { randomInt } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { controllers, type ControllerResponse } from '../../shared/controllers';
import {
  TEMP_PASSWORD_LENGTH,
  TEMP_PASSWORD_MS,
  validatePasswordComplexity,
} from '../../shared/auth';
import { db, schema as appSchema } from '../../db/client';
import {
  controllerError,
  controllerSuccess,
  type RegisteredController,
} from './base';
import {
  AccessDeniedError,
  authorizeUser,
  registerAuditLog,
} from './auth-context';

type SchemaLike = typeof import('../../db/schema');
type PasswordExecutor = Pick<typeof db, 'select' | 'insert'>;
type TempPasswordExecutor = Pick<typeof db, 'insert'>;

const TEMP_PASSWORD_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export type PasswordDeps = {
  hashPassword: (plain: string) => Promise<string>;
  comparePassword: (plain: string, hash: string) => Promise<boolean>;
  generateTempPassword: () => string;
  now: () => Date;
};

export const defaultDeps: PasswordDeps = {
  hashPassword: (plain) => bcrypt.hash(plain, 10),
  comparePassword: (plain, hash) => bcrypt.compare(plain, hash),
  generateTempPassword: generateTemporaryPassword,
  now: () => new Date(),
};

/**
 * Genera y persiste una contraseña temporal de 24h (contrasena + contrasena_temporal)
 * para `usuarioId`, dejando registro de quién la generó. Devuelve la contraseña en
 * texto plano para mostrarla una sola vez. Reutilizable dentro de una transacción
 * (alta de trabajador) o con la conexión directa (restablecimiento por el dueño).
 */
export async function createTemporaryPasswordRecord(
  executor: TempPasswordExecutor,
  schema: SchemaLike,
  params: { usuarioId: string; generadaPorUsuarioId: string },
  deps: PasswordDeps = defaultDeps,
): Promise<string> {
  const temporal = deps.generateTempPassword();
  const hash = await deps.hashPassword(temporal);
  const now = deps.now();
  const expiracion = new Date(now.getTime() + TEMP_PASSWORD_MS).toISOString();

  const [created] = await executor
    .insert(schema.contrasena)
    .values({
      contrasenaHash: hash,
      contrasenaFechaHoraCreacion: now.toISOString(),
      esContrasenaTemporal: true,
      esContrasenaDefinitiva: false,
      usuarioId: params.usuarioId,
      generadaPorUsuarioId: params.generadaPorUsuarioId,
    })
    .returning({ contrasenaId: schema.contrasena.contrasenaId });

  await executor.insert(schema.contrasenaTemporal).values({
    contrasenaId: created.contrasenaId,
    contrasenaTemporalFechaHoraExpiracion: expiracion,
  });

  return temporal;
}

export type ChangePasswordPayload = {
  usuarioId?: string;
  contrasenaActual?: string;
  contrasenaNueva?: string;
};

export type ResetPasswordPayload = {
  usuarioId?: string;
  usuarioObjetivoId?: string;
};

export async function changePasswordWithExecutor(
  database: PasswordExecutor,
  schema: SchemaLike,
  payload: unknown,
  deps: PasswordDeps = defaultDeps,
): Promise<ControllerResponse<{ cambiada: true }>> {
  const input = payload as ChangePasswordPayload | null;
  const usuarioId = normalizeText(input?.usuarioId);
  const actual =
    typeof input?.contrasenaActual === 'string' ? input.contrasenaActual : '';
  const nueva =
    typeof input?.contrasenaNueva === 'string' ? input.contrasenaNueva : '';

  if (!usuarioId || !nueva) {
    return controllerError(
      'VALIDATION_ERROR',
      'Ingrese la nueva contraseña.',
      'password',
    );
  }

  try {
    const user = await authorizeUser(database, schema, usuarioId, [
      'dueno',
      'trabajador',
    ]);

    const [vigente] = await database
      .select({
        contrasenaHash: schema.contrasena.contrasenaHash,
        esContrasenaTemporal: schema.contrasena.esContrasenaTemporal,
      })
      .from(schema.contrasena)
      .where(eq(schema.contrasena.usuarioId, user.usuarioId))
      .orderBy(desc(schema.contrasena.contrasenaFechaHoraCreacion))
      .limit(1);

    if (!vigente) {
      return controllerError(
        'NOT_FOUND',
        'El usuario no tiene una contraseña registrada.',
        'password',
      );
    }

    // En el cambio obligatorio tras login con contraseña temporal el usuario ya
    // demostró conocerla al autenticarse, así que no se vuelve a pedir la actual.
    // Solo el cambio voluntario (contraseña definitiva vigente) la exige.
    if (!vigente.esContrasenaTemporal) {
      if (!actual) {
        return controllerError(
          'VALIDATION_ERROR',
          'Ingrese la contraseña actual y la nueva contraseña.',
          'password',
        );
      }

      const actualOk = await deps.comparePassword(actual, vigente.contrasenaHash);

      if (!actualOk) {
        return controllerError(
          'VALIDATION_ERROR',
          'La contraseña actual es incorrecta.',
          'password',
        );
      }
    }

    const complexity = validatePasswordComplexity(nueva);

    if (!complexity.valid) {
      return controllerError(
        'VALIDATION_ERROR',
        complexity.message ?? 'La nueva contraseña no cumple los requisitos.',
        'password',
      );
    }

    const sameAsCurrent = await deps.comparePassword(
      nueva,
      vigente.contrasenaHash,
    );

    if (sameAsCurrent) {
      return controllerError(
        'BUSINESS_RULE',
        'La nueva contraseña debe ser distinta de la actual.',
        'password',
      );
    }

    const hash = await deps.hashPassword(nueva);

    await database.insert(schema.contrasena).values({
      contrasenaHash: hash,
      contrasenaFechaHoraCreacion: deps.now().toISOString(),
      esContrasenaTemporal: false,
      esContrasenaDefinitiva: true,
      usuarioId: user.usuarioId,
      generadaPorUsuarioId: user.usuarioId,
    });

    await registerAuditLog(database, schema, {
      descripcion: `Cambio de contraseña de ${user.trabajadorNombre}.`,
      modulo: 'autenticacion',
      tipoAccion: 'cambio_password',
      usuarioId: user.usuarioId,
    });

    return controllerSuccess({ cambiada: true });
  } catch (error) {
    return mapPasswordError(error);
  }
}

export async function resetPasswordWithExecutor(
  database: PasswordExecutor,
  schema: SchemaLike,
  payload: unknown,
  deps: PasswordDeps = defaultDeps,
): Promise<
  ControllerResponse<{ contrasenaTemporal: string; usuarioObjetivoId: string }>
> {
  const input = payload as ResetPasswordPayload | null;
  const solicitanteId = normalizeText(input?.usuarioId);
  const objetivoId = normalizeText(input?.usuarioObjetivoId);

  if (!solicitanteId || !objetivoId) {
    return controllerError(
      'VALIDATION_ERROR',
      'Seleccione el usuario al que desea restablecer la contraseña.',
      'password',
    );
  }

  try {
    // Solo el dueño puede restablecer contraseñas de otros usuarios (RF58).
    const solicitante = await authorizeUser(database, schema, solicitanteId, [
      'dueno',
    ]);

    const [objetivo] = await database
      .select({ usuarioId: schema.usuario.usuarioId })
      .from(schema.usuario)
      .where(eq(schema.usuario.usuarioId, objetivoId))
      .limit(1);

    if (!objetivo) {
      return controllerError(
        'NOT_FOUND',
        'El usuario seleccionado no existe.',
        'password',
      );
    }

    const temporal = await createTemporaryPasswordRecord(
      database,
      schema,
      {
        usuarioId: objetivo.usuarioId,
        generadaPorUsuarioId: solicitante.usuarioId,
      },
      deps,
    );

    await registerAuditLog(database, schema, {
      descripcion: `Restablecimiento de contraseña para el usuario ${objetivo.usuarioId}.`,
      modulo: 'administracion',
      tipoAccion: 'restablecer_password',
      usuarioId: solicitante.usuarioId,
    });

    return controllerSuccess({
      contrasenaTemporal: temporal,
      usuarioObjetivoId: objetivo.usuarioId,
    });
  } catch (error) {
    return mapPasswordError(error);
  }
}

export function generateTemporaryPassword(): string {
  let result = '';

  for (let index = 0; index < TEMP_PASSWORD_LENGTH; index += 1) {
    result += TEMP_PASSWORD_ALPHABET[randomInt(TEMP_PASSWORD_ALPHABET.length)];
  }

  return result;
}

function mapPasswordError(error: unknown): ControllerResponse<never> {
  if (error instanceof AccessDeniedError) {
    return controllerError('FORBIDDEN', error.message, 'password');
  }

  return controllerError(
    'DATABASE_ERROR',
    'No fue posible procesar la contraseña. Intente nuevamente.',
    'password',
  );
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export function createPasswordController(
  deps: Partial<PasswordDeps> = {},
): RegisteredController {
  const resolved: PasswordDeps = { ...defaultDeps, ...deps };

  return {
    metadata: controllers[1],
    handle: async (payload, context) => {
      if (context.channel === 'auth:cambiar-password') {
        return changePasswordWithExecutor(db, appSchema, payload, resolved);
      }

      if (context.channel === 'auth:restablecer-password') {
        return resetPasswordWithExecutor(db, appSchema, payload, resolved);
      }

      return controllerError(
        'INVALID_CHANNEL',
        `Canal IPC no registrado: ${context.channel}`,
        'password',
      );
    },
  };
}

export const passwordController = createPasswordController();
