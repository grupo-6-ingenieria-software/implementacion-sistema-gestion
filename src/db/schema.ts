/**
 * Drizzle schema — Minimarket y Panadería Huáscar
 * libSQL/Turso (compatible SQLite 3.x)
 *
 * Espejo TypeScript de db/schema/schema.sql. La SQL es la referencia humana;
 * este archivo es la fuente de verdad para tipos de Drizzle y la generación
 * de migraciones con drizzle-kit.
 *
 * Triggers no se representan acá (Drizzle no los soporta en TS); viven en el
 * archivo db/drizzle/triggers.sql que se aplica como migración custom.
 *
 * Activación de FKs: el cliente debe ejecutar `PRAGMA foreign_keys = ON` en
 * cada conexión a libSQL/Turso. Sin esto los REFERENCES son decorativos.
 */

import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { ulid } from 'ulid';

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/** ULID 26 chars Crockford base32. Generado en cliente por concurrencia. */
const ulidCheck = (col: string) =>
  sql.raw(
    `length(${col}) = 26 AND NOT ${col} GLOB '*[^0-9A-HJKMNP-TV-Z]*'`,
  );

const nowDefault = sql`(datetime('now'))`;

// ============================================================================
// 1. PERSONAS
// ============================================================================

export const trabajador = sqliteTable(
  'trabajador',
  {
    trabajadorId: integer('trabajador_id').primaryKey({ autoIncrement: true }),
    rut: text('rut').notNull().unique(),
    nombres: text('nombres').notNull(),
    apellidos: text('apellidos').notNull(),
    cargo: text('cargo', {
      enum: ['dueño', 'cajero', 'reponedor', 'bodega', 'panadero', 'otro'],
    }).notNull(),
    telefono: text('telefono'),
    email: text('email'),
    contactoEmergenciaNombre: text('contacto_emergencia_nombre'),
    contactoEmergenciaTelefono: text('contacto_emergencia_telefono'),
    fechaIngreso: text('fecha_ingreso').notNull(),
    observacion: text('observacion'),
    estado: text('estado', { enum: ['activo', 'inactivo'] })
      .notNull()
      .default('activo'),
    createdAt: text('created_at').notNull().default(nowDefault),
    updatedAt: text('updated_at').notNull().default(nowDefault),
  },
  (t) => [
    check(
      'trabajador_rut_format',
      sql`length(${t.rut}) BETWEEN 9 AND 10 AND ${t.rut} GLOB '[1-9]*-[0-9kK]'`,
    ),
    check(
      'trabajador_email_format',
      sql`${t.email} IS NULL OR ${t.email} LIKE '%_@_%._%'`,
    ),
    check(
      'trabajador_cargo_enum',
      sql`${t.cargo} IN ('dueño','cajero','reponedor','bodega','panadero','otro')`,
    ),
    check('trabajador_estado_enum', sql`${t.estado} IN ('activo','inactivo')`),
  ],
);

export const usuario = sqliteTable(
  'usuario',
  {
    usuarioId: integer('usuario_id').primaryKey({ autoIncrement: true }),
    trabajadorId: integer('trabajador_id')
      .unique()
      .references(() => trabajador.trabajadorId, { onDelete: 'restrict' }),
    username: text('username').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    rol: text('rol', { enum: ['dueño', 'cajero', 'reponedor'] }).notNull(),
    intentosFallidos: integer('intentos_fallidos').notNull().default(0),
    bloqueadoHasta: text('bloqueado_hasta'),
    ultimoLogin: text('ultimo_login'),
    requiereCambioPassword: integer('requiere_cambio_password')
      .notNull()
      .default(0),
    passwordTemporalExpiraAt: text('password_temporal_expira_at'),
    observacion: text('observacion'),
    createdAt: text('created_at').notNull().default(nowDefault),
    updatedAt: text('updated_at').notNull().default(nowDefault),
  },
  (t) => [
    check(
      'usuario_username_length',
      sql`length(${t.username}) BETWEEN 3 AND 32`,
    ),
    check('usuario_rol_enum', sql`${t.rol} IN ('dueño','cajero','reponedor')`),
    check('usuario_intentos_min', sql`${t.intentosFallidos} >= 0`),
    check(
      'usuario_requiere_cambio_bool',
      sql`${t.requiereCambioPassword} IN (0,1)`,
    ),
  ],
);

