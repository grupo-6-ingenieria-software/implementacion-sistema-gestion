# Plan de implementación P4 · CU22, CU23, CU24 y CU57

Bloque P4 "Trabajadores y seguridad" del Informe de Planificación del Incremento 2.
Versión final tras las decisiones del 11 de septiembre de 2026.

**Regla rectora.** La implementación sigue al pie de la letra el diagrama de secuencia UML
de cada escenario. Los diagramas canónicos son los de la carpeta de Drive
*Diagramas de secuencia* (zip del 11 de septiembre, 23:59 UTC): CU22 (3 escenarios),
CU23 (3), CU24 (2) y CU57 (2). Reemplazan a los dos locales de CU57 del 3 de septiembre.
Cualquier desviación nueva que aparezca durante la implementación se consulta antes de
codificar ese mensaje (decisión D12).

## 1. Decisiones cerradas

| # | Tema | Decisión |
|---|------|----------|
| D1 | Rol efectivo en `SesionUsuario` (CU57 msgs 9-10) | Literal. Columna `sesion_rol_efectivo` en `sesion_usuario`, escrita en el login y leída por el validador de sesión. Migración a cargo de P6. |
| D2 | Chequeo de permiso (CU57 msgs 15-23) | El controlador de dominio decide con el rol de sesión (literal). El guard conserva su chequeo por canal como defensa extra no dibujada. |
| D3 | Auditoría de acceso concedido (CU57 msgs 25-34) | Por apertura de módulo: `access:validate` audita el concedido en Main. El renderer deja de invocar `auditoria:registrar` para accesos. |
| D4 | Consulta CU24 (msgs 15-26) | Literal. Dos consultas: `trabajador` filtrada en SQL por búsqueda y estado, luego `usuario` para rol y filtro de rol. |
| D5 | V16 formulario de edición (CU22 msgs 30-33) | `WorkerFormView` en modo edición, montado como modal desde el listado. Sin ruta nueva. |
| D6 | `usuario_version` (CU22 msgs 59-70) | Literal. `usuario` y `usuario_version` se tocan solo si cambió el rol. |
| D7 | "Trabajador no encontrado" (CU22 E1, CU23 E1) | La vista muestra el mensaje cuando la búsqueda por RUT exacto devuelve lista vacía. El canal `trabajador:listar` no cambia. |
| D8 | V29 gestión de estado (CU23 msgs 22-25) | Componente modal propio `WorkerStatusView.tsx`, abierto desde el listado. Sin ruta nueva. |
| D9 | Motivo de cierre al revocar (CU23 msgs 50-55) | `sistema`, sin migración. |
| D10 | Evento de revocación (CU23 msgs 72-73) | Evento nuevo `session:invalidada`, difundido a todas las ventanas con payload `{ usuarioId }`. Cada renderer actúa solo si coincide con su usuario. |
| D11 | Violaciones de `rules.md` en los diagramas | Implementar tal cual. Reportar al equipo las transacciones dibujadas y el actor ausente en CU22 y CU23, sin bloquear. |
| D12 | Desviaciones nuevas | Pausar y consultar antes de codificar ese mensaje. |
| D13 | Entregas | PR 1 guard y sesión · PR 2 CU24 + CU22 · PR 3 CU23 · PR 4 trazabilidad. |

## 2. Propiedad de archivos

Archivos que P4 edita directamente:

- `src/main/controllers/worker.ts`, `auth-guard.ts`, `auth-context.ts`, `session.ts`,
  `access-control.ts`, `auth-login.ts`, `auth-jwt.ts`, `audit.ts`, `audit-service.ts`
- `src/shared/auth.ts`, `src/shared/users.ts`
- `src/renderer/src/views/WorkerListView.tsx`, `WorkerFormView.tsx`, `WorkerStatusView.tsx` (nuevo)
- `src/main/controllers/session-events.ts` (nuevo)
- `tests/main/controllers/worker.test.ts`, `auth-guard.test.ts`, `access-control.test.ts`,
  `session.test.ts`, `request-session.test.ts`, `tests/renderer/personal-ui.mts`
