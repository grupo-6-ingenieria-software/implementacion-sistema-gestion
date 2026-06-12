import { and, asc, eq, like, or, sql } from 'drizzle-orm';
import { controllers } from '../../shared/controllers';
import {
  hasLotFieldErrors,
  normalizeLotPreparePayload,
  normalizeLotRegisterPayload,
  validateLotRegisterPayload,
  type LotFieldErrors,
  type LotPrepareResponse,
  type LotProductOption,
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

type LotDependencies = {
  prepare: (payload: {
    ean13?: string;
    query?: string;
    usuarioId?: string;
  }) => Promise<LotPrepareResponse>;
  register: (payload: LotRegisterPayload) => Promise<LotRegisterResponse>;
};

export function createLotController(
  dependencies: LotDependencies = lotDependencies,
): RegisteredController {
  const handle: ControllerHandler<unknown, LotPrepareResponse | LotRegisterResponse> =
    async (payload, context) => {
      if (context.channel === 'lote:preparar') {
        const input = normalizeLotPreparePayload(payload);

        try {
          return {
            ok: true,
            data: await dependencies.prepare(input),
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
              message: 'No fue posible preparar el registro de lote.',
            },
          };
        }
      }

      if (context.channel === 'lote:registrar') {
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
      }

      return {
        ok: false,
        error: {
          code: 'INVALID_CHANNEL',
          controllerId: 'lot',
          message: `Canal IPC no registrado: ${context.channel}`,
        },
      };
    };

  return {
    metadata: controllers[13],
    handle,
  };
}

const lotDependencies: LotDependencies = {
  prepare: async ({ ean13, query, usuarioId }) => {
    const { db, schema } = await import('../../db/client');

    await authorizeUser(db, schema, usuarioId, ['dueno']);

    const providers = await listProviders(db as unknown as QueryExecutor, schema);
    const search = ean13?.trim() || query?.trim();

    if (!search) {
      return { providers };
    }

    const products = await listActiveProducts(
      db as unknown as QueryExecutor,
      schema,
      search,
      ean13 ? 1 : 10,
    );

    if (ean13 && products.length === 0) {
      throw new LotError('product-not-found', {
        ean13: 'El producto no existe o se encuentra inactivo.',
      });
    }

    return {
      providers,
      product: ean13 ? products[0] : undefined,
      products: ean13 ? undefined : products,
    };
  },
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

  return {
    loteId: createdLotId,
    ean13: payload.ean13,
  };
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
    ajusteJustificacion: `Ingreso de lote para ${payload.ean13}`,
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

async function listProviders(
  executor: QueryExecutor,
  schema: SchemaLike,
): Promise<LotProviderOption[]> {
  const rows = await executor
    .select({
      id: schema.proveedor.proveedorId,
      nombre: schema.proveedor.proveedorNombreRazonSocial,
      rut: schema.proveedor.proveedorRut,
    })
    .from(schema.proveedor)
    .orderBy(asc(schema.proveedor.proveedorNombreRazonSocial));

  return rows.map((row) => ({
    id: Number(row.id),
    nombre: row.nombre,
    rut: row.rut,
  }));
}

async function listActiveProducts(
  executor: QueryExecutor,
  schema: SchemaLike,
  search: string,
  limit: number,
): Promise<LotProductOption[]> {
  const rows = await executor
    .select({
      productoId: schema.producto.productoId,
      ean13: schema.producto.productoEan13,
      nombre: schema.producto.productoNombre,
      categoria: schema.categoria.categoriaNombre,
      exigeVencimiento: schema.categoria.categoriaExigeVencimiento,
      stockDisponible:
        sql<number>`coalesce(sum(${schema.lote.loteCantidadActual}), 0)`,
    })
    .from(schema.producto)
    .innerJoin(
      schema.categoria,
      eq(schema.categoria.categoriaId, schema.producto.categoriaId),
    )
    .leftJoin(
      schema.lote,
      eq(schema.lote.productoId, schema.producto.productoId),
    )
    .where(
      and(
        eq(schema.producto.productoEstado, 'activo'),
        or(
          eq(schema.producto.productoEan13, search),
          like(schema.producto.productoEan13, `%${search}%`),
          like(schema.producto.productoNombre, `%${search}%`),
        ),
      ),
    )
    .groupBy(
      schema.producto.productoId,
      schema.producto.productoEan13,
      schema.producto.productoNombre,
      schema.categoria.categoriaNombre,
      schema.categoria.categoriaExigeVencimiento,
    )
    .orderBy(asc(schema.producto.productoNombre))
    .limit(limit);

  return rows.map(mapProductRow);
}

async function findActiveProductByEan13(
  executor: QueryExecutor,
  schema: SchemaLike,
  ean13: string,
): Promise<LotProductOption | null> {
  const products = await listActiveProducts(executor, schema, ean13, 1);
  const product = products.find((item) => item.ean13 === ean13);

  return product ?? null;
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

function mapProductRow(row: {
  productoId: number;
  ean13: string;
  nombre: string;
  categoria: string;
  exigeVencimiento: boolean;
  stockDisponible: number;
}): LotProductOption {
  return {
    productoId: Number(row.productoId),
    ean13: row.ean13,
    nombre: row.nombre,
    categoria: row.categoria,
    exigeVencimiento: Boolean(row.exigeVencimiento),
    stockDisponible: Number(row.stockDisponible),
  };
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
