import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { Client, InArgs, InStatement, ResultSet, Transaction, TransactionMode } from "@libsql/client";
import { getTableName, isTable } from "drizzle-orm";
import * as schema from "../db/schema";
import type { ControllerResponse } from "../shared/controllers";
import { demoViewSteps, isDemoViewStep } from "../shared/demo-sequence";

type Sequence = { id: number; rf: string; cu: string; step: number };
type TraceContext = { sequence: Sequence; participant: string };
const context = new AsyncLocalStorage<TraceContext | undefined>();
let nextId = 0;
const tableNames = new Set<string>(Object.values(schema).filter(isTable).map(getTableName));
const viewNames = new Set<string>();
const receptionView = "V_ConfirmarRecepcionPedidoView";
const saleView = "V_RegistrarVentaView";

const channels: Record<string, { rf: string; cu: string; view: string }> = {
  "pedido:listar": { rf: "RF18", cu: "CU18", view: receptionView },
  "pedido:detalle": { rf: "RF18", cu: "CU18", view: receptionView },
  "pedido:confirmar-recepcion": { rf: "RF18", cu: "CU18", view: receptionView },
  "venta:verificar-caja": { rf: "RF36", cu: "CU36", view: saleView },
  "venta:producto": { rf: "RF36", cu: "CU36", view: saleView },
  "venta:validar-carrito": { rf: "RF36", cu: "CU36", view: saleView },
  "venta:registrar": { rf: "RF36", cu: "CU36", view: saleView },
};

function activeContext(): TraceContext | undefined {
  return process.env.HUASCAR_DEMO === "1" ? context.getStore() : undefined;
}

export function demoOutput(message: string): void {
  try { console.log(message); } catch {}
}

export function logDemoViewStep(step: unknown): void {
  if (process.env.HUASCAR_DEMO !== "1" || !isDemoViewStep(step)) return;
  const [cu, source, message] = demoViewSteps[step];
  const view = cu === "CU18" ? receptionView : saleView;
  const actor = "Dueño / Trabajador";
  const path = source === "actor" ? `${actor} → ${view}` : `${view} → ${actor}`;
  demoOutput(`[RF${cu.slice(2)}/${cu} · Vista] ${path}: ${message}`);
}

export function demoTraceStep(target: string, message: string): void {
  const active = activeContext();
  if (!active) return;
  emitStep(active.sequence, active.participant, target, message);
}

function emitStep(sequence: Sequence, source: string, target: string, message: string): void {
  sequence.step += 1;
  demoOutput(`[${sequence.rf}/${sequence.cu} #${sequence.id} · ${String(sequence.step).padStart(2, "0")}] ${source} → ${target}: ${message}`);
}

export function demoRandomUUID(purpose: string): string {
  const active = activeContext();
  if (!active) return randomUUID();
  demoTraceStep("C_cryptoNode", `Generar UUID de ${purpose}`);
  const id = randomUUID();
  emitStep(active.sequence, "C_cryptoNode", active.participant, `UUID de ${purpose} generado`);
  return id;
}

export async function traceDemoRequest<T extends ControllerResponse>(
  channel: string,
  action: () => Promise<T>,
): Promise<T> {
  const definition = channels[channel];
  if (process.env.HUASCAR_DEMO !== "1" || !definition) return action();
  const sequence = { id: ++nextId, rf: definition.rf, cu: definition.cu, step: 0 };
  const dispatcher = definition.cu === "CU18" ? "C_ControlAcceso" : "C_DispatcherControlAcceso";
  return context.run({ sequence, participant: definition.view }, async () => {
    demoTraceStep(dispatcher, channel);
    return context.run({ sequence, participant: dispatcher }, async () => {
      try {
        const response = await action();
        demoTraceStep(definition.view, response.ok ? "Respuesta OK" : `Respuesta rechazada (${response.error.code})`);
        return response;
      } catch (error) {
        demoTraceStep(definition.view, "Error; solicitud no completada");
        throw error;
      }
    });
  });
}

export async function traceDemoCall<T>(
  participant: string,
  message: string,
  action: () => Promise<T>,
): Promise<T> {
  const active = activeContext();
  if (!active) return action();
  demoTraceStep(participant, message);
  return context.run({ ...active, participant }, async () => {
    try {
      const result = await action();
      demoTraceStep(active.participant, `Retorno: ${message}`);
      return result;
    } catch (error) {
      demoTraceStep(active.participant, `Error: ${message}`);
      throw error;
    }
  });
}

