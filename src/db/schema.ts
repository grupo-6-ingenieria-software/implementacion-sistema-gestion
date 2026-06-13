/**
 * Drizzle schema — Minimarket y Panadería Huáscar
 * libSQL/Turso (compatible SQLite 3.x)
 *
 * Fuente de verdad: db/modelo_datos/modelo_relacional_3fn.md (29-may-2026)
 *
 * Convenciones (estricto 3FN):
 * - snake_case con prefijo de entidad en columnas (producto_nombre, no nombre).
 * - PK INTEGER autoincremental para maestros: categoria, producto, proveedor,
 *   trabajador, tasa_legal.
 * - PK VARCHAR(36) UUID v4 para eventos (lote, venta, merma, sesion, logs, etc.).
 * - PK VARCHAR(50) derivada de RUT para usuario (regla de negocio).
 * - Tablas intermedias M:N: PK propia VARCHAR(36) + FKs + UNIQUE sobre el par
 *   natural. Permite ser referenciada desde otras tablas con una sola columna.
 * - Dinero (CLP): INTEGER (pesos sin decimales).
 * - Tasas legales (%): REAL.
 * - Fechas y timestamps: TEXT ISO-8601.
 *
 * Activación de FKs: el cliente debe ejecutar `PRAGMA foreign_keys = ON` en
 * cada conexión a libSQL/Turso. Sin esto los REFERENCES son decorativos.
 *
 * Triggers no se representan acá (Drizzle no los soporta en TS); viven en
 * src/db/triggers.sql y se aplican vía `npm run db:triggers`.
 *
 * Módulos 3, 6 y 8 del catálogo de requerimientos no generan tablas (sólo
 * vistas calculadas o lógica de hardware).
 */

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/** UUID v4 (36 chars con guiones). Generado en cliente por concurrencia. */
const uuid = () => randomUUID();

/** Default SQL: timestamp ISO-8601 a la hora de INSERT. */
const nowDefault = sql`(datetime('now'))`;

/** Check de longitud para PKs UUID v4. */
const uuidCheck = (col: string) => sql.raw(`length(${col}) = 36`);

// ============================================================================
// MÓDULO 4 (parcial) — MAESTROS DE PERSONAS (definidos primero por refs)
// ============================================================================

export const trabajador = sqliteTable(
  'trabajador',
  {
    trabajadorId: integer('trabajador_id').primaryKey({ autoIncrement: true }),
    trabajadorRut: text('trabajador_rut').notNull().unique(),
    trabajadorNombre: text('trabajador_nombre').notNull(),
    trabajadorApellido: text('trabajador_apellido').notNull(),
    trabajadorTelefono: text('trabajador_telefono').notNull(),
    trabajadorCorreoElectronico: text('trabajador_correo_electronico'),
    trabajadorFechaIngreso: text('trabajador_fecha_ingreso').notNull(),
    trabajadorEstado: text('trabajador_estado', {
      enum: ['activo', 'inactivo'],
    })
      .notNull()
      .default('activo'),
  },
  (t) => [
    check(
      'trabajador_rut_format',
      sql`length(${t.trabajadorRut}) BETWEEN 9 AND 12 AND ${t.trabajadorRut} GLOB '[1-9]*-[0-9kK]'`,
    ),
    check(
      'trabajador_email_format',
      sql`${t.trabajadorCorreoElectronico} IS NULL OR ${t.trabajadorCorreoElectronico} LIKE '%_@_%._%'`,
    ),
    check(
      'trabajador_estado_enum',
      sql`${t.trabajadorEstado} IN ('activo','inactivo')`,
    ),
  ],
);

export const usuario = sqliteTable(
  'usuario',
  {
    // PK VARCHAR(50) derivada del RUT (regla de negocio). No autogenera.
    usuarioId: text('usuario_id').primaryKey(),
    usuarioRol: text('usuario_rol', {
      enum: ['dueño', 'cajero', 'reponedor'],
    }).notNull(),
    usuarioFechaCreacion: text('usuario_fecha_creacion')
      .notNull()
      .default(nowDefault),
    usuarioUltimoLoginFechaHora: text('usuario_ultimo_login_fecha_hora'),
    trabajadorId: integer('trabajador_id')
      .notNull()
      .unique()
      .references(() => trabajador.trabajadorId, { onDelete: 'restrict' }),
  },
  (t) => [
    check(
      'usuario_id_length',
      sql`length(${t.usuarioId}) BETWEEN 3 AND 50`,
    ),
    check(
      'usuario_rol_enum',
      sql`${t.usuarioRol} IN ('dueño','cajero','reponedor')`,
    ),
  ],
);

// ============================================================================
// MÓDULO 1 — INVENTARIO
// ============================================================================

export const categoria = sqliteTable(
  'categoria',
  {
    categoriaId: integer('categoria_id').primaryKey({ autoIncrement: true }),
    categoriaNombre: text('categoria_nombre').notNull().unique(),
    categoriaExigeVencimiento: integer('categoria_exige_vencimiento', {
      mode: 'boolean',
    }).notNull(),
  },
  (t) => [
    check(
      'categoria_exige_venc_bool',
      sql`${t.categoriaExigeVencimiento} IN (0,1)`,
    ),
  ],
);

