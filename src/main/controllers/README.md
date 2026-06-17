# `src/main/controllers/` — Controladores (lógica de negocio)

Cada controlador implementa uno o más **casos de uso** y se expone a la UI a
través de un canal IPC. Es la capa "Controlador" del MVC: recibe un payload,
aplica reglas de negocio sobre el modelo (Drizzle/SQLite) y devuelve un
`ControllerResponse<T>`.

## Contrato

Un controlador es un `RegisteredController` (ver [`base.ts`](./base.ts)):

```ts
type RegisteredController<TPayload, TData> = {
  metadata: ControllerMetadata;                       // id, name, module, channels
  handle: (payload, context) => Promise<ControllerResponse<TData>>;
};
```

- `metadata.channels` declara los canales IPC que atiende.
- `handle` recibe `context.claims` (claims verificados del JWT) en canales
  autenticados.
- La respuesta es siempre el contrato discriminado de
  [`shared/controllers.ts`](../../shared/controllers.ts):
  `{ ok: true, data } | { ok: false, error: { code, message, … } }`.

## Registro y dispatch

[`index.ts`](./index.ts) mantiene el arreglo `registeredControllers` y los conecta
a `ipcMain.handle`. En cada invocación el dispatcher:

1. Resuelve el controlador por canal (`findControllerByChannel`).
2. Verifica identidad/rol vía [`auth-guard.ts`](./auth-guard.ts) (`guardChannel`).
3. Inyecta la identidad de confianza y delega en `controller.handle`.
4. Actualiza la actividad de sesión salvo en `NON_ACTIVITY_CHANNELS`.

## Mapa de controladores

Agrupados por módulo (`ControllerModule`):

| Módulo | Controladores |
|--------|---------------|
| `auth` | `auth-login`, `password`, `access-control`, `session` |
| `dashboard` | `dashboard`, `stock-alert`, `expiration-alert`, `daily-sales-total` |
| `inventario` | `product-create`, `product-edit`, `product-status`, `product-query`, `product-delete`, `lot`, `waste`, `stock-discount` |
| `ventas` | `sale`, `sales-history` |
| `caja` | `cash-closing`, `cash-check` |
| `personal` | `worker`, `shift`, `attendance`, `user-management` |
| `lector-ean` | `ean-reader` |
| `administración` | `audit` |

Los archivos con sufijo `-service` (`sale-service`, `dashboard-service`,
`cash-closing-service`, `attendance-service`, `audit-service`) contienen lógica
reutilizable que los controladores componen; `-queries` / `-events` separan
lectura de notificaciones. `auth-jwt`, `auth-context` y `auth-fixtures` dan
soporte a autenticación. `base.ts` define el contrato común.

## Pruebas

Tests unitarios en
[`tests/main/controllers/`](../../../tests/main/controllers). No agregar
`*.test.ts` dentro de `src/`.