export async function traceDemoTransaction<T>(action: () => Promise<T>): Promise<T> {
  demoTraceStep("C_drizzle → C_libsql", "Solicitar transacción");
  try {
    const result = await action();
    demoTraceStep("C_drizzle → C_libsql", "COMMIT completado; cambios confirmados");
    return result;
  } catch (error) {
    demoTraceStep("C_drizzle → C_libsql", "Transacción rechazada; cambios no confirmados");
    throw error;
  }
}

export async function withoutDemoTrace<T>(action: () => PromiseLike<T>): Promise<T> {
  return context.run(undefined, async () => await action());
}

export function demoTraceLabel(): string | undefined {
  const active = activeContext();
  return active ? `${active.sequence.cu} #${active.sequence.id} · ${active.participant}` : undefined;
}

export const demoQueryLogger = {
  logQuery(query: string, _params: unknown[]): void {
    if (!activeContext()) return;
    const { operation, relations } = describeSql(query);
    demoTraceStep(`C_drizzle → C_libsql → ${relations}`, `${operation} solicitado`);
  },
};

function describeSql(query: string): { operation: string; relations: string } {
  const normalized = query.replace(/'(?:''|[^'])*'|--[^\n]*|\/\*[\s\S]*?\*\//g, " ");
  const operation = normalized.trim().match(/^\w+/)?.[0].toUpperCase() ?? "SQL";
  const names = new Set(
    [...normalized.matchAll(/\b(?:from|join|into|update)\s+(?:["`\[]?\w+["`\]]?\s*\.\s*)?["`\[]?([a-z_]\w*)["`\]]?/gi)]
      .map((match) => match[1].toLowerCase()),
  );
  const relations = [...names].flatMap((name) => {
    if (viewNames.has(name)) return [`vista SQL: ${name}`];
    return tableNames.has(name) ? [name] : [];
  });
  return {
    operation: operation === "WITH" ? "SQL con CTE" : operation,
    relations: `[${relations.join(", ") || "sin tablas ni vistas"}]`,
  };
}

export async function loadDemoSqlViews(client: Client): Promise<void> {
  if (process.env.HUASCAR_DEMO !== "1") return;
  viewNames.clear();
  try {
    const { rows } = await client.execute("SELECT name FROM sqlite_schema WHERE type = 'view'");
    for (const { name } of rows) {
      if (typeof name === "string" && /^[a-z_]\w*$/i.test(name)) {
        viewNames.add(name.toLowerCase());
      }
    }
  } catch {
    demoOutput("[Demo] No se pudieron identificar las vistas SQL.");
  }
}

async function traceSqlResult(
  statement: InStatement,
  execute: () => Promise<ResultSet>,
): Promise<ResultSet> {
  const active = activeContext();
  if (!active) return execute();
  const { operation, relations } = describeSql(typeof statement === "string" ? statement : statement.sql);
  try {
    const result = await execute();
    const count = operation === "SELECT" || operation === "SQL con CTE"
      ? `filas devueltas: ${result.rows.length}`
      : `filas afectadas: ${result.rowsAffected}`;
    emitStep(active.sequence, `${relations} → C_libsql → C_drizzle`, active.participant, `${operation} completado (${count})`);
    return result;
  } catch (error) {
    emitStep(active.sequence, "C_libsql → C_drizzle", active.participant, `${operation} rechazado en ${relations}`);
    throw error;
  }
}

function traceTransactionQueries(transaction: Transaction): Transaction {
  return new Proxy(transaction, {
    get(target, key) {
      if (key === "execute") {
        return (statement: InStatement) => traceSqlResult(statement, () => target.execute(statement));
      }
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export function traceDemoDatabase(client: Client): Client {
  if (process.env.HUASCAR_DEMO !== "1") return client;
  return new Proxy(client, {
    get(target, key) {
      if (key === "execute") {
        return (statement: InStatement, args?: InArgs) => traceSqlResult(statement, () =>
          typeof statement === "string" ? target.execute(statement, args) : target.execute(statement),
        );
      }
      if (key === "transaction") {
        return async (mode?: TransactionMode) => {
          const transaction = await target.transaction(mode);
          const active = activeContext();
          if (!active) return transaction;
          emitStep(active.sequence, "C_libsql → C_drizzle", active.participant, "Transacción iniciada");
          return traceTransactionQueries(transaction);
        };
      }
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