export const turno = sqliteTable(
  'turno',
  {
    turnoId: integer('turno_id').primaryKey({ autoIncrement: true }),
    trabajadorId: integer('trabajador_id')
      .notNull()
      .references(() => trabajador.trabajadorId, { onDelete: 'restrict' }),
    inicioAt: text('inicio_at').notNull(),
    finAt: text('fin_at').notNull(),
    estado: text('estado', {
      enum: ['planificado', 'en_curso', 'completado', 'cancelado'],
    })
      .notNull()
      .default('planificado'),
    observacion: text('observacion'),
    creadoPorUsuarioId: integer('creado_por_usuario_id').references(
      () => usuario.usuarioId,
      { onDelete: 'set null' },
    ),
    createdAt: text('created_at').notNull().default(nowDefault),
    updatedAt: text('updated_at').notNull().default(nowDefault),
  },
  (t) => [
    check(
      'turno_estado_enum',
      sql`${t.estado} IN ('planificado','en_curso','completado','cancelado')`,
    ),
    check('turno_rango_valido', sql`${t.inicioAt} < ${t.finAt}`),
    index('idx_turno_trabajador').on(t.trabajadorId, t.inicioAt),
  ],
);

export const asistencia = sqliteTable(
  'asistencia',
  {
    asistenciaId: integer('asistencia_id').primaryKey({ autoIncrement: true }),
    trabajadorId: integer('trabajador_id')
      .notNull()
      .references(() => trabajador.trabajadorId, { onDelete: 'restrict' }),
    turnoId: integer('turno_id').references(() => turno.turnoId, {
      onDelete: 'restrict', // RF27: no borrar turno con asistencia
    }),
    fecha: text('fecha').notNull(),
    tipo: text('tipo', {
      enum: ['presente', 'tardanza', 'justificada', 'injustificada'],
    }).notNull(),
    entradaAt: text('entrada_at'),
    salidaAt: text('salida_at'),
    observacion: text('observacion'),
    createdAt: text('created_at').notNull().default(nowDefault),
    updatedAt: text('updated_at').notNull().default(nowDefault),
  },
  (t) => [
    uniqueIndex('uq_asistencia_trab_fecha').on(t.trabajadorId, t.fecha),
    check(
      'asistencia_tipo_enum',
      sql`${t.tipo} IN ('presente','tardanza','justificada','injustificada')`,
    ),
    // Coherencia tipo <-> entrada/salida (RF30, RF32)
    check(
      'asistencia_coherencia_tipo_horas',
      sql`(${t.tipo} IN ('justificada','injustificada')
            AND ${t.entradaAt} IS NULL AND ${t.salidaAt} IS NULL)
       OR (${t.tipo} IN ('presente','tardanza')
            AND (${t.salidaAt} IS NULL
                 OR (${t.entradaAt} IS NOT NULL AND ${t.entradaAt} <= ${t.salidaAt})))`,
    ),
  ],
);

export const configPrevisional = sqliteTable(
  'config_previsional',
  {
    configPrevisionalId: integer('config_previsional_id').primaryKey({
      autoIncrement: true,
    }),
    afpPct: real('afp_pct').notNull(),
    saludPct: real('salud_pct').notNull(),
    cesantiaPct: real('cesantia_pct').notNull(),
    updatedBy: integer('updated_by').references(() => usuario.usuarioId, {
      onDelete: 'set null',
    }),
    updatedAt: text('updated_at').notNull().default(nowDefault),
  },
  (t) => [
    check('config_afp_range', sql`${t.afpPct} BETWEEN 0 AND 100`),
    check('config_salud_range', sql`${t.saludPct} BETWEEN 0 AND 100`),
    check('config_cesantia_range', sql`${t.cesantiaPct} BETWEEN 0 AND 100`),
  ],
);

