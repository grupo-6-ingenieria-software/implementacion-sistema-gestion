/**
 * ControlAccesoMiddleware — Control de acceso por rol (RF56, CU57).
 *
 * Canal access:validate. Verifica el JWT, resuelve el rol y comprueba que la
 * ruta solicitada esté permitida para ese rol según el árbol de navegación.
 * Un intento sin permiso se audita como acceso_denegado y se redirige al
 * dashboard en el renderer.
 */

import { controllers, type ControllerResponse } from '../../shared/controllers';
import { findNavNodeByPath, type Role } from '../../shared/navigation';
import { db, schema as appSchema } from '../../db/client';
import {
  controllerError,
  controllerSuccess,
  type RegisteredController,
} from './base';
import { registerAuditLog } from './auth-context';
import { verifySessionToken, type SessionTokenClaims } from './auth-jwt';

type SchemaLike = typeof import('../../db/schema');
type AccessExecutor = Pick<typeof db, 'select' | 'insert'>;

export type ValidateAccessPayload = {
  token?: string;
  /** Token de sesión adjuntado por el preload en cada invoke. */
  __authToken?: string;
  ruta?: string;
};

export type ValidateAccessData = {
  allowed: boolean;
  role: Role;
};

export type AccessControlDeps = {
  verifyToken: (token: unknown) => SessionTokenClaims | null;
};

const defaultDeps: AccessControlDeps = {
  verifyToken: verifySessionToken,
};

export async function validateAccessWithExecutor(
  database: AccessExecutor,
  schema: SchemaLike,
  payload: unknown,
  deps: AccessControlDeps = defaultDeps,
): Promise<ControllerResponse<ValidateAccessData>> {
  const input = payload as ValidateAccessPayload | null;
  const ruta = typeof input?.ruta === 'string' ? input.ruta.trim() : '';

  // El token llega como `token` (llamadas directas/legadas en pruebas) o como
  // `__authToken` (adjuntado por el preload en cada invoke del renderer).
  const claims = deps.verifyToken(input?.token ?? input?.__authToken);

  if (!claims) {
    return controllerError(
      'FORBIDDEN',
      'No hay una sesión válida para validar el acceso.',
      'access-control',
    );
  }

  if (!ruta) {
    return controllerError(
      'VALIDATION_ERROR',
      'No se indicó la ruta a validar.',
      'access-control',
    );
  }

  const node = findNavNodeByPath(ruta);

  if (!node) {
    return controllerError(
      'NOT_FOUND',
      'La ruta solicitada no existe.',
      'access-control',
    );
  }

  const allowed = (node.roles as readonly Role[]).includes(claims.rol);

  if (!allowed) {
    await registerAuditLog(database, schema, {
      descripcion: `Acceso denegado a ${node.label} para el rol ${claims.rol}.`,
      modulo: 'control_acceso',
      tipoAccion: 'acceso_denegado',
      usuarioId: claims.usuarioId,
    });

    return controllerError(
      'FORBIDDEN',
      'No tiene permiso para acceder a este módulo.',
      'access-control',
    );
  }

  return controllerSuccess<ValidateAccessData>({
    allowed: true,
    role: claims.rol,
  });
}

export function createAccessControlController(
  deps: Partial<AccessControlDeps> = {},
): RegisteredController<ValidateAccessPayload, ValidateAccessData> {
  const resolved: AccessControlDeps = { ...defaultDeps, ...deps };

  return {
    metadata: controllers[2],
    handle: (payload) =>
      validateAccessWithExecutor(db, appSchema, payload, resolved),
  };
}

export const accessControlController = createAccessControlController();