export const producto = sqliteTable(
  'producto',
  {
    productoId: integer('producto_id').primaryKey({ autoIncrement: true }),
    productoEan13: text('producto_ean_13').notNull().unique(),
    productoNombre: text('producto_nombre').notNull(),
    productoPrecioVenta: integer('producto_precio_venta').notNull(),
    productoStockMinimo: integer('producto_stock_minimo').notNull().default(0),
    productoEstado: text('producto_estado', { enum: ['activo', 'inactivo'] })
      .notNull()
      .default('activo'),
    productoFechaRegistro: text('producto_fecha_registro')
      .notNull()
      .default(nowDefault),
    categoriaId: integer('categoria_id')
      .notNull()
      .references(() => categoria.categoriaId, { onDelete: 'restrict' }),
  },
  (t) => [
    check(
      'producto_ean13_format',
      sql`length(${t.productoEan13}) = 13 AND ${t.productoEan13} GLOB '[0-9]*'`,
    ),
    check('producto_precio_venta_min', sql`${t.productoPrecioVenta} >= 0`),
    check('producto_stock_minimo_min', sql`${t.productoStockMinimo} >= 0`),
    check(
      'producto_estado_enum',
      sql`${t.productoEstado} IN ('activo','inactivo')`,
    ),
    index('idx_producto_nombre').on(t.productoNombre),
    index('idx_producto_categoria').on(t.categoriaId),
    index('idx_producto_estado').on(t.productoEstado),
  ],
);

export const historialPrecioProducto = sqliteTable(
  'historial_precio_producto',
  {
    historialPrecioProductoId: text('historial_precio_producto_id')
      .primaryKey()
      .$defaultFn(uuid),
    historialPrecioCosto: integer('historial_precio_costo').notNull(),
    historialPrecioVenta: integer('historial_precio_venta').notNull(),
    historialFechaHoraVigenciaDesde: text('historial_fecha_hora_vigencia_desde')
      .notNull()
      .default(nowDefault),
    historialFechaHoraVigenciaHasta: text('historial_fecha_hora_vigencia_hasta'),
    productoId: integer('producto_id')
      .notNull()
      .references(() => producto.productoId, { onDelete: 'restrict' }),
  },
  (t) => [
    check(
      'historial_precio_producto_uuid',
      uuidCheck('historial_precio_producto_id'),
    ),
    check('historial_precio_costo_min', sql`${t.historialPrecioCosto} >= 0`),
    check('historial_precio_venta_min', sql`${t.historialPrecioVenta} >= 0`),
    check(
      'historial_vigencia_rango',
      sql`${t.historialFechaHoraVigenciaHasta} IS NULL
       OR ${t.historialFechaHoraVigenciaDesde} <= ${t.historialFechaHoraVigenciaHasta}`,
    ),
    index('idx_historial_precio_producto').on(
      t.productoId,
      t.historialFechaHoraVigenciaDesde,
    ),
  ],
);

// proveedor y pedido_proveedor están en MÓDULO 2 (más abajo), pero lote los
// referencia. Drizzle resuelve forward refs vía arrow functions: OK.

export const lote = sqliteTable(
  'lote',
  {
    loteId: text('lote_id').primaryKey().$defaultFn(uuid),
    loteCantidadInicial: integer('lote_cantidad_inicial').notNull(),
    loteCantidadActual: integer('lote_cantidad_actual').notNull(),
    lotePrecioCosto: integer('lote_precio_costo').notNull(),
    loteFechaHoraIngreso: text('lote_fecha_hora_ingreso')
      .notNull()
      .default(nowDefault),
    // Flags discriminadores ISA (especialización perecible / no perecible).
    // Persisten en el supertipo en todas las FN (metodología del modelo .docx).
    esLotePerecible: integer('es_lote_perecible', { mode: 'boolean' }).notNull(),
    esLoteNoPerecible: integer('es_lote_no_perecible', {
      mode: 'boolean',
    }).notNull(),
    productoId: integer('producto_id')
      .notNull()
      .references(() => producto.productoId, { onDelete: 'restrict' }),
    proveedorId: integer('proveedor_id').references(
      () => proveedor.proveedorId,
      { onDelete: 'set null' },
    ),
    pedidoProveedorId: text('pedido_proveedor_id').references(
      () => pedidoProveedor.pedidoProveedorId,
      { onDelete: 'set null' },
    ),
  },
  (t) => [
    check('lote_uuid', uuidCheck('lote_id')),
    check('lote_cantidad_inicial_min', sql`${t.loteCantidadInicial} >= 0`),
    check('lote_precio_costo_min', sql`${t.lotePrecioCosto} >= 0`),
    // ISA: exactamente uno de los dos flags es verdadero.
    check(
      'lote_isa_exclusivo',
      sql`${t.esLotePerecible} + ${t.esLoteNoPerecible} = 1`,
    ),
    index('idx_lote_producto').on(t.productoId),
    index('idx_lote_pedido').on(t.pedidoProveedorId),
  ],
);

// Subtipo ISA 1:1 de lote
export const lotePerecible = sqliteTable('lote_perecible', {
  loteId: text('lote_id')
    .primaryKey()
    .references(() => lote.loteId, { onDelete: 'cascade' }),
  lotePerecibleFechaVencimiento: text('lote_perecible_fecha_vencimiento')
    .notNull(),
});