export const remuneracion = sqliteTable(
  'remuneracion',
  {
    remuneracionId: integer('remuneracion_id').primaryKey({
      autoIncrement: true,
    }),
    trabajadorId: integer('trabajador_id')
      .notNull()
      .references(() => trabajador.trabajadorId, { onDelete: 'restrict' }),
    mes: integer('mes').notNull(),
    anio: integer('anio').notNull(),
    montoBruto: integer('monto_bruto').notNull(),
    montoLiquido: integer('monto_liquido').notNull(),
    estado: text('estado', { enum: ['pendiente', 'pagada', 'anulada'] })
      .notNull()
      .default('pendiente'),
    observacion: text('observacion'),
    createdAt: text('created_at').notNull().default(nowDefault),
  },
  (t) => [
    uniqueIndex('uq_remuneracion_trab_periodo').on(t.trabajadorId, t.mes, t.anio),
    check('remuneracion_mes_range', sql`${t.mes} BETWEEN 1 AND 12`),
    check('remuneracion_anio_range', sql`${t.anio} BETWEEN 2020 AND 2100`),
    check('remuneracion_bruto_min', sql`${t.montoBruto} >= 0`),
    check('remuneracion_liquido_min', sql`${t.montoLiquido} >= 0`),
    check(
      'remuneracion_estado_enum',
      sql`${t.estado} IN ('pendiente','pagada','anulada')`,
    ),
    check(
      'remuneracion_liquido_lte_bruto',
      sql`${t.montoLiquido} <= ${t.montoBruto}`,
    ),
  ],
);

// ============================================================================
// 2. CATÁLOGO Y PROVEEDORES
// ============================================================================

export const categoria = sqliteTable(
  'categoria',
  {
    categoriaId: integer('categoria_id').primaryKey({ autoIncrement: true }),
    nombre: text('nombre').notNull().unique(),
    requiereVencimiento: integer('requiere_vencimiento').notNull().default(0),
  },
  (t) => [
    check('categoria_requiere_venc_bool', sql`${t.requiereVencimiento} IN (0,1)`),
  ],
);

export const proveedor = sqliteTable(
  'proveedor',
  {
    proveedorId: integer('proveedor_id').primaryKey({ autoIncrement: true }),
    rut: text('rut').notNull().unique(),
    razonSocial: text('razon_social').notNull(),
    contacto: text('contacto'),
    telefono: text('telefono'),
    email: text('email'),
    estado: text('estado', { enum: ['activo', 'inactivo'] })
      .notNull()
      .default('activo'),
    observacion: text('observacion'),
    createdAt: text('created_at').notNull().default(nowDefault),
  },
  (t) => [
    check(
      'proveedor_rut_format',
      sql`length(${t.rut}) BETWEEN 9 AND 10 AND ${t.rut} GLOB '[1-9]*-[0-9kK]'`,
    ),
    check(
      'proveedor_email_format',
      sql`${t.email} IS NULL OR ${t.email} LIKE '%_@_%._%'`,
    ),
    check('proveedor_estado_enum', sql`${t.estado} IN ('activo','inactivo')`),
  ],
);

export const proveedorCategoria = sqliteTable(
  'proveedor_categoria',
  {
    proveedorId: integer('proveedor_id')
      .notNull()
      .references(() => proveedor.proveedorId, { onDelete: 'cascade' }),
    categoriaId: integer('categoria_id')
      .notNull()
      .references(() => categoria.categoriaId, { onDelete: 'restrict' }),
  },
  (t) => [primaryKey({ columns: [t.proveedorId, t.categoriaId] })],
);

