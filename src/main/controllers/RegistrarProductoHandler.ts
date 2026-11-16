import { findControllerById } from "../../shared/controllers";
import {
  createProductWriteController,
  normalizeCreatePayload,
  productCreateDependencies,
} from "./EscrituraProductoAuxiliar";

export const registrarProductoHandler = createProductWriteController({
  channel: "producto:registrar",
  controllerId: "product-create",
  dependencies: productCreateDependencies,
  metadata: findControllerById("product-create")!,
  normalize: normalizeCreatePayload,
});