export const merma = sqliteTable(
  'merma',
  {
    mermaId: text('merma_id').primaryKey().$defaultFn(uuid),
    mermaMotivo: text('merma_motivo', {
      enum: ['vencimiento', 'dano', 'robo', 'error_registro'],
    }).notNull(),
    mermaObservacion: text('merma_observacion'),
    mermaFechaHora: text('merma_fecha_hora').notNull().default(nowDefault),
    productoId: integer('producto_id')
      .notNull()
      .references(() => producto.productoId, { onDelete: 'restrict' }),
    usuarioId: text('usuario_id')
      .notNull()
      .references(() => usuario.usuarioId, { onDelete: 'restrict' }),
  },
  (t) => [
    check('merma_uuid', uuidCheck('merma_id')),
    check(
      'merma_motivo_enum',
      sql`${t.mermaMotivo} IN ('vencimiento','dano','robo','error_registro')`,
    ),
    index('idx_merma_producto').on(t.productoId, t.mermaFechaHora),
  ],
);

// Intermedia M:N (merma <-> lote) con PK propia (Opción B)
export const mermaLote = sqliteTable(
  'merma_lote',
  {
    mermaLoteId: text('merma_lote_id').primaryKey().$defaultFn(uuid),
    mermaId: text('merma_id')
      .notNull()
      .references(() => merma.mermaId, { onDelete: 'cascade' }),
    loteId: text('lote_id')
      .notNull()
      .references(() => lote.loteId, { onDelete: 'restrict' }),
    mermaLoteCantidadDescontada: integer('merma_lote_cantidad_descontada')
      .notNull(),
  },
  (t) => [
    check('merma_lote_uuid', uuidCheck('merma_lote_id')),
    check(
      'merma_lote_cantidad_min',
      sql`${t.mermaLoteCantidadDescontada} > 0`,
    ),
    uniqueIndex('uq_merma_lote').on(t.mermaId, t.loteId),
  ],
);

export const ajusteInventario = sqliteTable(
  'ajuste_inventario',
  {
    ajusteInventarioId: text('ajuste_inventario_id')
      .primaryKey()
      .$defaultFn(uuid),
    ajusteCantidad: integer('ajuste_cantidad').notNull(),
    ajusteJustificacion: text('ajuste_justificacion').notNull(),
    ajusteFechaHora: text('ajuste_fecha_hora').notNull().default(nowDefault),
    productoId: integer('producto_id')
      .notNull()
      .references(() => producto.productoId, { onDelete: 'restrict' }),
    loteId: text('lote_id')
      .notNull()
      .references(() => lote.loteId, { onDelete: 'restrict' }),
    usuarioId: text('usuario_id')
      .notNull()
      .references(() => usuario.usuarioId, { onDelete: 'restrict' }),
  },
  (t) => [
    check('ajuste_inventario_uuid', uuidCheck('ajuste_inventario_id')),
    check('ajuste_cantidad_no_cero', sql`${t.ajusteCantidad} <> 0`),
    index('idx_ajuste_producto').on(t.productoId, t.ajusteFechaHora),
  ],
);

// ============================================================================
// MÓDULO 2 — PROVEEDORES
// ============================================================================

export const proveedor = sqliteTable(
  'proveedor',
  {
    proveedorId: integer('proveedor_id').primaryKey({ autoIncrement: true }),
    proveedorRut: text('proveedor_rut').notNull().unique(),
    proveedorNombreRazonSocial: text('proveedor_nombre_razon_social').notNull(),
    proveedorNombreContacto: text('proveedor_nombre_contacto').notNull(),
    proveedorTelefono: text('proveedor_telefono').notNull(),
    proveedorCorreoElectronico: text('proveedor_correo_electronico').notNull(),
  },
  (t) => [
    check(
      'proveedor_rut_format',
      sql`length(${t.proveedorRut}) BETWEEN 9 AND 12 AND ${t.proveedorRut} GLOB '[1-9]*-[0-9kK]'`,
    ),
    check(
      'proveedor_email_format',
      sql`${t.proveedorCorreoElectronico} LIKE '%_@_%._%'`,
    ),
  ],
);

// Intermedia M:N (proveedor <-> categoria) con PK propia (Opción B)
export const proveedorCategoria = sqliteTable(
  'proveedor_categoria',
  {
    proveedorCategoriaId: text('proveedor_categoria_id')
      .primaryKey()
      .$defaultFn(uuid),
    proveedorId: integer('proveedor_id')
      .notNull()
      .references(() => proveedor.proveedorId, { onDelete: 'cascade' }),
    categoriaId: integer('categoria_id')
      .notNull()
      .references(() => categoria.categoriaId, { onDelete: 'restrict' }),
  },
  (t) => [
    check('proveedor_categoria_uuid', uuidCheck('proveedor_categoria_id')),
    uniqueIndex('uq_proveedor_categoria').on(t.proveedorId, t.categoriaId),
  ],
);

export const pedidoProveedor = sqliteTable(
  'pedido_proveedor',
  {
    pedidoProveedorId: text('pedido_proveedor_id')
      .primaryKey()
      .$defaultFn(uuid),
    pedidoProveedorFechaHoraEmision: text('pedido_proveedor_fecha_hora_emision')
      .notNull()
      .default(nowDefault),
    pedidoProveedorEstado: text('pedido_proveedor_estado', {
      enum: ['borrador', 'emitido', 'enviado', 'parcial', 'recibido', 'cancelado'],
    }).notNull(),
    pedidoProveedorFechaHoraRecepcion: text(
      'pedido_proveedor_fecha_hora_recepcion',
    ),
    pedidoProveedorNotaRecepcion: text('pedido_proveedor_nota_recepcion'),
    proveedorId: integer('proveedor_id')
      .notNull()
      .references(() => proveedor.proveedorId, { onDelete: 'restrict' }),
    usuarioEmisorId: text('usuario_emisor_id')
      .notNull()
      .references(() => usuario.usuarioId, { onDelete: 'restrict' }),
    usuarioReceptorId: text('usuario_receptor_id').references(
      () => usuario.usuarioId,
      { onDelete: 'restrict' },
    ),
  },
  (t) => [
    check('pedido_proveedor_uuid', uuidCheck('pedido_proveedor_id')),
    check(
      'pedido_proveedor_estado_enum',
      sql`${t.pedidoProveedorEstado} IN ('borrador','emitido','enviado','parcial','recibido','cancelado')`,
    ),
    index('idx_pedido_proveedor_proveedor').on(t.proveedorId),
    index('idx_pedido_proveedor_estado').on(t.pedidoProveedorEstado),
  ],
);

