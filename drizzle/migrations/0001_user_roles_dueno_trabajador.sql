PRAGMA foreign_keys=OFF;

CREATE TABLE `usuario_new` (
	`usuario_id` text PRIMARY KEY NOT NULL,
	`usuario_rol` text NOT NULL,
	`usuario_fecha_creacion` text DEFAULT (datetime('now')) NOT NULL,
	`usuario_ultimo_login_fecha_hora` text,
	`trabajador_id` integer NOT NULL,
	FOREIGN KEY (`trabajador_id`) REFERENCES `trabajador`(`trabajador_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "usuario_id_length" CHECK(length("usuario_new"."usuario_id") BETWEEN 3 AND 50),
	CONSTRAINT "usuario_rol_enum" CHECK("usuario_new"."usuario_rol" IN ('dueno','trabajador'))
);

INSERT INTO `usuario_new` (
	`usuario_id`,
	`usuario_rol`,
	`usuario_fecha_creacion`,
	`usuario_ultimo_login_fecha_hora`,
	`trabajador_id`
)
SELECT
	`usuario_id`,
	CASE
		WHEN lower(`usuario_rol`) IN ('dueno', 'dueño', 'dueÃ±o') THEN 'dueno'
		ELSE 'trabajador'
	END,
	`usuario_fecha_creacion`,
	`usuario_ultimo_login_fecha_hora`,
	`trabajador_id`
FROM `usuario`;

DROP TABLE `usuario`;

ALTER TABLE `usuario_new` RENAME TO `usuario`;

CREATE UNIQUE INDEX `usuario_trabajador_id_unique` ON `usuario` (`trabajador_id`);

CREATE TABLE `usuario_version_new` (
	`usuario_version_id` text PRIMARY KEY NOT NULL,
	`usuario_version_nombre` text NOT NULL,
	`usuario_version_rol` text NOT NULL,
	`usuario_version_fecha_hora_vigencia_desde` text DEFAULT (datetime('now')) NOT NULL,
	`usuario_version_fecha_hora_vigencia_hasta` text,
	`usuario_id` text NOT NULL,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuario`(`usuario_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "usuario_version_uuid" CHECK(length(usuario_version_id) = 36),
	CONSTRAINT "usuario_version_rol_enum" CHECK("usuario_version_new"."usuario_version_rol" IN ('dueno','trabajador')),
	CONSTRAINT "usuario_version_vigencia_rango" CHECK("usuario_version_new"."usuario_version_fecha_hora_vigencia_hasta" IS NULL
       OR "usuario_version_new"."usuario_version_fecha_hora_vigencia_desde" <= "usuario_version_new"."usuario_version_fecha_hora_vigencia_hasta")
);

INSERT INTO `usuario_version_new` (
	`usuario_version_id`,
	`usuario_version_nombre`,
	`usuario_version_rol`,
	`usuario_version_fecha_hora_vigencia_desde`,
	`usuario_version_fecha_hora_vigencia_hasta`,
	`usuario_id`
)
SELECT
	`usuario_version_id`,
	`usuario_version_nombre`,
	CASE
		WHEN lower(`usuario_version_rol`) IN ('dueno', 'dueño', 'dueÃ±o') THEN 'dueno'
		ELSE 'trabajador'
	END,
	`usuario_version_fecha_hora_vigencia_desde`,
	`usuario_version_fecha_hora_vigencia_hasta`,
	`usuario_id`
FROM `usuario_version`;

DROP TABLE `usuario_version`;

ALTER TABLE `usuario_version_new` RENAME TO `usuario_version`;

CREATE INDEX `idx_usuario_version_usuario` ON `usuario_version` (`usuario_id`,`usuario_version_fecha_hora_vigencia_desde`);

PRAGMA foreign_keys=ON;