export const producto = sqliteTable(
  'producto',
  {
    productoId: integer('producto_id').primaryKey({ autoIncrement: true }),
    categoriaId: integer('categoria_id')
      .notNull()
      .references(() => categoria.categoriaId, { onDelete: 'restrict' }),
    ean13: text('ean13').notNull().unique(),
    nombre: text('nombre').notNull(),
    descripcion: text('descripcion'),
    unidadMedida: text('unidad_medida', {
      enum: ['unidad', 'kg', 'g', 'litro', 'ml'],
    }).notNull(),
    precioCosto: integer('precio_costo').notNull(),
    precioVenta: integer('precio_venta').notNull(),
    stockMinimo: real('stock_minimo').notNull().default(0),
    estado: text('estado', { enum: ['activo', 'inactivo'] })
      .notNull()
      .default('activo'),
    createdAt: text('created_at').notNull().default(nowDefault),
  },
  (t) => [
    check(
      'producto_ean13_format',
      sql`length(${t.ean13}) = 13 AND ${t.ean13} GLOB '[0-9]*'`,
    ),
    check(
      'producto_unidad_enum',
      sql`${t.unidadMedida} IN ('unidad','kg','g','litro','ml')`,
    ),
    check('producto_precio_costo_min', sql`${t.precioCosto} >= 0`),
    check('producto_precio_venta_min', sql`${t.precioVenta} >= 0`),
    check('producto_stock_min', sql`${t.stockMinimo} >= 0`),
    check('producto_estado_enum', sql`${t.estado} IN ('activo','inactivo')`),
    index('idx_producto_nombre').on(t.nombre),
    index('idx_producto_estado').on(t.estado),
    index('idx_producto_categoria').on(t.categoriaId),
  ],
);

// ============================================================================
// 3. COMPRAS
// ============================================================================

export const pedido = sqliteTable(
  'pedido',
  {
    pedidoId: integer('pedido_id').primaryKey({ autoIncrement: true }),
    proveedorId: integer('proveedor_id')
      .notNull()
      .references(() => proveedor.proveedorId, { onDelete: 'restrict' }),
    entregaEstimada: text('entrega_estimada'),
    email: text('email'),
    comentario: text('comentario'),
    observacion: text('observacion'),
    createdAt: text('created_at').notNull().default(nowDefault),
  },
  (t) => [
    check(
      'pedido_email_format',
      sql`${t.email} IS NULL OR ${t.email} LIKE '%_@_%._%'`,
    ),
    index('idx_pedido_proveedor').on(t.proveedorId),
  ],
);

export const estadoPedido = sqliteTable(
  'estado_pedido',
  {
    pedidoEstadoId: integer('pedido_estado_id').primaryKey({
      autoIncrement: true,
    }),
    pedidoId: integer('pedido_id')
      .notNull()
      .references(() => pedido.pedidoId, { onDelete: 'cascade' }),
    usuarioId: integer('usuario_id')
      .notNull()
      .references(() => usuario.usuarioId, { onDelete: 'restrict' }),
    estado: text('estado', {
      enum: ['pendiente', 'enviado', 'parcial', 'recibido', 'cancelado'],
    }).notNull(),
    observacion: text('observacion'),
    createdAt: text('created_at').notNull().default(nowDefault),
  },
  (t) => [
    check(
      'estado_pedido_enum',
      sql`${t.estado} IN ('pendiente','enviado','parcial','recibido','cancelado')`,
    ),
    index('idx_estado_pedido_pedido').on(t.pedidoId, t.createdAt),
  ],
);

export const detallePedido = sqliteTable(
  'detalle_pedido',
  {
    detallePedidoId: integer('detalle_pedido_id').primaryKey({
      autoIncrement: true,
    }),
    pedidoId: integer('pedido_id')
      .notNull()
      .references(() => pedido.pedidoId, { onDelete: 'cascade' }),
    productoId: integer('producto_id')
      .notNull()
      .references(() => producto.productoId, { onDelete: 'restrict' }),
    cantidadSolicitada: real('cantidad_solicitada').notNull(),
    cantidadRecibida: real('cantidad_recibida').notNull().default(0),
    precioUnitario: integer('precio_unitario').notNull(),
  },
  (t) => [
    check('detalle_pedido_solicitada_min', sql`${t.cantidadSolicitada} > 0`),
    check(
      'detalle_pedido_recibida_range',
      sql`${t.cantidadRecibida} >= 0 AND ${t.cantidadRecibida} <= ${t.cantidadSolicitada}`,
    ),
    check('detalle_pedido_precio_min', sql`${t.precioUnitario} >= 0`),
    index('idx_detalle_pedido_pedido').on(t.pedidoId),
  ],
);

