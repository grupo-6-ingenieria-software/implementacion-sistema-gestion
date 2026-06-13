/**
 * Seed mínimo de desarrollo — Modelo 3FN estricto.
 * Ejecutar: npm run db:seed
 *
 * Crea el conjunto mínimo de datos para poder levantar la app:
 * - 2 trabajadores (dueno + trabajador)
 * - 2 usuarios (con PK derivada del RUT)
 * - 3 categorías (1 perecible + 2 no perecibles)
 * - 1 proveedor con sus relaciones de categoría
 * - 3 productos + historial_precio inicial + lotes
 * - 1 tasa legal (AFP)
 * - 1 cierre de caja abierto (para permitir ventas si se quiere probar)
 */

import 'dotenv/config';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import bcrypt from 'bcryptjs';
import { TEMP_PASSWORD_MS } from '../shared/auth.js';
import * as s from './schema.js';

const client = createClient({
  url: process.env.DATABASE_URL ?? 'file:./local.db',
  authToken: process.env.DATABASE_AUTH_TOKEN,
});
await client.execute('PRAGMA foreign_keys = ON');
const db = drizzle(client, { schema: s });

// ----------------------------------------------------------------------------
// Trabajadores
// ----------------------------------------------------------------------------

const [dueno] = await db
  .insert(s.trabajador)
  .values({
    trabajadorRut: '12345678-9',
    trabajadorNombre: 'María',
    trabajadorApellido: 'Huáscar',
    trabajadorTelefono: '987654321',
    trabajadorCorreoElectronico: 'maria@huascar.cl',
    trabajadorFechaIngreso: '2024-01-01',
    trabajadorEstado: 'activo',
  })
  .returning();

const [cajera] = await db
  .insert(s.trabajador)
  .values({
    trabajadorRut: '23456789-0',
    trabajadorNombre: 'Camila',
    trabajadorApellido: 'Rojas',
    trabajadorTelefono: '912345678',
    trabajadorCorreoElectronico: null,
    trabajadorFechaIngreso: '2025-06-15',
    trabajadorEstado: 'activo',
  })
  .returning();

// ----------------------------------------------------------------------------
// Usuarios (PK = RUT del trabajador)
// ----------------------------------------------------------------------------

const USR_DUENO = dueno.trabajadorRut;
const USR_CAJERA = cajera.trabajadorRut;

await db.insert(s.usuario).values([
  {
    usuarioId: USR_DUENO,
    usuarioRol: 'dueno',
    trabajadorId: dueno.trabajadorId,
  },
  {
    usuarioId: USR_CAJERA,
    usuarioRol: 'trabajador',
    trabajadorId: cajera.trabajadorId,
  },
]);

// ----------------------------------------------------------------------------
// Contraseñas (RF55, RF58)
// - Dueño: contraseña DEFINITIVA fija para desarrollo.
// - Cajera: contraseña TEMPORAL (fuerza cambio al primer login, expira en 24h).
// ----------------------------------------------------------------------------

const DUENO_PASSWORD = 'Huascar2026';
const CAJERA_TEMP_PASSWORD = 'Caja2026';

await db.insert(s.contrasena).values({
  contrasenaHash: await bcrypt.hash(DUENO_PASSWORD, 10),
  esContrasenaTemporal: false,
  esContrasenaDefinitiva: true,
  usuarioId: USR_DUENO,
  generadaPorUsuarioId: USR_DUENO,
});

const [cajeraPwd] = await db
  .insert(s.contrasena)
  .values({
    contrasenaHash: await bcrypt.hash(CAJERA_TEMP_PASSWORD, 10),
    esContrasenaTemporal: true,
    esContrasenaDefinitiva: false,
    usuarioId: USR_CAJERA,
    generadaPorUsuarioId: USR_DUENO,
  })
  .returning({ contrasenaId: s.contrasena.contrasenaId });

await db.insert(s.contrasenaTemporal).values({
  contrasenaId: cajeraPwd.contrasenaId,
  contrasenaTemporalFechaHoraExpiracion: new Date(
    Date.now() + TEMP_PASSWORD_MS,
  ).toISOString(),
});

// ----------------------------------------------------------------------------
// Categorías
// ----------------------------------------------------------------------------

const [catBebidas] = await db
  .insert(s.categoria)
  .values({ categoriaNombre: 'Bebidas', categoriaExigeVencimiento: false })
  .returning();

const [catLacteos] = await db
  .insert(s.categoria)
  .values({ categoriaNombre: 'Lácteos', categoriaExigeVencimiento: true })
  .returning();

const [catPan] = await db
  .insert(s.categoria)
  .values({ categoriaNombre: 'Panadería', categoriaExigeVencimiento: true })
  .returning();

// ----------------------------------------------------------------------------
// Proveedor + relación con categorías
// ----------------------------------------------------------------------------

