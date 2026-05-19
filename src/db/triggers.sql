-- ============================================================================
-- Triggers — aplicar como migración custom tras drizzle-kit migrate
-- ============================================================================
-- Drizzle no representa triggers en TypeScript. Este archivo se ejecuta
-- manualmente o vía un wrapper en migrations/. Es seguro re-ejecutarlo gracias
-- al `IF NOT EXISTS` de cada CREATE TRIGGER (extensión de SQLite).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Turnos no superpuestos (RF25, RF26)
-- ----------------------------------------------------------------------------

CREATE TRIGGER IF NOT EXISTS turno_no_overlap_insert
BEFORE INSERT ON turno FOR EACH ROW
WHEN NEW.estado <> 'cancelado'
 AND EXISTS (
    SELECT 1 FROM turno t
    WHERE t.trabajador_id = NEW.trabajador_id
      AND t.estado <> 'cancelado'
      AND t.inicio_at < NEW.fin_at
      AND t.fin_at    > NEW.inicio_at
 )
BEGIN
    SELECT RAISE(ABORT, 'Turno se cruza con otro del mismo trabajador (RF25)');
END;

CREATE TRIGGER IF NOT EXISTS turno_no_overlap_update
BEFORE UPDATE ON turno FOR EACH ROW
WHEN NEW.estado <> 'cancelado'
 AND EXISTS (
    SELECT 1 FROM turno t
    WHERE t.trabajador_id = NEW.trabajador_id
      AND t.turno_id <> NEW.turno_id
      AND t.estado <> 'cancelado'
      AND t.inicio_at < NEW.fin_at
      AND t.fin_at    > NEW.inicio_at
 )
BEGIN
    SELECT RAISE(ABORT, 'Turno se cruza con otro del mismo trabajador (RF26)');
END;

-- ----------------------------------------------------------------------------
-- 2. Producto activo (RF03)
-- ----------------------------------------------------------------------------

CREATE TRIGGER IF NOT EXISTS detalle_pedido_producto_activo
BEFORE INSERT ON detalle_pedido FOR EACH ROW
WHEN (SELECT estado FROM producto WHERE producto_id = NEW.producto_id) = 'inactivo'
BEGIN
    SELECT RAISE(ABORT, 'No se puede pedir un producto inactivo (RF03)');
END;

CREATE TRIGGER IF NOT EXISTS detalle_venta_producto_activo
BEFORE INSERT ON detalle_venta FOR EACH ROW
WHEN (SELECT estado FROM producto WHERE producto_id = NEW.producto_id) = 'inactivo'
BEGIN
    SELECT RAISE(ABORT, 'No se puede vender un producto inactivo (RF03)');
END;

-- ----------------------------------------------------------------------------
-- 3. Lote: fecha_vencimiento obligatoria si la categoría lo exige (RF49)
-- ----------------------------------------------------------------------------

CREATE TRIGGER IF NOT EXISTS lote_vencimiento_insert
BEFORE INSERT ON lote FOR EACH ROW
WHEN NEW.fecha_vencimiento IS NULL
 AND EXISTS (
    SELECT 1 FROM producto p
    JOIN categoria c ON c.categoria_id = p.categoria_id
    WHERE p.producto_id = NEW.producto_id
      AND c.requiere_vencimiento = 1
 )
BEGIN
    SELECT RAISE(ABORT, 'La categoría exige fecha_vencimiento (RF49)');
END;

CREATE TRIGGER IF NOT EXISTS lote_vencimiento_update
BEFORE UPDATE ON lote FOR EACH ROW
WHEN NEW.fecha_vencimiento IS NULL
 AND EXISTS (
    SELECT 1 FROM producto p
    JOIN categoria c ON c.categoria_id = p.categoria_id
    WHERE p.producto_id = NEW.producto_id
      AND c.requiere_vencimiento = 1
 )
BEGIN
    SELECT RAISE(ABORT, 'La categoría exige fecha_vencimiento (RF49)');
END;

-- ----------------------------------------------------------------------------
-- 4. Venta post-cierre rechazada (RF41)
-- ----------------------------------------------------------------------------