- `docs/incremento-2/*`

Archivos centrales que edita P6 a solicitud de P4 (sección 9):
`src/db/schema.ts`, `drizzle/`, `src/shared/navigation.ts`, `src/shared/controllers.ts`,
`src/main/controllers/index.ts`, `src/preload/index.ts`, `src/renderer/src/App.tsx`.

Rama de trabajo: `feature/i2-p4-trabajadores`.

## 3. Fase 1 · Contrato congelado

Objetivo: dejar los diagramas del equipo en el repositorio documental y transcribirlos a
YAML para que la matriz de la Fase 2 y la trazabilidad de la Fase 7 tengan una fuente
auditable.

1. Copiar el contenido del zip a `../diagramas_secuencias_ii/CU22`, `CU23`, `CU24` y
   reemplazar `CU57`. Registrar SHA-256 de cada `.drawio` y `.png` en
   `docs/incremento-2/sha256.txt`.
2. Transcribir cada escenario a YAML en
   `../.claude/skills/diagrama-secuencia-uml/specs_incremento_2/` (`cu22.yaml`,
   `cu23.yaml`, `cu24.yaml`; reescribir `cu57.yaml`). Trazabilidad: docx de RF y CU del
   Incremento 2 (tablas 2.15, 2.16, 2.17, 2.29) y doc v5 (V15*, V16*, V29, C37, C38, C39,
   §14.2). Registrar en `resolved_contradictions`: Documento 0 frente a Incremento 2;
   cargo frente a rol de sistema; contraseña temporal en edición (no aplica, CU59);
   CU57 lee rol desde `SesionUsuario` mientras CU22-24 lo leen del JWT (D1 resuelve).
3. Ejecutar `validate` y `audit` del skill sobre YAML y drawio. Volcar los hallazgos en
   `docs/incremento-2/hallazgos-diagramas.md` (transacciones dibujadas en CU22 y CU23,
   actor ausente en CU22 y CU23, inconsistencia D1). Entregar al equipo. No regenerar PNG.

Entregable: diagramas versionados, cuatro YAML, reporte de hallazgos.

## 4. Fase 2 · Matriz de coincidencia mensaje a mensaje

Por cada uno de los 10 escenarios, tabla con columnas
`mensaje N · participante origen → destino · símbolo de código · estado (coincide / falta / sobra)`.
Archivo: `docs/incremento-2/matriz-mensajes.md`. Punto de partida: la auditoría
preliminar de 19 filas ya hecha (resumida en la sección 10).

Salida: lista definitiva de deltas por CU, separada en archivos de P4 y solicitudes a P6.
Si aparece un delta no previsto, se detiene y se consulta (D12).

## 5. Fase 3 · PR 1 "guard y sesión" (deltas transversales de CU57)

Es la "primera entrega que desbloquea" del informe. Todo lo demás depende de esto.

### 5.1 Solicitud previa a P6 (bloqueante)

El proyecto usa Drizzle en modo *schema-first*: la fuente de verdad es
`src/db/schema.ts` y el `.sql` lo emite `drizzle-kit`. No se escribe a mano un archivo de
migración: sin su entrada en `drizzle/migrations/meta/_journal.json` no se aplicaría, y ese
journal lo mantiene el generador.

**Paso 1.** P6 agrega la columna en `src/db/schema.ts`, dentro de `sesionUsuario`:

```ts
sesionRolEfectivo: text("sesion_rol_efectivo", {
  enum: ["dueno", "trabajador"],
}),
```

**Paso 2.** `npm run db:generate -- --name=sesion_rol_efectivo`, que emite
`drizzle/migrations/0003_sesion_rol_efectivo.sql` y agrega la entrada al journal.

**Paso 3.** P6 añade a mano, dentro del archivo generado, el backfill de las filas
históricas. Es el patrón que ya usó `0001_user_roles_dueno_trabajador.sql`: estructura
generada por drizzle-kit más la transformación de datos escrita por el equipo.

