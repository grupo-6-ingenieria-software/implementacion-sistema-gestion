import { and, eq } from 'drizzle-orm';
import { controllers } from '../../shared/controllers';
import {
  hasLotFieldErrors,
  normalizeLotRegisterPayload,
  validateLotRegisterPayload,
  type LotFieldErrors,
  type LotProviderOption,
  type LotRegisterPayload,
  type LotRegisterResponse,
} from '../../shared/lots';
import type { ControllerHandler, RegisteredController } from './base';
import {
  AccessDeniedError,
  authorizeUser,
  registerAuditLog,
} from './auth-context';
import { notifyDashboardUpdated } from './dashboard-events';

type LotDependencies = {
  register: (payload: LotRegisterPayload) => Promise<LotRegisterResponse>;
  listProviders: (payload: unknown) => Promise<LotProviderOption[]>;
};

type LotControllerResponse = LotRegisterResponse | LotProviderOption[];

export function createLotController(
  dependencies: LotDependencies = lotDependencies,
): RegisteredController {
  const handle: ControllerHandler<unknown, LotControllerResponse> = async (
    payload,
    context,
  ) => {
    if (context.channel === 'lote:proveedores') {
      try {
        return {
          ok: true,
          data: await dependencies.listProviders(payload),
        };
      } catch (error) {
        if (error instanceof AccessDeniedError) {
          return {
            ok: false,
            error: {
              code: 'FORBIDDEN',
              controllerId: 'lot',
              message: error.message,
            },
          };
        }

        return {
          ok: false,
          error: {
            code: 'DATABASE_ERROR',
            controllerId: 'lot',
            message: 'No fue posible cargar los proveedores.',
          },
        };
      }
    }

    if (context.channel !== 'lote:registrar') {
      return {
        ok: false,
        error: {
          code: 'INVALID_CHANNEL',
          controllerId: 'lot',
          message: `Canal IPC no registrado: ${context.channel}`,
        },
      };
    }

    const input = normalizeLotRegisterPayload(payload);
    const fieldErrors = validateLotRegisterPayload(input);

    if (hasLotFieldErrors(fieldErrors)) {
      return validationResponse(fieldErrors);
    }

    try {
      return {
        ok: true,
        data: await dependencies.register(input),
      };
    } catch (error) {
      const knownError = normalizeLotError(error);

      if (knownError) {
        return knownError;
      }

      return {
        ok: false,
        error: {
          code: 'DATABASE_ERROR',
          controllerId: 'lot',
          message: 'No fue posible registrar el lote. Intente nuevamente.',
        },
      };
    }
  };

  return {
    metadata: controllers[13],
    handle,
  };
}

const lotDependencies: LotDependencies = {
  listProviders,
  register: registerLot,
};

async function registerLot(
  payload: LotRegisterPayload,
): Promise<LotRegisterResponse> {
  const { db, schema } = await import('../../db/client');
  let createdLotId = '';

  await db.transaction(async (tx) => {
    const result = await registerLotWithExecutor(tx, schema, payload);
    createdLotId = result.loteId;
  });

  notifyDashboardUpdated();

  return {
    loteId: createdLotId,
    ean13: payload.ean13,
  };
}

async function listProviders(payload: unknown): Promise<LotProviderOption[]> {
  const { db, schema } = await import('../../db/client');
  const usuarioId = normalizeUsuarioIdPayload(payload);

  await authorizeUser(db, schema, usuarioId, ['dueno']);

  return db
    .select({
      id: schema.proveedor.proveedorId,
      nombre: schema.proveedor.proveedorNombreRazonSocial,
    })
    .from(schema.proveedor)
    .orderBy(schema.proveedor.proveedorNombreRazonSocial);
}