const [prov] = await db
  .insert(s.proveedor)
  .values({
    proveedorRut: '76543210-K',
    proveedorNombreRazonSocial: 'Distribuidora Central S.A.',
    proveedorNombreContacto: 'Juan Pérez',
    proveedorTelefono: '912345678',
    proveedorCorreoElectronico: 'ventas@distribuidora.cl',
  })
  .returning();

await db.insert(s.proveedorCategoria).values([
  { proveedorId: prov.proveedorId, categoriaId: catBebidas.categoriaId },
  { proveedorId: prov.proveedorId, categoriaId: catLacteos.categoriaId },
]);

// ----------------------------------------------------------------------------
// Productos
// ----------------------------------------------------------------------------

const [coca] = await db
  .insert(s.producto)
  .values({
    productoEan13: '7802920000017',
    productoNombre: 'Coca-Cola 1.5L',
    productoPrecioVenta: 1800,
    productoStockMinimo: 20,
    productoEstado: 'activo',
    categoriaId: catBebidas.categoriaId,
  })
  .returning();

const [leche] = await db
  .insert(s.producto)
  .values({
    productoEan13: '7802345600012',
    productoNombre: 'Leche Soprole 1L',
    productoPrecioVenta: 1390,
    productoStockMinimo: 30,
    productoEstado: 'activo',
    categoriaId: catLacteos.categoriaId,
  })
  .returning();

const [hallulla] = await db
  .insert(s.producto)
  .values({
    productoEan13: '7800000000123',
    productoNombre: 'Hallulla (unidad)',
    productoPrecioVenta: 250,
    productoStockMinimo: 50,
    productoEstado: 'activo',
    categoriaId: catPan.categoriaId,
  })
  .returning();

// ----------------------------------------------------------------------------
// Historial de precio inicial por producto (requerido por detalle_venta)
// ----------------------------------------------------------------------------

await db.insert(s.historialPrecioProducto).values([
  {
    historialPrecioCosto: 1200,
    historialPrecioVenta: 1800,
    productoId: coca.productoId,
  },
  {
    historialPrecioCosto: 950,
    historialPrecioVenta: 1390,
    productoId: leche.productoId,
  },
  {
    historialPrecioCosto: 150,
    historialPrecioVenta: 250,
    productoId: hallulla.productoId,
  },
]);

// ----------------------------------------------------------------------------
// Lotes iniciales
// ----------------------------------------------------------------------------

const [loteCoca] = await db
  .insert(s.lote)
  .values({
    loteCantidadInicial: 48,
    loteCantidadActual: 48,
    lotePrecioCosto: 1200,
    esLotePerecible: false,
    esLoteNoPerecible: true,
    productoId: coca.productoId,
    proveedorId: prov.proveedorId,
  })
  .returning();

const [loteLeche] = await db
  .insert(s.lote)
  .values({
    loteCantidadInicial: 60,
    loteCantidadActual: 60,
    lotePrecioCosto: 950,
    esLotePerecible: true,
    esLoteNoPerecible: false,
    productoId: leche.productoId,
    proveedorId: prov.proveedorId,
  })
  .returning();

const [loteHallulla] = await db
  .insert(s.lote)
  .values({
    loteCantidadInicial: 200,
    loteCantidadActual: 200,
    lotePrecioCosto: 150,
    esLotePerecible: true,
    esLoteNoPerecible: false,
    productoId: hallulla.productoId,
  })
  .returning();

// Subtipos ISA para los lotes de categorías perecibles
await db.insert(s.lotePerecible).values([
  {
    loteId: loteLeche.loteId,
    lotePerecibleFechaVencimiento: '2026-08-01',
  },
  {
    loteId: loteHallulla.loteId,
    lotePerecibleFechaVencimiento: '2026-06-05',
  },
]);

// ----------------------------------------------------------------------------
// Tasa legal de ejemplo (AFP)
// ----------------------------------------------------------------------------

await db.insert(s.tasaLegal).values({
  tasaLegalTipo: 'afp',
  tasaLegalValor: 11.45,
  tasaLegalFechaVigenciaDesde: '2026-01-01',
});

// ----------------------------------------------------------------------------
// Cierre de caja inicial (abierto) para que la cajera pueda registrar ventas
// ----------------------------------------------------------------------------

await db.insert(s.cierreCaja).values({
  cierreEstado: 'abierto',
});

console.log('✓ Seed completo:');
console.log('  · 2 trabajadores, 2 usuarios');
console.log('  · 3 categorías, 1 proveedor (con 2 cat.), 3 productos');
console.log('  · 3 historiales de precio, 3 lotes (2 perecibles)');
console.log('  · 1 tasa legal (AFP), 1 cierre de caja abierto');
client.close();
