CREATE TRIGGER IF NOT EXISTS trg_turno_no_superpuesto_ins
BEFORE INSERT ON turno
FOR EACH ROW
WHEN NEW.turno_estado <> 'cancelado' AND EXISTS (
  SELECT 1 FROM turno t
  WHERE t.trabajador_id = NEW.trabajador_id
    AND t.turno_estado <> 'cancelado'
    AND NEW.turno_fecha_hora_inicio < t.turno_fecha_hora_fin
    AND NEW.turno_fecha_hora_fin   > t.turno_fecha_hora_inicio
)
BEGIN
  SELECT RAISE(ABORT, 'Turno superpuesto para el trabajador (RF25/RF26)');
END;

CREATE TRIGGER IF NOT EXISTS trg_turno_no_superpuesto_upd
BEFORE UPDATE OF turno_fecha_hora_inicio, turno_fecha_hora_fin, turno_estado,
                 trabajador_id ON turno
FOR EACH ROW
WHEN NEW.turno_estado <> 'cancelado' AND EXISTS (
  SELECT 1 FROM turno t
  WHERE t.turno_id <> NEW.turno_id
    AND t.trabajador_id = NEW.trabajador_id
    AND t.turno_estado <> 'cancelado'
    AND NEW.turno_fecha_hora_inicio < t.turno_fecha_hora_fin
    AND NEW.turno_fecha_hora_fin   > t.turno_fecha_hora_inicio
)
BEGIN
  SELECT RAISE(ABORT, 'Turno superpuesto para el trabajador (RF25/RF26)');
END;

CREATE TRIGGER IF NOT EXISTS trg_detalle_venta_producto_activo
BEFORE INSERT ON detalle_venta
FOR EACH ROW
WHEN (SELECT producto_estado FROM producto
       WHERE producto_id = NEW.producto_id) <> 'activo'
BEGIN
  SELECT RAISE(ABORT, 'No se puede vender un producto inactivo (RF03)');
END;

CREATE TRIGGER IF NOT EXISTS trg_detalle_pedido_producto_activo
BEFORE INSERT ON detalle_pedido
FOR EACH ROW
WHEN (SELECT producto_estado FROM producto
       WHERE producto_id = NEW.producto_id) <> 'activo'
BEGIN
  SELECT RAISE(ABORT, 'No se puede pedir un producto inactivo (RF03)');
END;

CREATE TRIGGER IF NOT EXISTS trg_lote_flag_categoria_coherente
BEFORE INSERT ON lote
FOR EACH ROW
WHEN (SELECT c.categoria_exige_vencimiento
       FROM producto p JOIN categoria c ON c.categoria_id = p.categoria_id
       WHERE p.producto_id = NEW.producto_id) <> NEW.es_lote_perecible
BEGIN
  SELECT RAISE(ABORT,
    'es_lote_perecible debe coincidir con categoria_exige_vencimiento (RF49)');
END;

CREATE TRIGGER IF NOT EXISTS trg_lote_perecible_flag_coherente
BEFORE INSERT ON lote_perecible
FOR EACH ROW
WHEN (SELECT es_lote_perecible FROM lote WHERE lote_id = NEW.lote_id) <> 1
BEGIN
  SELECT RAISE(ABORT,
    'No se puede crear lote_perecible si el lote no está marcado es_lote_perecible (RF49)');
END;

CREATE TRIGGER IF NOT EXISTS trg_venta_cierre_abierto
BEFORE INSERT ON venta
FOR EACH ROW
WHEN (SELECT cierre_estado FROM cierre_caja
       WHERE cierre_caja_id = NEW.cierre_caja_id) <> 'abierto'
BEGIN
  SELECT RAISE(ABORT, 'No se puede registrar una venta en una caja cerrada (RF41)');
END;

CREATE TRIGGER IF NOT EXISTS trg_log_auditoria_no_update
BEFORE UPDATE ON log_auditoria
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'log_auditoria es inmutable: UPDATE no permitido (RNF10)');
END;

CREATE TRIGGER IF NOT EXISTS trg_log_auditoria_no_delete
BEFORE DELETE ON log_auditoria
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'log_auditoria es inmutable: DELETE no permitido (RNF10)');
END;

CREATE TRIGGER IF NOT EXISTS trg_log_errores_no_update
BEFORE UPDATE ON log_errores_tecnicos
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'log_errores_tecnicos es inmutable: UPDATE no permitido (RNF10)');
END;

CREATE TRIGGER IF NOT EXISTS trg_log_errores_no_delete
BEFORE DELETE ON log_errores_tecnicos
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'log_errores_tecnicos es inmutable: DELETE no permitido (RNF10)');
END;

CREATE TRIGGER IF NOT EXISTS trg_venta_lote_stock_suficiente
BEFORE INSERT ON venta_lote
FOR EACH ROW
WHEN NEW.venta_lote_cantidad_consumida >
     (SELECT lote_cantidad_actual FROM lote WHERE lote_id = NEW.lote_id)
BEGIN
  SELECT RAISE(ABORT, 'Cantidad vendida excede el stock disponible del lote');
END;

CREATE TRIGGER IF NOT EXISTS trg_merma_lote_stock_suficiente
BEFORE INSERT ON merma_lote
FOR EACH ROW
WHEN NEW.merma_lote_cantidad_descontada >
     (SELECT lote_cantidad_actual FROM lote WHERE lote_id = NEW.lote_id)
BEGIN
  SELECT RAISE(ABORT, 'Cantidad de merma excede el stock disponible del lote');
END;

CREATE TRIGGER IF NOT EXISTS trg_venta_efectivo_flag_coherente
BEFORE INSERT ON venta_efectivo
FOR EACH ROW
WHEN (SELECT es_venta_efectivo FROM venta WHERE venta_id = NEW.venta_id) <> 1
BEGIN
  SELECT RAISE(ABORT,
    'venta_efectivo solo aplica a ventas marcadas es_venta_efectivo');
END;

CREATE TRIGGER IF NOT EXISTS trg_contrasena_temporal_flag_coherente
BEFORE INSERT ON contrasena_temporal
FOR EACH ROW
WHEN (SELECT es_contrasena_temporal FROM contrasena
       WHERE contrasena_id = NEW.contrasena_id) <> 1
BEGIN
  SELECT RAISE(ABORT,
    'contrasena_temporal solo aplica a contraseñas marcadas es_contrasena_temporal');
END;

CREATE TRIGGER IF NOT EXISTS trg_anulacion_venta_solo_completada
BEFORE INSERT ON anulacion_venta
FOR EACH ROW
WHEN (SELECT venta_estado FROM venta
       WHERE venta_id = NEW.venta_id) <> 'completada'
BEGIN
  SELECT RAISE(ABORT, 'Solo se puede anular una venta en estado completada (RF44)');
END;

CREATE TRIGGER IF NOT EXISTS trg_anulacion_venta_marca_estado
AFTER INSERT ON anulacion_venta
FOR EACH ROW
BEGIN
  UPDATE venta SET venta_estado = 'anulada' WHERE venta_id = NEW.venta_id;
END;
