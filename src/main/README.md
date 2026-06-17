# `src/main/` — Proceso principal (Electron)

Proceso **main** de Electron: corre en Node, es dueño del ciclo de vida de la
app, de la ventana y del acceso a la base de datos. Es la frontera de confianza:
toda la lógica de negocio y la verificación de identidad ocurren aquí, nunca en
el renderer.

## Contenido

| Archivo / carpeta | Responsabilidad |
|-------------------|-----------------|
| [`index.ts`](./index.ts) | Punto de entrada. Crea el `BrowserWindow`, inicializa la BD (migraciones + triggers idempotentes) **antes** de abrir la ventana y registra los controladores IPC. |
| [`controllers/`](./controllers) | Controladores: una unidad de lógica por caso de uso, registrada en un canal IPC. Ver su propio README. |
| `assets.d.ts` | Declaraciones de tipos para assets importados. |

## Arranque (`index.ts`)

1. `app.whenReady()` → `initializeDatabase(db, client, …)` aplica esquema y
   triggers. En la app empaquetada esto reemplaza a los scripts de dev
   `db:migrate` / `db:triggers`.
2. Se crea el `BrowserWindow` con `contextIsolation: true`, `nodeIntegration:
   false` y el `preload` compilado (`../preload/index.mjs`).
3. `registerControllers(ipcMain)` conecta cada canal a su handler.
4. En dev con `HUASCAR_DEBUG_LOGIN=1` se registra además el login de depuración.

## Seguridad

- El renderer no tiene acceso a Node ni a la BD; sólo al API expuesto por el
  preload.
- El dispatcher IPC verifica el JWT de sesión y el rol requerido por canal
  (`controllers/auth-guard.ts`) y sobrescribe la identidad de confianza en el
  payload, de modo que el renderer no pueda falsificar el `usuarioId`.

## Pruebas

Los tests del proceso principal están en
[`tests/main/`](../../tests/main) (controllers y `db-init`). No agregar `*.test.ts`
dentro de `src/`.
