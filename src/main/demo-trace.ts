import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { getTableName, isTable } from "drizzle-orm";
import * as schema from "../db/schema";
import type { ControllerResponse } from "../shared/controllers";
import type { Role } from "../shared/navigation";
import { demoViewSteps, isDemoViewStep, type DemoViewStep } from "../shared/demo-sequence";
import { summarizeDemoResponse } from "./controllers/demo-log";

/**
 * Traza de la demo (`npm run demo`) para CU18 y CU36.
 *
 * Imprime una línea por mensaje, con los mismos participantes de los diagramas
 * de secuencia: `[CU36] V_RegistrarVentaView -> C_VentaHandler: venta:registrar`.
 * Solo muestra el camino principal: las tablas que aparecen en cada diagrama y
 * las llamadas directas, sin retornos intermedios ni consultas de apoyo.
 */

type Flow = {
  cu: "CU18" | "CU36";
  view: string;
  handler: string;
  /** Tablas que aparecen en el diagrama; el resto de las consultas no se imprime. */
  tables: ReadonlySet<string>;
};
type TraceContext = { flow: Flow; channel: string; participant: string };

const ACCESS = "C_ControlAcceso";
const DRIZZLE = "C_drizzle";
const LIBSQL = "C_libsql";
const COLUMN = "V_ConfirmarRecepcionPedidoView".length;

const reception: Flow = {
  cu: "CU18",
  view: "V_ConfirmarRecepcionPedidoView",
  handler: "C_RecepcionPedidoHandler",
  tables: new Set([
    "sesion_usuario", "pedido_proveedor", "detalle_pedido", "recepcion_pedido",
    "detalle_recepcion", "lote", "lote_perecible", "historial_auditoria_pedido", "log_auditoria",
  ]),
};
const sale: Flow = {
  cu: "CU36",
  view: "V_RegistrarVentaView",
  handler: "C_VentaHandler",
  tables: new Set([
    "sesion_usuario", "cierre_caja", "producto", "lote",
    "venta", "venta_efectivo", "detalle_venta", "venta_lote",
  ]),
};

const channels: Record<string, { flow: Flow; request: string }> = {
  "pedido:listar": { flow: reception, request: "pedido:listar (estados, JWT)" },
  "pedido:detalle": { flow: reception, request: "pedido:detalle (pedido, JWT)" },
  "pedido:confirmar-recepcion": { flow: reception, request: "pedido:confirmar-recepcion (entrega, JWT)" },
  "venta:verificar-caja": { flow: sale, request: "venta:verificar-caja (JWT)" },
  "venta:producto": { flow: sale, request: "venta:producto (EAN-13 o nombre, JWT)" },
  "venta:validar-carrito": { flow: sale, request: "venta:validar-carrito (carrito, JWT)" },
  "venta:registrar": { flow: sale, request: "venta:registrar (carrito, pago, JWT)" },
};

/**
 * Mensaje participante → C_drizzle. Se busca primero por participante, luego
 * por canal y al final solo por operación y tabla.
 */
