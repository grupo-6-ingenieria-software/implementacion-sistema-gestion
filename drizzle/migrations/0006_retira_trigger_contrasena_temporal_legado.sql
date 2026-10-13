-- 0005 ya lo elimina, pero un cliente con triggers.sql anterior puede haberlo
-- recreado después. Consulta es_contrasena_temporal, que ya no existe.
DROP TRIGGER IF EXISTS `trg_contrasena_temporal_flag_coherente`;
