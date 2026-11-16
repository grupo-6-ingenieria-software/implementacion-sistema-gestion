import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { BrowserWindow } from "electron";
import log from "electron-log/main";
import { findControllerById } from "../../shared/controllers";
import { db } from "../../db/client";
import { checkedAdd, NumericRangeError } from "../../shared/numbers";
import { DASHBOARD_UPDATED_EVENT } from "../../shared/dashboard";
import {
  isValidSaleId,
  SALE_ANNULLED_EVENT,
  type SaleAnnulmentRequest,
  type SaleAnnulmentResult,
} from "../../shared/sales";
import { AccessDeniedError, mapDatabaseRoleToTechnicalRole } from "./ContextoAutenticacionAuxiliar";
import { getDashboardDay } from "./FechaChileAuxiliar";
import { assertDailySaleTotals, assertInventoryTotals } from "./PrimitivasValidacionSqlAuxiliar";
import { registerAuditLog, type DbExecutor } from "./RegistroVentaAuxiliar";
import { runSerializedWriteTransaction } from "./TransaccionEscrituraAuxiliar";
import {
  controllerError,
  controllerSuccess,
  type RegisteredController,
} from "./BaseControladorAuxiliar";

export class SaleAnnulmentValidationError extends Error {}
export class SaleAnnulmentNotFoundError extends Error {}
export class SaleAnnulmentBusinessError extends Error {}

type NormalizedAnnulment = {
  ventaId: string;
  razon: string;
  usuarioId: string;
};

type AnnulmentUser = {
  usuarioId: string;
  nombre: string;
};

export async function annulSale(
  database: DbExecutor,
  payload: SaleAnnulmentRequest,
  now = new Date(),
): Promise<SaleAnnulmentResult> {
  const normalized = validateAnnulment(payload);

  return runSerializedWriteTransaction(database, async (tx) => {
    const user = await authorizeAnnulmentUser(tx, normalized.usuarioId);
    const { startUtc, endUtc } = getDashboardDay(now);
    const saleRows = await tx.all<{
      ventaId: string;
      estado: "completada" | "anulada";
      esDelDia: number;
      cierreCajaId: string;
      anulacionVentaId: string | null;
    }>(sql`
      SELECT
        v.venta_id AS ventaId,
        v.venta_estado AS estado,
        CASE
          WHEN datetime(v.venta_fecha_hora) >= datetime(${startUtc})
            AND datetime(v.venta_fecha_hora) < datetime(${endUtc})
          THEN 1 ELSE 0
        END AS esDelDia,
        v.cierre_caja_id AS cierreCajaId,
        av.anulacion_venta_id AS anulacionVentaId
      FROM venta v
      LEFT JOIN anulacion_venta av ON av.venta_id = v.venta_id
      WHERE lower(v.venta_id) = lower(${normalized.ventaId})
      LIMIT 1
    `);
    const sale = saleRows[0];

    if (!sale) {
      throw new SaleAnnulmentNotFoundError(
        "La venta indicada no fue encontrada.",
      );
    }
    if (Number(sale.esDelDia) !== 1) {
      throw new SaleAnnulmentBusinessError(
        "Solo se pueden anular ventas registradas durante el día actual.",
      );
    }
    if (sale.estado === "anulada" || sale.anulacionVentaId) {
      throw new SaleAnnulmentBusinessError("La venta indicada ya fue anulada.");
    }

    const cashRows = await tx.all<{ estado: "abierto" | "cerrado" }>(sql`
      SELECT cierre_estado AS estado
      FROM cierre_caja
      WHERE cierre_caja_id = ${sale.cierreCajaId}
      LIMIT 1
    `);
    const cash = cashRows[0];

    if (!cash) {
      throw new Error(
        `La venta ${sale.ventaId} no tiene una caja asociada recuperable.`,
      );
    }
    if (cash.estado !== "abierto") {
      throw new SaleAnnulmentBusinessError(
        "La caja asociada a la venta está cerrada. No es posible anularla.",
      );
    }

    const consumedLots = await tx.all<{
      loteId: string;
      cantidad: number;
    }>(sql`
      SELECT
        lote_id AS loteId,
        venta_lote_cantidad_consumida AS cantidad
      FROM venta_lote
      WHERE venta_id = ${sale.ventaId}
      ORDER BY lote_id ASC
    `);

    if (consumedLots.length === 0) {
      throw new Error(
        `La venta ${sale.ventaId} no contiene lotes que puedan restituirse.`,
      );
    }

    let unidadesRestituidas = 0;
    for (const consumed of consumedLots) {
      const quantity = Number(consumed.cantidad);
      if (!Number.isSafeInteger(quantity) || quantity <= 0) {
        throw new Error(
          `La venta ${sale.ventaId} contiene una cantidad de lote inválida.`,
        );
      }

      const restored = await tx.run(sql`
        UPDATE lote
        SET lote_cantidad_actual = lote_cantidad_actual + ${quantity}
        WHERE lote_id = ${consumed.loteId}
      `);
      if (restored.rowsAffected !== 1) {
        throw new Error(
          `No fue posible restituir el lote ${consumed.loteId}.`,
        );
      }
      unidadesRestituidas = checkedAdd(unidadesRestituidas, quantity);
    }

    const fechaHora = now.toISOString();
    await tx.run(sql`
      INSERT INTO anulacion_venta (
        anulacion_venta_id,
        anulacion_fecha_hora,
        anulacion_razon,
        venta_id,
        usuario_id
      )
      VALUES (
        ${randomUUID()},
        ${fechaHora},
        ${normalized.razon},
        ${sale.ventaId},
        ${user.usuarioId}
      )
    `);

    // El trigger de integridad también marca la venta. Este UPDATE explícito
    // conserva el contrato de C47 y es seguro aunque el trigger ya se ejecutó.
    const updatedSale = await tx.run(sql`
      UPDATE venta
      SET venta_estado = 'anulada'
      WHERE venta_id = ${sale.ventaId}
    `);
    if (updatedSale.rowsAffected !== 1) {
      throw new Error(`No fue posible marcar la venta ${sale.ventaId}.`);
    }

    await assertInventoryTotals(tx);
    await assertDailySaleTotals(tx, now);
    await registerAuditLog(tx, {
      usuarioId: user.usuarioId,
      tipoAccion: "anular_venta",
      modulo: "ventas",
      descripcion:
        `Venta ${sale.ventaId} anulada por ${user.nombre}. ` +
        `Razón: ${normalized.razon}. Se restituyeron ` +
        `${unidadesRestituidas} unidades en ${consumedLots.length} lotes.`,
    });

    return {
      ventaId: sale.ventaId,
      fechaHora,
      razon: normalized.razon,
      responsable: {
        usuarioId: user.usuarioId,
        nombre: user.nombre,
      },
      lotesRestituidos: consumedLots.length,
      unidadesRestituidas,
    };
  });
}

