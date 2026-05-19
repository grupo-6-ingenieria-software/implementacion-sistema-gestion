/**
 * Seed mínimo para desarrollo local.
 * Ejecutar: npm run db:seed
 */

import 'dotenv/config';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { ulid } from 'ulid';
import * as s from './schema.js';

const client = createClient({
  url: process.env.DATABASE_URL ?? 'file:./local.db',
});
await client.execute('PRAGMA foreign_keys = ON');
const db = drizzle(client, { schema: s });

// Trabajadores
const [dueno] = await db
  .insert(s.trabajador)
  .values({
    rut: '12345678-9',
    nombres: 'María',
    apellidos: 'Huáscar',
    cargo: 'dueño',
    fechaIngreso: '2024-01-01',
  })
  .returning();

const [cajera] = await db
  .insert(s.trabajador)
  .values({
    rut: '23456789-0',
    nombres: 'Camila',
    apellidos: 'Rojas',
    cargo: 'cajero',
    fechaIngreso: '2025-06-15',
  })
  .returning();

// Usuarios
const [usrDueno] = await db
  .insert(s.usuario)
  .values({
    trabajadorId: dueno.trabajadorId,
    username: 'maria',
    passwordHash: '$2a$12$placeholder',
    rol: 'dueño',
  })
  .returning();

const [usrCajera] = await db
  .insert(s.usuario)
  .values({
    trabajadorId: cajera.trabajadorId,
    username: 'camila',
    passwordHash: '$2a$12$placeholder',
    rol: 'cajero',
  })
  .returning();

// Catálogo
const [catBebidas] = await db
  .insert(s.categoria)
  .values({ nombre: 'Bebidas', requiereVencimiento: 0 })
  .returning();

const [catLacteos] = await db
  .insert(s.categoria)
  .values({ nombre: 'Lácteos', requiereVencimiento: 1 })
  .returning();

const [catPan] = await db
  .insert(s.categoria)
  .values({ nombre: 'Panadería', requiereVencimiento: 1 })
  .returning();

// Proveedor
const [prov] = await db
  .insert(s.proveedor)
  .values({
    rut: '76543210-K',
    razonSocial: 'Distribuidora Central S.A.',
    contacto: 'Juan Pérez',
    telefono: '+56912345678',
    email: 'ventas@distribuidora.cl',
  })
  .returning();

await db.insert(s.proveedorCategoria).values([
  { proveedorId: prov.proveedorId, categoriaId: catBebidas.categoriaId },
  { proveedorId: prov.proveedorId, categoriaId: catLacteos.categoriaId },
]);

// Productos
const [coca] = await db
  .insert(s.producto)
  .values({
    categoriaId: catBebidas.categoriaId,
    ean13: '7802920000017',
    nombre: 'Coca-Cola 1.5L',
    unidadMedida: 'unidad',
    precioCosto: 1200,
    precioVenta: 1800,
    stockMinimo: 20,
  })
  .returning();

const [leche] = await db
  .insert(s.producto)
  .values({
    categoriaId: catLacteos.categoriaId,
    ean13: '7802345600012',
    nombre: 'Leche Soprole 1L',
    unidadMedida: 'litro',
    precioCosto: 950,
    precioVenta: 1390,
    stockMinimo: 30,
  })
  .returning();

const [hallulla] = await db
  .insert(s.producto)
  .values({
    categoriaId: catPan.categoriaId,
    ean13: '7800000000123',
    nombre: 'Hallulla',
    unidadMedida: 'kg',
    precioCosto: 1500,
    precioVenta: 2500,
    stockMinimo: 5,
  })
  .returning();

// Lotes
await db.insert(s.lote).values([
  { productoId: coca.productoId, cantidadActual: 48, precioUnitario: 1200 },
  {
    productoId: leche.productoId,
    cantidadActual: 60,
    precioUnitario: 950,
    fechaVencimiento: '2026-08-01',
  },
  {
    productoId: hallulla.productoId,
    cantidadActual: 12.5,
    precioUnitario: 1500,
    fechaVencimiento: '2026-05-20',
  },
]);

// Config sistema
await db.insert(s.configSistema).values([
  { clave: 'dias_alerta_vencimiento',        valor: '7' },
  { clave: 'minutos_inactividad_sesion',     valor: '30' },
  { clave: 'horas_validez_password_temporal', valor: '24' },
  { clave: 'max_intentos_login',             valor: '5' },
  { clave: 'minutos_bloqueo_cuenta',         valor: '15' },
]);

// Audit log
await db.insert(s.auditLog).values({
  auditLogId: ulid(),
  usuarioId: usrDueno.usuarioId,
  username: 'maria',
  rol: 'dueño',
  accion: 'login',
  modulo: 'auth',
  descripcion: 'Inicio de sesión exitoso',
});

console.log('✓ Seed completo: 2 trabajadores, 2 usuarios, 3 categorías, 1 proveedor, 3 productos, 3 lotes, 5 configs, 1 audit.');
client.close();