const queryMessages: Record<string, string> = {
  "pedido:listar SELECT pedido_proveedor": "Listar pedidos por estado",
  "pedido:confirmar-recepcion SELECT pedido_proveedor": "Revalidar que el pedido siga recepcionable",
  "pedido:confirmar-recepcion SELECT detalle_pedido": "Releer saldos por línea",
  "pedido:confirmar-recepcion SELECT recepcion_pedido": "Comprobar que la operación no esté registrada",
  "venta:validar-carrito SELECT lote": "Validar stock suficiente",
  "venta:registrar SELECT producto": "Releer producto activo y precio vigente",
  "venta:registrar SELECT lote": "Revalidar stock suficiente",
  "C_DescuentoStockHandler SELECT lote": "Consultar lotes con stock para FEFO/FIFO",
  "UPDATE sesion_usuario": "Validar sesión y actualizar último acceso",
  "SELECT sesion_usuario": "Consultar sesión vigente",
  "SELECT pedido_proveedor": "Consultar pedido y su estado",
  "UPDATE pedido_proveedor": "Actualizar estado del pedido",
  "SELECT detalle_pedido": "Consultar solicitado, recibido y pendiente",
  "UPDATE detalle_pedido": "Acumular cantidad recibida",
  "SELECT recepcion_pedido": "Consultar entregas anteriores",
  "INSERT recepcion_pedido": "Registrar cabecera de la entrega",
  "UPDATE recepcion_pedido": "Guardar estado resultante de la entrega",
  "SELECT detalle_recepcion": "Consultar cantidades de cada entrega",
  "INSERT detalle_recepcion": "Registrar cantidades de la entrega",
  "INSERT lote": "Crear lote con su costo",
  "INSERT lote_perecible": "Guardar vencimiento del lote",
  "SELECT historial_auditoria_pedido": "Consultar historial del pedido",
  "INSERT historial_auditoria_pedido": "Registrar evento en el historial",
  "INSERT log_auditoria": "Insertar evento de auditoría",
  "SELECT cierre_caja": "Consultar caja del día",
  "INSERT cierre_caja": "Abrir caja del día",
  "SELECT producto": "Consultar producto activo",
  "SELECT lote": "Consultar stock por lote",
  "UPDATE lote": "Descontar stock de los lotes",
  "INSERT venta": "Insertar venta",
  "INSERT venta_efectivo": "Guardar monto recibido",
  "INSERT detalle_venta": "Insertar detalle de venta",
  "INSERT venta_lote": "Registrar consumo por lote",
};
const verbs: Record<string, string> = {
  SELECT: "Consultar", INSERT: "Insertar", UPDATE: "Actualizar", DELETE: "Eliminar",
};

const context = new AsyncLocalStorage<TraceContext | undefined>();
const tableNames = new Set<string>(Object.values(schema).filter(isTable).map(getTableName));

const actorLabels: Record<Role, string> = { dueno: "Dueño", trabajador: "Trabajador" };
/** Rol de la última sesión verificada; se usa como actor en los pasos de vista. */
let actor = "Dueño/Trabajador";

/** Guarda el rol efectivo que confirmó el control de acceso. */
export function rememberDemoActor(rol: unknown): void {
  if (demoEnabled() && (rol === "dueno" || rol === "trabajador")) actor = actorLabels[rol];
}

function demoEnabled(): boolean {
  return process.env.HUASCAR_DEMO === "1";
}

function activeContext(): TraceContext | undefined {
  return demoEnabled() ? context.getStore() : undefined;
}

export function demoOutput(message: string): void {
  try { console.log(message); } catch {}
}

/**
 * Color de letra de cada participante, tomado del borde (strokeColor de
 * draw.io) de su línea de vida en los diagramas de secuencia: vistas en azul,
 * controladores propios en verde, librerías en rojo y tablas en morado.
 * `ansi256` es la aproximación para terminales sin color de 24 bits.
 */
const palette = {
  view: { rgb: [0x6c, 0x8e, 0xbf], ansi256: 67 },
  controller: { rgb: [0x82, 0xb3, 0x66], ansi256: 107 },
  library: { rgb: [0xb8, 0x54, 0x50], ansi256: 131 },
  table: { rgb: [0x96, 0x73, 0xa6], ansi256: 97 },
} as const;
const libraries = new Set(["C_jsonwebtoken", "C_drizzle", "C_libsql", "C_cryptoNode", "C_webContentsSend"]);

function paletteOf(name: string): (typeof palette)[keyof typeof palette] | undefined {
  if (name.startsWith("V_")) return palette.view;
  if (libraries.has(name)) return palette.library;
  if (name.startsWith("C_")) return palette.controller;
  if (tableNames.has(name)) return palette.table;
  return undefined; // El actor no tiene color en los diagramas.
}

function colorsEnabled(): boolean {
  if (process.env.NO_COLOR) return false;
  return Boolean(process.env.FORCE_COLOR) || process.stdout.isTTY === true;
}

