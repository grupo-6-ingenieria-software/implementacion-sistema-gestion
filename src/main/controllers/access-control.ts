import { controllers, type ControllerResponse } from "../../shared/controllers";
import {
  findNavNodeByPath,
  navGroupLabels,
  type Role,
} from "../../shared/navigation";
import { db, schema as appSchema } from "../../db/client";
import {
  controllerError,
  controllerSuccess,
  type RegisteredController,
} from "./base";
import { registerAuditLog } from "./auth-context";
import { verifySessionToken, type SessionTokenClaims } from "./auth-jwt";

type SchemaLike = typeof import("../../db/schema");
type AccessExecutor = Pick<typeof db, "select" | "insert">;

export type ValidateAccessPayload = {
  token?: string;

  __authToken?: string;
  __rolSesion?: string;
  ruta?: string;
};

export type ValidateAccessData = {
  allowed: boolean;
  role: Role;
};

export type AccessControlDeps = {
  verifyToken: (token: unknown) => SessionTokenClaims | null;
};

const defaultDeps: AccessControlDeps = {
  verifyToken: verifySessionToken,
};

export async function validateAccessWithExecutor(
  database: AccessExecutor,
  schema: SchemaLike,
  payload: unknown,
  deps: AccessControlDeps = defaultDeps,
): Promise<ControllerResponse<ValidateAccessData>> {
  const input = payload as ValidateAccessPayload | null;
  const ruta = typeof input?.ruta === "string" ? input.ruta.trim() : "";

  const claims = deps.verifyToken(input?.token ?? input?.__authToken);

  if (!claims) {
    return controllerError(
      "FORBIDDEN",
      "No hay una sesión válida para validar el acceso.",
      "access-control",
    );
  }

  if (!ruta) {
    return controllerError(
      "VALIDATION_ERROR",
      "No se indicó la ruta a validar.",
      "access-control",
    );
  }

  const node = findNavNodeByPath(ruta);

  if (!node) {
    return controllerError(
      "NOT_FOUND",
      "La ruta solicitada no existe.",
      "access-control",
    );
  }

  const rolSesion: Role | undefined =
    input?.__rolSesion === "dueno" || input?.__rolSesion === "trabajador"
      ? input.__rolSesion
      : undefined;
  const rolEfectivo = rolSesion ?? claims.rol;
  const allowed = (node.roles as readonly Role[]).includes(rolEfectivo);

  if (!allowed) {
    await registerAuditLog(database, schema, {
      descripcion: `Acceso denegado a ${node.label} para el rol ${rolEfectivo}.`,
      modulo: "control_acceso",
      tipoAccion: "acceso_denegado",
      usuarioId: claims.usuarioId,
    });

    return controllerError(
      "FORBIDDEN",
      "No tiene permiso para acceder a este módulo.",
      "access-control",
    );
  }

  await registerAuditLog(database, schema, {
    descripcion: `Acceso concedido a ${node.label}.`,
    modulo: navGroupLabels[node.group].toLocaleLowerCase("es"),
    tipoAccion: "acceso_concedido",
    usuarioId: claims.usuarioId,
  });

  return controllerSuccess<ValidateAccessData>({
    allowed: true,
    role: rolEfectivo,
  });
}

export function createAccessControlController(
  deps: Partial<AccessControlDeps> = {},
): RegisteredController<ValidateAccessPayload, ValidateAccessData> {
  const resolved: AccessControlDeps = { ...defaultDeps, ...deps };

  return {
    metadata: controllers[2],
    handle: (payload) =>
      validateAccessWithExecutor(db, appSchema, payload, resolved),
  };
}

export const accessControlController = createAccessControlController();
