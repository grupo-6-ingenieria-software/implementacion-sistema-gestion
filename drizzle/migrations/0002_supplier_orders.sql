CREATE TABLE `detalle_recepcion` (
	`detalle_recepcion_id` text PRIMARY KEY NOT NULL,
	`recepcion_pedido_id` text NOT NULL,
	`detalle_pedido_id` text NOT NULL,
	`lote_id` text NOT NULL,
	`detalle_recepcion_cantidad` integer NOT NULL,
	FOREIGN KEY (`recepcion_pedido_id`) REFERENCES `recepcion_pedido`(`recepcion_pedido_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`detalle_pedido_id`) REFERENCES `detalle_pedido`(`detalle_pedido_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`lote_id`) REFERENCES `lote`(`lote_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "detalle_recepcion_uuid" CHECK(length(detalle_recepcion_id) = 36),
	CONSTRAINT "detalle_recepcion_cantidad_min" CHECK("detalle_recepcion"."detalle_recepcion_cantidad" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `detalle_recepcion_lote_id_unique` ON `detalle_recepcion` (`lote_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_detalle_recepcion_linea` ON `detalle_recepcion` (`recepcion_pedido_id`,`detalle_pedido_id`);--> statement-breakpoint
CREATE INDEX `idx_detalle_recepcion_recepcion` ON `detalle_recepcion` (`recepcion_pedido_id`);--> statement-breakpoint
CREATE TABLE `recepcion_pedido` (
	`recepcion_pedido_id` text PRIMARY KEY NOT NULL,
	`recepcion_operacion_id` text NOT NULL,
	`recepcion_fecha_hora` text DEFAULT (datetime('now')) NOT NULL,
	`recepcion_estado_resultante` text NOT NULL,
	`pedido_proveedor_id` text NOT NULL,
	`usuario_id` text NOT NULL,
	FOREIGN KEY (`pedido_proveedor_id`) REFERENCES `pedido_proveedor`(`pedido_proveedor_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuario`(`usuario_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "recepcion_pedido_uuid" CHECK(length(recepcion_pedido_id) = 36),
	CONSTRAINT "recepcion_operacion_uuid" CHECK(length(recepcion_operacion_id) = 36),
	CONSTRAINT "recepcion_estado_resultante_enum" CHECK("recepcion_pedido"."recepcion_estado_resultante" IN ('parcial','recibido'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recepcion_pedido_recepcion_operacion_id_unique` ON `recepcion_pedido` (`recepcion_operacion_id`);--> statement-breakpoint
CREATE INDEX `idx_recepcion_pedido` ON `recepcion_pedido` (`pedido_proveedor_id`,`recepcion_fecha_hora`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_detalle_pedido` (
	`detalle_pedido_id` text PRIMARY KEY NOT NULL,
	`pedido_proveedor_id` text NOT NULL,
	`producto_id` integer NOT NULL,
	`cantidad_solicitada` integer NOT NULL,
	`cantidad_recibida` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`pedido_proveedor_id`) REFERENCES `pedido_proveedor`(`pedido_proveedor_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`producto_id`) REFERENCES `producto`(`producto_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "detalle_pedido_uuid" CHECK(length(detalle_pedido_id) = 36),
	CONSTRAINT "detalle_pedido_solicitada_min" CHECK("__new_detalle_pedido"."cantidad_solicitada" > 0),
	CONSTRAINT "detalle_pedido_recibida_range" CHECK("__new_detalle_pedido"."cantidad_recibida" >= 0 AND "__new_detalle_pedido"."cantidad_recibida" <= "__new_detalle_pedido"."cantidad_solicitada")
);
--> statement-breakpoint
INSERT INTO `__new_detalle_pedido`("detalle_pedido_id", "pedido_proveedor_id", "producto_id", "cantidad_solicitada", "cantidad_recibida") SELECT "detalle_pedido_id", "pedido_proveedor_id", "producto_id", "cantidad_solicitada", COALESCE("cantidad_recibida", 0) FROM `detalle_pedido`;--> statement-breakpoint
DROP TABLE `detalle_pedido`;--> statement-breakpoint
ALTER TABLE `__new_detalle_pedido` RENAME TO `detalle_pedido`;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_detalle_pedido` ON `detalle_pedido` (`pedido_proveedor_id`,`producto_id`);--> statement-breakpoint
CREATE INDEX `idx_detalle_pedido_pedido` ON `detalle_pedido` (`pedido_proveedor_id`);--> statement-breakpoint
CREATE TABLE `__new_pedido_proveedor` (
	`pedido_proveedor_id` text PRIMARY KEY NOT NULL,
	`pedido_proveedor_fecha_hora_emision` text DEFAULT (datetime('now')) NOT NULL,
	`pedido_proveedor_estado` text DEFAULT 'pendiente' NOT NULL,
	`pedido_proveedor_fecha_hora_recepcion` text,
	`pedido_proveedor_nota_recepcion` text,
	`proveedor_id` integer NOT NULL,
	`usuario_emisor_id` text NOT NULL,
	`usuario_receptor_id` text,
	FOREIGN KEY (`proveedor_id`) REFERENCES `proveedor`(`proveedor_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`usuario_emisor_id`) REFERENCES `usuario`(`usuario_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`usuario_receptor_id`) REFERENCES `usuario`(`usuario_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "pedido_proveedor_uuid" CHECK(length(pedido_proveedor_id) = 36),
	CONSTRAINT "pedido_proveedor_estado_enum" CHECK("__new_pedido_proveedor"."pedido_proveedor_estado" IN ('pendiente','parcial','recibido','cancelado','parcial_cerrado'))
);
--> statement-breakpoint
INSERT INTO `__new_pedido_proveedor`("pedido_proveedor_id", "pedido_proveedor_fecha_hora_emision", "pedido_proveedor_estado", "pedido_proveedor_fecha_hora_recepcion", "pedido_proveedor_nota_recepcion", "proveedor_id", "usuario_emisor_id", "usuario_receptor_id")
SELECT
	"pedido_proveedor_id",
	"pedido_proveedor_fecha_hora_emision",
	CASE
		WHEN "pedido_proveedor_estado" IN ('pendiente','parcial','recibido','cancelado','parcial_cerrado') THEN "pedido_proveedor_estado"
		WHEN "pedido_proveedor_estado" IN ('borrador','emitido','enviado') THEN 'pendiente'
		ELSE 'pendiente'
	END,
	"pedido_proveedor_fecha_hora_recepcion",
	"pedido_proveedor_nota_recepcion",
	"proveedor_id",
	"usuario_emisor_id",
	"usuario_receptor_id"
FROM `pedido_proveedor`;--> statement-breakpoint
DROP TABLE `pedido_proveedor`;--> statement-breakpoint
ALTER TABLE `__new_pedido_proveedor` RENAME TO `pedido_proveedor`;--> statement-breakpoint
CREATE INDEX `idx_pedido_proveedor_proveedor` ON `pedido_proveedor` (`proveedor_id`);--> statement-breakpoint
CREATE INDEX `idx_pedido_proveedor_estado` ON `pedido_proveedor` (`pedido_proveedor_estado`);--> statement-breakpoint
PRAGMA foreign_keys=ON;
