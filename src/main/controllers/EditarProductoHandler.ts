import { findControllerById } from "../../shared/controllers";
import {
  createProductWriteController,
  normalizeEditPayload,
  productEditDependencies,
} from "./EscrituraProductoAuxiliar";

export const editarProductoHandler = createProductWriteController({
  channel: "producto:editar",
  controllerId: "product-edit",
  dependencies: productEditDependencies,
  metadata: findControllerById("product-edit")!,
  normalize: normalizeEditPayload,
});