export const lote = sqliteTable(
  'lote',
  {
    loteId: integer('lote_id').primaryKey({ autoIncrement: true }),
    productoId: integer('producto_id')
      .notNull()
      .references(() => producto.productoId, { onDelete: 'restrict' }),
    detallePedidoId: integer('detalle_pedido_id').references(
      () => detallePedido.detallePedidoId,
      { onDelete: 'set null' },
    ),
    // cantidad_actual SIN check >= 0: el sistema acepta negativo y lo registra
    // como discrepancia (dimensión técnica §14.23.14).
    cantidadActual: real('cantidad_actual').notNull(),
    precioUnitario: integer('precio_unitario').notNull(),
    fechaVencimiento: text('fecha_vencimiento'),
    fechaIngreso: text('fecha_ingreso').notNull().default(nowDefault),
  },
  (t) => [
    check('lote_precio_min', sql`${t.precioUnitario} >= 0`),
    index('idx_lote_producto_venc').on(t.productoId, t.fechaVencimiento),
  ],
);

// ============================================================================
// 4. VENTAS
// ============================================================================

export const cierreCaja = sqliteTable(
  'cierre_caja',
  {
    cierreCajaId: integer('cierre_caja_id').primaryKey({ autoIncrement: true }),
    usuarioId: integer('usuario_id')
      .notNull()
      .references(() => usuario.usuarioId, { onDelete: 'restrict' }),
    totalVentas: integer('total_ventas').notNull(),
    totalEfectivo: integer('total_efectivo').notNull(),
    totalDebito: integer('total_debito').notNull(),
    totalCredito: integer('total_credito').notNull(),
    totalTransferencia: integer('total_transferencia').notNull(),
    efectivoContado: integer('efectivo_contado').notNull(),
    diferenciaEfectivo: integer('diferencia_efectivo').notNull(),
    createdAt: text('created_at').notNull().default(nowDefault),
    completedAt: text('completed_at'),
  },
  (t) => [
    check('cierre_total_ventas_min', sql`${t.totalVentas} >= 0`),
    check('cierre_total_efectivo_min', sql`${t.totalEfectivo} >= 0`),
    check('cierre_total_debito_min', sql`${t.totalDebito} >= 0`),
    check('cierre_total_credito_min', sql`${t.totalCredito} >= 0`),
    check('cierre_total_transfer_min', sql`${t.totalTransferencia} >= 0`),
    check('cierre_efectivo_contado_min', sql`${t.efectivoContado} >= 0`),
    // RF41: un único cierre por usuario y día
    uniqueIndex('uq_cierre_caja_dia').on(
      t.usuarioId,
      sql`date(${t.createdAt})`,
    ),
  ],
);

