import { controllers } from '../../shared/controllers';
import {
  createProductWriteController,
  normalizeEditPayload,
  productEditDependencies,
  validateEditPayload,
} from './product-write';

export const productEditController = createProductWriteController({
  channel: 'producto:editar',
  controllerId: 'product-edit',
  dependencies: productEditDependencies,
  metadata: controllers[10],
  normalize: normalizeEditPayload,
  validate: validateEditPayload,
});
