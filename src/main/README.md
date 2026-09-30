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
5. `startAutoUpdater()` comprueba si el formato admite autoactualización (ver abajo).

## Actualizaciones automáticas (`updater.ts`)

- El CI publica el mismo formato que las releases hasta v0.3.0: un `.exe`
  portable para Windows y un `.dmg` para macOS. Para actualizar, descargar
  la nueva versión desde GitHub Releases y reemplazar la anterior manualmente.
- En Windows portable, electron-builder define `PORTABLE_EXECUTABLE_DIR`;
  el updater lo detecta y no busca, descarga ni instala actualizaciones.
  En dev y en macOS tampoco se activa.
- El código de autoactualización queda disponible para builds instaladas de
  Windows (NSIS), que requieren `Setup.exe`, `.blockmap` y `latest.yml`.
  El CI ya no publica esos archivos de Windows.
- En esas builds instaladas, busca al arrancar y cada 6 horas; descarga en segundo plano. Al terminar
  ofrece «Reiniciar ahora» o «Más tarde»; si se posterga, se instala al cerrar
  la app.

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
