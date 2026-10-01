DROP TRIGGER IF EXISTS `trg_contrasena_temporal_flag_coherente`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_contrasena` (
	`contrasena_id` text PRIMARY KEY NOT NULL,
	`contrasena_hash` text NOT NULL,
	`contrasena_fecha_hora_creacion` text DEFAULT (datetime('now')) NOT NULL,
	`usuario_id` text NOT NULL,
	`generada_por_usuario_id` text,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuario`(`usuario_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`generada_por_usuario_id`) REFERENCES `usuario`(`usuario_id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "contrasena_uuid" CHECK(length(contrasena_id) = 36)
);
--> statement-breakpoint
INSERT INTO `__new_contrasena`("contrasena_id", "contrasena_hash", "contrasena_fecha_hora_creacion", "usuario_id", "generada_por_usuario_id") SELECT "contrasena_id", "contrasena_hash", "contrasena_fecha_hora_creacion", "usuario_id", "generada_por_usuario_id" FROM `contrasena`;--> statement-breakpoint
DROP TABLE `contrasena`;--> statement-breakpoint
ALTER TABLE `__new_contrasena` RENAME TO `contrasena`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_contrasena_usuario` ON `contrasena` (`usuario_id`,`contrasena_fecha_hora_creacion`);--> statement-breakpoint
CREATE TABLE `__new_contrasena_temporal` (
	`contrasena_temporal_id` text PRIMARY KEY NOT NULL,
	`contrasena_temporal_fecha_hora_expiracion` text NOT NULL,
	`contrasena_id` text NOT NULL,
	FOREIGN KEY (`contrasena_id`) REFERENCES `contrasena`(`contrasena_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "contrasena_temporal_uuid" CHECK(length(contrasena_temporal_id) = 36)
);
--> statement-breakpoint
INSERT INTO `__new_contrasena_temporal`("contrasena_temporal_id", "contrasena_temporal_fecha_hora_expiracion", "contrasena_id") SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))), "contrasena_temporal_fecha_hora_expiracion", "contrasena_id" FROM `contrasena_temporal`;--> statement-breakpoint
DROP TABLE `contrasena_temporal`;--> statement-breakpoint
ALTER TABLE `__new_contrasena_temporal` RENAME TO `contrasena_temporal`;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_contrasena_temporal_contrasena` ON `contrasena_temporal` (`contrasena_id`);