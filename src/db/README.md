# `src/db/` — Capa de datos (Modelo)

Todo lo relativo a la base de datos: definición del esquema, conexión,
inicialización en runtime, triggers de integridad y datos semilla. Es la capa
"Modelo". Usa **libSQL/Turso** (compatible SQLite 3.x) con **Drizzle ORM**.

> Las **consultas** no viven acá: se hacen con el query builder de Drizzle dentro
> de los controladores (`src/main/controllers/`), siempre sobre el `db` que
> exporta [`client.ts`](./client.ts). El renderer nunca toca la BD.

## Contenido

| Archivo / carpeta | Responsabilidad |
|-------------------|-----------------|
| [`schema.ts`](./schema.ts) | **Fuente de verdad del esquema.** ~33 tablas `sqliteTable` (trabajador, usuario, producto, venta, lote, sesión, logs, …) en 3FN estricto. De aquí drizzle-kit genera el DDL. |
| [`client.ts`](./client.ts) | **Conexión única.** Crea el cliente libSQL e instancia Drizzle `db`. Activa `PRAGMA foreign_keys = ON` y `journal_mode = WAL`. Exporta `db`, `client`, `schema` y el tipo `DB`. |
| [`init.ts`](./init.ts) | **Inicialización en runtime.** `initializeDatabase()` aplica, idempotente y en orden: (1) migraciones de esquema, (2) triggers. `resolveDatabaseInitPaths()` resuelve rutas para dev y para la app empaquetada. |
| `triggers.sql` | Triggers de integridad con `CREATE TRIGGER IF NOT EXISTS`. Drizzle no expresa triggers en TS, por eso van en SQL aparte. |
| [`seed.ts`](./seed.ts) | Datos semilla (`npm run db:seed`). |
| `scripts/apply-triggers.ts` | Script de desarrollo para aplicar `triggers.sql` (`npm run db:triggers`). |

## ¿Y `drizzle/migrations/` (en la raíz del repo)?

El DDL de las migraciones **no** vive en `src/db/`, sino en `drizzle/migrations/`
en la raíz. Es intencional: es **salida generada** por `drizzle-kit`, no código a
mano. Lo dicta `drizzle.config.ts` → `out: './drizzle/migrations'` (el default de
la herramienta). Separar fuente (`src/db/`) de artefacto generado (`drizzle/`) es
la convención de Drizzle.

```
schema.ts ──(drizzle-kit generate)──► drizzle/migrations/*.sql
                                              │
                                  init.ts (migrate) ─► BD
```

La carpeta `drizzle/` se referencia en 4 puntos cableados:
`drizzle.config.ts` (`out`), `src/db/init.ts` (rutas dev y empaquetado),
`package.json` (`build.extraResources` la copia al `.exe`) y
`src/main/controllers/auth-fixtures.ts` (los tests aplican migraciones desde ahí).

## Flujo de inicialización

```
src/main/index.ts  (app.whenReady, ANTES de abrir ventana)
  └─ initializeDatabase(db, client, resolveDatabaseInitPaths({ isPackaged, resourcesPath }))
       ├─ migrate(db, { migrationsFolder })   ← drizzle/migrations/*.sql
       └─ applyTriggers(client, triggersPath) ← src/db/triggers.sql
```

- **Dev / tests:** rutas relativas a `process.cwd()` (`drizzle/migrations`,
  `src/db/triggers.sql`).
- **Empaquetado:** `drizzle/` y `triggers.sql` se copian a
  `process.resourcesPath` vía `extraResources`. Esto reemplaza a los scripts de
  dev `db:migrate` / `db:triggers`, que usan `tsx` y no existen en la app
  empaquetada (issue #30).

Ambos pasos son idempotentes: `migrate` registra lo aplicado en
`__drizzle_migrations`; los triggers usan `IF NOT EXISTS`.

## Cómo se consulta la BD

No hay SQL crudo disperso. Las consultas usan el **query builder de Drizzle**
(`db.select / insert / update / delete / transaction`) y viven en los
controladores (`src/main/controllers/*.ts`). La lógica reutilizable se extrae a
archivos `-service` / `-queries` (`sale-service.ts`, `dashboard-queries.ts`,
`audit-service.ts`).

```ts
import { db, schema } from '../../db/client';

const productos = await db.select().from(schema.producto);
await db.transaction(async (tx) => { /* … */ });
```

`client.execute` (SQL crudo) se usa solo para los PRAGMAs de conexión
(`client.ts`), los triggers vía `executeMultiple` (`init.ts`) y el setup de tests
(`auth-fixtures.ts`).

## Comandos

```bash
npm run db:generate   # genera migración tras cambiar schema.ts
npm run db:migrate    # aplica migraciones (dev)
npm run db:triggers   # aplica triggers.sql (dev)
npm run db:push       # push directo del schema (sin migración)
npm run db:studio     # explorador Drizzle Studio
npm run db:seed       # datos semilla
```

## Convenciones del esquema (3FN)

- `snake_case` con prefijo de entidad en columnas (`producto_nombre`, no `nombre`).
- PK `INTEGER` autoincremental para maestros; `VARCHAR(36)` UUID v4 para eventos;
  PK derivada de RUT para `usuario`.
- Dinero (CLP): `INTEGER` (pesos sin decimales). Tasas (%): `REAL`.
  Fechas/timestamps: `TEXT` ISO-8601.
- FKs activas solo con `PRAGMA foreign_keys = ON` en cada conexión (lo hace
  `client.ts`); sin eso los `REFERENCES` son decorativos.

## Pruebas

Tests de inicialización en
[`tests/main/db-init.test.ts`](../../tests/main/db-init.test.ts). No agregar
`*.test.ts` dentro de `src/`.
