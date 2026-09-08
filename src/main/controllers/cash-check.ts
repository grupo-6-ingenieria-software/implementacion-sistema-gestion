import { randomUUID } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import { controllers } from '../../shared/controllers';
import { db } from '../../db/client';
import { controllerError, controllerSuccess, type RegisteredController } from './base';
import { getDashboardDay } from './dashboard-date';

type CashCheckResponse = {
  disponible: boolean;
  cierreCajaId: string;
};

export type CashCheckDb = {
  all: <TRow = Record<string, unknown>>(query: SQL) => Promise<TRow[]>;
  run: (query: SQL) => Promise<{ rowsAffected?: number }>;
};

export type DailyCashRegisterState =
  | { status: 'sin_registro' }
  | { status: 'abierta'; cierreCajaId: string; openedAt: string }
  | {
      status: 'cerrada';
      cierreCajaId: string;
      openedAt: string;
      closedAt: string;
      closedByUserId?: string;
      closedByName?: string;
    };

/** C20: obtiene el estado de caja correspondiente únicamente al día consultado. */
export async function inspectDailyCashRegister(
  database: Pick<CashCheckDb, 'all'>,
  now = new Date(),
): Promise<DailyCashRegisterState> {
  const { startUtc, endUtc } = getDashboardDay(now);
  const rows = await database.all<{
    cierreCajaId: string;
    status: 'abierto' | 'cerrado';
    openedAt: string;
    closedAt: string | null;
    closedByUserId: string | null;
    closedByName: string | null;
  }>(sql`
    SELECT
      c.cierre_caja_id AS cierreCajaId,
      c.cierre_estado AS status,
      c.cierre_fecha_hora_inicio AS openedAt,
      c.cierre_fecha_hora_fin AS closedAt,
      c.usuario_cierre_id AS closedByUserId,
      trim(t.trabajador_nombre || ' ' || t.trabajador_apellido) AS closedByName
    FROM cierre_caja c
    LEFT JOIN usuario u ON u.usuario_id = c.usuario_cierre_id
    LEFT JOIN trabajador t ON t.trabajador_id = u.trabajador_id
    WHERE datetime(c.cierre_fecha_hora_inicio) >= datetime(${startUtc})
      AND datetime(c.cierre_fecha_hora_inicio) < datetime(${endUtc})
    ORDER BY
      CASE WHEN c.cierre_estado = 'cerrado' THEN 1 ELSE 0 END DESC,
      datetime(c.cierre_fecha_hora_inicio) DESC
    LIMIT 1
  `);
  const row = rows[0];
  if (!row) return { status: 'sin_registro' };
  if (row.status === 'abierto') {
    return { status: 'abierta', cierreCajaId: row.cierreCajaId, openedAt: row.openedAt };
  }
  return {
    status: 'cerrada',
    cierreCajaId: row.cierreCajaId,
    openedAt: row.openedAt,
    closedAt: row.closedAt ?? row.openedAt,
    closedByUserId: row.closedByUserId ?? undefined,
    closedByName: row.closedByName ?? undefined,
  };
}

/** C20: abre la primera caja del día, pero nunca vuelve a abrir una caja cerrada. */
export async function ensureDailyCashRegisterForSale(
  database: CashCheckDb,
  now = new Date(),
): Promise<DailyCashRegisterState> {
  const state = await inspectDailyCashRegister(database, now);
  if (state.status !== 'sin_registro') return state;

  await database.run(sql`
    INSERT INTO cierre_caja (
      cierre_caja_id,
      cierre_fecha_hora_inicio,
      cierre_estado
    )
    SELECT ${randomUUID()}, ${now.toISOString()}, 'abierto'
    WHERE NOT EXISTS (
      SELECT 1 FROM cierre_caja
      WHERE datetime(cierre_fecha_hora_inicio) >= datetime(${getDashboardDay(now).startUtc})
        AND datetime(cierre_fecha_hora_inicio) < datetime(${getDashboardDay(now).endUtc})
    )
  `);

  return inspectDailyCashRegister(database, now);
}

export const cashCheckController: RegisteredController<unknown, CashCheckResponse> = {
  metadata: controllers[19],
  handle: async () => {
    const openCash = await ensureDailyCashRegisterForSale(
      db as unknown as CashCheckDb,
    );

    if (openCash.status !== 'abierta') {
      return controllerError(
        'BUSINESS_RULE',
        'La caja se encuentra cerrada. No es posible registrar ventas.',
        'cash-check',
      );
    }

    return controllerSuccess({
      disponible: true,
      cierreCajaId: openCash.cierreCajaId,
    });
  },
};
