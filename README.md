# Sistema de Gestión — Minimarket y Panadería Huáscar

Sistema de escritorio offline-first para gestión de inventario, ventas y trabajadores del Minimarket y Panadería Huáscar, Rengo, Chile.

## Stack

| Capa | Tecnología |
|------|-----------|
| UI | Electron 35 + React 19 + TypeScript |
| Backend local | Express 5 (IPC) |
| Base de datos | SQLite vía `@libsql/client` |
| ORM | Drizzle ORM 0.45 |
| Runtime scripts | `tsx` |

## Requisitos

- Node.js 20+
- npm 10+

## Instalación

```bash
npm install
```

## Base de datos

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

Crear un archivo `.env` en la raíz (ver `.env.example` cuando esté disponible):

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
    schema.ts          # 22 tablas (fuente de verdad)
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

- Claves primarias: `INTEGER AUTOINCREMENT` en general; `ULID` en tablas de alta concurrencia (`venta`, `detalle_venta`, `audit_log`, `movimiento_inventario`)
- Dinero (CLP): `INTEGER`
- Fechas: `TEXT` ISO-8601
- `PRAGMA foreign_keys = ON` se activa en cada conexión

## Licencia

Uso académico — Ingeniería de Software, Universidad, 2026.
