/**
 * Emisión y verificación de JWT (RF55, RF56).
 *
 * Según la dimensión técnica (§4.2) la autenticación usa jsonwebtoken HS256 con
 * un secreto empaquetado en la aplicación: un token emitido es válido en
 * cualquier instancia local. El servidor no almacena la sesión en el token; la
 * tabla sesion_usuario lleva el control de inactividad (ver session.ts).
 */

import jwt from 'jsonwebtoken';
import type { Role } from '../../shared/navigation';

export type SessionTokenClaims = {
  usuarioId: string;
  rol: Role;
  usuarioRol: string;
  passwordTemporal: boolean;
  sesionId: string;
};

/**
 * Secreto del JWT. En producción se empaqueta vía variable de entorno
 * (JWT_SECRET) inyectada en el bundle; el valor por defecto sólo cubre el
 * entorno de desarrollo y pruebas.
 */
const JWT_SECRET = process.env.JWT_SECRET ?? 'huascar-dev-jwt-secret-change-me';

export function signSessionToken(claims: SessionTokenClaims): string {
  return jwt.sign(claims, JWT_SECRET, { algorithm: 'HS256' });
}

export function verifySessionToken(token: unknown): SessionTokenClaims | null {
  if (typeof token !== 'string' || token.length === 0) {
    return null;
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });

    if (typeof payload !== 'object' || payload === null) {
      return null;
    }

    const candidate = payload as Partial<SessionTokenClaims>;

    if (
      typeof candidate.usuarioId !== 'string' ||
      typeof candidate.sesionId !== 'string' ||
      (candidate.rol !== 'dueno' && candidate.rol !== 'trabajador') ||
      typeof candidate.usuarioRol !== 'string' ||
      typeof candidate.passwordTemporal !== 'boolean'
    ) {
      return null;
    }

    return {
      usuarioId: candidate.usuarioId,
      rol: candidate.rol,
      usuarioRol: candidate.usuarioRol,
      passwordTemporal: candidate.passwordTemporal,
      sesionId: candidate.sesionId,
    };
  } catch {
    return null;
  }
}