```sql
--> statement-breakpoint
UPDATE `sesion_usuario`
   SET `sesion_rol_efectivo` = CASE
     WHEN (SELECT lower(u.`usuario_rol`) FROM `usuario` u
            WHERE u.`usuario_id` = `sesion_usuario`.`usuario_id`) LIKE 'due%'
       THEN 'dueno' ELSE 'trabajador' END
 WHERE `sesion_rol_efectivo` IS NULL;
```

**Paso 4.** Alinear el control de migraciones (ver abajo) y luego `npm run db:migrate`.

### 5.1.1 Bloqueante heredado del control de migraciones

Verificado el 11 de septiembre sobre un clon íntegro de la base del equipo: `db:migrate`
falla con ``table `detalle_recepcion` already exists``.

La causa es un historial partido en dos tablas de control. `__drizzle_migrations`, que es la
que consulta drizzle-kit, solo registra `0000` y `0001`. La migración `0002_supplier_orders`
quedó anotada en una tabla `__migrations` escrita por otra herramienta. Como sus tablas ya
existen, drizzle intenta recrearlas y aborta antes de llegar a `0003`. No es un efecto de
este plan: la base ya venía así.

El migrador de libSQL decide qué aplicar comparando `created_at` de la última fila de
`__drizzle_migrations` contra el campo `when` de cada entrada del journal. El hash se guarda
pero no participa de la decisión. Basta entonces registrar `0002` con su `when` real:

```sql
INSERT INTO __drizzle_migrations (hash, created_at)
VALUES ('<sha256 del archivo 0002_supplier_orders.sql>', 1789157293843);
```

El hash se obtiene con `shasum -a 256 drizzle/migrations/0002_supplier_orders.sql`. El valor
resultante coincide con el que ya figuraba en `__migrations`, lo que confirma que ambas
tablas usan el mismo algoritmo y que el registro es el correcto.

**Estado: ya resuelto en ambas bases, el 11 de septiembre de 2026. No repetir el `INSERT`.**

Se aplicó primero sobre un clon local y después sobre la base compartida de Turso, con
respaldo previo en ambos casos. En las dos, `db:migrate` aplicó únicamente `0003`, la
columna quedó creada y el backfill pobló las 118 sesiones existentes: 103 de dueño y 15 de
trabajador, con cero desajustes contra el rol real de cada usuario. El control quedó en 4
migraciones de 4. En local, además, typecheck limpio y 421 pruebas en 54 archivos en verde.

El `INSERT` está escrito de forma idempotente: si se vuelve a ejecutar, detecta la fila y no
hace nada. Aun así no hace falta correrlo de nuevo.

Lo que sí debe saber el resto del equipo: quien tenga una base local anterior a esta
corrección chocará con el mismo error al migrar. La salida más simple es rehacer la base
local como clon de la remota, que ya viene con el control alineado.

Decisión abierta para P6 sobre la forma de la columna:

- **Sin `check()` a nivel de tabla** (recomendado): el tipado `enum` de Drizzle ya restringe
  los valores en TypeScript y el login es el único escritor. drizzle-kit puede emitir un
  `ALTER TABLE ADD COLUMN` simple.
- **Con `check()`**: SQLite no permite agregar un CHECK de tabla con `ALTER TABLE`, así que
  drizzle-kit emitirá una reconstrucción completa (crear tabla nueva, copiar, borrar,
  renombrar), igual que `0001`. Es viable porque ningún trigger de `src/db/triggers.sql`
  toca `sesion_usuario`, pero es una migración más pesada.

En ambos casos la columna queda nullable en la base: SQLite no admite `NOT NULL` sin default
al agregar una columna, y por eso existe el backfill. La garantía de que siempre venga
poblada es de la aplicación (`auth-login.ts` la escribe en cada sesión nueva) y el lector
trata `null` como "sesión anterior a la migración", resolviendo el rol desde `usuario`.

P6 confirma la forma exacta del SQL ejecutando `db:generate` antes de abrir el PR de
migración; este plan no fija el texto generado.

### 5.2 Cambios de P4

