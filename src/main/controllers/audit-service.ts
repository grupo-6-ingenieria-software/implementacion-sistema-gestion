import { sql, type SQL } from 'drizzle-orm';
import {
  normalizeAuditLogQueryPayload,
  type AuditLogEntry,
  type AuditLogQueryResponse,
  type AuditLogUserOption,
  type NormalizedAuditLogQuery,
} from '../../shared/audit';
import type { ControllerResponse } from '../../shared/controllers';
import * as appSchema from '../../db/schema';
import {
  AccessDeniedError,
  authorizeUser,
  registerAuditLog,
} from './auth-context';

type AuditRegisterPayload = {
  descripcion?: string;
  modulo?: string;
  tipoAccion?: string;
  usuarioId?: string;
};

type AuditDatabase = {
  all: <TRow = Record<string, unknown>>(query: SQL) => Promise<TRow[]>;
  insert: typeof import('../../db/client').db.insert;
  select: typeof import('../../db/client').db.select;
};

export async function registerAuditEvent(
  database: AuditDatabase,
  schema: typeof appSchema,
  payload: unknown,
): Promise<ControllerResponse<{ registrado: true }>> {
  const input = normalizeAuditRegisterPayload(payload);

  if (!input) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        controllerId: 'audit',
        message: 'Los datos de auditoria estan incompletos.',
      },
    };
  }

  try {
    const user = await authorizeUser(database, schema, input.usuarioId, [
      'dueno',
      'trabajador',
    ]);

    await registerAuditLog(database, schema, {
      descripcion: input.descripcion,
      modulo: input.modulo,
      tipoAccion: input.tipoAccion,
      usuarioId: user.usuarioId,
    });

    return { ok: true, data: { registrado: true } };
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      return {
        ok: false,
        error: {
          code: 'FORBIDDEN',
          controllerId: 'audit',
          message: error.message,
        },
      };
    }

    return {
      ok: false,
      error: {
        code: 'DATABASE_ERROR',
        controllerId: 'audit',
        message: 'No fue posible registrar la auditoria. Intente nuevamente.',
      },
    };
  }
}

export async function queryAuditLog(
  database: AuditDatabase,
  schema: typeof appSchema,
  payload: unknown,
): Promise<ControllerResponse<AuditLogQueryResponse>> {
  let query: NormalizedAuditLogQuery;

  try {
    query = normalizeAuditLogQueryPayload(payload);
  } catch (error) {
    if (error instanceof Error && 'fieldErrors' in error) {
      return {
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          controllerId: 'audit',
          fieldErrors: error.fieldErrors as Record<string, string>,
          message: error.message,
        },
      };
    }

    return {
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        controllerId: 'audit',
        message: 'Revise los filtros antes de consultar el log de auditoria.',
      },
    };
  }

  try {
    const user = await authorizeUser(database, schema, query.usuarioId, [
      'dueno',
      'trabajador',
    ]);

    if (user.role !== 'dueno') {
      await registerAuditLog(database, schema, {
        descripcion: `Intento denegado de consulta del log de auditoria por ${user.trabajadorNombre}.`,
        modulo: 'administracion',
        tipoAccion: 'acceso_denegado',
        usuarioId: user.usuarioId,
      });

      return {
        ok: false,
        error: {
          code: 'FORBIDDEN',
          controllerId: 'audit',
          message: 'No tiene permiso para consultar el log de auditoria.',
        },
      };
    }

    const result = await loadAuditLog(database, query);

    await registerAuditLog(database, schema, {
      descripcion: buildAuditQueryDescription(query, result.total),
      modulo: 'administracion',
      tipoAccion: 'consulta',
      usuarioId: user.usuarioId,
    });

    return { ok: true, data: result };
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      return {
        ok: false,
        error: {
          code: 'FORBIDDEN',
          controllerId: 'audit',
          message: error.message,
        },
      };
    }

    return {
      ok: false,
      error: {
        code: 'DATABASE_ERROR',
        controllerId: 'audit',
        message: 'No fue posible consultar el log de auditoria. Intente nuevamente.',
      },
    };
  }
}

