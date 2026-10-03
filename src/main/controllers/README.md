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
| `personal` | `worker`, `shift`, `attendance`, `absence`, `attendance-monthly-summary`, `user-management` |
| `lector-ean` | `ean-reader` |
| `administración` | `audit` |

Los archivos con sufijo `-service` (`sale-service`, `dashboard-service`,
`cash-closing-service`, `attendance-service`, `audit-service`) contienen lógica
reutilizable que los controladores componen; `-queries` / `-events` separan
lectura de notificaciones. `auth-jwt`, `auth-context` y `auth-fixtures` dan
soporte a autenticación. `base.ts` define el contrato común.

## RF32 CU32 Registro de ausencia

`absence.ts` expone `ausencia:registrar` exclusivamente al Dueño y delega en
`absence-service.ts`. La identidad proviene de los claims verificados; el servicio
revalida sesión, rol efectivo y actividad del responsable dentro de la transacción.
El contrato compartido de `shared/absence.ts` admite trabajador, fecha civil chilena,
tipo justificada/injustificada y observación opcional de hasta 200 caracteres Unicode.

El servicio comprueba trabajador existente/activo y conflictos con cualquier ausencia
previa o asistencia cuya entrada pertenece a la fecha seleccionada en America/Santiago.
No exige turno ni limita retrospectivamente las fechas válidas. Ausencia y auditoría
`registrar_ausencia` se guardan en la misma transacción; un fallo revierte ambas.
CU32 y las entradas de asistencia reutilizan `runSerializedWriteTransaction`, que
repite las lecturas cuando una escritura competidora produce SQLITE_BUSY.

V34 se abre desde Personal o por trabajador activo en V15, con RUT precargado y
modificable. Después de guardar vuelve a Trabajadores con una confirmación temporal.
El esquema y los tipos adicionales almacenables permanecen compatibles.

Pruebas: `tests/shared/absence.test.ts`, `tests/main/controllers/absence.test.ts`
y `tests/main/controllers/absence-service.test.ts`. La verificación visual se ejecuta
con `node tests/renderer/cu32-ui.mts` y deja capturas en `out/cu32-qa`.

## RF33 CU33 Resumen mensual de asistencia

`monthly-attendance.ts` implementa C52 (`ResumenAsistenciaHandler`) mediante
`asistencia:resumen-mensual`, con `{ trabajadorId, mes, anio }`. V36 se abre en
`/app/personal/asistencia/resumen-mensual` desde Personal, Trabajadores o Asistencia.
Ambos canales de CU33 son exclusivos del Dueño y se auditan en el dispatcher;
`trabajador:listar-para-resumen` incluye inactivos y personas sin cuenta de usuario.

`queryMonthlyAttendance` lee un snapshot de trabajador, asistencias y ausencias,
sin modificar sus datos. Devuelve días con registros, totales mensuales y todas las
semanas lunes–domingo recortadas al mes. Fechas y cortes usan America/Santiago.
La duración completa corresponde al día de entrada, incluso si cruza de mes;
se descartan segundos incompletos por jornada. Los helpers de minutos de
`shared/attendance.ts` también se usan al registrar la salida y permiten totales
superiores a 24 horas. El servicio de consulta queda reutilizable para CU52.

Una jornada pendiente cuenta como día trabajado sin aportar horas. Licencia,
vacaciones y permiso suman como justificadas conservando su tipo diario.
Duplicados, coexistencia de asistencia/ausencia y timestamps inválidos o invertidos
devuelven `BUSINESS_RULE` con las fechas afectadas, sin totales parciales. Los meses
vacíos y futuros son consultas exitosas con ceros; se admiten años 1900–9998.
V36 no exporta y descarta respuestas tardías al cambiar filtros o salir de la vista.

Pruebas: `tests/shared/monthly-attendance.test.ts`,
`tests/main/controllers/monthly-attendance.test.ts` y
`tests/main/controllers/monthly-attendance-service.test.ts`.
La verificación visual se ejecuta con `node tests/renderer/cu33-ui.mts` y guarda
capturas en `out/cu33-qa`.

## RF52 CU52 Reporte de asistencia del personal

`attendance-report.ts` implementa C59 (`ReporteAsistenciaHandler`) en
`reporte:asistencia`, con `{ mes, anio, rol? }`. V43 se abre desde Reportes en
`/app/reportes/asistencia-personal`, exclusivamente para el Dueño. La consulta
devuelve `{ periodo, rol, filas }` y se audita incluso cuando no hay filas.

`attendance-report-service.ts` reúne trabajadores, asistencias y ausencias en tres
consultas dentro del mismo snapshot. Comparte la consolidación de CU33 mediante
`monthly-attendance-calculation.ts`: fechas de entrada chilenas, minutos completos
por jornada y rechazo de registros inconsistentes. El nombre es el actual del
trabajador. El rol mostrado y filtrado es el de la UsuarioVersion vigente al cierre
del período; si no hay una versión anterior al cierre se usa la más antigua y, sin
versiones, el rol actual de Usuario. Las personas sin cuenta muestran «Sin usuario»
solo con Todos.

Sin actividad en el período filtrado, la tabla queda vacía. Con actividad se incluyen
los activos y los inactivos que tengan asistencia o ausencia. Los días pendientes
cuentan como trabajados sin sumar minutos. El promedio divide las horas por los días
trabajados y trunca la fracción de minuto; sin días trabajados devuelve `null` (`N/A`).

C61 exporta con `{ tipo: "asistencia-personal", periodo: { mes, anio }, rol? }`,
recalculando en Main con los mismos filtros. PDF horizontal y XLSX incluyen el
encabezado institucional y usan `AsistenciaPersonal_YYYY-MM_DD-MM-AAAA.ext`.
La exportación vacía se rechaza y solo se auditan las exportaciones guardadas.

Pruebas: `tests/shared/attendance-report.test.ts` y las tres pruebas
`tests/main/controllers/attendance-report*.test.ts`. La verificación de la
aplicación se ejecuta con `node tests/renderer/cu52-ui.mts` y deja capturas en
`out/cu52-qa`. Simula el transporte IPC; los cálculos se prueban sobre SQLite real,
el PDF mediante su HTML y contrato de impresión, y el XLSX se genera y vuelve a abrir.

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
