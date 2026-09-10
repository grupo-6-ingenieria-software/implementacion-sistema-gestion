import { controllers } from "../../shared/controllers";
import {
  createProductWriteController,
  normalizeCreatePayload,
  productCreateDependencies,
} from "./product-write";

export const productCreateController = createProductWriteController({
  channel: "producto:registrar",
  controllerId: "product-create",
  dependencies: productCreateDependencies,
  metadata: controllers[9],
  normalize: normalizeCreatePayload,
});
