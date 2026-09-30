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
a `ipcMain.handle`. El componente representado como
`C_DispatcherControlAcceso` en los diagramas corresponde a
`dispatchControllerWithAccessControl` en ese archivo, junto con la validación de
`auth-guard.ts`. En cada invocación:

1. Resuelve el controlador por canal (`findControllerByChannel`).
2. Verifica el JWT vía [`auth-guard.ts`](./auth-guard.ts) (`authenticateChannel`),
   confirma la sesión persistida y después el rol efectivo (`authorizeRequest`).
3. Inyecta la identidad de confianza y delega en `controller.handle`.
4. Actualiza la actividad de sesión salvo en `NON_ACTIVITY_CHANNELS`.

Los nombres de los handlers de negocio en los diagramas usan el prefijo `C_`
seguido por `metadata.name` de `src/shared/controllers.ts` (por ejemplo,
`C_RegistrarProductoHandler`). El controlador de validación de acceso se llama
`ControlAcceso`, representado como `C_ControlAcceso`.

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

## RF58 CU58 Log de auditoría

El Dueño consulta los últimos doce meses mediante `auditoria:consultar`, con
filtros de usuario, acción y fechas chilenas, y paginación descendente. La ventana
se aplica también al conteo y a las opciones de filtros. Los registros se eliminan
al cumplir doce meses mediante `audit-retention-service.ts`: la limpieza corre al
iniciar la aplicación y cada 24 horas mientras permanece abierta, con reintento
en el siguiente ciclo ante un fallo. `UsuarioVersion` conserva el nombre y rol
del responsable al momento del evento.

Login, altas, ediciones y anulaciones se auditan desde sus servicios existentes.
`audit-dispatch.ts` agrega las consultas de negocio exitosas y las exportaciones
PDF/XLSX guardadas, usando la identidad verificada por C03/C05. Una cancelación o
un error no genera una exportación exitosa. Los nuevos canales de lectura deben
incorporarse a `AUDITED_QUERY_CHANNELS` si no registran su propia auditoría.

El Trabajador no puede consultar el log (CU58-E1): la ruta se marca
`authorizedByMain`, de modo que V_LogAuditoriaView invoca `auditoria:consultar`
y Main decide. `authorizeRequest` verifica el JWT (`authenticateChannel`),
confirma la sesión y recién entonces rechaza el rol, registrando un único
intento; la vista muestra el aviso y vuelve al dashboard. Las demás
denegaciones de navegación local invocan `access:validate` para dejar evidencia. Los triggers impiden modificar o
reemplazar registros, eliminar registros vigentes y alterar una identidad
histórica utilizada; cerrar la vigencia de una versión y crear otra sigue
permitido.
La eliminación por retención es la excepción al bloqueo de DELETE permitida por
RF58 y RNF09 del Documento 0; no existe un canal IPC de eliminación y no se borran
usuarios ni versiones.

Pruebas CP62: `tests/main/controllers/rf58-audit.integration.test.ts`,
`tests/main/controllers/audit-dispatch.test.ts` y `tests/shared/audit.test.ts`.
La limpieza, sus límites y la actualización de triggers se verifican en
`tests/main/controllers/audit-retention.integration.test.ts`; el ciclo automático
se verifica en `tests/main/controllers/audit-retention-service.test.ts`.
La interfaz se comprueba con `node tests/renderer/rf58-ui.mjs` y
`node --import tsx tests/renderer/rf58-e1-ui.mjs`; requiere Chromium de
Playwright (`npx playwright install chromium`).

## Pruebas

Tests unitarios en
[`tests/main/controllers/`](../../../tests/main/controllers). No agregar
`*.test.ts` dentro de `src/`.