/** Nombre del participante con el color de su diagrama, rellenado a `width`. */
function participant(name: string, width = 0): string {
  const padding = " ".repeat(Math.max(0, width - name.length));
  const colors = paletteOf(name);
  if (!colors || !colorsEnabled()) return name + padding;
  const truecolor = /^(truecolor|24bit)$/i.test(process.env.COLORTERM ?? "");
  const foreground = truecolor ? `38;2;${colors.rgb.join(";")}` : `38;5;${colors.ansi256}`;
  return `\x1b[${foreground}m${name}\x1b[0m${padding}`;
}

function emit(flow: Flow, source: string, arrow: "->" | "-->", target: string, message: string): void {
  demoOutput(`[${flow.cu}] ${participant(source, COLUMN)} ${arrow.padEnd(3)} ${participant(target)}: ${message}`);
}

/** Mensaje desde el participante actual hacia `target`. */
export function demoTraceStep(target: string, message: string): void {
  const active = activeContext();
  if (active) emit(active.flow, active.participant, "->", target, message);
}

function emitSeparator(cu: Flow["cu"], label: string): void {
  demoOutput(`[${cu}] ────────── ${label} ──────────`);
}

const receptionPhases = {
  session: "Revalidar sesión y permisos",
  validation: "Validar pedido y datos de la entrega",
  registration: "Registrar cantidades, costos y lotes de la entrega",
  orderUpdate: "Actualizar saldo y estado del pedido",
  audit: "Registrar auditoría de la recepción",
} as const;

export function traceDemoReceptionPhase(phase: keyof typeof receptionPhases): void {
  const active = activeContext();
  if (active?.channel === "pedido:confirmar-recepcion") {
    emitSeparator(active.flow.cu, receptionPhases[phase]);
  }
}

const salePhases = {
  session: receptionPhases.session,
  validation: "Validar carrito y calcular el pago",
  stockPlan: "Verificar stock y seleccionar lotes",
  cash: "Verificar o abrir la caja del día",
  registration: "Registrar venta, pago y detalle",
  stockUpdate: "Descontar stock y registrar los lotes usados",
} as const;

export function traceDemoSalePhase(phase: keyof typeof salePhases): void {
  const active = activeContext();
  if (active?.channel === "venta:registrar") {
    emitSeparator(active.flow.cu, salePhases[phase]);
  }
}

const completedViewActions: Partial<Record<DemoViewStep, string>> = {
  ordersShown: "Listado de pedidos listo",
  deliveryFormShown: "Detalle del pedido listo",
  saleReady: "Vista de venta lista",
  productsShown: "Búsqueda de producto completada",
  cartShown: "Carrito actualizado",
  saleShown: "Venta registrada",
};

export function logDemoViewStep(step: unknown): void {
  if (!demoEnabled() || !isDemoViewStep(step)) return;
  const [cu, source, message] = demoViewSteps[step];
  const flow = cu === "CU18" ? reception : sale;
  if (source === "actor") emit(flow, actor, "->", flow.view, message);
  else if (source === "self") emit(flow, flow.view, "->", flow.view, message);
  else emit(flow, flow.view, "-->", actor, message);

  const completedAction = completedViewActions[step];
  if (completedAction) {
    emitSeparator(cu, completedAction);
  }
}

export function demoRandomUUID(purpose: string): string {
  demoTraceStep("C_cryptoNode", `Generar UUID de ${purpose}`);
  return randomUUID();
}

/**
 * Envuelve una solicitud IPC de CU18/CU36: vista → handler → control de acceso.
 * El retorno final al handler vuelve a la vista con un resumen de una línea.
 */