| Archivo | Cambio | Mensajes del diagrama |
|---------|--------|-----------------------|
| `auth-login.ts` | Al insertar `sesion_usuario`, escribir `sesionRolEfectivo = role`. | CU57 9-10 (origen del dato) |
| `session.ts` | `validateAndRefreshActiveSession` y `inspectSessionState` devuelven `rolEfectivo` leído de la fila. `VerifySessionData` gana `rolEfectivo?: Role`. Si la columna viene `null` (sesión abierta antes de la migración), se resuelve el rol desde `usuario` como respaldo. | CU57 6-13, CU24 6-13, CU22 6-13, CU23 6-13 |
| `auth-guard.ts` | `authorizeRequest` toma el rol de sesión devuelto por `session` y lo adjunta al contexto (`context.claims.rol = rolEfectivo`) y al payload confiable como `__rolSesion`. El chequeo `CHANNEL_ROLES` se mantiene y pasa a usar el rol de sesión (D2). Agregar a `CHANNEL_ROLE_OVERRIDES`: `trabajador:registrar`, `trabajador:actualizar`, `trabajador:cambiar-estado`, `turno:crear`, `turno:editar`, `turno:eliminar` → solo `dueno`. | CU57 14, 21-23; CU24 3 |
| `auth-context.ts` | `authorizeUser(executor, schema, usuarioId, allowedRoles, sessionRole?)`. Si `sessionRole` viene, la decisión de permiso usa ese rol y la base se consulta solo para existencia y estado activo. Si no viene, comportamiento actual (compatibilidad con controladores de otros bloques hasta que adopten el contrato). | CU57 15-23; CU22 71 |
| `worker.ts` | Todas las llamadas a `authorize` pasan `payload.__rolSesion`. | CU22 14, CU23 14, CU24 14 |
| `access-control.ts` | Decide con el rol de sesión. Audita concedido (`acceso_concedido`, módulo del nodo) y denegado (`acceso_denegado`) en Main (D3). | CU57 25-34 y E1 17-26 |
| `shared/auth.ts` | Constantes `SESSION_INVALIDATED_EVENT = "session:invalidada"` y `SESSION_INVALIDATED_MESSAGE`. | CU23 72 (se usan en PR 3) |

### 5.3 Solicitudes a P6 en este PR

- `App.tsx`: retirar la llamada `auditoria:registrar` de `auditRouteAccess` para accesos
  concedidos y denegados (Main los audita). Al recibir `deny` de `evaluateRouteAccess` o
  `FORBIDDEN` de `access:validate`, guardar `accessDeniedMessage = "No tiene permiso para
  acceder a este módulo."`, navegar al dashboard y mostrar el banner. Limpiar al navegar.
- `navigation.ts`: `worker-list.roles = ["dueno", "trabajador"]`;
  `shift-calendar.roles = ["dueno", "trabajador"]` (coordinado con P5).

### 5.4 Tests

- `auth-guard.test.ts`: rol de sesión prevalece sobre el rol del JWT y sobre el de la base;
  overrides niegan mutaciones a trabajador aunque el nodo permita ambos roles; denegación
  auditada una sola vez.
- `session.test.ts`: `validateAndRefreshActiveSession` devuelve `rolEfectivo`.
- `access-control.test.ts`: concedido auditado en Main (CU57 happy); denegado auditado y
  `FORBIDDEN` (CU57 E1).
- `navigation.test.ts`: nueva matriz de roles.
- `auth-login.test.ts`: la sesión creada persiste el rol efectivo.

### 5.5 Política publicada

`docs/incremento-2/politica-permisos.md`: matriz §14.2 del doc v5 traducida a canal y ruta,
más la instrucción para los demás bloques: "pasar `payload.__rolSesion` como quinto
argumento de `authorizeUser`".

## 6. Fase 4 · PR 2 parte A · CU24

