# `src/` — Código fuente

Código de la aplicación de escritorio **Sistema de Gestión Huáscar** (Electron +
React + TypeScript). El código se organiza por **capa** siguiendo el modelo de
procesos de Electron y un patrón MVC sobre IPC.

## Estructura

| Carpeta | Proceso | Responsabilidad |
|---------|---------|-----------------|
| [`main/`](./main) | Main (Node) | Arranque de la app, ventana, dispatcher IPC y **controladores** (lógica de negocio). |
| [`preload/`](./preload) | Preload | Puente seguro `contextBridge` entre renderer y main. Adjunta el JWT de sesión a cada `invoke`. |
| [`renderer/`](./renderer/src) | Renderer (Chromium) | UI React: vistas, componentes y enrutado. |
| [`db/`](./db) | Main | Cliente libSQL/Drizzle, esquema, inicialización en runtime, triggers y seed. |
| `shared/` | Ambos | Tipos y lógica pura compartida (navegación, contratos de controllers, validaciones, EAN-13, etc.). |

## Flujo de una petición

```
renderer (vista React)
  └─ window.api.invoke(canal, payload)        ← preload adjunta __authToken
       └─ ipcMain.handle (main/controllers/index.ts)
            ├─ auth-guard: verifica JWT y rol del canal
            └─ controller.handle(payload, ctx) → ControllerResponse
                 └─ db (Drizzle) → SQLite/libSQL
```

Todos los controladores devuelven el contrato discriminado
`ControllerResponse<T>` (`{ ok: true, data } | { ok: false, error }`) definido en
[`shared/controllers.ts`](./shared/controllers.ts).

## Convenciones

- **Sin pruebas dentro de `src/`.** Los tests viven en
  [`tests/`](../tests), espejando esta estructura (`tests/main/controllers/…`,
  `tests/shared/…`, `tests/renderer/src/…`). Config en `vitest.config.ts`.
- `shared/` no importa de `main/` ni de `renderer/` (sólo lógica pura).
- El renderer **nunca** accede a la BD directamente: todo pasa por IPC.

## Comandos útiles

```bash
npm run dev         # levanta la app en desarrollo
npm run typecheck   # tsc --noEmit
npm test            # corre la suite (Vitest) desde tests/
```
