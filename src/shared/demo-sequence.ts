export const DEMO_VIEW_STEP_CHANNEL = "demo:paso-vista";

export const demoViewSteps = {
  receptionOpened: ["CU18", "actor", "Abre Recepciones e historial de pedidos"],
  ordersShown: ["CU18", "view", "Muestra los pedidos por estado"],
  orderSelected: ["CU18", "actor", "Selecciona un pedido"],
  orderShown: ["CU18", "view", "Muestra cantidades solicitadas, recibidas, pendientes e historial"],
  deliveryFormShown: ["CU18", "view", "Habilita la entrega con cantidad, costo y vencimiento"],
  receptionSubmitted: ["CU18", "actor", "Confirma las cantidades y datos de esta entrega"],
  receptionShown: ["CU18", "view", "Muestra el resultado de la recepción y recarga los saldos"],
  saleOpened: ["CU36", "actor", "Abre Registrar venta"],
  saleReady: ["CU36", "view", "Habilita el buscador, el campo EAN-13 y el carrito"],
  productSearched: ["CU36", "actor", "Busca un producto por nombre"],
  productScanned: ["CU36", "actor", "Ingresa o escanea un EAN-13"],
  eanAccepted: ["CU36", "view", "Acepta el formato EAN-13"],
  eanRejected: ["CU36", "view", "Rechaza el formato EAN-13"],
  productsShown: ["CU36", "view", "Muestra el resultado de productos con precio y stock"],
  quantityEntered: ["CU36", "actor", "Ingresa una cantidad para el carrito"],
  cartShown: ["CU36", "view", "Actualiza el carrito validado, subtotal y total"],
  paymentSelected: ["CU36", "actor", "Selecciona el método de pago"],
  saleSubmitted: ["CU36", "actor", "Confirma el registro de la venta"],
  saleShown: ["CU36", "view", "Muestra la confirmación con total y método de pago"],
} as const;

export type DemoViewStep = keyof typeof demoViewSteps;

export function isDemoViewStep(value: unknown): value is DemoViewStep {
  return typeof value === "string" && Object.hasOwn(demoViewSteps, value);
}
