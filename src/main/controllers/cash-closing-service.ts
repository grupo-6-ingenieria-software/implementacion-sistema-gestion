import { sql } from 'drizzle-orm';
import type { Role } from '../../shared/navigation';
import type { PaymentMethod } from '../../shared/sales';
import {
  createEmptyCashPaymentBreakdown,
  type CashCloseRequest,
  type CashCloseResult,
  type CashClosingRequest,
  type CashClosingSummary,
} from '../../shared/cash';
import { mapDatabaseRoleToTechnicalRole } from './auth-context';
import {
  calculateSaleAmount,
  type SaleRow,
} from './dashboard-service';
import { getDashboardDay } from './dashboard-date';
import {
  registerAuditLog,
  type DbExecutor,
} from './sale-service';
import { inspectDailyCashRegister } from './cash-check';

type CashUser = {
  role: Role;
  usuarioId: string;
  usuarioRol: string;
  trabajadorNombre: string;
};

type CashRegisterRow = {
  cierreCajaId: string;
  closedAt: string | null;
  closedByName: string | null;
  closedByUserId: string | null;
  openedAt: string;
  status: 'abierto' | 'cerrado';
};

export class CashClosingValidationError extends Error {}
export class CashClosingBusinessError extends Error {}
export class CashClosingAccessError extends Error {}

export async function getCashClosingSummary(
  database: DbExecutor,
  payload: CashClosingRequest,
  now = new Date(),
): Promise<CashClosingSummary> {
  await authorizeCashClosingUser(database, payload.usuarioId);
  const cashState = await inspectDailyCashRegister(database, now);
  if (cashState.status === 'cerrada') {
    throw new CashClosingBusinessError('La caja de este día ya fue cerrada.');
  }
  const cashRegister = cashState.status === 'abierta'
    ? {
        cierreCajaId: cashState.cierreCajaId,
        closedAt: null,
        closedByName: null,
        closedByUserId: null,
        openedAt: cashState.openedAt,
        status: 'abierto' as const,
      }
    : undefined;

  return buildSummary(database, cashRegister, now);
}

export async function closeCashRegister(
  database: DbExecutor,
  payload: CashCloseRequest,
  now = new Date(),
): Promise<CashCloseResult> {
  if (!payload.confirmacion) {
    throw new CashClosingValidationError('Debe confirmar el cierre de caja.');
  }

  return database.transaction(async (tx) => {
    const user = await authorizeCashClosingUser(tx, payload.usuarioId);
    const cashState = await inspectDailyCashRegister(tx, now);

    if (cashState.status === 'sin_registro') {
      throw new CashClosingBusinessError(
        'No hay una caja abierta para cerrar.',
      );
    }

    if (cashState.status === 'cerrada') {
      throw new CashClosingBusinessError(
        'La caja de este dia ya fue cerrada.',
      );
    }

    const cashRegister: CashRegisterRow = {
      cierreCajaId: cashState.cierreCajaId,
      closedAt: null,
      closedByName: null,
      closedByUserId: null,
      openedAt: cashState.openedAt,
      status: 'abierto',
    };

    const summary = await buildSummary(tx, cashRegister, now);
    const closedAt = now.toISOString();
    const result = await tx.run(sql`
      UPDATE cierre_caja
      SET
        cierre_estado = 'cerrado',
        cierre_fecha_hora_fin = ${closedAt},
        usuario_cierre_id = ${user.usuarioId}
      WHERE cierre_caja_id = ${cashRegister.cierreCajaId}
        AND cierre_estado = 'abierto'
    `);

    if (result.rowsAffected === 0) {
      throw new CashClosingBusinessError(
        'La caja de este dia ya fue cerrada.',
      );
    }

    await registerAuditLog(tx, {
      usuarioId: user.usuarioId,
      tipoAccion: 'cerrar_caja',
      modulo: 'caja',
      descripcion: `Cierre de caja ${cashRegister.cierreCajaId} registrado por ${user.trabajadorNombre} por $${summary.currentAmount}.`,
    });

    return {
      ...summary,
      closedAt,
      closedBy: {
        usuarioId: user.usuarioId,
        nombre: user.trabajadorNombre,
      },
      status: 'cerrada',
    };
  });
}

