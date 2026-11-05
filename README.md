# Sistema de Gestión — Minimarket y Panadería Huáscar

![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-20+-5FA04E?style=flat-square&logo=node.js&logoColor=white)
![Drizzle ORM](https://img.shields.io/badge/Drizzle_ORM-0.45-C5F74F?style=flat-square&logo=drizzle&logoColor=black)
![SQLite](https://img.shields.io/badge/SQLite-libSQL-003B57?style=flat-square&logo=sqlite&logoColor=white)
![Electron](https://img.shields.io/badge/Electron-35-47848F?style=flat-square&logo=electron&logoColor=white)
![License](https://img.shields.io/badge/licencia-académica-orange?style=flat-square)

> Sistema de escritorio offline-first para gestión de inventario, ventas y trabajadores del Minimarket y Panadería Huáscar, Rengo, Chile.

---

## Stack

| Capa | Tecnología |
|------|-----------|
| Vista & Controlador| Electron 35 + React 19 + TypeScript |
| Modelo | SQLite vía `@libsql/client` + Drizzle ORM 0.45 |
| Runtime scripts | `tsx` |

## Requisitos

- Node.js 20+
- npm 10+

## Instalación

```bash
npm install
```

## Base de datos

### Demostración RF18 y RF36

Ejecutar `npm run demo`. Funciona sin internet con las dependencias instaladas.
Iniciar sesión con **12345678-9 / Huascar2026** (María Huáscar, Dueño).
Cada ejecución crea una SQLite independiente en `out/demo-*/huscar.db`, con un
pedido pendiente de dos productos, ambos con stock 0. Conserva las bases anteriores.

| Producto | EAN-13 | Pedido | Costo unitario | Precio de venta |
|---|---|---:|---:|---:|
| Arroz grano largo 1 kg | 7802920000015 | 10 | $900 | $1.500 |
| Galletas de vainilla 150 g | 7802920000022 | 5 | $600 | $1.000 |

1. Proveedores → Recepciones e historial de pedidos: abrir el pedido de
   Distribuidora Los Robles SpA, ingresar cantidades 10 y 5, costos 900 y 600, y confirmar.
2. Ventas → Registrar venta: ingresar ambos EAN-13 y esperar su incorporación
   automática; cambiar la cantidad de Arroz grano largo 1 kg a 2 y pulsar Tab.
   Mantener Galletas de vainilla 150 g en 1. Efectivo: monto recibido 5000 y confirmar.
   Total 4000, vuelto 1000 y stocks finales 8 y 4.

La terminal muestra logs `[RF18]` y `[RF36]` de consultas, validación y
operaciones confirmadas, con nombre, EAN-13 y stock antes/después del movimiento.
Agrupan las escrituras de cada transacción en etapas
de negocio; no representan una traza SQL ni cambian el orden interno de las
operaciones. Los logs se habilitan solo con `npm run demo`. Ctrl+C detiene la app.

Para consultar la misma base que usa la aplicación, abre otra terminal y ejecuta
`npm run demo:db`. Cada reinicio cambia la base; sal con `.quit` y vuelve a abrirla
con ese comando después de reiniciar la demo. Dentro de SQLite, consulta el stock:

```sql
SELECT p.producto_nombre AS producto, p.producto_ean_13 AS ean13, COALESCE(SUM(l.lote_cantidad_actual), 0) AS stock FROM producto p LEFT JOIN lote l ON l.producto_id = p.producto_id GROUP BY p.producto_id ORDER BY p.producto_id;
```

```bash
# Generar migración (tras cambios en schema)
npm run db:generate

# Aplicar migraciones
npm run db:migrate

# Aplicar triggers SQL
npm run db:triggers

# Seed de desarrollo
npm run db:seed

# Drizzle Studio (explorador visual)
npm run db:studio
```

La base de datos local se crea en `local.db` (excluido de git).

## Variables de entorno

Crear un archivo `.env` en la raíz:

```env
# Desarrollo local — SQLite embebido
DATABASE_URL=file:./local.db

# Solo necesario para Turso en producción
# DATABASE_AUTH_TOKEN=
```

## Estructura

```
src/
  db/
    schema.ts          # 34 tablas (fuente de verdad, 3FN)
    client.ts          # Conexión libSQL + Drizzle
    triggers.sql       # 15 triggers de integridad
    seed.ts            # Datos de prueba locales
    scripts/
      apply-triggers.ts
drizzle/
  migrations/          # Migraciones generadas por drizzle-kit
drizzle.config.ts
```

## Convenciones

- Claves primarias: `INTEGER AUTOINCREMENT` en maestros (`categoria`, `producto`, `proveedor`, `trabajador`, `tasa_legal`); `UUID v4` (`VARCHAR(36)`, generado en cliente con `node:crypto.randomUUID`) en tablas de eventos (`venta`, `detalle_venta`, `lote`, `merma`, `log_auditoria`, etc.); `usuario` usa PK derivada del RUT
- Especializaciones ISA (`lote`, `contrasena`, `venta`): patrón híbrido con flags `ES_*` en el supertipo (`CHECK` exactamente uno = 1) + subtabla 1:1 (`lote_perecible`, `contrasena_temporal`, `venta_efectivo`)
- Dinero (CLP): `INTEGER` (pesos sin decimales); tasas legales (%): `REAL`
- Fechas y timestamps: `TEXT` ISO-8601
- Integridad: 15 triggers en `triggers.sql` (turnos no superpuestos, sobreventa, logs inmutables, coherencia ISA, etc.)
- `PRAGMA foreign_keys = ON` se activa en cada conexión (libSQL arranca con FK OFF)

---

<p align="center">
  Hecho con sangre, sudor y lágrimas 🫩 · Ingeniería de Software 2026
</p>