export async function registerLotWithExecutor(
  executor: MutationExecutor,
  schema: SchemaLike,
  payload: LotRegisterPayload,
): Promise<LotRegisterResponse> {
  const user = await authorizeUser(executor, schema, payload.usuarioId, ['dueno']);
  const product = await findActiveProductByEan13(executor, schema, payload.ean13);

  if (!product) {
    throw new LotError('product-not-found', {
      ean13: 'El producto no existe o se encuentra inactivo.',
    });
  }

  const fieldErrors = validateLotRegisterPayload(payload, {
    productRequiresExpiration: product.exigeVencimiento,
  });

  if (hasLotFieldErrors(fieldErrors)) {
    throw new LotError('validation', fieldErrors);
  }

  const provider = await findProviderById(executor, schema, payload.proveedorId);

  if (!provider) {
    throw new LotError('provider-not-found', {
      proveedorId: 'Seleccione un proveedor existente.',
    });
  }

  const [createdLot] = await executor
    .insert(schema.lote)
    .values({
      loteCantidadInicial: payload.cantidad,
      loteCantidadActual: payload.cantidad,
      lotePrecioCosto: payload.precioCosto,
      esLotePerecible: product.exigeVencimiento,
      esLoteNoPerecible: !product.exigeVencimiento,
      productoId: product.productoId,
      proveedorId: provider.id,
    })
    .returning({ loteId: schema.lote.loteId });

  if (product.exigeVencimiento && payload.fechaVencimiento) {
    await executor.insert(schema.lotePerecible).values({
      loteId: createdLot.loteId,
      lotePerecibleFechaVencimiento: payload.fechaVencimiento,
    });
  }

  await executor.insert(schema.ajusteInventario).values({
    ajusteCantidad: payload.cantidad,
    ajusteJustificacion: `Entrada de lote para ${payload.ean13}`,
    productoId: product.productoId,
    loteId: createdLot.loteId,
    usuarioId: user.usuarioId,
  });

  await registerAuditLog(executor, schema, {
    tipoAccion: 'registro',
    modulo: 'inventario',
    descripcion: `Lote registrado para producto ${payload.ean13}`,
    usuarioId: user.usuarioId,
  });

  return {
    loteId: createdLot.loteId,
    ean13: payload.ean13,
  };
}

async function findActiveProductByEan13(
  executor: QueryExecutor,
  schema: SchemaLike,
  ean13: string,
): Promise<{ productoId: number; exigeVencimiento: boolean } | null> {
  const [product] = await executor
    .select({
      productoId: schema.producto.productoId,
      exigeVencimiento: schema.categoria.categoriaExigeVencimiento,
    })
    .from(schema.producto)
    .innerJoin(
      schema.categoria,
      eq(schema.categoria.categoriaId, schema.producto.categoriaId),
    )
    .where(
      and(
        eq(schema.producto.productoEstado, 'activo'),
        eq(schema.producto.productoEan13, ean13),
      ),
    )
    .limit(1);

  return product
    ? {
        productoId: Number(product.productoId),
        exigeVencimiento: Boolean(product.exigeVencimiento),
      }
    : null;
}

async function findProviderById(
  executor: QueryExecutor,
  schema: SchemaLike,
  proveedorId: number,
): Promise<{ id: number } | null> {
  const [provider] = await executor
    .select({ id: schema.proveedor.proveedorId })
    .from(schema.proveedor)
    .where(eq(schema.proveedor.proveedorId, proveedorId))
    .limit(1);

  return provider ? { id: Number(provider.id) } : null;
}

function normalizeLotError(error: unknown) {
  if (error instanceof AccessDeniedError) {
    return {
      ok: false as const,
      error: {
        code: 'FORBIDDEN' as const,
        controllerId: 'lot' as const,
        message: error.message,
      },
    };
  }

  if (!(error instanceof LotError)) {
    return null;
  }

  if (error.reason === 'product-not-found') {
    return {
      ok: false as const,
      error: {
        code: 'BUSINESS_RULE' as const,
        controllerId: 'lot' as const,
        fieldErrors: error.fieldErrors,
        message: 'El producto no existe o se encuentra inactivo.',
      },
    };
  }

  if (error.reason === 'provider-not-found') {
    return {
      ok: false as const,
      error: {
        code: 'VALIDATION_ERROR' as const,
        controllerId: 'lot' as const,
        fieldErrors: error.fieldErrors,
        message: 'Revise los campos marcados antes de continuar.',
      },
    };
  }

  return validationResponse(error.fieldErrors);
}

function normalizeUsuarioIdPayload(payload: unknown): string | undefined {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'usuarioId' in payload &&
    typeof payload.usuarioId === 'string'
  ) {
    return payload.usuarioId.trim();
  }

  return undefined;
}

function validationResponse(fieldErrors: LotFieldErrors) {
  return {
    ok: false as const,
    error: {
      code: 'VALIDATION_ERROR' as const,
      controllerId: 'lot' as const,
      fieldErrors,
      message: 'Revise los campos marcados antes de continuar.',
    },
  };
}

export class LotError extends Error {
  constructor(
    readonly reason: 'product-not-found' | 'provider-not-found' | 'validation',
    readonly fieldErrors: LotFieldErrors,
  ) {
    super('No fue posible registrar el lote.');
  }
}

type SchemaLike = typeof import('../../db/schema');
type QueryExecutor = {
  select: typeof import('../../db/client').db.select;
  insert: typeof import('../../db/client').db.insert;
};
type MutationExecutor = QueryExecutor;

export const lotController = createLotController();
