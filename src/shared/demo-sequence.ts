export const DEMO_VIEW_STEP_CHANNEL = "demo:paso-vista";

/** `actor`: actor → vista; `self`: la vista se valida a sí misma; `view`: vista → actor. */
export const demoViewSteps = {
  receptionOpened: ["CU18", "actor", "Abre Recepciones e historial de pedidos"],
  ordersShown: ["CU18", "view", "Mostrar pedidos pendientes, parciales y terminados"],
  orderSelected: ["CU18", "actor", "Selecciona un pedido"],
  orderShown: ["CU18", "view", "Mostrar solicitado, recibido, pendiente e historial"],
  deliveryFormShown: ["CU18", "view", "Pedir cantidad, costo y vencimiento de esta entrega"],
  receptionSubmitted: ["CU18", "actor", "Ingresa esta entrega y confirma"],
  receptionShown: ["CU18", "view", "Mostrar éxito y saldos actualizados"],
  saleOpened: ["CU36", "actor", "Selecciona Registrar venta"],
  saleReady: ["CU36", "view", "Mostrar campo EAN-13, buscador y carrito vacío"],
  productSearched: ["CU36", "actor", "Busca el producto por nombre"],
  productScanned: ["CU36", "actor", "Escanea o ingresa el EAN-13"],
  eanAccepted: ["CU36", "self", "Validar formato EAN-13: correcto"],
  eanRejected: ["CU36", "self", "Validar formato EAN-13: inválido"],
  productsShown: ["CU36", "view", "Mostrar producto con precio y stock"],
  quantityEntered: ["CU36", "actor", "Ingresa la cantidad"],
  cartShown: ["CU36", "view", "Mostrar carrito con subtotal y total"],
  paymentSelected: ["CU36", "actor", "Selecciona el método de pago"],
  saleSubmitted: ["CU36", "actor", "Confirma la venta"],
  saleShown: ["CU36", "view", "Mostrar confirmación con total y método de pago"],
} as const;

export type DemoViewStep = keyof typeof demoViewSteps;

export function isDemoViewStep(value: unknown): value is DemoViewStep {
  return typeof value === "string" && Object.hasOwn(demoViewSteps, value);
}