function validateAnnulment(payload: SaleAnnulmentRequest): NormalizedAnnulment {
  if (!isValidSaleId(payload?.ventaId)) {
    throw new SaleAnnulmentValidationError(
      "Ingrese un número de venta válido en formato UUID.",
    );
  }
  if (typeof payload.razon !== "string" || !payload.razon.trim()) {
    throw new SaleAnnulmentValidationError(
      "La razón de anulación es obligatoria.",
    );
  }
  if (typeof payload.usuarioId !== "string" || !payload.usuarioId.trim()) {
    throw new AccessDeniedError(
      "No hay un usuario autenticado para realizar esta acción.",
    );
  }

  return {
    ventaId: payload.ventaId.trim(),
    razon: payload.razon.trim(),
    usuarioId: payload.usuarioId.trim(),
  };
}

async function authorizeAnnulmentUser(
  database: Pick<DbExecutor, "all">,
  usuarioId: string,
): Promise<AnnulmentUser> {
  const rows = await database.all<{
    usuarioId: string;
    usuarioRol: string;
    trabajadorEstado: string;
    nombre: string;
  }>(sql`
    SELECT
      u.usuario_id AS usuarioId,
      u.usuario_rol AS usuarioRol,
      t.trabajador_estado AS trabajadorEstado,
      trim(t.trabajador_nombre || ' ' || t.trabajador_apellido) AS nombre
    FROM usuario u
    JOIN trabajador t ON t.trabajador_id = u.trabajador_id
    WHERE u.usuario_id = ${usuarioId}
    LIMIT 1
  `);
  const user = rows[0];
  const role = user ? mapDatabaseRoleToTechnicalRole(user.usuarioRol) : null;

  if (
    !user ||
    user.trabajadorEstado !== "activo" ||
    !role ||
    !["dueno", "trabajador"].includes(role)
  ) {
    throw new AccessDeniedError(
      "El usuario autenticado no está activo o no tiene permiso para anular ventas.",
    );
  }

  return { usuarioId: user.usuarioId, nombre: user.nombre };
}

export function notifySaleAnnulled(result: SaleAnnulmentResult): void {
  let windows: BrowserWindow[];

  try {
    windows = BrowserWindow.getAllWindows();
  } catch (error) {
    logNotificationError(error);
    return;
  }

  for (const window of windows) {
    try {
      window.webContents.send(SALE_ANNULLED_EVENT, result);
    } catch (error) {
      logNotificationError(error);
    }
    try {
      window.webContents.send(DASHBOARD_UPDATED_EVENT);
    } catch (error) {
      logNotificationError(error);
    }
  }
}

function logNotificationError(error: unknown): void {
  try {
    log.error("No fue posible notificar la anulación de venta.", error);
  } catch {}
}

const metadata = findControllerById("sale-annulment")!;

type Dependencies = {
  annul: typeof annulSale;
  notify: typeof notifySaleAnnulled;
};

export function createAnulacionVentaHandler(
  dependencies: Dependencies = {
    annul: annulSale,
    notify: notifySaleAnnulled,
  },
): RegisteredController<unknown, SaleAnnulmentResult> {
  return {
    metadata,
    handle: async (payload, context) => {
      if (context.channel !== "venta:anular") {
        return controllerError(
          "INVALID_CHANNEL",
          `Canal IPC no registrado: ${context.channel}`,
          metadata.id,
        );
      }

      try {
        const result = await dependencies.annul(
          db as unknown as DbExecutor,
          (payload ?? {}) as SaleAnnulmentRequest,
        );
        dependencies.notify(result);
        return controllerSuccess(result);
      } catch (error) {
        if (error instanceof SaleAnnulmentValidationError) {
          return controllerError(
            "VALIDATION_ERROR",
            error.message,
            metadata.id,
          );
        }
        if (error instanceof SaleAnnulmentNotFoundError) {
          return controllerError("NOT_FOUND", error.message, metadata.id);
        }
        if (error instanceof SaleAnnulmentBusinessError || error instanceof NumericRangeError) {
          return controllerError("BUSINESS_RULE", error.message, metadata.id);
        }
        if (error instanceof AccessDeniedError) {
          return controllerError("FORBIDDEN", error.message, metadata.id);
        }

        console.error(error);
        return controllerError(
          "TECHNICAL_ERROR",
          "No fue posible anular la venta. Intente nuevamente.",
          metadata.id,
        );
      }
    },
  };
}

export const anulacionVentaHandler = createAnulacionVentaHandler();
