PRAGMA foreign_keys=OFF;

CREATE TABLE `__new_venta` (
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
	`venta_responsable_nombre` text NOT NULL,
	`venta_responsable_rol` text NOT NULL,
	`cierre_caja_id` text NOT NULL,
	FOREIGN KEY (`usuario_cajero_id`) REFERENCES `usuario`(`usuario_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`cierre_caja_id`) REFERENCES `cierre_caja`(`cierre_caja_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "venta_uuid" CHECK(length(venta_id) = 36),
	CONSTRAINT "venta_descuento_tipo_enum" CHECK("__new_venta"."venta_descuento_tipo" IN ('ninguno','porcentaje','monto')),
	CONSTRAINT "venta_metodo_pago_enum" CHECK("__new_venta"."venta_metodo_pago" IN ('efectivo','debito','credito','transferencia')),
	CONSTRAINT "venta_estado_enum" CHECK("__new_venta"."venta_estado" IN ('completada','anulada')),
	CONSTRAINT "venta_responsable_nombre_no_vacio" CHECK(length(trim("__new_venta"."venta_responsable_nombre")) > 0),
	CONSTRAINT "venta_responsable_rol_enum" CHECK("__new_venta"."venta_responsable_rol" IN ('dueno','trabajador')),
	CONSTRAINT "venta_descuento_coherente" CHECK(("__new_venta"."venta_descuento_tipo" = 'ninguno' AND "__new_venta"."venta_descuento_valor" IS NULL)
		OR ("__new_venta"."venta_descuento_tipo" <> 'ninguno' AND "__new_venta"."venta_descuento_valor" IS NOT NULL AND "__new_venta"."venta_descuento_valor" > 0)),
	CONSTRAINT "venta_isa_coherente" CHECK(("__new_venta"."venta_metodo_pago" = 'efectivo'
			AND "__new_venta"."es_venta_efectivo" = 1 AND "__new_venta"."es_venta_electronica" = 0)
		OR ("__new_venta"."venta_metodo_pago" <> 'efectivo'
			AND "__new_venta"."es_venta_efectivo" = 0 AND "__new_venta"."es_venta_electronica" = 1))
);

WITH `version_responsable` AS (
	SELECT
		v.`venta_id`,
		uv.`usuario_version_id`,
		uv.`usuario_version_nombre`,
		uv.`usuario_version_rol`,
		ROW_NUMBER() OVER (
			PARTITION BY v.`venta_id`
			ORDER BY
				datetime(uv.`usuario_version_fecha_hora_vigencia_desde`) DESC,
				(uv.`usuario_version_fecha_hora_vigencia_hasta` IS NULL) DESC,
				uv.`usuario_version_id` DESC
		) AS `prioridad`
	FROM `venta` v
	LEFT JOIN `usuario_version` uv
		ON uv.`usuario_id` = v.`usuario_cajero_id`
		AND datetime(uv.`usuario_version_fecha_hora_vigencia_desde`) <= datetime(v.`venta_fecha_hora`)
		AND (
			uv.`usuario_version_fecha_hora_vigencia_hasta` IS NULL
			OR datetime(v.`venta_fecha_hora`) < datetime(uv.`usuario_version_fecha_hora_vigencia_hasta`)
		)
)
INSERT INTO `__new_venta` (
	`venta_id`, `venta_fecha_hora`, `venta_descuento_tipo`,
	`venta_descuento_valor`, `venta_descuento_razon`, `venta_metodo_pago`,
	`venta_estado`, `es_venta_efectivo`, `es_venta_electronica`,
	`usuario_cajero_id`, `venta_responsable_nombre`, `venta_responsable_rol`,
	`cierre_caja_id`
)
SELECT
	v.`venta_id`,
	v.`venta_fecha_hora`,
	v.`venta_descuento_tipo`,
	v.`venta_descuento_valor`,
	v.`venta_descuento_razon`,
	v.`venta_metodo_pago`,
	v.`venta_estado`,
	v.`es_venta_efectivo`,
	v.`es_venta_electronica`,
	v.`usuario_cajero_id`,
	CASE
		WHEN vr.`usuario_version_id` IS NOT NULL
			THEN NULLIF(trim(vr.`usuario_version_nombre`), '')
		ELSE NULLIF(trim(t.`trabajador_nombre` || ' ' || t.`trabajador_apellido`), '')
	END,
	CASE
		WHEN vr.`usuario_version_id` IS NOT NULL THEN
			CASE WHEN vr.`usuario_version_rol` IN ('dueno', 'trabajador')
				THEN vr.`usuario_version_rol` ELSE NULL END
		WHEN u.`usuario_rol` IN ('dueno', 'trabajador') THEN u.`usuario_rol`
		ELSE NULL
	END,
	v.`cierre_caja_id`
FROM `venta` v
LEFT JOIN `usuario` u ON u.`usuario_id` = v.`usuario_cajero_id`
LEFT JOIN `trabajador` t ON t.`trabajador_id` = u.`trabajador_id`
LEFT JOIN `version_responsable` vr
	ON vr.`venta_id` = v.`venta_id` AND vr.`prioridad` = 1;

DROP TABLE `venta`;
ALTER TABLE `__new_venta` RENAME TO `venta`;

CREATE INDEX `idx_venta_fecha` ON `venta` (`venta_fecha_hora`);
CREATE INDEX `idx_venta_cierre` ON `venta` (`cierre_caja_id`);
CREATE INDEX `idx_venta_cajero` ON `venta` (`usuario_cajero_id`,`venta_fecha_hora`);
CREATE INDEX `idx_venta_estado` ON `venta` (`venta_estado`);

PRAGMA foreign_keys=ON;