export const venta = sqliteTable(
  'venta',
  {
    ventaId: text('venta_id')
      .primaryKey()
      .$defaultFn(() => ulid()),
    cierreCajaId: integer('cierre_caja_id').references(
      () => cierreCaja.cierreCajaId,
      { onDelete: 'set null' },
    ),
    usuarioId: integer('usuario_id')
      .notNull()
      .references(() => usuario.usuarioId, { onDelete: 'restrict' }),
    anuladaPorUsuarioId: integer('anulada_por_usuario_id').references(
      () => usuario.usuarioId,
      { onDelete: 'set null' },
    ),
    subtotal: integer('subtotal').notNull(),
    iva: integer('iva').notNull().default(0),
    descuento: integer('descuento').notNull().default(0),
    tipoDescuento: text('tipo_descuento', { enum: ['porcentaje', 'monto'] }),
    observacionDescuento: text('observacion_descuento'),
    total: integer('total').notNull(),
    metodoPago: text('metodo_pago', {
      enum: ['efectivo', 'debito', 'credito', 'transferencia'],
    }).notNull(),
    montoRecibido: integer('monto_recibido').notNull(),
    vuelto: integer('vuelto'),
    estado: text('estado', { enum: ['completada', 'anulada'] })
      .notNull()
      .default('completada'),
    motivoAnulacion: text('motivo_anulacion'),
    anuladoAt: text('anulado_at'),
    createdAt: text('created_at').notNull().default(nowDefault),
  },
  (t) => [
    check('venta_ulid_format', ulidCheck('venta_id')),
    check('venta_subtotal_min', sql`${t.subtotal} >= 0`),
    check('venta_iva_min', sql`${t.iva} >= 0`),
    check('venta_descuento_min', sql`${t.descuento} >= 0`),
    check('venta_total_min', sql`${t.total} >= 0`),
    check('venta_monto_recibido_min', sql`${t.montoRecibido} >= 0`),
    check('venta_vuelto_min', sql`${t.vuelto} >= 0 OR ${t.vuelto} IS NULL`),
    check(
      'venta_tipo_descuento_enum',
      sql`${t.tipoDescuento} IN ('porcentaje','monto') OR ${t.tipoDescuento} IS NULL`,
    ),
    check(
      'venta_metodo_pago_enum',
      sql`${t.metodoPago} IN ('efectivo','debito','credito','transferencia')`,
    ),
    check('venta_estado_enum', sql`${t.estado} IN ('completada','anulada')`),
    check(
      'venta_descuento_coherente',
      sql`(${t.descuento} = 0 AND ${t.tipoDescuento} IS NULL)
       OR (${t.descuento} > 0 AND ${t.tipoDescuento} IS NOT NULL)`,
    ),
    check(
      'venta_anulacion_coherente',
      sql`(${t.estado} = 'anulada' AND ${t.anuladoAt} IS NOT NULL
            AND ${t.motivoAnulacion} IS NOT NULL
            AND ${t.anuladaPorUsuarioId} IS NOT NULL)
       OR (${t.estado} = 'completada' AND ${t.anuladoAt} IS NULL
            AND ${t.motivoAnulacion} IS NULL
            AND ${t.anuladaPorUsuarioId} IS NULL)`,
    ),
    index('idx_venta_created').on(t.createdAt),
    index('idx_venta_usuario').on(t.usuarioId, t.createdAt),
    index('idx_venta_cierre').on(t.cierreCajaId),
    index('idx_venta_estado').on(t.estado),
  ],
);

export const detalleVenta = sqliteTable(
  'detalle_venta',
  {
    detalleVentaId: text('detalle_venta_id')
      .primaryKey()
      .$defaultFn(() => ulid()),
    ventaId: text('venta_id')
      .notNull()
      .references(() => venta.ventaId, { onDelete: 'cascade' }),
    productoId: integer('producto_id')
      .notNull()
      .references(() => producto.productoId, { onDelete: 'restrict' }),
    loteId: integer('lote_id').references(() => lote.loteId),
    cantidad: real('cantidad').notNull(),
    precioUnitario: integer('precio_unitario').notNull(),
    descuento: integer('descuento').notNull().default(0),
    subtotal: integer('subtotal').notNull(),
  },
  (t) => [
    check('detalle_venta_ulid_format', ulidCheck('detalle_venta_id')),
    check('detalle_venta_cantidad_min', sql`${t.cantidad} > 0`),
    check('detalle_venta_precio_min', sql`${t.precioUnitario} >= 0`),
    check('detalle_venta_descuento_min', sql`${t.descuento} >= 0`),
    check('detalle_venta_subtotal_min', sql`${t.subtotal} >= 0`),
    // Tolerancia 1 CLP por redondeo de venta a granel
    check(
      'detalle_venta_subtotal_aritmetico',
      sql`ABS(${t.subtotal} - (${t.cantidad} * ${t.precioUnitario} - ${t.descuento})) < 1`,
    ),
    index('idx_detalle_venta_venta').on(t.ventaId),
    index('idx_detalle_venta_producto').on(t.productoId),
  ],
);

// ============================================================================
// 5. INVENTARIO
// ============================================================================