// Intermedia M:N (pedido_proveedor <-> producto) con PK propia (Opción B)
export const detallePedido = sqliteTable(
  'detalle_pedido',
  {
    detallePedidoId: text('detalle_pedido_id').primaryKey().$defaultFn(uuid),
    pedidoProveedorId: text('pedido_proveedor_id')
      .notNull()
      .references(() => pedidoProveedor.pedidoProveedorId, {
        onDelete: 'cascade',
      }),
    productoId: integer('producto_id')
      .notNull()
      .references(() => producto.productoId, { onDelete: 'restrict' }),
    cantidadSolicitada: integer('cantidad_solicitada').notNull(),
    cantidadRecibida: integer('cantidad_recibida'),
  },
  (t) => [
    check('detalle_pedido_uuid', uuidCheck('detalle_pedido_id')),
    check('detalle_pedido_solicitada_min', sql`${t.cantidadSolicitada} > 0`),
    check(
      'detalle_pedido_recibida_range',
      sql`${t.cantidadRecibida} IS NULL OR ${t.cantidadRecibida} >= 0`,
    ),
    uniqueIndex('uq_detalle_pedido').on(t.pedidoProveedorId, t.productoId),
    index('idx_detalle_pedido_pedido').on(t.pedidoProveedorId),
  ],
);

export const historialAuditoriaPedido = sqliteTable(
  'historial_auditoria_pedido',
  {
    historialAuditoriaPedidoId: text('historial_auditoria_pedido_id')
      .primaryKey()
      .$defaultFn(uuid),
    historialApTipoEvento: text('historial_ap_tipo_evento').notNull(),
    historialApFechaHora: text('historial_ap_fecha_hora')
      .notNull()
      .default(nowDefault),
    historialApNota: text('historial_ap_nota'),
    pedidoProveedorId: text('pedido_proveedor_id')
      .notNull()
      .references(() => pedidoProveedor.pedidoProveedorId, {
        onDelete: 'restrict',
      }),
    usuarioId: text('usuario_id')
      .notNull()
      .references(() => usuario.usuarioId, { onDelete: 'restrict' }),
  },
  (t) => [
    check(
      'historial_auditoria_pedido_uuid',
      uuidCheck('historial_auditoria_pedido_id'),
    ),
    index('idx_historial_ap_pedido').on(
      t.pedidoProveedorId,
      t.historialApFechaHora,
    ),
  ],
);

// ============================================================================
// MÓDULO 4 (resto) — TRABAJADORES Y ACCESO
// ============================================================================

export const usuarioVersion = sqliteTable(
  'usuario_version',
  {
    usuarioVersionId: text('usuario_version_id').primaryKey().$defaultFn(uuid),
    usuarioVersionNombre: text('usuario_version_nombre').notNull(),
    usuarioVersionRol: text('usuario_version_rol', {
      enum: ['dueño', 'cajero', 'reponedor'],
    }).notNull(),
    usuarioVersionFechaHoraVigenciaDesde: text(
      'usuario_version_fecha_hora_vigencia_desde',
    )
      .notNull()
      .default(nowDefault),
    usuarioVersionFechaHoraVigenciaHasta: text(
      'usuario_version_fecha_hora_vigencia_hasta',
    ),
    usuarioId: text('usuario_id')
      .notNull()
      .references(() => usuario.usuarioId, { onDelete: 'restrict' }),
  },
  (t) => [
    check('usuario_version_uuid', uuidCheck('usuario_version_id')),
    check(
      'usuario_version_rol_enum',
      sql`${t.usuarioVersionRol} IN ('dueño','cajero','reponedor')`,
    ),
    check(
      'usuario_version_vigencia_rango',
      sql`${t.usuarioVersionFechaHoraVigenciaHasta} IS NULL
       OR ${t.usuarioVersionFechaHoraVigenciaDesde} <= ${t.usuarioVersionFechaHoraVigenciaHasta}`,
    ),
    index('idx_usuario_version_usuario').on(
      t.usuarioId,
      t.usuarioVersionFechaHoraVigenciaDesde,
    ),
  ],
);