CREATE TRIGGER IF NOT EXISTS venta_no_post_cierre
BEFORE INSERT ON venta FOR EACH ROW
WHEN EXISTS (
    SELECT 1 FROM cierre_caja
    WHERE usuario_id = NEW.usuario_id
      AND date(created_at) = date(COALESCE(NEW.created_at, datetime('now')))
)
BEGIN
    SELECT RAISE(ABORT, 'La caja del usuario ya está cerrada para esta fecha (RF41)');
END;

-- ----------------------------------------------------------------------------
-- 5. Producto en unidades sin cantidad fraccional (RF35)
-- ----------------------------------------------------------------------------

CREATE TRIGGER IF NOT EXISTS detalle_venta_unidad_entera
BEFORE INSERT ON detalle_venta FOR EACH ROW
WHEN NEW.cantidad <> CAST(NEW.cantidad AS INTEGER)
 AND (SELECT unidad_medida FROM producto WHERE producto_id = NEW.producto_id) = 'unidad'
BEGIN
    SELECT RAISE(ABORT, 'Producto en unidades no admite cantidad fraccional (RF35)');
END;

CREATE TRIGGER IF NOT EXISTS mov_inv_unidad_entera
BEFORE INSERT ON movimiento_inventario FOR EACH ROW
WHEN ABS(NEW.cantidad) <> CAST(ABS(NEW.cantidad) AS INTEGER)
 AND (SELECT unidad_medida FROM producto WHERE producto_id = NEW.producto_id) = 'unidad'
BEGIN
    SELECT RAISE(ABORT, 'Producto en unidades no admite cantidad fraccional (RF35)');
END;

-- ----------------------------------------------------------------------------
-- 6. audit_log inmutable (RNF10) — solo permite archived 0 -> 1
-- ----------------------------------------------------------------------------

CREATE TRIGGER IF NOT EXISTS audit_log_no_update
BEFORE UPDATE ON audit_log FOR EACH ROW
WHEN OLD.archived = 1
  OR NEW.archived = 0
  OR OLD.audit_log_id IS NOT NEW.audit_log_id
  OR OLD.usuario_id   IS NOT NEW.usuario_id
  OR OLD.username     IS NOT NEW.username
  OR OLD.rol          IS NOT NEW.rol
  OR OLD.accion       IS NOT NEW.accion
  OR OLD.modulo       IS NOT NEW.modulo
  OR OLD.descripcion  IS NOT NEW.descripcion
  OR OLD.created_at   IS NOT NEW.created_at
BEGIN
    SELECT RAISE(ABORT, 'audit_log es inmutable (RNF10): solo se permite archived 0->1');
END;

CREATE TRIGGER IF NOT EXISTS audit_log_no_delete
BEFORE DELETE ON audit_log
BEGIN
    SELECT RAISE(ABORT, 'audit_log es inmutable (RNF10)');
END;

-- ----------------------------------------------------------------------------
-- 7. Auto-actualización de updated_at
-- ----------------------------------------------------------------------------

CREATE TRIGGER IF NOT EXISTS trabajador_updated_at
AFTER UPDATE ON trabajador FOR EACH ROW
WHEN OLD.updated_at IS NEW.updated_at
BEGIN
    UPDATE trabajador SET updated_at = datetime('now')
    WHERE trabajador_id = NEW.trabajador_id;
END;

CREATE TRIGGER IF NOT EXISTS usuario_updated_at
AFTER UPDATE ON usuario FOR EACH ROW
WHEN OLD.updated_at IS NEW.updated_at
BEGIN
    UPDATE usuario SET updated_at = datetime('now')
    WHERE usuario_id = NEW.usuario_id;
END;

CREATE TRIGGER IF NOT EXISTS turno_updated_at
AFTER UPDATE ON turno FOR EACH ROW
WHEN OLD.updated_at IS NEW.updated_at
BEGIN
    UPDATE turno SET updated_at = datetime('now')
    WHERE turno_id = NEW.turno_id;
END;

CREATE TRIGGER IF NOT EXISTS asistencia_updated_at
AFTER UPDATE ON asistencia FOR EACH ROW
WHEN OLD.updated_at IS NEW.updated_at
BEGIN
    UPDATE asistencia SET updated_at = datetime('now')
    WHERE asistencia_id = NEW.asistencia_id;
END;