export const merma = sqliteTable(
  'merma',
  {
    mermaId: integer('merma_id').primaryKey({ autoIncrement: true }),
    usuarioId: integer('usuario_id')
      .notNull()
      .references(() => usuario.usuarioId, { onDelete: 'restrict' }),
    tipo: text('tipo', {
      enum: ['vencimiento', 'robo', 'rotura', 'conteo', 'otro'],
    }).notNull(),
    observacion: text('observacion'),
    createdAt: text('created_at').notNull().default(nowDefault),
  },
  (t) => [
    check(
      'merma_tipo_enum',
      sql`${t.tipo} IN ('vencimiento','robo','rotura','conteo','otro')`,
    ),
  ],
);

export const movimientoInventario = sqliteTable(
  'movimiento_inventario',
  {
    movimientoInventarioId: text('movimiento_inventario_id')
      .primaryKey()
      .$defaultFn(() => ulid()),
    productoId: integer('producto_id')
      .notNull()
      .references(() => producto.productoId, { onDelete: 'restrict' }),
    loteId: integer('lote_id').references(() => lote.loteId),
    usuarioId: integer('usuario_id')
      .notNull()
      .references(() => usuario.usuarioId, { onDelete: 'restrict' }),
    detallePedidoId: integer('detalle_pedido_id').references(
      () => detallePedido.detallePedidoId,
      { onDelete: 'set null' },
    ),
    detalleVentaId: text('detalle_venta_id').references(
      () => detalleVenta.detalleVentaId,
      { onDelete: 'set null' },
    ),
    mermaId: integer('merma_id').references(() => merma.mermaId, {
      onDelete: 'set null',
    }),
    cantidad: real('cantidad').notNull(),
    tipo: text('tipo', {
      enum: ['entrada', 'salida', 'venta', 'merma', 'ajuste', 'devolucion'],
    }).notNull(),
    createdAt: text('created_at').notNull().default(nowDefault),
  },
  (t) => [
    check('mov_inv_ulid_format', ulidCheck('movimiento_inventario_id')),
    check(
      'mov_inv_tipo_enum',
      sql`${t.tipo} IN ('entrada','salida','venta','merma','ajuste','devolucion')`,
    ),
    // Exactamente una FK origen según tipo
    check(
      'mov_inv_origen_coherente',
      sql`(${t.tipo} = 'entrada'
            AND ${t.detallePedidoId} IS NOT NULL
            AND ${t.detalleVentaId} IS NULL
            AND ${t.mermaId} IS NULL)
       OR (${t.tipo} = 'venta'
            AND ${t.detalleVentaId} IS NOT NULL
            AND ${t.detallePedidoId} IS NULL
            AND ${t.mermaId} IS NULL)
       OR (${t.tipo} = 'merma'
            AND ${t.mermaId} IS NOT NULL
            AND ${t.detallePedidoId} IS NULL
            AND ${t.detalleVentaId} IS NULL)
       OR (${t.tipo} = 'devolucion'
            AND ${t.detalleVentaId} IS NOT NULL
            AND ${t.detallePedidoId} IS NULL
            AND ${t.mermaId} IS NULL)
       OR (${t.tipo} IN ('salida','ajuste')
            AND ${t.detallePedidoId} IS NULL
            AND ${t.detalleVentaId} IS NULL
            AND ${t.mermaId} IS NULL)`,
    ),
    // Coherencia signo cantidad <-> tipo
    check(
      'mov_inv_signo_cantidad',
      sql`(${t.tipo} IN ('entrada','devolucion') AND ${t.cantidad} > 0)
       OR (${t.tipo} IN ('venta','merma','salida') AND ${t.cantidad} < 0)
       OR (${t.tipo} = 'ajuste' AND ${t.cantidad} <> 0)`,
    ),
    index('idx_mov_producto_fecha').on(t.productoId, t.createdAt),
    index('idx_mov_lote').on(t.loteId),
    index('idx_mov_tipo').on(t.tipo),
  ],
);

