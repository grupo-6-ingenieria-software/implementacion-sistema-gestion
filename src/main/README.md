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
| [`updater.ts`](./updater.ts) | Auto-actualización con `electron-updater` desde GitHub Releases (sólo Windows instalado). |
| `assets.d.ts` | Declaraciones de tipos para assets importados. |

## Arranque (`index.ts`)

1. `app.whenReady()` → `initializeDatabase(db, client, …)` aplica esquema y
   triggers. En la app empaquetada esto reemplaza a los scripts de dev
   `db:migrate` / `db:triggers`.
2. Se crea el `BrowserWindow` con `contextIsolation: true`, `nodeIntegration:
   false` y el `preload` compilado (`../preload/index.mjs`).
3. `registerControllers(ipcMain)` conecta cada canal a su handler.
4. En dev con `HUASCAR_DEBUG_LOGIN=1` se registra además el login de depuración.
5. `startAutoUpdater()` busca una versión nueva (ver abajo).

## Actualizaciones automáticas (`updater.ts`)

- Sólo corre en la build empaquetada de Windows (`win.target: "nsis"`). En dev
  y en el `.dmg` de macOS (sin firma, sólo para pruebas) no hace nada.
- Lee `build.publish` de `package.json` (GitHub Releases del repo). El CI sube
  en cada release el `Setup.exe`, su `.blockmap` y `latest.yml`, que es lo que
  consulta el updater.
- Busca al arrancar y cada 6 horas; descarga en segundo plano. Al terminar
  ofrece «Reiniciar ahora» o «Más tarde»; si se posterga, se instala al cerrar
  la app.
- La instalación NSIS es por usuario (`perMachine: false`), así que no pide
  permisos de administrador al actualizar.
- La primera vez hay que instalar el `Setup.exe` a mano (el `.exe` portable
  anterior no se puede actualizar solo).

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
