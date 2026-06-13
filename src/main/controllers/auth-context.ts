import { and, desc, eq, isNull } from 'drizzle-orm';
import { getAuditTimestamp } from '../../shared/audit';
import type { Role } from '../../shared/navigation';

export type AuthenticatedUser = {
  role: Role;
  trabajadorNombre: string;
  usuarioId: string;
  usuarioRol: string;
};

export class AccessDeniedError extends Error {
  constructor(message = 'No tiene permiso para realizar esta accion.') {
    super(message);
  }
}

export async function authorizeUser(
  executor: ExecutorLike,
  schema: SchemaLike,
  usuarioId: string | undefined,
  allowedRoles: readonly Role[],
): Promise<AuthenticatedUser> {
  if (!usuarioId?.trim()) {
    throw new AccessDeniedError('No hay un usuario autenticado para esta accion.');
  }

  const [user] = await executor
    .select({
      usuarioId: schema.usuario.usuarioId,
      usuarioRol: schema.usuario.usuarioRol,
      trabajadorNombre: schema.trabajador.trabajadorNombre,
      trabajadorApellido: schema.trabajador.trabajadorApellido,
      trabajadorEstado: schema.trabajador.trabajadorEstado,
    })
    .from(schema.usuario)
    .innerJoin(
      schema.trabajador,
      eq(schema.trabajador.trabajadorId, schema.usuario.trabajadorId),
    )
    .where(eq(schema.usuario.usuarioId, usuarioId.trim()))
    .limit(1);

  if (!user || user.trabajadorEstado !== 'activo') {
    throw new AccessDeniedError('El usuario autenticado no esta activo o no existe.');
  }

  const role = mapDatabaseRoleToTechnicalRole(user.usuarioRol);

  if (!role || !allowedRoles.includes(role)) {
    throw new AccessDeniedError('No tiene permiso para realizar esta accion.');
  }

  return {
    role,
    usuarioId: user.usuarioId,
    usuarioRol: user.usuarioRol,
    trabajadorNombre:
      `${user.trabajadorNombre} ${user.trabajadorApellido}`.trim(),
  };
}

export async function registerAuditLog(
  executor: ExecutorLike,
  schema: SchemaLike,
  event: {
    descripcion: string;
    modulo: string;
    tipoAccion: string;
    usuarioId: string;
  },
): Promise<void> {
  const usuarioVersionId = await getOrCreateCurrentUserVersion(
    executor,
    schema,
    event.usuarioId,
  );

  await executor.insert(schema.logAuditoria).values({
    logFechaHora: getAuditTimestamp(),
    logTipoAccion: event.tipoAccion,
    logModulo: event.modulo,
    logDescripcion: event.descripcion,
    usuarioVersionId,
  });
}

export function mapDatabaseRoleToTechnicalRole(role: string): Role | null {
  const normalized = normalizeRole(role);

  if (normalized.includes('duen')) {
    return 'dueno';
  }

  if (normalized === 'cajero' || normalized === 'reponedor') {
    return 'trabajador';
  }

  return null;
}

async function getOrCreateCurrentUserVersion(
  executor: ExecutorLike,
  schema: SchemaLike,
  usuarioId: string,
): Promise<string> {
  const [existingVersion] = await executor
    .select({
      id: schema.usuarioVersion.usuarioVersionId,
    })
    .from(schema.usuarioVersion)
    .where(
      and(
        eq(schema.usuarioVersion.usuarioId, usuarioId),
        isNull(schema.usuarioVersion.usuarioVersionFechaHoraVigenciaHasta),
      ),
    )
    .orderBy(desc(schema.usuarioVersion.usuarioVersionFechaHoraVigenciaDesde))
    .limit(1);

  if (existingVersion) {
    return existingVersion.id;
  }

  const user = await authorizeUser(executor, schema, usuarioId, [
    'dueno',
    'trabajador',
  ]);

  const [createdVersion] = await executor
    .insert(schema.usuarioVersion)
    .values({
      usuarioVersionNombre: user.trabajadorNombre,
      usuarioVersionRol: toAuditRole(user),
      usuarioVersionFechaHoraVigenciaDesde: getAuditTimestamp(),
      usuarioId: user.usuarioId,
    })
    .returning({ id: schema.usuarioVersion.usuarioVersionId });

  return createdVersion.id;
}

function normalizeRole(role: string): string {
  return role
    .toLocaleLowerCase('es')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00c3\u00b1/g, 'n')
    .replace(/\u00c3\u0192\u00c2\u00b1/g, 'n');
}

function toAuditRole(
  user: AuthenticatedUser,
): 'due\u00f1o' | 'cajero' | 'reponedor' {
  if (user.role === 'dueno') {
    return 'due\u00f1o';
  }

  return user.usuarioRol === 'reponedor' ? 'reponedor' : 'cajero';
}

type SchemaLike = typeof import('../../db/schema');
type ExecutorLike = {
  insert: typeof import('../../db/client').db.insert;
  select: typeof import('../../db/client').db.select;
};