| Archivo | Cambio | Mensajes |
|---------|--------|----------|
| `worker.ts` | `trabajador:listar` autoriza `["dueno", "trabajador"]`. `listWorkers(filters)` en dos pasos (D4): (1) `SELECT` sobre `trabajador` con `WHERE` por búsqueda (`rut LIKE` o `nombre LIKE`, insensible a tildes vía normalización previa del término) y `estado`; (2) `SELECT` sobre `usuario` por los `trabajador_id` obtenidos, aplicando filtro de rol. Orden en SQL por nombre y apellido. `filterAndSortUserList` queda solo para ordenar por columna. | CU24 15-26 |
| `WorkerListView.tsx` | Prop `role`. Botones Registrar, Editar y Cambiar estado se renderizan solo con `role === "dueno"`. Mensaje "No se encontraron trabajadores" en lista vacía (ya existe). | CU24 28, E1 28 |
| `shared/users.ts` | `UserListFilters` sin cambios de contrato. | CU24 30 |

Solicitud a P6: `App.tsx` pasa `role={session.role}` a `WorkerListView`.

Tests:

- `worker.test.ts`: happy Dueño (lista completa con acciones), happy Trabajador (misma
  lista), búsqueda por RUT parcial, por nombre con tilde, filtro rol, filtro estado, E1
  vacío; "listar no concede editar": trabajador invoca `trabajador:actualizar` por IPC
  directo → `FORBIDDEN` y fila `acceso_denegado`.
- `personal-ui.mts`: tabla renderizada, cambio de filtro reinvoca `trabajador:listar` con
  payload correcto, botones ausentes para trabajador, mensaje de vacío.

## 7. Fase 5 · PR 2 parte B · CU22

| Archivo | Cambio | Mensajes |
|---------|--------|----------|
| `WorkerFormView.tsx` | Modo edición: props `mode: "create" \| "edit"`, `initialValues`, `onClose`, `onSaved`. En edición el RUT se muestra deshabilitado. Reutiliza `validateUserFormValues` con `validateRutFormat: false`. Se monta como modal desde el listado (D5). | CU22 30-33, 86-87 |
| `WorkerListView.tsx` | Eliminar el modal de edición interno. Botón Editar abre `WorkerFormView` en modo edición. Si la búsqueda por RUT exacto devuelve vacío, mostrar "Trabajador no encontrado" (D7). | CU22 1-2, 27-29, E1 22 |
| `worker.ts` `updateWorker` | Dentro de la transacción: revalidar existencia por RUT (`NOT_FOUND` si no existe); actualizar `trabajador` (nombre, teléfono, correo); **solo si cambió el rol**: actualizar `usuario.usuario_rol`, cerrar `usuario_version` vigente e insertar la nueva (D6); auditar con descripción de campos cambiados. No tocar `sesion_usuario`. | CU22 47-81 |

Tests (`worker.test.ts` y `worker-update.integration.test.ts` con BD real):

- Happy sin cambio de rol: `trabajador` actualizado, `usuario` y `usuario_version` intactos.
- Happy con cambio de rol: `usuario` actualizado, versión anterior cerrada, versión nueva
  insertada, auditoría en la misma transacción.
- Tras cambiar el rol, una request con el JWT y la sesión vigente del trabajador sigue
  autorizándose con el rol anterior (`sesion_rol_efectivo` no cambia).
- E1: RUT inexistente → `NOT_FOUND`, sin escrituras.
- E2 por canal: nombre vacío, rol inválido, teléfono de 8 dígitos, correo inválido →
  `VALIDATION_ERROR` con `fieldErrors`, sin iniciar transacción.
- `personal-ui.mts`: RUT deshabilitado en edición, error preventivo sin IPC, éxito con
  datos válidos, mensaje "Trabajador no encontrado" con RUT exacto inexistente.

## 8. Fase 6 · PR 3 · CU23