async function loadAuditLog(
  database: AuditDatabase,
  query: NormalizedAuditLogQuery,
): Promise<AuditLogQueryResponse> {
  const where = buildWhereClause(query);
  const offset = (query.page - 1) * query.pageSize;
  const entries = await database.all<AuditLogEntry>(sql`
    SELECT
      la.log_auditoria_id AS id,
      la.log_fecha_hora AS fechaHora,
      la.log_tipo_accion AS tipoAccion,
      la.log_modulo AS modulo,
      la.log_descripcion AS descripcion,
      uv.usuario_id AS usuarioId,
      uv.usuario_version_nombre AS usuarioNombre,
      uv.usuario_version_rol AS rol
    FROM log_auditoria la
    INNER JOIN usuario_version uv
      ON uv.usuario_version_id = la.usuario_version_id
    ${where}
    ORDER BY datetime(la.log_fecha_hora) DESC, la.log_auditoria_id DESC
    LIMIT ${query.pageSize}
    OFFSET ${offset}
  `);
  const totalRows = await database.all<{ total: number }>(sql`
    SELECT COUNT(*) AS total
    FROM log_auditoria la
    INNER JOIN usuario_version uv
      ON uv.usuario_version_id = la.usuario_version_id
    ${where}
  `);
  const total = Number(totalRows[0]?.total ?? 0);
  const [usuarios, tiposAccion] = await Promise.all([
    loadUserOptions(database),
    loadActionTypes(database),
  ]);

  return {
    entries,
    filters: {
      tiposAccion,
      usuarios,
    },
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

async function loadUserOptions(
  database: AuditDatabase,
): Promise<AuditLogUserOption[]> {
  return database.all<AuditLogUserOption>(sql`
    SELECT
      uv.usuario_id AS id,
      uv.usuario_version_nombre AS nombre,
      uv.usuario_version_rol AS rol
    FROM usuario_version uv
    WHERE EXISTS (
      SELECT 1
      FROM log_auditoria la
      WHERE la.usuario_version_id = uv.usuario_version_id
    )
    GROUP BY uv.usuario_id, uv.usuario_version_nombre, uv.usuario_version_rol
    ORDER BY uv.usuario_version_nombre ASC
  `);
}

async function loadActionTypes(database: AuditDatabase): Promise<string[]> {
  const rows = await database.all<{ tipoAccion: string }>(sql`
    SELECT log_tipo_accion AS tipoAccion
    FROM log_auditoria
    GROUP BY log_tipo_accion
    ORDER BY log_tipo_accion ASC
  `);

  return rows.map((row) => row.tipoAccion);
}

function buildWhereClause(query: NormalizedAuditLogQuery): SQL {
  const conditions: SQL[] = [];

  if (query.usuarioFiltroId) {
    conditions.push(sql`uv.usuario_id = ${query.usuarioFiltroId}`);
  }

  if (query.tipoAccion) {
    conditions.push(sql`la.log_tipo_accion = ${query.tipoAccion}`);
  }

  if (query.fechaDesde) {
    conditions.push(
      sql`datetime(la.log_fecha_hora) >= datetime(${query.fechaDesde})`,
    );
  }

  if (query.fechaHasta) {
    conditions.push(
      sql`datetime(la.log_fecha_hora) <= datetime(${query.fechaHasta}, '+1 day', '-1 second')`,
    );
  }

  if (conditions.length === 0) {
    return sql``;
  }

  return sql`WHERE ${sql.join(conditions, sql` AND `)}`;
}

function buildAuditQueryDescription(
  query: NormalizedAuditLogQuery,
  total: number,
): string {
  const filters: string[] = [];

  if (query.usuarioFiltroId) {
    filters.push(`usuario ${query.usuarioFiltroId}`);
  }

  if (query.tipoAccion) {
    filters.push(`accion ${query.tipoAccion}`);
  }

  if (query.fechaDesde || query.fechaHasta) {
    filters.push(
      `fechas ${query.fechaDesde ?? 'inicio'} a ${query.fechaHasta ?? 'fin'}`,
    );
  }

  const filterText = filters.length > 0 ? filters.join(', ') : 'sin filtros';
  return `Consulta de log de auditoria pagina ${query.page} (${filterText}); ${total} registros coincidentes.`;
}

function normalizeAuditRegisterPayload(
  payload: unknown,
): Required<AuditRegisterPayload> | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const input = payload as AuditRegisterPayload;
  const usuarioId = normalizeRequiredText(input.usuarioId);
  const tipoAccion = normalizeRequiredText(input.tipoAccion);
  const modulo = normalizeRequiredText(input.modulo);
  const descripcion = normalizeRequiredText(input.descripcion);

  if (!usuarioId || !tipoAccion || !modulo || !descripcion) {
    return null;
  }

  return {
    descripcion,
    modulo,
    tipoAccion,
    usuarioId,
  };
}

function normalizeRequiredText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