export const discrepanciaStock = sqliteTable(
  'discrepancia_stock',
  {
    discrepanciaStockId: integer('discrepancia_stock_id').primaryKey({
      autoIncrement: true,
    }),
    productoId: integer('producto_id')
      .notNull()
      .references(() => producto.productoId, { onDelete: 'restrict' }),
    loteId: integer('lote_id').references(() => lote.loteId),
    ventaId: text('venta_id').references(() => venta.ventaId),
    cantidadNegativa: real('cantidad_negativa').notNull(),
    detectadoPorUsuarioId: integer('detectado_por_usuario_id')
      .notNull()
      .references(() => usuario.usuarioId, { onDelete: 'restrict' }),
    estado: text('estado', {
      enum: [
        'pendiente',
        'aceptada_merma',
        'ajuste_reposicion',
        'venta_anulada',
        'stock_cero',
      ],
    })
      .notNull()
      .default('pendiente'),
    resueltoPorUsuarioId: integer('resuelto_por_usuario_id').references(
      () => usuario.usuarioId,
      { onDelete: 'restrict' },
    ),
    resueltoAt: text('resuelto_at'),
    observacion: text('observacion'),
    createdAt: text('created_at').notNull().default(nowDefault),
  },
  (t) => [
    check('discrepancia_cantidad_min', sql`${t.cantidadNegativa} > 0`),
    check(
      'discrepancia_estado_enum',
      sql`${t.estado} IN ('pendiente','aceptada_merma','ajuste_reposicion','venta_anulada','stock_cero')`,
    ),
    check(
      'discrepancia_resolucion_coherente',
      sql`(${t.estado} = 'pendiente' AND ${t.resueltoAt} IS NULL
            AND ${t.resueltoPorUsuarioId} IS NULL)
       OR (${t.estado} <> 'pendiente' AND ${t.resueltoAt} IS NOT NULL
            AND ${t.resueltoPorUsuarioId} IS NOT NULL)`,
    ),
    index('idx_discrepancia_estado').on(t.estado, t.createdAt),
    index('idx_discrepancia_producto').on(t.productoId),
  ],
);

// ============================================================================
// 6. SISTEMA
// ============================================================================

export const auditLog = sqliteTable(
  'audit_log',
  {
    auditLogId: text('audit_log_id')
      .primaryKey()
      .$defaultFn(() => ulid()),
    usuarioId: integer('usuario_id').references(() => usuario.usuarioId),
    username: text('username'),
    rol: text('rol'),
    accion: text('accion').notNull(),
    modulo: text('modulo').notNull(),
    descripcion: text('descripcion').notNull(),
    archived: integer('archived').notNull().default(0),
    createdAt: text('created_at').notNull().default(nowDefault),
  },
  (t) => [
    check('audit_log_ulid_format', ulidCheck('audit_log_id')),
    check('audit_log_archived_bool', sql`${t.archived} IN (0,1)`),
    index('idx_audit_log_created').on(t.createdAt),
    index('idx_audit_log_usuario').on(t.usuarioId, t.createdAt),
    index('idx_audit_log_archived').on(t.archived, t.createdAt),
  ],
);

export const configSistema = sqliteTable('config_sistema', {
  clave: text('clave').primaryKey(),
  valor: text('valor').notNull(),
  descripcion: text('descripcion'),
  updatedByUsuarioId: integer('updated_by_usuario_id').references(
    () => usuario.usuarioId,
    { onDelete: 'set null' },
  ),
  updatedAt: text('updated_at').notNull().default(nowDefault),
});

// ============================================================================
// Type helpers
// ============================================================================

export type Trabajador = typeof trabajador.$inferSelect;
export type NewTrabajador = typeof trabajador.$inferInsert;
export type Usuario = typeof usuario.$inferSelect;
export type NewUsuario = typeof usuario.$inferInsert;
export type Producto = typeof producto.$inferSelect;
export type NewProducto = typeof producto.$inferInsert;
export type Venta = typeof venta.$inferSelect;
export type NewVenta = typeof venta.$inferInsert;
export type DetalleVenta = typeof detalleVenta.$inferSelect;
export type NewDetalleVenta = typeof detalleVenta.$inferInsert;
export type MovimientoInventario = typeof movimientoInventario.$inferSelect;
export type NewMovimientoInventario = typeof movimientoInventario.$inferInsert;
export type AuditLog = typeof auditLog.$inferSelect;
export type NewAuditLog = typeof auditLog.$inferInsert;