| Archivo | Cambio | Mensajes |
|---------|--------|----------|
| `WorkerStatusView.tsx` (nuevo) | Modal V29 (D8): RUT, nombre, estado actual, estado resultante, advertencia "se cerrarán sus sesiones abiertas" al desactivar. Botones Confirmar y Cancelar. Cancelar cierra sin invocar IPC. | CU23 22-25, E2 25-26 |
| `shared/users.ts` | `UserStatusChangePayload` gana `confirmacion: boolean`. `normalizeUserStatusChangePayload` lo lee. | CU23 26 |
| `worker.ts` `changeStatus` | Validar `confirmacion === true` y `estado ∈ {activo, inactivo}` antes de la transacción. Dentro: revalidar existencia (`NOT_FOUND`), leer estado anterior, actualizar solo `trabajador_estado`; si el nuevo estado es `inactivo`: `UPDATE sesion_usuario SET sesion_fecha_hora_cierre = now, sesion_motivo_cierre = 'sistema' WHERE usuario_id = ? AND sesion_fecha_hora_cierre IS NULL` (D9); auditar con "estado anterior → nuevo". Después del commit, si desactivó: `notifySessionInvalidated(usuarioId)`. | CU23 39-71 |
| `session-events.ts` (nuevo) | `notifySessionInvalidated(usuarioId)`: `BrowserWindow.getAllWindows()` y `webContents.send(SESSION_INVALIDATED_EVENT, { usuarioId })`, con manejo de error igual a `dashboard-events.ts` (D10). | CU23 72-73 |
| `WorkerListView.tsx` | Botón Cambiar estado abre `WorkerStatusView`. Búsqueda por RUT exacto vacía → "Trabajador no encontrado" (D7). | CU23 1-2, 21, E1 22 |

Solicitudes a P6:

- `preload/index.ts`: `onSessionInvalidated(listener: (payload: { usuarioId: string }) => void)`.
- `App.tsx`: al recibir el evento, si `payload.usuarioId === session.usuarioId`, limpiar la
  sesión, mostrar `SESSION_INVALIDATED_MESSAGE` y navegar a `/login`. Además, el heartbeat
  de `auth:verificar-sesion` y cualquier `FORBIDDEN` por sesión inválida deben mostrar ese
  mismo mensaje y no el de inactividad cuando el motivo sea `sistema`.
- `shared/auth.ts` es de P4; las constantes ya están desde PR 1.

Tests:

- `worker.test.ts` con BD real: desactivar cierra solo las sesiones abiertas del objetivo
  con motivo `sistema`; las de otros usuarios siguen abiertas; la siguiente request con el
  token viejo devuelve `FORBIDDEN`; reactivar no reabre sesiones y un login nuevo funciona;
  E1 `NOT_FOUND`; payload sin `confirmacion` → `VALIDATION_ERROR`; auditoría con ambos
  estados; el evento se emite solo tras commit exitoso y nunca tras rollback (spy sobre
  `notifySessionInvalidated`).
- `personal-ui.mts`: cancelar no invoca IPC; confirmar invoca
  `trabajador:cambiar-estado` con `{ estado, usuarioObjetivoId, confirmacion: true }`.
- Evidencia de "no disponible": tests existentes `auth-login.test.ts` (e3),
  `shift.test.ts` (inactivo rechazado), `attendance-service.test.ts` (inactivo bloqueado).

## 9. Fase 7 · PR 4 · Trazabilidad y aceptación

1. `docs/incremento-2/RF22.md`, `RF23.md`, `RF24.md`, `RF57.md`: por escenario, diagrama
   y SHA, evidencia de código con enlaces `archivo#Lnn`, tests, secuencia verificada.
   Formato de `docs/incremento-1/RF21.md`.
2. `docs/incremento-2/README.md` con índice, decisiones D1-D13 y hallazgos de diagramas.
3. `docs/incremento-2/matriz.json` con las filas nuevas (mismo esquema que incremento 1).
4. `npm run typecheck && npm test && npm run build`.
5. Pruebas de aceptación entre bloques (informe §6):
   - "Rol y desactivación" con propietarios: cambio de rol surte efecto al siguiente
     login; desactivar revoca sesiones abiertas; reactivar no revive tokens; probar por IPC
     directo.
   - "Acceso transversal" con P7 y propietarios: ambos roles acceden a costos, proveedores,
     ajuste, recepción y valorización; mutaciones de personal, turnos, remuneraciones y
     configuración solo Dueño; responsable de venta proviene de sesión.
   - "Turnos" con P5: ambos roles consultan calendario; solo Dueño modifica.

## 10. Resumen de solicitudes a P6

