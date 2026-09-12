ALTER TABLE `sesion_usuario` ADD `sesion_rol_efectivo` text;

--> statement-breakpoint
UPDATE `sesion_usuario`
   SET `sesion_rol_efectivo` = CASE
     WHEN (SELECT lower(u.`usuario_rol`) FROM `usuario` u
            WHERE u.`usuario_id` = `sesion_usuario`.`usuario_id`) LIKE 'due%'
       THEN 'dueno' ELSE 'trabajador' END
 WHERE `sesion_rol_efectivo` IS NULL;
