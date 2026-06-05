CREATE TABLE `ajuste_inventario` (
	`ajuste_inventario_id` text PRIMARY KEY NOT NULL,
	`ajuste_cantidad` integer NOT NULL,
	`ajuste_justificacion` text NOT NULL,
	`ajuste_fecha_hora` text DEFAULT (datetime('now')) NOT NULL,
	`producto_id` integer NOT NULL,
	`lote_id` text NOT NULL,
	`usuario_id` text NOT NULL,
	FOREIGN KEY (`producto_id`) REFERENCES `producto`(`producto_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`lote_id`) REFERENCES `lote`(`lote_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuario`(`usuario_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ajuste_inventario_uuid" CHECK(length(ajuste_inventario_id) = 36),
	CONSTRAINT "ajuste_cantidad_no_cero" CHECK("ajuste_inventario"."ajuste_cantidad" <> 0)
);
--> statement-breakpoint
CREATE INDEX `idx_ajuste_producto` ON `ajuste_inventario` (`producto_id`,`ajuste_fecha_hora`);--> statement-breakpoint
CREATE TABLE `anulacion_venta` (
	`anulacion_venta_id` text PRIMARY KEY NOT NULL,
	`anulacion_fecha_hora` text DEFAULT (datetime('now')) NOT NULL,
	`anulacion_razon` text NOT NULL,
	`venta_id` text NOT NULL,
	`usuario_id` text NOT NULL,
	FOREIGN KEY (`venta_id`) REFERENCES `venta`(`venta_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuario`(`usuario_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "anulacion_venta_uuid" CHECK(length(anulacion_venta_id) = 36)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `anulacion_venta_venta_id_unique` ON `anulacion_venta` (`venta_id`);--> statement-breakpoint
CREATE TABLE `asistencia` (
	`asistencia_id` text PRIMARY KEY NOT NULL,
	`asistencia_fecha_hora_entrada` text NOT NULL,
	`asistencia_fecha_hora_salida` text,
	`trabajador_id` integer NOT NULL,
	`turno_id` text,
	FOREIGN KEY (`trabajador_id`) REFERENCES `trabajador`(`trabajador_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`turno_id`) REFERENCES `turno`(`turno_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "asistencia_uuid" CHECK(length(asistencia_id) = 36),
	CONSTRAINT "asistencia_rango_valido" CHECK("asistencia"."asistencia_fecha_hora_salida" IS NULL
       OR "asistencia"."asistencia_fecha_hora_entrada" <= "asistencia"."asistencia_fecha_hora_salida")
);
--> statement-breakpoint
CREATE INDEX `idx_asistencia_trabajador` ON `asistencia` (`trabajador_id`,`asistencia_fecha_hora_entrada`);--> statement-breakpoint
CREATE TABLE `ausencia` (
	`ausencia_id` text PRIMARY KEY NOT NULL,
	`ausencia_fecha` text NOT NULL,
	`ausencia_tipo` text NOT NULL,
	`ausencia_observacion` text,
	`ausencia_fecha_hora_registro` text DEFAULT (datetime('now')) NOT NULL,
	`trabajador_id` integer NOT NULL,
	`usuario_registrador_id` text NOT NULL,
	FOREIGN KEY (`trabajador_id`) REFERENCES `trabajador`(`trabajador_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`usuario_registrador_id`) REFERENCES `usuario`(`usuario_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ausencia_uuid" CHECK(length(ausencia_id) = 36),
	CONSTRAINT "ausencia_tipo_enum" CHECK("ausencia"."ausencia_tipo" IN ('justificada','injustificada','licencia','vacaciones','permiso'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_ausencia_trabajador_fecha` ON `ausencia` (`trabajador_id`,`ausencia_fecha`);--> statement-breakpoint
CREATE TABLE `categoria` (
	`categoria_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`categoria_nombre` text NOT NULL,
	`categoria_exige_vencimiento` integer NOT NULL,
	CONSTRAINT "categoria_exige_venc_bool" CHECK("categoria"."categoria_exige_vencimiento" IN (0,1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categoria_categoria_nombre_unique` ON `categoria` (`categoria_nombre`);--> statement-breakpoint
CREATE TABLE `cierre_caja` (
	`cierre_caja_id` text PRIMARY KEY NOT NULL,
	`cierre_fecha_hora_inicio` text DEFAULT (datetime('now')) NOT NULL,
	`cierre_estado` text DEFAULT 'abierto' NOT NULL,
	`cierre_fecha_hora_fin` text,
	`usuario_cierre_id` text,
	FOREIGN KEY (`usuario_cierre_id`) REFERENCES `usuario`(`usuario_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "cierre_caja_uuid" CHECK(length(cierre_caja_id) = 36),
	CONSTRAINT "cierre_estado_enum" CHECK("cierre_caja"."cierre_estado" IN ('abierto','cerrado')),
	CONSTRAINT "cierre_fin_coherente" CHECK(("cierre_caja"."cierre_estado" = 'abierto' AND "cierre_caja"."cierre_fecha_hora_fin" IS NULL
            AND "cierre_caja"."usuario_cierre_id" IS NULL)
       OR ("cierre_caja"."cierre_estado" = 'cerrado' AND "cierre_caja"."cierre_fecha_hora_fin" IS NOT NULL
            AND "cierre_caja"."usuario_cierre_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cierre_caja_cierre_fecha_hora_inicio_unique` ON `cierre_caja` (`cierre_fecha_hora_inicio`);--> statement-breakpoint
CREATE TABLE `contrasena` (
	`contrasena_id` text PRIMARY KEY NOT NULL,
	`contrasena_hash` text NOT NULL,
	`contrasena_fecha_hora_creacion` text DEFAULT (datetime('now')) NOT NULL,
	`es_contrasena_temporal` integer NOT NULL,
	`es_contrasena_definitiva` integer NOT NULL,
	`usuario_id` text NOT NULL,
	`generada_por_usuario_id` text,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuario`(`usuario_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`generada_por_usuario_id`) REFERENCES `usuario`(`usuario_id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "contrasena_uuid" CHECK(length(contrasena_id) = 36),
	CONSTRAINT "contrasena_isa_exclusivo" CHECK("contrasena"."es_contrasena_temporal" + "contrasena"."es_contrasena_definitiva" = 1)
);
--> statement-breakpoint
CREATE INDEX `idx_contrasena_usuario` ON `contrasena` (`usuario_id`,`contrasena_fecha_hora_creacion`);--> statement-breakpoint
CREATE TABLE `contrasena_temporal` (
	`contrasena_id` text PRIMARY KEY NOT NULL,
	`contrasena_temporal_fecha_hora_expiracion` text NOT NULL,
	FOREIGN KEY (`contrasena_id`) REFERENCES `contrasena`(`contrasena_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `detalle_pedido` (
	`detalle_pedido_id` text PRIMARY KEY NOT NULL,
	`pedido_proveedor_id` text NOT NULL,
	`producto_id` integer NOT NULL,
	`cantidad_solicitada` integer NOT NULL,
	`cantidad_recibida` integer,
	FOREIGN KEY (`pedido_proveedor_id`) REFERENCES `pedido_proveedor`(`pedido_proveedor_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`producto_id`) REFERENCES `producto`(`producto_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "detalle_pedido_uuid" CHECK(length(detalle_pedido_id) = 36),
	CONSTRAINT "detalle_pedido_solicitada_min" CHECK("detalle_pedido"."cantidad_solicitada" > 0),
	CONSTRAINT "detalle_pedido_recibida_range" CHECK("detalle_pedido"."cantidad_recibida" IS NULL OR "detalle_pedido"."cantidad_recibida" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_detalle_pedido` ON `detalle_pedido` (`pedido_proveedor_id`,`producto_id`);--> statement-breakpoint
CREATE INDEX `idx_detalle_pedido_pedido` ON `detalle_pedido` (`pedido_proveedor_id`);--> statement-breakpoint
CREATE TABLE `detalle_venta` (
	`detalle_venta_id` text PRIMARY KEY NOT NULL,
	`venta_id` text NOT NULL,
	`producto_id` integer NOT NULL,
	`detalle_venta_cantidad` integer NOT NULL,
	`historial_precio_producto_id` text NOT NULL,
	FOREIGN KEY (`venta_id`) REFERENCES `venta`(`venta_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`producto_id`) REFERENCES `producto`(`producto_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`historial_precio_producto_id`) REFERENCES `historial_precio_producto`(`historial_precio_producto_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "detalle_venta_uuid" CHECK(length(detalle_venta_id) = 36),
	CONSTRAINT "detalle_venta_cantidad_min" CHECK("detalle_venta"."detalle_venta_cantidad" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_detalle_venta` ON `detalle_venta` (`venta_id`,`producto_id`);--> statement-breakpoint
CREATE INDEX `idx_detalle_venta_venta` ON `detalle_venta` (`venta_id`);--> statement-breakpoint
CREATE INDEX `idx_detalle_venta_producto` ON `detalle_venta` (`producto_id`);--> statement-breakpoint
CREATE TABLE `historial_auditoria_pedido` (
	`historial_auditoria_pedido_id` text PRIMARY KEY NOT NULL,
	`historial_ap_tipo_evento` text NOT NULL,
	`historial_ap_fecha_hora` text DEFAULT (datetime('now')) NOT NULL,
	`historial_ap_nota` text,
	`pedido_proveedor_id` text NOT NULL,
	`usuario_id` text NOT NULL,
	FOREIGN KEY (`pedido_proveedor_id`) REFERENCES `pedido_proveedor`(`pedido_proveedor_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuario`(`usuario_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "historial_auditoria_pedido_uuid" CHECK(length(historial_auditoria_pedido_id) = 36)
);
--> statement-breakpoint
CREATE INDEX `idx_historial_ap_pedido` ON `historial_auditoria_pedido` (`pedido_proveedor_id`,`historial_ap_fecha_hora`);--> statement-breakpoint
CREATE TABLE `historial_precio_producto` (
	`historial_precio_producto_id` text PRIMARY KEY NOT NULL,
	`historial_precio_costo` integer NOT NULL,
	`historial_precio_venta` integer NOT NULL,
	`historial_fecha_hora_vigencia_desde` text DEFAULT (datetime('now')) NOT NULL,
	`historial_fecha_hora_vigencia_hasta` text,
	`producto_id` integer NOT NULL,
	FOREIGN KEY (`producto_id`) REFERENCES `producto`(`producto_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "historial_precio_producto_uuid" CHECK(length(historial_precio_producto_id) = 36),
	CONSTRAINT "historial_precio_costo_min" CHECK("historial_precio_producto"."historial_precio_costo" >= 0),
	CONSTRAINT "historial_precio_venta_min" CHECK("historial_precio_producto"."historial_precio_venta" >= 0),
	CONSTRAINT "historial_vigencia_rango" CHECK("historial_precio_producto"."historial_fecha_hora_vigencia_hasta" IS NULL
       OR "historial_precio_producto"."historial_fecha_hora_vigencia_desde" <= "historial_precio_producto"."historial_fecha_hora_vigencia_hasta")
);
--> statement-breakpoint
CREATE INDEX `idx_historial_precio_producto` ON `historial_precio_producto` (`producto_id`,`historial_fecha_hora_vigencia_desde`);--> statement-breakpoint
CREATE TABLE `intento_login` (
	`intento_login_id` text PRIMARY KEY NOT NULL,
	`intento_nombre_usuario_ingresado` text NOT NULL,
	`intento_fecha_hora` text DEFAULT (datetime('now')) NOT NULL,
	`intento_exitoso` integer NOT NULL,
	`usuario_id` text,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuario`(`usuario_id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "intento_login_uuid" CHECK(length(intento_login_id) = 36),
	CONSTRAINT "intento_login_exitoso_bool" CHECK("intento_login"."intento_exitoso" IN (0,1))
);
--> statement-breakpoint
CREATE INDEX `idx_intento_login_fecha` ON `intento_login` (`intento_fecha_hora`);--> statement-breakpoint
CREATE INDEX `idx_intento_login_usuario` ON `intento_login` (`usuario_id`,`intento_fecha_hora`);--> statement-breakpoint
CREATE TABLE `log_auditoria` (
	`log_auditoria_id` text PRIMARY KEY NOT NULL,
	`log_fecha_hora` text DEFAULT (datetime('now')) NOT NULL,
	`log_tipo_accion` text NOT NULL,
	`log_modulo` text NOT NULL,
	`log_descripcion` text NOT NULL,
	`usuario_version_id` text NOT NULL,
	FOREIGN KEY (`usuario_version_id`) REFERENCES `usuario_version`(`usuario_version_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "log_auditoria_uuid" CHECK(length(log_auditoria_id) = 36)
);
--> statement-breakpoint
CREATE INDEX `idx_log_auditoria_fecha` ON `log_auditoria` (`log_fecha_hora`);--> statement-breakpoint
CREATE INDEX `idx_log_auditoria_modulo` ON `log_auditoria` (`log_modulo`,`log_fecha_hora`);--> statement-breakpoint
CREATE TABLE `log_errores_tecnicos` (
	`log_errortecnicos_id` text PRIMARY KEY NOT NULL,
	`log_errores_fecha_hora` text DEFAULT (datetime('now')) NOT NULL,
	`log_errores_tipo_error` text NOT NULL,
	`log_errores_modulo` text NOT NULL,
	`log_errores_descripcion_tecnica` text NOT NULL,
	`usuario_id` text,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuario`(`usuario_id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "log_errores_tecnicos_uuid" CHECK(length(log_errortecnicos_id) = 36)
);
--> statement-breakpoint
CREATE INDEX `idx_log_errores_fecha` ON `log_errores_tecnicos` (`log_errores_fecha_hora`);--> statement-breakpoint
CREATE INDEX `idx_log_errores_modulo` ON `log_errores_tecnicos` (`log_errores_modulo`,`log_errores_fecha_hora`);--> statement-breakpoint
CREATE TABLE `lote` (
	`lote_id` text PRIMARY KEY NOT NULL,
	`lote_cantidad_inicial` integer NOT NULL,
	`lote_cantidad_actual` integer NOT NULL,
	`lote_precio_costo` integer NOT NULL,
	`lote_fecha_hora_ingreso` text DEFAULT (datetime('now')) NOT NULL,
	`es_lote_perecible` integer NOT NULL,
	`es_lote_no_perecible` integer NOT NULL,
	`producto_id` integer NOT NULL,
	`proveedor_id` integer,
	`pedido_proveedor_id` text,
	FOREIGN KEY (`producto_id`) REFERENCES `producto`(`producto_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`proveedor_id`) REFERENCES `proveedor`(`proveedor_id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`pedido_proveedor_id`) REFERENCES `pedido_proveedor`(`pedido_proveedor_id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "lote_uuid" CHECK(length(lote_id) = 36),
	CONSTRAINT "lote_cantidad_inicial_min" CHECK("lote"."lote_cantidad_inicial" >= 0),
	CONSTRAINT "lote_precio_costo_min" CHECK("lote"."lote_precio_costo" >= 0),
	CONSTRAINT "lote_isa_exclusivo" CHECK("lote"."es_lote_perecible" + "lote"."es_lote_no_perecible" = 1)
);
--> statement-breakpoint
CREATE INDEX `idx_lote_producto` ON `lote` (`producto_id`);--> statement-breakpoint
CREATE INDEX `idx_lote_pedido` ON `lote` (`pedido_proveedor_id`);--> statement-breakpoint
CREATE TABLE `lote_perecible` (
	`lote_id` text PRIMARY KEY NOT NULL,
	`lote_perecible_fecha_vencimiento` text NOT NULL,
	FOREIGN KEY (`lote_id`) REFERENCES `lote`(`lote_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `merma` (
	`merma_id` text PRIMARY KEY NOT NULL,
	`merma_motivo` text NOT NULL,
	`merma_observacion` text,
	`merma_fecha_hora` text DEFAULT (datetime('now')) NOT NULL,
	`producto_id` integer NOT NULL,
	`usuario_id` text NOT NULL,
	FOREIGN KEY (`producto_id`) REFERENCES `producto`(`producto_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuario`(`usuario_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "merma_uuid" CHECK(length(merma_id) = 36),
	CONSTRAINT "merma_motivo_enum" CHECK("merma"."merma_motivo" IN ('vencimiento','robo','rotura','conteo','otro'))
);
--> statement-breakpoint
CREATE INDEX `idx_merma_producto` ON `merma` (`producto_id`,`merma_fecha_hora`);--> statement-breakpoint
CREATE TABLE `merma_lote` (
	`merma_lote_id` text PRIMARY KEY NOT NULL,
	`merma_id` text NOT NULL,
	`lote_id` text NOT NULL,
	`merma_lote_cantidad_descontada` integer NOT NULL,
	FOREIGN KEY (`merma_id`) REFERENCES `merma`(`merma_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lote_id`) REFERENCES `lote`(`lote_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "merma_lote_uuid" CHECK(length(merma_lote_id) = 36),
	CONSTRAINT "merma_lote_cantidad_min" CHECK("merma_lote"."merma_lote_cantidad_descontada" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_merma_lote` ON `merma_lote` (`merma_id`,`lote_id`);--> statement-breakpoint
CREATE TABLE `pedido_proveedor` (
	`pedido_proveedor_id` text PRIMARY KEY NOT NULL,
	`pedido_proveedor_fecha_hora_emision` text DEFAULT (datetime('now')) NOT NULL,
	`pedido_proveedor_estado` text NOT NULL,
	`pedido_proveedor_fecha_hora_recepcion` text,
	`pedido_proveedor_nota_recepcion` text,
	`proveedor_id` integer NOT NULL,
	`usuario_emisor_id` text NOT NULL,
	`usuario_receptor_id` text,
	FOREIGN KEY (`proveedor_id`) REFERENCES `proveedor`(`proveedor_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`usuario_emisor_id`) REFERENCES `usuario`(`usuario_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`usuario_receptor_id`) REFERENCES `usuario`(`usuario_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "pedido_proveedor_uuid" CHECK(length(pedido_proveedor_id) = 36),
	CONSTRAINT "pedido_proveedor_estado_enum" CHECK("pedido_proveedor"."pedido_proveedor_estado" IN ('borrador','emitido','enviado','parcial','recibido','cancelado'))
);
--> statement-breakpoint
CREATE INDEX `idx_pedido_proveedor_proveedor` ON `pedido_proveedor` (`proveedor_id`);--> statement-breakpoint
CREATE INDEX `idx_pedido_proveedor_estado` ON `pedido_proveedor` (`pedido_proveedor_estado`);--> statement-breakpoint
CREATE TABLE `producto` (
	`producto_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`producto_ean_13` text NOT NULL,
	`producto_nombre` text NOT NULL,
	`producto_precio_venta` integer NOT NULL,
	`producto_stock_minimo` integer DEFAULT 0 NOT NULL,
	`producto_estado` text DEFAULT 'activo' NOT NULL,
	`producto_fecha_registro` text DEFAULT (datetime('now')) NOT NULL,
	`categoria_id` integer NOT NULL,
	FOREIGN KEY (`categoria_id`) REFERENCES `categoria`(`categoria_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "producto_ean13_format" CHECK(length("producto"."producto_ean_13") = 13 AND "producto"."producto_ean_13" GLOB '[0-9]*'),
	CONSTRAINT "producto_precio_venta_min" CHECK("producto"."producto_precio_venta" >= 0),
	CONSTRAINT "producto_stock_minimo_min" CHECK("producto"."producto_stock_minimo" >= 0),
	CONSTRAINT "producto_estado_enum" CHECK("producto"."producto_estado" IN ('activo','inactivo'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `producto_producto_ean_13_unique` ON `producto` (`producto_ean_13`);--> statement-breakpoint
CREATE INDEX `idx_producto_nombre` ON `producto` (`producto_nombre`);--> statement-breakpoint
CREATE INDEX `idx_producto_categoria` ON `producto` (`categoria_id`);--> statement-breakpoint
CREATE INDEX `idx_producto_estado` ON `producto` (`producto_estado`);--> statement-breakpoint
CREATE TABLE `proveedor` (
	`proveedor_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`proveedor_rut` text NOT NULL,
	`proveedor_nombre_razon_social` text NOT NULL,
	`proveedor_nombre_contacto` text NOT NULL,
	`proveedor_telefono` text NOT NULL,
	`proveedor_correo_electronico` text NOT NULL,
	CONSTRAINT "proveedor_rut_format" CHECK(length("proveedor"."proveedor_rut") BETWEEN 9 AND 12 AND "proveedor"."proveedor_rut" GLOB '[1-9]*-[0-9kK]'),
	CONSTRAINT "proveedor_email_format" CHECK("proveedor"."proveedor_correo_electronico" LIKE '%_@_%._%')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `proveedor_proveedor_rut_unique` ON `proveedor` (`proveedor_rut`);--> statement-breakpoint
CREATE TABLE `proveedor_categoria` (
	`proveedor_categoria_id` text PRIMARY KEY NOT NULL,
	`proveedor_id` integer NOT NULL,
	`categoria_id` integer NOT NULL,
	FOREIGN KEY (`proveedor_id`) REFERENCES `proveedor`(`proveedor_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`categoria_id`) REFERENCES `categoria`(`categoria_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "proveedor_categoria_uuid" CHECK(length(proveedor_categoria_id) = 36)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_proveedor_categoria` ON `proveedor_categoria` (`proveedor_id`,`categoria_id`);--> statement-breakpoint
CREATE TABLE `remuneracion` (
	`remuneracion_id` text PRIMARY KEY NOT NULL,
	`remuneracion_mes` integer NOT NULL,
	`remuneracion_anio` integer NOT NULL,
	`remuneracion_monto_bruto` integer NOT NULL,
	`remuneracion_observacion` text,
	`remuneracion_fecha_hora_registro` text DEFAULT (datetime('now')) NOT NULL,
	`trabajador_id` integer NOT NULL,
	`usuario_registrador_id` text NOT NULL,
	FOREIGN KEY (`trabajador_id`) REFERENCES `trabajador`(`trabajador_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`usuario_registrador_id`) REFERENCES `usuario`(`usuario_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "remuneracion_uuid" CHECK(length(remuneracion_id) = 36),
	CONSTRAINT "remuneracion_mes_range" CHECK("remuneracion"."remuneracion_mes" BETWEEN 1 AND 12),
	CONSTRAINT "remuneracion_anio_range" CHECK("remuneracion"."remuneracion_anio" BETWEEN 2020 AND 2100),
	CONSTRAINT "remuneracion_bruto_min" CHECK("remuneracion"."remuneracion_monto_bruto" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_remuneracion_trabajador_periodo` ON `remuneracion` (`trabajador_id`,`remuneracion_anio`,`remuneracion_mes`);--> statement-breakpoint
CREATE TABLE `remuneracion_tasa` (
	`remuneracion_tasa_id` text PRIMARY KEY NOT NULL,
	`remuneracion_id` text NOT NULL,
	`tasa_legal_id` integer NOT NULL,
	FOREIGN KEY (`remuneracion_id`) REFERENCES `remuneracion`(`remuneracion_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tasa_legal_id`) REFERENCES `tasa_legal`(`tasa_legal_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "remuneracion_tasa_uuid" CHECK(length(remuneracion_tasa_id) = 36)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_remuneracion_tasa` ON `remuneracion_tasa` (`remuneracion_id`,`tasa_legal_id`);--> statement-breakpoint
CREATE TABLE `sesion_usuario` (
	`sesion_usuario_id` text PRIMARY KEY NOT NULL,
	`sesion_fecha_hora_inicio` text DEFAULT (datetime('now')) NOT NULL,
	`sesion_fecha_hora_ultimo_acceso` text DEFAULT (datetime('now')) NOT NULL,
	`sesion_fecha_hora_cierre` text,
	`sesion_motivo_cierre` text,
	`usuario_id` text NOT NULL,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuario`(`usuario_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "sesion_usuario_uuid" CHECK(length(sesion_usuario_id) = 36),
	CONSTRAINT "sesion_motivo_cierre_enum" CHECK("sesion_usuario"."sesion_motivo_cierre" IS NULL OR "sesion_usuario"."sesion_motivo_cierre" IN ('manual','inactividad','sistema')),
	CONSTRAINT "sesion_cierre_coherente" CHECK(("sesion_usuario"."sesion_fecha_hora_cierre" IS NULL AND "sesion_usuario"."sesion_motivo_cierre" IS NULL)
       OR ("sesion_usuario"."sesion_fecha_hora_cierre" IS NOT NULL AND "sesion_usuario"."sesion_motivo_cierre" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `idx_sesion_usuario` ON `sesion_usuario` (`usuario_id`,`sesion_fecha_hora_inicio`);--> statement-breakpoint
CREATE TABLE `tasa_legal` (
	`tasa_legal_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tasa_legal_tipo` text NOT NULL,
	`tasa_legal_valor` real NOT NULL,
	`tasa_legal_fecha_vigencia_desde` text NOT NULL,
	`tasa_legal_fecha_vigencia_hasta` text,
	CONSTRAINT "tasa_legal_tipo_enum" CHECK("tasa_legal"."tasa_legal_tipo" IN ('afp','salud','cesantia','impuesto','otro')),
	CONSTRAINT "tasa_legal_valor_range" CHECK("tasa_legal"."tasa_legal_valor" BETWEEN 0 AND 100),
	CONSTRAINT "tasa_legal_vigencia_rango" CHECK("tasa_legal"."tasa_legal_fecha_vigencia_hasta" IS NULL
       OR "tasa_legal"."tasa_legal_fecha_vigencia_desde" <= "tasa_legal"."tasa_legal_fecha_vigencia_hasta")
);
--> statement-breakpoint
CREATE TABLE `trabajador` (
	`trabajador_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trabajador_rut` text NOT NULL,
	`trabajador_nombre` text NOT NULL,
	`trabajador_apellido` text NOT NULL,
	`trabajador_telefono` text NOT NULL,
	`trabajador_correo_electronico` text,
	`trabajador_fecha_ingreso` text NOT NULL,
	`trabajador_estado` text DEFAULT 'activo' NOT NULL,
	CONSTRAINT "trabajador_rut_format" CHECK(length("trabajador"."trabajador_rut") BETWEEN 9 AND 12 AND "trabajador"."trabajador_rut" GLOB '[1-9]*-[0-9kK]'),
	CONSTRAINT "trabajador_email_format" CHECK("trabajador"."trabajador_correo_electronico" IS NULL OR "trabajador"."trabajador_correo_electronico" LIKE '%_@_%._%'),
	CONSTRAINT "trabajador_estado_enum" CHECK("trabajador"."trabajador_estado" IN ('activo','inactivo'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trabajador_trabajador_rut_unique` ON `trabajador` (`trabajador_rut`);--> statement-breakpoint
CREATE TABLE `turno` (
	`turno_id` text PRIMARY KEY NOT NULL,
	`turno_fecha_hora_inicio` text NOT NULL,
	`turno_fecha_hora_fin` text NOT NULL,
	`turno_estado` text DEFAULT 'planificado' NOT NULL,
	`trabajador_id` integer NOT NULL,
	FOREIGN KEY (`trabajador_id`) REFERENCES `trabajador`(`trabajador_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "turno_uuid" CHECK(length(turno_id) = 36),
	CONSTRAINT "turno_estado_enum" CHECK("turno"."turno_estado" IN ('planificado','en_curso','completado','cancelado')),
	CONSTRAINT "turno_rango_valido" CHECK("turno"."turno_fecha_hora_inicio" < "turno"."turno_fecha_hora_fin")
);
--> statement-breakpoint
CREATE INDEX `idx_turno_trabajador` ON `turno` (`trabajador_id`,`turno_fecha_hora_inicio`);--> statement-breakpoint
CREATE TABLE `usuario` (
	`usuario_id` text PRIMARY KEY NOT NULL,
	`usuario_rol` text NOT NULL,
	`usuario_fecha_creacion` text DEFAULT (datetime('now')) NOT NULL,
	`usuario_ultimo_login_fecha_hora` text,
	`trabajador_id` integer NOT NULL,
	FOREIGN KEY (`trabajador_id`) REFERENCES `trabajador`(`trabajador_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "usuario_id_length" CHECK(length("usuario"."usuario_id") BETWEEN 3 AND 50),
	CONSTRAINT "usuario_rol_enum" CHECK("usuario"."usuario_rol" IN ('dueño','cajero','reponedor'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `usuario_trabajador_id_unique` ON `usuario` (`trabajador_id`);--> statement-breakpoint
CREATE TABLE `usuario_version` (
	`usuario_version_id` text PRIMARY KEY NOT NULL,
	`usuario_version_nombre` text NOT NULL,
	`usuario_version_rol` text NOT NULL,
	`usuario_version_fecha_hora_vigencia_desde` text DEFAULT (datetime('now')) NOT NULL,
	`usuario_version_fecha_hora_vigencia_hasta` text,
	`usuario_id` text NOT NULL,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuario`(`usuario_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "usuario_version_uuid" CHECK(length(usuario_version_id) = 36),
	CONSTRAINT "usuario_version_rol_enum" CHECK("usuario_version"."usuario_version_rol" IN ('dueño','cajero','reponedor')),
	CONSTRAINT "usuario_version_vigencia_rango" CHECK("usuario_version"."usuario_version_fecha_hora_vigencia_hasta" IS NULL
       OR "usuario_version"."usuario_version_fecha_hora_vigencia_desde" <= "usuario_version"."usuario_version_fecha_hora_vigencia_hasta")
);
--> statement-breakpoint
CREATE INDEX `idx_usuario_version_usuario` ON `usuario_version` (`usuario_id`,`usuario_version_fecha_hora_vigencia_desde`);--> statement-breakpoint
CREATE TABLE `venta` (
	`venta_id` text PRIMARY KEY NOT NULL,
	`venta_fecha_hora` text DEFAULT (datetime('now')) NOT NULL,
	`venta_descuento_tipo` text DEFAULT 'ninguno' NOT NULL,
	`venta_descuento_valor` integer,
	`venta_descuento_razon` text,
	`venta_metodo_pago` text NOT NULL,
	`venta_estado` text DEFAULT 'completada' NOT NULL,
	`es_venta_efectivo` integer NOT NULL,
	`es_venta_electronica` integer NOT NULL,
	`usuario_cajero_id` text NOT NULL,
	`cierre_caja_id` text NOT NULL,
	FOREIGN KEY (`usuario_cajero_id`) REFERENCES `usuario`(`usuario_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`cierre_caja_id`) REFERENCES `cierre_caja`(`cierre_caja_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "venta_uuid" CHECK(length(venta_id) = 36),
	CONSTRAINT "venta_descuento_tipo_enum" CHECK("venta"."venta_descuento_tipo" IN ('ninguno','porcentaje','monto')),
	CONSTRAINT "venta_metodo_pago_enum" CHECK("venta"."venta_metodo_pago" IN ('efectivo','debito','credito','transferencia')),
	CONSTRAINT "venta_estado_enum" CHECK("venta"."venta_estado" IN ('completada','anulada')),
	CONSTRAINT "venta_descuento_coherente" CHECK(("venta"."venta_descuento_tipo" = 'ninguno' AND "venta"."venta_descuento_valor" IS NULL)
       OR ("venta"."venta_descuento_tipo" <> 'ninguno' AND "venta"."venta_descuento_valor" IS NOT NULL AND "venta"."venta_descuento_valor" > 0)),
	CONSTRAINT "venta_isa_coherente" CHECK(("venta"."venta_metodo_pago" = 'efectivo'
            AND "venta"."es_venta_efectivo" = 1 AND "venta"."es_venta_electronica" = 0)
       OR ("venta"."venta_metodo_pago" <> 'efectivo'
            AND "venta"."es_venta_efectivo" = 0 AND "venta"."es_venta_electronica" = 1))
);
--> statement-breakpoint
CREATE INDEX `idx_venta_fecha` ON `venta` (`venta_fecha_hora`);--> statement-breakpoint
CREATE INDEX `idx_venta_cierre` ON `venta` (`cierre_caja_id`);--> statement-breakpoint
CREATE INDEX `idx_venta_cajero` ON `venta` (`usuario_cajero_id`,`venta_fecha_hora`);--> statement-breakpoint
CREATE INDEX `idx_venta_estado` ON `venta` (`venta_estado`);--> statement-breakpoint
CREATE TABLE `venta_efectivo` (
	`venta_id` text PRIMARY KEY NOT NULL,
	`venta_efectivo_monto_recibido` integer NOT NULL,
	FOREIGN KEY (`venta_id`) REFERENCES `venta`(`venta_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "venta_efectivo_min" CHECK("venta_efectivo"."venta_efectivo_monto_recibido" >= 0)
);
--> statement-breakpoint
CREATE TABLE `venta_lote` (
	`venta_lote_id` text PRIMARY KEY NOT NULL,
	`venta_id` text NOT NULL,
	`lote_id` text NOT NULL,
	`venta_lote_cantidad_consumida` integer NOT NULL,
	FOREIGN KEY (`venta_id`) REFERENCES `venta`(`venta_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lote_id`) REFERENCES `lote`(`lote_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "venta_lote_uuid" CHECK(length(venta_lote_id) = 36),
	CONSTRAINT "venta_lote_cantidad_min" CHECK("venta_lote"."venta_lote_cantidad_consumida" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_venta_lote` ON `venta_lote` (`venta_id`,`lote_id`);