export const contrasena = sqliteTable(
  'contrasena',
  {
    contrasenaId: text('contrasena_id').primaryKey().$defaultFn(uuid),
    contrasenaHash: text('contrasena_hash').notNull(),
    contrasenaFechaHoraCreacion: text('contrasena_fecha_hora_creacion')
      .notNull()
      .default(nowDefault),
    // Flags discriminadores ISA (especialización temporal / definitiva).
    esContrasenaTemporal: integer('es_contrasena_temporal', {
      mode: 'boolean',
    }).notNull(),
    esContrasenaDefinitiva: integer('es_contrasena_definitiva', {
      mode: 'boolean',
    }).notNull(),
    usuarioId: text('usuario_id')
      .notNull()
      .references(() => usuario.usuarioId, { onDelete: 'cascade' }),
    generadaPorUsuarioId: text('generada_por_usuario_id').references(
      () => usuario.usuarioId,
      { onDelete: 'set null' },
    ),
  },
  (t) => [
    check('contrasena_uuid', uuidCheck('contrasena_id')),
    // ISA: exactamente uno de los dos flags es verdadero.
    check(
      'contrasena_isa_exclusivo',
      sql`${t.esContrasenaTemporal} + ${t.esContrasenaDefinitiva} = 1`,
    ),
    index('idx_contrasena_usuario').on(
      t.usuarioId,
      t.contrasenaFechaHoraCreacion,
    ),
  ],
);

// Subtipo ISA 1:1 de contrasena
export const contrasenaTemporal = sqliteTable('contrasena_temporal', {
  contrasenaId: text('contrasena_id')
    .primaryKey()
    .references(() => contrasena.contrasenaId, { onDelete: 'cascade' }),
  contrasenaTemporalFechaHoraExpiracion: text(
    'contrasena_temporal_fecha_hora_expiracion',
  ).notNull(),
});

export const sesionUsuario = sqliteTable(
  'sesion_usuario',
  {
    sesionUsuarioId: text('sesion_usuario_id').primaryKey().$defaultFn(uuid),
    sesionFechaHoraInicio: text('sesion_fecha_hora_inicio')
      .notNull()
      .default(nowDefault),
    sesionFechaHoraUltimoAcceso: text('sesion_fecha_hora_ultimo_acceso')
      .notNull()
      .default(nowDefault),
    sesionFechaHoraCierre: text('sesion_fecha_hora_cierre'),
    sesionMotivoCierre: text('sesion_motivo_cierre', {
      enum: ['manual', 'inactividad', 'sistema'],
    }),
    usuarioId: text('usuario_id')
      .notNull()
      .references(() => usuario.usuarioId, { onDelete: 'restrict' }),
  },
  (t) => [
    check('sesion_usuario_uuid', uuidCheck('sesion_usuario_id')),
    check(
      'sesion_motivo_cierre_enum',
      sql`${t.sesionMotivoCierre} IS NULL OR ${t.sesionMotivoCierre} IN ('manual','inactividad','sistema')`,
    ),
    check(
      'sesion_cierre_coherente',
      sql`(${t.sesionFechaHoraCierre} IS NULL AND ${t.sesionMotivoCierre} IS NULL)
       OR (${t.sesionFechaHoraCierre} IS NOT NULL AND ${t.sesionMotivoCierre} IS NOT NULL)`,
    ),
    index('idx_sesion_usuario').on(t.usuarioId, t.sesionFechaHoraInicio),
  ],
);

