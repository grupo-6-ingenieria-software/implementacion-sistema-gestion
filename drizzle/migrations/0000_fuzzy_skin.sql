CREATE TABLE `asistencia` (
	`asistencia_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trabajador_id` integer NOT NULL,
	`turno_id` integer,
	`fecha` text NOT NULL,
	`tipo` text NOT NULL,
	`entrada_at` text,
	`salida_at` text,
	`observacion` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`trabajador_id`) REFERENCES `trabajador`(`trabajador_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`turno_id`) REFERENCES `turno`(`turno_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "asistencia_tipo_enum" CHECK("asistencia"."tipo" IN ('presente','tardanza','justificada','injustificada')),
	CONSTRAINT "asistencia_coherencia_tipo_horas" CHECK(("asistencia"."tipo" IN ('justificada','injustificada')
            AND "asistencia"."entrada_at" IS NULL AND "asistencia"."salida_at" IS NULL)
       OR ("asistencia"."tipo" IN ('presente','tardanza')
            AND ("asistencia"."salida_at" IS NULL
                 OR ("asistencia"."entrada_at" IS NOT NULL AND "asistencia"."entrada_at" <= "asistencia"."salida_at"))))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_asistencia_trab_fecha` ON `asistencia` (`trabajador_id`,`fecha`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`audit_log_id` text PRIMARY KEY NOT NULL,
	`usuario_id` integer,
	`username` text,
	`rol` text,
	`accion` text NOT NULL,
	`modulo` text NOT NULL,
	`descripcion` text NOT NULL,
	`archived` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuario`(`usuario_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "audit_log_ulid_format" CHECK(length(audit_log_id) = 26 AND NOT audit_log_id GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	CONSTRAINT "audit_log_archived_bool" CHECK("audit_log"."archived" IN (0,1))
);
--> statement-breakpoint
CREATE INDEX `idx_audit_log_created` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_audit_log_usuario` ON `audit_log` (`usuario_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_audit_log_archived` ON `audit_log` (`archived`,`created_at`);--> statement-breakpoint
CREATE TABLE `categoria` (
	`categoria_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nombre` text NOT NULL,
	`requiere_vencimiento` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "categoria_requiere_venc_bool" CHECK("categoria"."requiere_vencimiento" IN (0,1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categoria_nombre_unique` ON `categoria` (`nombre`);--> statement-breakpoint
CREATE TABLE `cierre_caja` (
	`cierre_caja_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`usuario_id` integer NOT NULL,
	`total_ventas` integer NOT NULL,
	`total_efectivo` integer NOT NULL,
	`total_debito` integer NOT NULL,
	`total_credito` integer NOT NULL,
	`total_transferencia` integer NOT NULL,
	`efectivo_contado` integer NOT NULL,
	`diferencia_efectivo` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuario`(`usuario_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "cierre_total_ventas_min" CHECK("cierre_caja"."total_ventas" >= 0),
	CONSTRAINT "cierre_total_efectivo_min" CHECK("cierre_caja"."total_efectivo" >= 0),
	CONSTRAINT "cierre_total_debito_min" CHECK("cierre_caja"."total_debito" >= 0),
	CONSTRAINT "cierre_total_credito_min" CHECK("cierre_caja"."total_credito" >= 0),
	CONSTRAINT "cierre_total_transfer_min" CHECK("cierre_caja"."total_transferencia" >= 0),
	CONSTRAINT "cierre_efectivo_contado_min" CHECK("cierre_caja"."efectivo_contado" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_cierre_caja_dia` ON `cierre_caja` (`usuario_id`,date("created_at"));--> statement-breakpoint
CREATE TABLE `config_previsional` (
	`config_previsional_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`afp_pct` real NOT NULL,
	`salud_pct` real NOT NULL,
	`cesantia_pct` real NOT NULL,
	`updated_by` integer,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `usuario`(`usuario_id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "config_afp_range" CHECK("config_previsional"."afp_pct" BETWEEN 0 AND 100),
	CONSTRAINT "config_salud_range" CHECK("config_previsional"."salud_pct" BETWEEN 0 AND 100),
	CONSTRAINT "config_cesantia_range" CHECK("config_previsional"."cesantia_pct" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE `config_sistema` (
	`clave` text PRIMARY KEY NOT NULL,
	`valor` text NOT NULL,
	`descripcion` text,
	`updated_by_usuario_id` integer,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`updated_by_usuario_id`) REFERENCES `usuario`(`usuario_id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `detalle_pedido` (
	`detalle_pedido_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pedido_id` integer NOT NULL,
	`producto_id` integer NOT NULL,
	`cantidad_solicitada` real NOT NULL,
	`cantidad_recibida` real DEFAULT 0 NOT NULL,
	`precio_unitario` integer NOT NULL,
	FOREIGN KEY (`pedido_id`) REFERENCES `pedido`(`pedido_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`producto_id`) REFERENCES `producto`(`producto_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "detalle_pedido_solicitada_min" CHECK("detalle_pedido"."cantidad_solicitada" > 0),
	CONSTRAINT "detalle_pedido_recibida_range" CHECK("detalle_pedido"."cantidad_recibida" >= 0 AND "detalle_pedido"."cantidad_recibida" <= "detalle_pedido"."cantidad_solicitada"),
	CONSTRAINT "detalle_pedido_precio_min" CHECK("detalle_pedido"."precio_unitario" >= 0)
);
--> statement-breakpoint
CREATE INDEX `idx_detalle_pedido_pedido` ON `detalle_pedido` (`pedido_id`);--> statement-breakpoint
CREATE TABLE `detalle_venta` (
	`detalle_venta_id` text PRIMARY KEY NOT NULL,
	`venta_id` text NOT NULL,
	`producto_id` integer NOT NULL,
	`lote_id` integer,
	`cantidad` real NOT NULL,
	`precio_unitario` integer NOT NULL,
	`descuento` integer DEFAULT 0 NOT NULL,
	`subtotal` integer NOT NULL,
	FOREIGN KEY (`venta_id`) REFERENCES `venta`(`venta_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`producto_id`) REFERENCES `producto`(`producto_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`lote_id`) REFERENCES `lote`(`lote_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "detalle_venta_ulid_format" CHECK(length(detalle_venta_id) = 26 AND NOT detalle_venta_id GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	CONSTRAINT "detalle_venta_cantidad_min" CHECK("detalle_venta"."cantidad" > 0),
	CONSTRAINT "detalle_venta_precio_min" CHECK("detalle_venta"."precio_unitario" >= 0),
	CONSTRAINT "detalle_venta_descuento_min" CHECK("detalle_venta"."descuento" >= 0),
	CONSTRAINT "detalle_venta_subtotal_min" CHECK("detalle_venta"."subtotal" >= 0),
	CONSTRAINT "detalle_venta_subtotal_aritmetico" CHECK(ABS("detalle_venta"."subtotal" - ("detalle_venta"."cantidad" * "detalle_venta"."precio_unitario" - "detalle_venta"."descuento")) < 1)
);
--> statement-breakpoint
CREATE INDEX `idx_detalle_venta_venta` ON `detalle_venta` (`venta_id`);--> statement-breakpoint
CREATE INDEX `idx_detalle_venta_producto` ON `detalle_venta` (`producto_id`);--> statement-breakpoint
CREATE TABLE `discrepancia_stock` (
	`discrepancia_stock_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`producto_id` integer NOT NULL,
	`lote_id` integer,
	`venta_id` text,
	`cantidad_negativa` real NOT NULL,
	`detectado_por_usuario_id` integer NOT NULL,
	`estado` text DEFAULT 'pendiente' NOT NULL,
	`resuelto_por_usuario_id` integer,
	`resuelto_at` text,
	`observacion` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`producto_id`) REFERENCES `producto`(`producto_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`lote_id`) REFERENCES `lote`(`lote_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`venta_id`) REFERENCES `venta`(`venta_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`detectado_por_usuario_id`) REFERENCES `usuario`(`usuario_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`resuelto_por_usuario_id`) REFERENCES `usuario`(`usuario_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "discrepancia_cantidad_min" CHECK("discrepancia_stock"."cantidad_negativa" > 0),
	CONSTRAINT "discrepancia_estado_enum" CHECK("discrepancia_stock"."estado" IN ('pendiente','aceptada_merma','ajuste_reposicion','venta_anulada','stock_cero')),
	CONSTRAINT "discrepancia_resolucion_coherente" CHECK(("discrepancia_stock"."estado" = 'pendiente' AND "discrepancia_stock"."resuelto_at" IS NULL
            AND "discrepancia_stock"."resuelto_por_usuario_id" IS NULL)
       OR ("discrepancia_stock"."estado" <> 'pendiente' AND "discrepancia_stock"."resuelto_at" IS NOT NULL
            AND "discrepancia_stock"."resuelto_por_usuario_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `idx_discrepancia_estado` ON `discrepancia_stock` (`estado`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_discrepancia_producto` ON `discrepancia_stock` (`producto_id`);--> statement-breakpoint
CREATE TABLE `estado_pedido` (
	`pedido_estado_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pedido_id` integer NOT NULL,
	`usuario_id` integer NOT NULL,
	`estado` text NOT NULL,
	`observacion` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`pedido_id`) REFERENCES `pedido`(`pedido_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuario`(`usuario_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "estado_pedido_enum" CHECK("estado_pedido"."estado" IN ('pendiente','enviado','parcial','recibido','cancelado'))
);
--> statement-breakpoint
CREATE INDEX `idx_estado_pedido_pedido` ON `estado_pedido` (`pedido_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `lote` (
	`lote_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`producto_id` integer NOT NULL,
	`detalle_pedido_id` integer,
	`cantidad_actual` real NOT NULL,
	`precio_unitario` integer NOT NULL,
	`fecha_vencimiento` text,
	`fecha_ingreso` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`producto_id`) REFERENCES `producto`(`producto_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`detalle_pedido_id`) REFERENCES `detalle_pedido`(`detalle_pedido_id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "lote_precio_min" CHECK("lote"."precio_unitario" >= 0)
);
--> statement-breakpoint
CREATE INDEX `idx_lote_producto_venc` ON `lote` (`producto_id`,`fecha_vencimiento`);--> statement-breakpoint
CREATE TABLE `merma` (
	`merma_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`usuario_id` integer NOT NULL,
	`tipo` text NOT NULL,
	`observacion` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuario`(`usuario_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "merma_tipo_enum" CHECK("merma"."tipo" IN ('vencimiento','robo','rotura','conteo','otro'))
);
--> statement-breakpoint
CREATE TABLE `movimiento_inventario` (
	`movimiento_inventario_id` text PRIMARY KEY NOT NULL,
	`producto_id` integer NOT NULL,
	`lote_id` integer,
	`usuario_id` integer NOT NULL,
	`detalle_pedido_id` integer,
	`detalle_venta_id` text,
	`merma_id` integer,
	`cantidad` real NOT NULL,
	`tipo` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`producto_id`) REFERENCES `producto`(`producto_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`lote_id`) REFERENCES `lote`(`lote_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuario`(`usuario_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`detalle_pedido_id`) REFERENCES `detalle_pedido`(`detalle_pedido_id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`detalle_venta_id`) REFERENCES `detalle_venta`(`detalle_venta_id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`merma_id`) REFERENCES `merma`(`merma_id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "mov_inv_ulid_format" CHECK(length(movimiento_inventario_id) = 26 AND NOT movimiento_inventario_id GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	CONSTRAINT "mov_inv_tipo_enum" CHECK("movimiento_inventario"."tipo" IN ('entrada','salida','venta','merma','ajuste','devolucion')),
	CONSTRAINT "mov_inv_origen_coherente" CHECK(("movimiento_inventario"."tipo" = 'entrada'
            AND "movimiento_inventario"."detalle_pedido_id" IS NOT NULL
            AND "movimiento_inventario"."detalle_venta_id" IS NULL
            AND "movimiento_inventario"."merma_id" IS NULL)
       OR ("movimiento_inventario"."tipo" = 'venta'
            AND "movimiento_inventario"."detalle_venta_id" IS NOT NULL
            AND "movimiento_inventario"."detalle_pedido_id" IS NULL
            AND "movimiento_inventario"."merma_id" IS NULL)
       OR ("movimiento_inventario"."tipo" = 'merma'
            AND "movimiento_inventario"."merma_id" IS NOT NULL
            AND "movimiento_inventario"."detalle_pedido_id" IS NULL
            AND "movimiento_inventario"."detalle_venta_id" IS NULL)
       OR ("movimiento_inventario"."tipo" = 'devolucion'
            AND "movimiento_inventario"."detalle_venta_id" IS NOT NULL
            AND "movimiento_inventario"."detalle_pedido_id" IS NULL
            AND "movimiento_inventario"."merma_id" IS NULL)
       OR ("movimiento_inventario"."tipo" IN ('salida','ajuste')
            AND "movimiento_inventario"."detalle_pedido_id" IS NULL
            AND "movimiento_inventario"."detalle_venta_id" IS NULL
            AND "movimiento_inventario"."merma_id" IS NULL)),
	CONSTRAINT "mov_inv_signo_cantidad" CHECK(("movimiento_inventario"."tipo" IN ('entrada','devolucion') AND "movimiento_inventario"."cantidad" > 0)
       OR ("movimiento_inventario"."tipo" IN ('venta','merma','salida') AND "movimiento_inventario"."cantidad" < 0)
       OR ("movimiento_inventario"."tipo" = 'ajuste' AND "movimiento_inventario"."cantidad" <> 0))
);
--> statement-breakpoint
CREATE INDEX `idx_mov_producto_fecha` ON `movimiento_inventario` (`producto_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_mov_lote` ON `movimiento_inventario` (`lote_id`);--> statement-breakpoint
CREATE INDEX `idx_mov_tipo` ON `movimiento_inventario` (`tipo`);--> statement-breakpoint
CREATE TABLE `pedido` (
	`pedido_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`proveedor_id` integer NOT NULL,
	`entrega_estimada` text,
	`email` text,
	`comentario` text,
	`observacion` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`proveedor_id`) REFERENCES `proveedor`(`proveedor_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "pedido_email_format" CHECK("pedido"."email" IS NULL OR "pedido"."email" LIKE '%_@_%._%')
);
--> statement-breakpoint
CREATE INDEX `idx_pedido_proveedor` ON `pedido` (`proveedor_id`);--> statement-breakpoint
CREATE TABLE `producto` (
	`producto_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`categoria_id` integer NOT NULL,
	`ean13` text NOT NULL,
	`nombre` text NOT NULL,
	`descripcion` text,
	`unidad_medida` text NOT NULL,
	`precio_costo` integer NOT NULL,
	`precio_venta` integer NOT NULL,
	`stock_minimo` real DEFAULT 0 NOT NULL,
	`estado` text DEFAULT 'activo' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`categoria_id`) REFERENCES `categoria`(`categoria_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "producto_ean13_format" CHECK(length("producto"."ean13") = 13 AND "producto"."ean13" GLOB '[0-9]*'),
	CONSTRAINT "producto_unidad_enum" CHECK("producto"."unidad_medida" IN ('unidad','kg','g','litro','ml')),
	CONSTRAINT "producto_precio_costo_min" CHECK("producto"."precio_costo" >= 0),
	CONSTRAINT "producto_precio_venta_min" CHECK("producto"."precio_venta" >= 0),
	CONSTRAINT "producto_stock_min" CHECK("producto"."stock_minimo" >= 0),
	CONSTRAINT "producto_estado_enum" CHECK("producto"."estado" IN ('activo','inactivo'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `producto_ean13_unique` ON `producto` (`ean13`);--> statement-breakpoint
CREATE INDEX `idx_producto_nombre` ON `producto` (`nombre`);--> statement-breakpoint
CREATE INDEX `idx_producto_estado` ON `producto` (`estado`);--> statement-breakpoint
CREATE INDEX `idx_producto_categoria` ON `producto` (`categoria_id`);--> statement-breakpoint
CREATE TABLE `proveedor` (
	`proveedor_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rut` text NOT NULL,
	`razon_social` text NOT NULL,
	`contacto` text,
	`telefono` text,
	`email` text,
	`estado` text DEFAULT 'activo' NOT NULL,
	`observacion` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	CONSTRAINT "proveedor_rut_format" CHECK(length("proveedor"."rut") BETWEEN 9 AND 10 AND "proveedor"."rut" GLOB '[1-9]*-[0-9kK]'),
	CONSTRAINT "proveedor_email_format" CHECK("proveedor"."email" IS NULL OR "proveedor"."email" LIKE '%_@_%._%'),
	CONSTRAINT "proveedor_estado_enum" CHECK("proveedor"."estado" IN ('activo','inactivo'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `proveedor_rut_unique` ON `proveedor` (`rut`);--> statement-breakpoint
CREATE TABLE `proveedor_categoria` (
	`proveedor_id` integer NOT NULL,
	`categoria_id` integer NOT NULL,
	PRIMARY KEY(`proveedor_id`, `categoria_id`),
	FOREIGN KEY (`proveedor_id`) REFERENCES `proveedor`(`proveedor_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`categoria_id`) REFERENCES `categoria`(`categoria_id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `remuneracion` (
	`remuneracion_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trabajador_id` integer NOT NULL,
	`mes` integer NOT NULL,
	`anio` integer NOT NULL,
	`monto_bruto` integer NOT NULL,
	`monto_liquido` integer NOT NULL,
	`estado` text DEFAULT 'pendiente' NOT NULL,
	`observacion` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`trabajador_id`) REFERENCES `trabajador`(`trabajador_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "remuneracion_mes_range" CHECK("remuneracion"."mes" BETWEEN 1 AND 12),
	CONSTRAINT "remuneracion_anio_range" CHECK("remuneracion"."anio" BETWEEN 2020 AND 2100),
	CONSTRAINT "remuneracion_bruto_min" CHECK("remuneracion"."monto_bruto" >= 0),
	CONSTRAINT "remuneracion_liquido_min" CHECK("remuneracion"."monto_liquido" >= 0),
	CONSTRAINT "remuneracion_estado_enum" CHECK("remuneracion"."estado" IN ('pendiente','pagada','anulada')),
	CONSTRAINT "remuneracion_liquido_lte_bruto" CHECK("remuneracion"."monto_liquido" <= "remuneracion"."monto_bruto")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_remuneracion_trab_periodo` ON `remuneracion` (`trabajador_id`,`mes`,`anio`);--> statement-breakpoint
CREATE TABLE `trabajador` (
	`trabajador_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rut` text NOT NULL,
	`nombres` text NOT NULL,
	`apellidos` text NOT NULL,
	`cargo` text NOT NULL,
	`telefono` text,
	`email` text,
	`contacto_emergencia_nombre` text,
	`contacto_emergencia_telefono` text,
	`fecha_ingreso` text NOT NULL,
	`observacion` text,
	`estado` text DEFAULT 'activo' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	CONSTRAINT "trabajador_rut_format" CHECK(length("trabajador"."rut") BETWEEN 9 AND 10 AND "trabajador"."rut" GLOB '[1-9]*-[0-9kK]'),
	CONSTRAINT "trabajador_email_format" CHECK("trabajador"."email" IS NULL OR "trabajador"."email" LIKE '%_@_%._%'),
	CONSTRAINT "trabajador_cargo_enum" CHECK("trabajador"."cargo" IN ('dueño','cajero','reponedor','bodega','panadero','otro')),
	CONSTRAINT "trabajador_estado_enum" CHECK("trabajador"."estado" IN ('activo','inactivo'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trabajador_rut_unique` ON `trabajador` (`rut`);--> statement-breakpoint
CREATE TABLE `turno` (
	`turno_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trabajador_id` integer NOT NULL,
	`inicio_at` text NOT NULL,
	`fin_at` text NOT NULL,
	`estado` text DEFAULT 'planificado' NOT NULL,
	`observacion` text,
	`creado_por_usuario_id` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`trabajador_id`) REFERENCES `trabajador`(`trabajador_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`creado_por_usuario_id`) REFERENCES `usuario`(`usuario_id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "turno_estado_enum" CHECK("turno"."estado" IN ('planificado','en_curso','completado','cancelado')),
	CONSTRAINT "turno_rango_valido" CHECK("turno"."inicio_at" < "turno"."fin_at")
);
--> statement-breakpoint
CREATE INDEX `idx_turno_trabajador` ON `turno` (`trabajador_id`,`inicio_at`);--> statement-breakpoint
CREATE TABLE `usuario` (
	`usuario_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trabajador_id` integer,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`rol` text NOT NULL,
	`intentos_fallidos` integer DEFAULT 0 NOT NULL,
	`bloqueado_hasta` text,
	`ultimo_login` text,
	`requiere_cambio_password` integer DEFAULT 0 NOT NULL,
	`password_temporal_expira_at` text,
	`observacion` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`trabajador_id`) REFERENCES `trabajador`(`trabajador_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "usuario_username_length" CHECK(length("usuario"."username") BETWEEN 3 AND 32),
	CONSTRAINT "usuario_rol_enum" CHECK("usuario"."rol" IN ('dueño','cajero','reponedor')),
	CONSTRAINT "usuario_intentos_min" CHECK("usuario"."intentos_fallidos" >= 0),
	CONSTRAINT "usuario_requiere_cambio_bool" CHECK("usuario"."requiere_cambio_password" IN (0,1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `usuario_trabajador_id_unique` ON `usuario` (`trabajador_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `usuario_username_unique` ON `usuario` (`username`);--> statement-breakpoint
CREATE TABLE `venta` (
	`venta_id` text PRIMARY KEY NOT NULL,
	`cierre_caja_id` integer,
	`usuario_id` integer NOT NULL,
	`anulada_por_usuario_id` integer,
	`subtotal` integer NOT NULL,
	`iva` integer DEFAULT 0 NOT NULL,
	`descuento` integer DEFAULT 0 NOT NULL,
	`tipo_descuento` text,
	`observacion_descuento` text,
	`total` integer NOT NULL,
	`metodo_pago` text NOT NULL,
	`monto_recibido` integer NOT NULL,
	`vuelto` integer,
	`estado` text DEFAULT 'completada' NOT NULL,
	`motivo_anulacion` text,
	`anulado_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`cierre_caja_id`) REFERENCES `cierre_caja`(`cierre_caja_id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuario`(`usuario_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`anulada_por_usuario_id`) REFERENCES `usuario`(`usuario_id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "venta_ulid_format" CHECK(length(venta_id) = 26 AND NOT venta_id GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	CONSTRAINT "venta_subtotal_min" CHECK("venta"."subtotal" >= 0),
	CONSTRAINT "venta_iva_min" CHECK("venta"."iva" >= 0),
	CONSTRAINT "venta_descuento_min" CHECK("venta"."descuento" >= 0),
	CONSTRAINT "venta_total_min" CHECK("venta"."total" >= 0),
	CONSTRAINT "venta_monto_recibido_min" CHECK("venta"."monto_recibido" >= 0),
	CONSTRAINT "venta_vuelto_min" CHECK("venta"."vuelto" >= 0 OR "venta"."vuelto" IS NULL),
	CONSTRAINT "venta_tipo_descuento_enum" CHECK("venta"."tipo_descuento" IN ('porcentaje','monto') OR "venta"."tipo_descuento" IS NULL),
	CONSTRAINT "venta_metodo_pago_enum" CHECK("venta"."metodo_pago" IN ('efectivo','debito','credito','transferencia')),
	CONSTRAINT "venta_estado_enum" CHECK("venta"."estado" IN ('completada','anulada')),
	CONSTRAINT "venta_descuento_coherente" CHECK(("venta"."descuento" = 0 AND "venta"."tipo_descuento" IS NULL)
       OR ("venta"."descuento" > 0 AND "venta"."tipo_descuento" IS NOT NULL)),
	CONSTRAINT "venta_anulacion_coherente" CHECK(("venta"."estado" = 'anulada' AND "venta"."anulado_at" IS NOT NULL
            AND "venta"."motivo_anulacion" IS NOT NULL
            AND "venta"."anulada_por_usuario_id" IS NOT NULL)
       OR ("venta"."estado" = 'completada' AND "venta"."anulado_at" IS NULL
            AND "venta"."motivo_anulacion" IS NULL
            AND "venta"."anulada_por_usuario_id" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `idx_venta_created` ON `venta` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_venta_usuario` ON `venta` (`usuario_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_venta_cierre` ON `venta` (`cierre_caja_id`);--> statement-breakpoint
CREATE INDEX `idx_venta_estado` ON `venta` (`estado`);