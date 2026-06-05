-- ============================================================================
-- Triggers — Modelo 3FN estricto (Minimarket y Panadería Huáscar)
-- ============================================================================
-- Fuente de verdad de columnas: src/db/schema.ts
-- Se aplican con:  npm run db:migrate && npm run db:triggers
-- Idempotentes:    CREATE TRIGGER IF NOT EXISTS.
--
-- Convención: todos los triggers de VALIDACIÓN abortan con RAISE(ABORT, ...).
-- Solo hay una mutación automática (marcar venta anulada), documentada abajo.
--
-- Decisión de alcance — stock de lote (lote_cantidad_actual):
--   NO se descuenta automáticamente vía trigger. La aplicación es responsable
--   de actualizar lote_cantidad_actual al vender/mermar/ajustar; auto-descontar
--   aquí provocaría doble descuento. Sí se valida que no se consuma más de lo
--   disponible (guards de sobreventa), que es seguro y no muta datos.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Turno no superpuesto para un mismo trabajador (RF25, RF26)
--    Dos turnos del mismo trabajador no pueden traslaparse en el tiempo.
--    Solapamiento: nuevo.inicio < existente.fin  AND  nuevo.fin > existente.inicio
--    Se ignoran turnos cancelados.
-- ----------------------------------------------------------------------------
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


-- ----------------------------------------------------------------------------
-- 2. Producto inactivo no es vendible ni pedible (RF03)
--    No se permite agregar un producto inactivo a una venta ni a un pedido.
-- ----------------------------------------------------------------------------
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


-- ----------------------------------------------------------------------------
-- 3. Coherencia ISA del lote perecible (RF49)
--    El flag es_lote_perecible vive en el supertipo (lote). Se garantiza:
--    3a. El flag es coherente con la categoría: una categoría que exige
--        vencimiento obliga es_lote_perecible=1, y viceversa (enforce RF49 a
--        nivel de lote, ahora posible gracias al flag en el supertipo).
--    3b. Solo puede existir fila en lote_perecible si el flag es_lote_perecible=1.
--    NOTA: la obligatoriedad inversa (flag=1 DEBE tener su fila lote_perecible)
--    no es expresable sin constraints diferidas; se garantiza insertando lote +
--    lote_perecible en la misma transacción a nivel de aplicación.
-- ----------------------------------------------------------------------------
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


-- ----------------------------------------------------------------------------
-- 4. Venta rechazada si la caja está cerrada (RF41)
--    Una venta solo puede registrarse contra un cierre_caja en estado 'abierto'.
-- ----------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS trg_venta_cierre_abierto
BEFORE INSERT ON venta
FOR EACH ROW
WHEN (SELECT cierre_estado FROM cierre_caja
       WHERE cierre_caja_id = NEW.cierre_caja_id) <> 'abierto'
BEGIN
  SELECT RAISE(ABORT, 'No se puede registrar una venta en una caja cerrada (RF41)');
END;


-- ----------------------------------------------------------------------------
-- 5. Log de auditoría inmutable (RNF10)
--    El log de auditoría es append-only: no admite UPDATE ni DELETE.
--    (El schema 3FN no incluye columna 'archived', por lo que es inmutable total.)
-- ----------------------------------------------------------------------------
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

-- El log técnico también es append-only.
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


-- ----------------------------------------------------------------------------
-- 6. Guards de sobreventa / sobre-merma (no se consume más de lo disponible)
--    Validan contra lote_cantidad_actual SIN mutarla (la app la descuenta).
-- ----------------------------------------------------------------------------
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


-- ----------------------------------------------------------------------------
-- 7. Coherencia ISA flag ↔ fila subtipo (venta efectivo y contraseña temporal)
--    Solo puede existir la fila subtipo si el flag del supertipo es 1.
--    (El flag venta.es_venta_efectivo ya está atado a venta_metodo_pago por el
--     CHECK venta_isa_coherente; aquí se ata la EXISTENCIA de la fila subtipo.)
-- ----------------------------------------------------------------------------
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


-- ----------------------------------------------------------------------------
-- 8. Anulación de venta (RF44)
--    8a. Guard: solo se puede anular una venta en estado 'completada'.
--    8b. Mutación controlada: al anular, la venta pasa a estado 'anulada'.
--        (Mantiene coherente venta.venta_estado con la existencia de la
--         anulación; el UNIQUE sobre venta_id ya impide doble anulación.)
-- ----------------------------------------------------------------------------
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
