import {
  controllers,
  type ControllerResponse,
  type EanCaptureResponse,
  type EanFailureResponse,
} from "../../shared/controllers";
import { invalidEan13Message, type ProductDetailResponse } from "../../shared/products";
import { isValidEan13 } from "../../shared/ean13";
import { registerAuditEvent } from "./audit-service";
import { queryProductDetailWithExecutor } from "./product-query";
import { controllerError, controllerSuccess, type RegisteredController } from "./base";

type EanReaderDependencies = {
  findProduct: (ean13: string) => Promise<ProductDetailResponse["product"] | null>;
  report: (event: {
    usuarioId: string;
    modulo: string;
    tipoAccion: string;
    descripcion: string;
  }) => Promise<ControllerResponse<EanFailureResponse>>;
};

const dependencies: EanReaderDependencies = {
  findProduct: async (ean13) => {
    const { db, schema } = await import("../../db/client");
    return queryProductDetailWithExecutor(db, schema, ean13, false);
  },
  report: async (event) => {
    const { db, schema } = await import("../../db/client");
    return registerAuditEvent(db, schema, event);
  },
};

// Sigue el patrón de las fábricas de C13 y C16. Las consultas y la auditoría
// permanecen en sus servicios existentes.
export function createEanReaderController(
  deps: EanReaderDependencies = dependencies,
): RegisteredController<unknown, EanCaptureResponse | EanFailureResponse> {
  return {
    metadata: controllers[23],
    handle: async (payload, context) => {
      if (context.channel !== "ean:validar-captura" && context.channel !== "ean:registrar-fallo") {
        return controllerError("INVALID_CHANNEL", `Canal IPC no registrado: ${context.channel}`, "ean-reader");
      }
      if (!context.claims || !["dueno", "trabajador"].includes(context.claims.rol)) {
        return controllerError("FORBIDDEN", "No hay una sesión válida para realizar esta acción.", "ean-reader");
      }
      const input = payload && typeof payload === "object" && !Array.isArray(payload)
        ? payload as Record<string, unknown>
        : {};

      if (context.channel === "ean:registrar-fallo") {
        if (typeof input.modulo !== "string" || !["inventario", "ventas", "proveedores"].includes(input.modulo)) {
          return controllerError("VALIDATION_ERROR", "Debe indicar el módulo de la lectura fallida.", "ean-reader");
        }
        try {
          const result = await deps.report({
            usuarioId: context.claims.usuarioId,
            modulo: input.modulo,
            tipoAccion: "lectura_fallida",
            descripcion: "Lectura fallida reportada por el usuario. Se permite reintentar o ingresar el código manualmente.",
          });
          return result.ok ? result : { ok: false, error: { ...result.error, controllerId: "ean-reader" } };
        } catch {
          return controllerError("DATABASE_ERROR", "No fue posible registrar la lectura fallida. Intente nuevamente.", "ean-reader");
        }
      }

      const ean13 = typeof input.value === "string" ? input.value.trim() : "";
      if (!isValidEan13(ean13)) {
        return {
          ok: false,
          error: {
            code: "VALIDATION_ERROR",
            controllerId: "ean-reader",
            fieldErrors: { ean13: invalidEan13Message },
            message: "Código inválido, intente escanear nuevamente",
          },
        };
      }
      if (input.mode !== undefined && input.mode !== "validar" && input.mode !== "buscar-producto") {
        return controllerError("VALIDATION_ERROR", "Modo de captura inválido.", "ean-reader");
      }
      if (input.mode !== "buscar-producto") return controllerSuccess({ ean13 });

      try {
        const producto = await deps.findProduct(ean13);
        return producto
          ? controllerSuccess({ ean13, producto })
          : controllerError("NOT_FOUND", "Producto no encontrado", "ean-reader");
      } catch {
        return controllerError("DATABASE_ERROR", "No fue posible consultar el producto. Intente nuevamente.", "ean-reader");
      }
    },
  };
}

export const eanReaderController = createEanReaderController();
