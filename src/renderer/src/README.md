# `src/renderer/src/` — Interfaz (React)

Proceso **renderer** de Electron: la UI en React + TypeScript (Vite + Tailwind).
Es la capa "Vista". No tiene acceso a Node ni a la base de datos; se comunica con
el proceso principal sólo a través del API expuesto por el preload
(`window.api.invoke`).

## Contenido

| Archivo / carpeta | Responsabilidad |
|-------------------|-----------------|
| [`App.tsx`](./App.tsx) | Componente raíz: enrutado interno, estado de sesión, menú según rol y montaje de las vistas. |
| [`main.tsx`](./main.tsx) | Bootstrap de React (monta `<App/>` en el DOM). |
| [`views/`](./views) | Una vista por pantalla/caso de uso (login, dashboard, inventario, ventas, caja, personal, etc.). |
| `components/` | Componentes reutilizables (p. ej. `CampoEAN13Input`, `ResumenVentasDashboard`, `SeccionesPagoVenta`). |
| `styles.css` | Estilos globales / capa Tailwind. |
| `vite-env.d.ts` | Tipos de entorno de Vite. |

## Enrutado y sesión

`App.tsx` no usa router externo: deriva el árbol de navegación, los permisos por
rol y la ruta inicial desde [`shared/navigation.ts`](../../shared/navigation.ts)
(`navigationTree`, `evaluateRouteAccess`, `getVisibleMenu`, …). El estado de
sesión (`SessionState`) controla el acceso a rutas públicas vs. autenticadas y el
cambio obligatorio de contraseña temporal.

## Comunicación con el backend

```ts
const res = await window.api.invoke<MiData>('canal:accion', payload);
if (res.ok) { /* res.data */ } else { /* res.error.code / message */ }
```

- El preload adjunta el JWT (`__authToken`) automáticamente; la vista no maneja
  el token directamente (se guarda con `window.api.setSessionToken`).
- Eventos push del main: `onDashboardUpdated`, `onSessionExpired`.
- Las validaciones y formatos (RUT, EAN-13, complejidad de contraseña) se
  importan de `shared/` para mantener una sola fuente de verdad con el backend.

## Pruebas

Tests de la UI (lógica pura de vistas/`App`) en
[`tests/renderer/src/`](../../../tests/renderer/src). No agregar `*.test.ts`
dentro de `src/`.