| Orden | Archivo | Cambio | PR |
|-------|---------|--------|----|
| 1 | `db/schema.ts` → `npm run db:generate` → backfill a mano en el `.sql` generado → `db:migrate` | Columna `sesion_rol_efectivo` | Antes de PR 1 |
| 2 | `shared/navigation.ts` | `worker-list` y `shift-calendar` con ambos roles | PR 1 |
| 3 | `App.tsx` | Retirar auditoría de acceso del renderer; banner de denegación y redirección | PR 1 |
| 4 | `App.tsx` | Prop `role` a `WorkerListView` | PR 2 |
| 5 | `preload/index.ts` | `onSessionInvalidated` | PR 3 |
| 6 | `App.tsx` | Manejo de `session:invalidada` y mensaje de sesión revocada en heartbeat y `FORBIDDEN` | PR 3 |

## 11. Auditoría preliminar diagrama vs código (base de la Fase 2)

| # | Mensaje | Código hoy | Resolución |
|---|---------|------------|------------|
| 1 | CU57 9-10 rol efectivo en SesionUsuario | Sin columna; rol en JWT | D1: columna + login + session.ts |
| 2 | CU57 15-23 permiso en controlador | Guard decide; `authorizeUser` relee base | D2: `authorizeUser` con `sessionRole`; guard se mantiene |
| 3 | CU57 25-34 concedido auditado en Main | Renderer audita | D3: `access:validate` audita |
| 4 | CU57 E1 28-29 mensaje de permisos insuficientes | Sin mensaje | Banner en `App.tsx` (P6) |
| 5 | CU24 1-3 ambos roles consultan | Solo dueño | `worker.ts` + `navigation.ts` + overrides |
| 6 | CU24 15-26 dos consultas en SQL | JOIN + memoria | D4 |
| 7 | CU24 28 acciones solo Dueño | Vista sin rol | Prop `role` |
| 8 | CU22 30-33 V16 participante | Modal en listado | D5 |
| 9 | CU22 59-70 versión solo si cambió rol | Nombre o rol | D6 |
| 10 | CU22 E1 / CU23 E1 no encontrado | Lista vacía | D7 |
| 11 | CU23 22-25 V29 participante | `window.confirm` | D8 |
| 12 | CU23 26, 39 confirmación en payload | No existe | Campo `confirmacion` |
| 13 | CU23 50-55 revocar sesiones | No se tocan | UPDATE directo, motivo `sistema` (D9) |
| 14 | CU23 63 estados anterior/nuevo en auditoría | Solo nuevo | Descripción con ambos |
| 15 | CU23 72-73 evento tras commit | Solo `session:expirada` al sender | D10 |
| 16 | CU23 74 reactivar exige login | Ya se cumple | Test |
| 17 | BEGIN/COMMIT dibujados; sin actor | `db.transaction` | D11: reportar, no bloquear |
| 18 | CU22 2 / CU23 2 búsqueda por RUT vía listar | Compatible | Sin cambio |
| 19 | CU22 E2 validación antes de transacción | Ya se cumple | Test del camino backend |

## 12. Orden de ejecución y dependencias

```
Fase 1 (docs) ─► Fase 2 (matriz) ─► P6: migración 0003
                                        │
                                        ▼
                                   Fase 3 · PR 1 guard y sesión
                                        │
                        ┌───────────────┴───────────────┐
                        ▼                               ▼
              Fase 4 · CU24 ─► Fase 5 · CU22       (P1, P5, P7 adoptan política)
                        │        (PR 2)
                        ▼
              Fase 6 · CU23 · PR 3
                        │
                        ▼
              Fase 7 · PR 4 trazabilidad + aceptación cruzada
```

Comandos de referencia:

```bash
# desde ~/sem1-2026/ingenieria_software
python3 .claude/skills/diagrama-secuencia-uml/scripts/diagram_flow.py audit diagramas_secuencias_ii/CU23/cu23-cambiar-estado-trabajador.drawio
python3 .claude/skills/diagrama-secuencia-uml/scripts/diagram_flow.py validate .claude/skills/diagrama-secuencia-uml/specs_incremento_2/cu23.yaml

# desde git_implementacion
npm run typecheck && npm test && npm run build
```