export const intentoLogin = sqliteTable(
  'intento_login',
  {
    intentoLoginId: text('intento_login_id').primaryKey().$defaultFn(uuid),
    intentoNombreUsuarioIngresado: text('intento_nombre_usuario_ingresado')
      .notNull(),
    intentoFechaHora: text('intento_fecha_hora').notNull().default(nowDefault),
    intentoExitoso: integer('intento_exitoso', { mode: 'boolean' }).notNull(),
    usuarioId: text('usuario_id').references(() => usuario.usuarioId, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    check('intento_login_uuid', uuidCheck('intento_login_id')),
    check('intento_login_exitoso_bool', sql`${t.intentoExitoso} IN (0,1)`),
    index('idx_intento_login_fecha').on(t.intentoFechaHora),
    index('idx_intento_login_usuario').on(t.usuarioId, t.intentoFechaHora),
  ],
);

export const turno = sqliteTable(
  'turno',
  {
    turnoId: text('turno_id').primaryKey().$defaultFn(uuid),
    turnoFechaHoraInicio: text('turno_fecha_hora_inicio').notNull(),
    turnoFechaHoraFin: text('turno_fecha_hora_fin').notNull(),
    turnoEstado: text('turno_estado', {
      enum: ['planificado', 'en_curso', 'completado', 'cancelado'],
    })
      .notNull()
      .default('planificado'),
    trabajadorId: integer('trabajador_id')
      .notNull()
      .references(() => trabajador.trabajadorId, { onDelete: 'restrict' }),
  },
  (t) => [
    check('turno_uuid', uuidCheck('turno_id')),
    check(
      'turno_estado_enum',
      sql`${t.turnoEstado} IN ('planificado','en_curso','completado','cancelado')`,
    ),
    check(
      'turno_rango_valido',
      sql`${t.turnoFechaHoraInicio} < ${t.turnoFechaHoraFin}`,
    ),
    index('idx_turno_trabajador').on(t.trabajadorId, t.turnoFechaHoraInicio),
  ],
);

export const asistencia = sqliteTable(
  'asistencia',
  {
    asistenciaId: text('asistencia_id').primaryKey().$defaultFn(uuid),
    asistenciaFechaHoraEntrada: text('asistencia_fecha_hora_entrada').notNull(),
    asistenciaFechaHoraSalida: text('asistencia_fecha_hora_salida'),
    trabajadorId: integer('trabajador_id')
      .notNull()
      .references(() => trabajador.trabajadorId, { onDelete: 'restrict' }),
    turnoId: text('turno_id').references(() => turno.turnoId, {
      onDelete: 'restrict',
    }),
  },
  (t) => [
    check('asistencia_uuid', uuidCheck('asistencia_id')),
    check(
      'asistencia_rango_valido',
      sql`${t.asistenciaFechaHoraSalida} IS NULL
       OR ${t.asistenciaFechaHoraEntrada} <= ${t.asistenciaFechaHoraSalida}`,
    ),
    index('idx_asistencia_trabajador').on(
      t.trabajadorId,
      t.asistenciaFechaHoraEntrada,
    ),
  ],
);

export const ausencia = sqliteTable(
  'ausencia',
  {
    ausenciaId: text('ausencia_id').primaryKey().$defaultFn(uuid),
    ausenciaFecha: text('ausencia_fecha').notNull(),
    ausenciaTipo: text('ausencia_tipo', {
      enum: ['justificada', 'injustificada', 'licencia', 'vacaciones', 'permiso'],
    }).notNull(),
    ausenciaObservacion: text('ausencia_observacion'),
    ausenciaFechaHoraRegistro: text('ausencia_fecha_hora_registro')
      .notNull()
      .default(nowDefault),
    trabajadorId: integer('trabajador_id')
      .notNull()
      .references(() => trabajador.trabajadorId, { onDelete: 'restrict' }),
    usuarioRegistradorId: text('usuario_registrador_id')
      .notNull()
      .references(() => usuario.usuarioId, { onDelete: 'restrict' }),
  },
  (t) => [
    check('ausencia_uuid', uuidCheck('ausencia_id')),
    check(
      'ausencia_tipo_enum',
      sql`${t.ausenciaTipo} IN ('justificada','injustificada','licencia','vacaciones','permiso')`,
    ),
    uniqueIndex('uq_ausencia_trabajador_fecha').on(
      t.trabajadorId,
      t.ausenciaFecha,
    ),
  ],
);

export const remuneracion = sqliteTable(
  'remuneracion',
  {
    remuneracionId: text('remuneracion_id').primaryKey().$defaultFn(uuid),
    remuneracionMes: integer('remuneracion_mes').notNull(),
    remuneracionAnio: integer('remuneracion_anio').notNull(),
    remuneracionMontoBruto: integer('remuneracion_monto_bruto').notNull(),
    remuneracionObservacion: text('remuneracion_observacion'),
    remuneracionFechaHoraRegistro: text('remuneracion_fecha_hora_registro')
      .notNull()
      .default(nowDefault),
    trabajadorId: integer('trabajador_id')
      .notNull()
      .references(() => trabajador.trabajadorId, { onDelete: 'restrict' }),
    usuarioRegistradorId: text('usuario_registrador_id')
      .notNull()
      .references(() => usuario.usuarioId, { onDelete: 'restrict' }),
  },
  (t) => [
    check('remuneracion_uuid', uuidCheck('remuneracion_id')),
    check('remuneracion_mes_range', sql`${t.remuneracionMes} BETWEEN 1 AND 12`),
    check(
      'remuneracion_anio_range',
      sql`${t.remuneracionAnio} BETWEEN 2020 AND 2100`,
    ),
    check('remuneracion_bruto_min', sql`${t.remuneracionMontoBruto} >= 0`),
    uniqueIndex('uq_remuneracion_trabajador_periodo').on(
      t.trabajadorId,
      t.remuneracionAnio,
      t.remuneracionMes,
    ),
  ],
);

export const tasaLegal = sqliteTable(
  'tasa_legal',
  {
    tasaLegalId: integer('tasa_legal_id').primaryKey({ autoIncrement: true }),
    tasaLegalTipo: text('tasa_legal_tipo', {
      enum: ['afp', 'salud', 'cesantia', 'impuesto', 'otro'],
    }).notNull(),
    tasaLegalValor: real('tasa_legal_valor').notNull(),
    tasaLegalFechaVigenciaDesde: text('tasa_legal_fecha_vigencia_desde')
      .notNull(),
    tasaLegalFechaVigenciaHasta: text('tasa_legal_fecha_vigencia_hasta'),
  },
  (t) => [
    check(
      'tasa_legal_tipo_enum',
      sql`${t.tasaLegalTipo} IN ('afp','salud','cesantia','impuesto','otro')`,
    ),
    check(
      'tasa_legal_valor_range',
      sql`${t.tasaLegalValor} BETWEEN 0 AND 100`,
    ),
    check(
      'tasa_legal_vigencia_rango',
      sql`${t.tasaLegalFechaVigenciaHasta} IS NULL
       OR ${t.tasaLegalFechaVigenciaDesde} <= ${t.tasaLegalFechaVigenciaHasta}`,
    ),
  ],
);

// Intermedia M:N (remuneracion <-> tasa_legal) con PK propia (Opción B)
export const remuneracionTasa = sqliteTable(
  'remuneracion_tasa',
  {
    remuneracionTasaId: text('remuneracion_tasa_id')
      .primaryKey()
      .$defaultFn(uuid),
    remuneracionId: text('remuneracion_id')
      .notNull()
      .references(() => remuneracion.remuneracionId, { onDelete: 'cascade' }),
    tasaLegalId: integer('tasa_legal_id')
      .notNull()
      .references(() => tasaLegal.tasaLegalId, { onDelete: 'restrict' }),
  },
  (t) => [
    check('remuneracion_tasa_uuid', uuidCheck('remuneracion_tasa_id')),
    uniqueIndex('uq_remuneracion_tasa').on(t.remuneracionId, t.tasaLegalId),
  ],
);

// ============================================================================
// MÓDULO 5 — VENTAS
// ============================================================================

export const cierreCaja = sqliteTable(
  'cierre_caja',
  {
    cierreCajaId: text('cierre_caja_id').primaryKey().$defaultFn(uuid),
    cierreFechaHoraInicio: text('cierre_fecha_hora_inicio')
      .notNull()
      .unique()
      .default(nowDefault),
    cierreEstado: text('cierre_estado', { enum: ['abierto', 'cerrado'] })
      .notNull()
      .default('abierto'),
    cierreFechaHoraFin: text('cierre_fecha_hora_fin'),
    usuarioCierreId: text('usuario_cierre_id').references(
      () => usuario.usuarioId,
      { onDelete: 'restrict' },
    ),
  },
  (t) => [
    check('cierre_caja_uuid', uuidCheck('cierre_caja_id')),
    check(
      'cierre_estado_enum',
      sql`${t.cierreEstado} IN ('abierto','cerrado')`,
    ),
    check(
      'cierre_fin_coherente',
      sql`(${t.cierreEstado} = 'abierto' AND ${t.cierreFechaHoraFin} IS NULL
            AND ${t.usuarioCierreId} IS NULL)
       OR (${t.cierreEstado} = 'cerrado' AND ${t.cierreFechaHoraFin} IS NOT NULL
            AND ${t.usuarioCierreId} IS NOT NULL)`,
    ),
  ],
);

export const venta = sqliteTable(
  'venta',
  {
    ventaId: text('venta_id').primaryKey().$defaultFn(uuid),
    ventaFechaHora: text('venta_fecha_hora').notNull().default(nowDefault),
    ventaDescuentoTipo: text('venta_descuento_tipo', {
      enum: ['ninguno', 'porcentaje', 'monto'],
    })
      .notNull()
      .default('ninguno'),
    ventaDescuentoValor: integer('venta_descuento_valor'),
    ventaDescuentoRazon: text('venta_descuento_razon'),
    ventaMetodoPago: text('venta_metodo_pago', {
      enum: ['efectivo', 'debito', 'credito', 'transferencia'],
    }).notNull(),
    ventaEstado: text('venta_estado', { enum: ['completada', 'anulada'] })
      .notNull()
      .default('completada'),
    // Flags discriminadores ISA (especialización efectivo / electrónica).
    esVentaEfectivo: integer('es_venta_efectivo', {
      mode: 'boolean',
    }).notNull(),
    esVentaElectronica: integer('es_venta_electronica', {
      mode: 'boolean',
    }).notNull(),
    usuarioCajeroId: text('usuario_cajero_id')
      .notNull()
      .references(() => usuario.usuarioId, { onDelete: 'restrict' }),
    cierreCajaId: text('cierre_caja_id')
      .notNull()
      .references(() => cierreCaja.cierreCajaId, { onDelete: 'restrict' }),
  },
  (t) => [
    check('venta_uuid', uuidCheck('venta_id')),
    check(
      'venta_descuento_tipo_enum',
      sql`${t.ventaDescuentoTipo} IN ('ninguno','porcentaje','monto')`,
    ),
    check(
      'venta_metodo_pago_enum',
      sql`${t.ventaMetodoPago} IN ('efectivo','debito','credito','transferencia')`,
    ),
    check(
      'venta_estado_enum',
      sql`${t.ventaEstado} IN ('completada','anulada')`,
    ),
    check(
      'venta_descuento_coherente',
      sql`(${t.ventaDescuentoTipo} = 'ninguno' AND ${t.ventaDescuentoValor} IS NULL)
       OR (${t.ventaDescuentoTipo} <> 'ninguno' AND ${t.ventaDescuentoValor} IS NOT NULL AND ${t.ventaDescuentoValor} > 0)`,
    ),
    // ISA: exactamente un flag verdadero, y coherente con el método de pago
    // (efectivo => es_venta_efectivo; débito/crédito/transferencia => electrónica).
    check(
      'venta_isa_coherente',
      sql`(${t.ventaMetodoPago} = 'efectivo'
            AND ${t.esVentaEfectivo} = 1 AND ${t.esVentaElectronica} = 0)
       OR (${t.ventaMetodoPago} <> 'efectivo'
            AND ${t.esVentaEfectivo} = 0 AND ${t.esVentaElectronica} = 1)`,
    ),
    index('idx_venta_fecha').on(t.ventaFechaHora),
    index('idx_venta_cierre').on(t.cierreCajaId),
    index('idx_venta_cajero').on(t.usuarioCajeroId, t.ventaFechaHora),
    index('idx_venta_estado').on(t.ventaEstado),
  ],
);

// Subtipo ISA 1:1 de venta
export const ventaEfectivo = sqliteTable(
  'venta_efectivo',
  {
    ventaId: text('venta_id')
      .primaryKey()
      .references(() => venta.ventaId, { onDelete: 'cascade' }),
    ventaEfectivoMontoRecibido: integer('venta_efectivo_monto_recibido')
      .notNull(),
  },
  (t) => [
    check('venta_efectivo_min', sql`${t.ventaEfectivoMontoRecibido} >= 0`),
  ],
);

// Intermedia M:N (venta <-> producto) con PK propia (Opción B)
export const detalleVenta = sqliteTable(
  'detalle_venta',
  {
    detalleVentaId: text('detalle_venta_id').primaryKey().$defaultFn(uuid),
    ventaId: text('venta_id')
      .notNull()
      .references(() => venta.ventaId, { onDelete: 'cascade' }),
    productoId: integer('producto_id')
      .notNull()
      .references(() => producto.productoId, { onDelete: 'restrict' }),
    detalleVentaCantidad: integer('detalle_venta_cantidad').notNull(),
    historialPrecioProductoId: text('historial_precio_producto_id')
      .notNull()
      .references(
        () => historialPrecioProducto.historialPrecioProductoId,
        { onDelete: 'restrict' },
      ),
  },
  (t) => [
    check('detalle_venta_uuid', uuidCheck('detalle_venta_id')),
    check('detalle_venta_cantidad_min', sql`${t.detalleVentaCantidad} > 0`),
    uniqueIndex('uq_detalle_venta').on(t.ventaId, t.productoId),
    index('idx_detalle_venta_venta').on(t.ventaId),
    index('idx_detalle_venta_producto').on(t.productoId),
  ],
);

// Intermedia M:N (venta <-> lote) con PK propia (Opción B)
export const ventaLote = sqliteTable(
  'venta_lote',
  {
    ventaLoteId: text('venta_lote_id').primaryKey().$defaultFn(uuid),
    ventaId: text('venta_id')
      .notNull()
      .references(() => venta.ventaId, { onDelete: 'cascade' }),
    loteId: text('lote_id')
      .notNull()
      .references(() => lote.loteId, { onDelete: 'restrict' }),
    ventaLoteCantidadConsumida: integer('venta_lote_cantidad_consumida')
      .notNull(),
  },
  (t) => [
    check('venta_lote_uuid', uuidCheck('venta_lote_id')),
    check(
      'venta_lote_cantidad_min',
      sql`${t.ventaLoteCantidadConsumida} > 0`,
    ),
    uniqueIndex('uq_venta_lote').on(t.ventaId, t.loteId),
  ],
);

export const anulacionVenta = sqliteTable(
  'anulacion_venta',
  {
    anulacionVentaId: text('anulacion_venta_id').primaryKey().$defaultFn(uuid),
    anulacionFechaHora: text('anulacion_fecha_hora')
      .notNull()
      .default(nowDefault),
    anulacionRazon: text('anulacion_razon').notNull(),
    ventaId: text('venta_id')
      .notNull()
      .unique()
      .references(() => venta.ventaId, { onDelete: 'restrict' }),
    usuarioId: text('usuario_id')
      .notNull()
      .references(() => usuario.usuarioId, { onDelete: 'restrict' }),
  },
  (t) => [
    check('anulacion_venta_uuid', uuidCheck('anulacion_venta_id')),
  ],
);

// ============================================================================
// MÓDULO 7 — LOGS Y AUDITORÍA
// ============================================================================

export const logAuditoria = sqliteTable(
  'log_auditoria',
  {
    logAuditoriaId: text('log_auditoria_id').primaryKey().$defaultFn(uuid),
    logFechaHora: text('log_fecha_hora').notNull().default(nowDefault),
    logTipoAccion: text('log_tipo_accion').notNull(),
    logModulo: text('log_modulo').notNull(),
    logDescripcion: text('log_descripcion').notNull(),
    usuarioVersionId: text('usuario_version_id')
      .notNull()
      .references(() => usuarioVersion.usuarioVersionId, {
        onDelete: 'restrict',
      }),
  },
  (t) => [
    check('log_auditoria_uuid', uuidCheck('log_auditoria_id')),
    index('idx_log_auditoria_fecha').on(t.logFechaHora),
    index('idx_log_auditoria_modulo').on(t.logModulo, t.logFechaHora),
  ],
);

export const logErroresTecnicos = sqliteTable(
  'log_errores_tecnicos',
  {
    logErrortecnicosId: text('log_errortecnicos_id')
      .primaryKey()
      .$defaultFn(uuid),
    logErroresFechaHora: text('log_errores_fecha_hora')
      .notNull()
      .default(nowDefault),
    logErroresTipoError: text('log_errores_tipo_error').notNull(),
    logErroresModulo: text('log_errores_modulo').notNull(),
    logErroresDescripcionTecnica: text('log_errores_descripcion_tecnica')
      .notNull(),
    usuarioId: text('usuario_id').references(() => usuario.usuarioId, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    check('log_errores_tecnicos_uuid', uuidCheck('log_errortecnicos_id')),
    index('idx_log_errores_fecha').on(t.logErroresFechaHora),
    index('idx_log_errores_modulo').on(t.logErroresModulo, t.logErroresFechaHora),
  ],
);

// ============================================================================
// Type helpers
// ============================================================================

export type Trabajador = typeof trabajador.$inferSelect;
export type NewTrabajador = typeof trabajador.$inferInsert;
export type Usuario = typeof usuario.$inferSelect;
export type NewUsuario = typeof usuario.$inferInsert;
export type Categoria = typeof categoria.$inferSelect;
export type NewCategoria = typeof categoria.$inferInsert;
export type Producto = typeof producto.$inferSelect;
export type NewProducto = typeof producto.$inferInsert;
export type Proveedor = typeof proveedor.$inferSelect;
export type NewProveedor = typeof proveedor.$inferInsert;
export type Lote = typeof lote.$inferSelect;
export type NewLote = typeof lote.$inferInsert;
export type Venta = typeof venta.$inferSelect;
export type NewVenta = typeof venta.$inferInsert;
export type DetalleVenta = typeof detalleVenta.$inferSelect;
export type NewDetalleVenta = typeof detalleVenta.$inferInsert;
export type LogAuditoria = typeof logAuditoria.$inferSelect;
export type NewLogAuditoria = typeof logAuditoria.$inferInsert;