export async function traceDemoRequest<T extends ControllerResponse>(
  channel: string,
  action: () => Promise<T>,
): Promise<T> {
  const definition = channels[channel];
  if (!demoEnabled() || !definition) return action();
  const { flow } = definition;
  emit(flow, flow.view, "->", flow.handler, definition.request);
  return context.run({ flow, channel, participant: ACCESS }, async () => {
    traceDemoReceptionPhase("session");
    traceDemoSalePhase("session");
    emit(flow, flow.handler, "->", ACCESS, "Validar JWT, rol y sesión");
    try {
      const response = await action();
      emit(flow, flow.handler, "-->", flow.view, response.ok
        ? summarizeDemoResponse(channel, response.data)
        : `Rechazado (${response.error.code})`);
      return response;
    } catch (error) {
      emit(flow, flow.handler, "-->", flow.view, "Error; solicitud no completada");
      throw error;
    }
  });
}

/** Cede el control al handler del caso de uso una vez concedido el acceso. */
export async function enterDemoHandler<T>(action: () => Promise<T>): Promise<T> {
  const active = activeContext();
  if (!active) return action();
  emit(active.flow, ACCESS, "-->", active.flow.handler, "Acceso concedido");
  return context.run({ ...active, participant: active.flow.handler }, action);
}

/** Llamada del participante actual a `participant`; lo que ocurra dentro sale a su nombre. */
export async function traceDemoCall<T>(
  participant: string,
  message: string,
  action: () => Promise<T>,
): Promise<T> {
  const active = activeContext();
  if (!active) return action();
  emit(active.flow, active.participant, "->", participant, message);
  return context.run({ ...active, participant }, action);
}

export async function traceDemoTransaction<T>(action: () => Promise<T>): Promise<T> {
  const active = activeContext();
  if (!active) return action();
  emit(active.flow, active.participant, "->", DRIZZLE, "Iniciar transacción");
  emit(active.flow, DRIZZLE, "->", LIBSQL, "BEGIN");
  try {
    const result = await action();
    emit(active.flow, active.participant, "->", DRIZZLE, "Confirmar transacción");
    emit(active.flow, DRIZZLE, "->", LIBSQL, "COMMIT");
    return result;
  } catch (error) {
    emit(active.flow, DRIZZLE, "->", LIBSQL, "ROLLBACK; no se guarda ningún cambio");
    throw error;
  }
}

/** Ejecuta pasos de apoyo que no aparecen en el diagrama sin imprimirlos. */
export async function withoutDemoTrace<T>(action: () => PromiseLike<T>): Promise<T> {
  return context.run(undefined, async () => await action());
}

export const demoQueryLogger = {
  logQuery(query: string, _params: unknown[]): void {
    const active = activeContext();
    if (!active) return;
    const { operation, tables } = describeSql(query);
    if (!verbs[operation]) return;
    const [table, ...joined] = tables.filter((name) => active.flow.tables.has(name));
    if (!table) return;
    const key = `${operation} ${table}`;
    const message = queryMessages[`${active.participant} ${key}`]
      ?? queryMessages[`${active.channel} ${key}`]
      ?? queryMessages[key]
      ?? `${verbs[operation]} ${table}`;
    emit(active.flow, active.participant, "->", DRIZZLE, message);
    emit(active.flow, DRIZZLE, "->", LIBSQL, "Ejecutar SQL");
    emit(active.flow, LIBSQL, "->", table, joined.length ? `${operation} (con ${joined.join(", ")})` : operation);
  },
};

function describeSql(query: string): { operation: string; tables: string[] } {
  const normalized = query.replace(/'(?:''|[^'])*'|--[^\n]*|\/\*[\s\S]*?\*\//g, " ");
  const first = normalized.trim().match(/^\w+/)?.[0].toUpperCase() ?? "SQL";
  const names = [...normalized.matchAll(/\b(?:from|join|into|update)\s+(?:["`\[]?\w+["`\]]?\s*\.\s*)?["`\[]?([a-z_]\w*)["`\]]?/gi)]
    .map((match) => match[1].toLowerCase())
    .filter((name) => tableNames.has(name));
  return { operation: first === "WITH" ? "SELECT" : first, tables: [...new Set(names)] };
}