async function authorizeCashClosingUser(
  database: Pick<DbExecutor, 'all'>,
  usuarioId: string | undefined,
): Promise<CashUser> {
  const normalizedUsuarioId = usuarioId?.trim();

  if (!normalizedUsuarioId) {
    throw new CashClosingValidationError(
      'Se requiere un usuario autenticado para cerrar caja.',
    );
  }

  const rows = await database.all<{
    trabajadorApellido: string;
    trabajadorEstado: string;
    trabajadorNombre: string;
    usuarioId: string;
    usuarioRol: string;
  }>(sql`
    SELECT
      u.usuario_id AS usuarioId,
      u.usuario_rol AS usuarioRol,
      t.trabajador_nombre AS trabajadorNombre,
      t.trabajador_apellido AS trabajadorApellido,
      t.trabajador_estado AS trabajadorEstado
    FROM usuario u
    INNER JOIN trabajador t ON t.trabajador_id = u.trabajador_id
    WHERE u.usuario_id = ${normalizedUsuarioId}
    LIMIT 1
  `);

  const user = rows[0];

  if (!user || user.trabajadorEstado !== 'activo') {
    throw new CashClosingAccessError(
      'El usuario autenticado no esta activo o no existe.',
    );
  }

  const role = mapDatabaseRoleToTechnicalRole(user.usuarioRol);

  if (!role || !['dueno', 'trabajador'].includes(role)) {
    throw new CashClosingAccessError(
      'No tiene permiso para cerrar caja.',
    );
  }

  return {
    role,
    usuarioId: user.usuarioId,
    usuarioRol: user.usuarioRol,
    trabajadorNombre:
      `${user.trabajadorNombre} ${user.trabajadorApellido}`.trim(),
  };
}

async function buildSummary(
  database: Pick<DbExecutor, 'all'>,
  cashRegister: CashRegisterRow | undefined,
  now: Date,
): Promise<CashClosingSummary> {
  const saleRows = cashRegister
    ? await loadCashRegisterSaleRows(database, cashRegister.cierreCajaId, now)
    : [];
  const annulledSaleIds = cashRegister
    ? await loadCashRegisterAnnulledSaleIds(database, cashRegister.cierreCajaId, now)
    : new Set<string>();
  const payments = createEmptyCashPaymentBreakdown();
  let currentAmount = 0;
  let currentTransactions = 0;
  let voidedAmount = 0;
  let voidedTransactions = 0;

  for (const row of saleRows) {
    const amount = calculateSaleAmount(row);
    const paymentMethod = row.paymentMethod;

    if (annulledSaleIds.has(row.ventaId)) {
      voidedAmount += amount;
      voidedTransactions += 1;
      payments[paymentMethod].voidedAmount += amount;
      payments[paymentMethod].voidedTransactions += 1;
      continue;
    }

    currentAmount += amount;
    currentTransactions += 1;
    payments[paymentMethod].currentAmount += amount;
    payments[paymentMethod].currentTransactions += 1;
  }

  return {
    cierreCajaId: cashRegister?.cierreCajaId,
    closedAt: cashRegister?.closedAt ?? undefined,
    closedBy:
      cashRegister?.closedByUserId
        ? {
            usuarioId: cashRegister.closedByUserId,
            nombre: cashRegister.closedByName ?? undefined,
          }
        : undefined,
    currentAmount,
    currentTransactions,
    generatedAt: now.toISOString(),
    openedAt: cashRegister?.openedAt,
    payments,
    status: cashRegister
      ? cashRegister.status === 'abierto'
        ? 'abierta'
        : 'cerrada'
      : 'sin_registro',
    voidedAmount,
    voidedTransactions,
  };
}

async function loadCashRegisterSaleRows(
  database: Pick<DbExecutor, 'all'>,
  cierreCajaId: string,
  now: Date,
): Promise<Array<SaleRow & { paymentMethod: PaymentMethod; ventaId: string }>> {
  const { startUtc, endUtc } = getDashboardDay(now);
  return database.all<SaleRow & { paymentMethod: PaymentMethod; ventaId: string }>(sql`
    SELECT
      v.venta_id AS ventaId,
      v.venta_estado AS state,
      v.venta_metodo_pago AS paymentMethod,
      v.venta_descuento_tipo AS discountType,
      v.venta_descuento_valor AS discountValue,
      COALESCE(
        SUM(dv.detalle_venta_cantidad * hp.historial_precio_venta),
        0
      ) AS subtotal
    FROM venta v
    LEFT JOIN detalle_venta dv ON dv.venta_id = v.venta_id
    LEFT JOIN historial_precio_producto hp
      ON hp.historial_precio_producto_id = dv.historial_precio_producto_id
    WHERE
      v.cierre_caja_id = ${cierreCajaId}
      AND datetime(v.venta_fecha_hora) >= datetime(${startUtc})
      AND datetime(v.venta_fecha_hora) < datetime(${endUtc})
    GROUP BY
      v.venta_id,
      v.venta_estado,
      v.venta_metodo_pago,
      v.venta_descuento_tipo,
      v.venta_descuento_valor
  `);
}

async function loadCashRegisterAnnulledSaleIds(
  database: Pick<DbExecutor, 'all'>,
  cierreCajaId: string,
  now: Date,
): Promise<Set<string>> {
  const { startUtc, endUtc } = getDashboardDay(now);
  const rows = await database.all<{ ventaId: string }>(sql`
    SELECT av.venta_id AS ventaId
    FROM anulacion_venta av
    INNER JOIN venta v ON v.venta_id = av.venta_id
    WHERE v.cierre_caja_id = ${cierreCajaId}
      AND datetime(av.anulacion_fecha_hora) >= datetime(${startUtc})
      AND datetime(av.anulacion_fecha_hora) < datetime(${endUtc})
  `);
  return new Set(rows.map((row) => row.ventaId));
}
