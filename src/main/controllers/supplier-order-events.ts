import { BrowserWindow } from "electron";
import log from "electron-log/main";
import { SUPPLIER_ORDERS_UPDATED_EVENT } from "../../shared/supplier-orders";

export function notifySupplierOrdersUpdated(): void {
  try {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(SUPPLIER_ORDERS_UPDATED_EVENT);
    }
  } catch (error) {
    try {
      log.error("No fue posible notificar la actualización de pedidos.", error);
    } catch (loggingError) {
      process.stderr.write(
        `No fue posible registrar el error de notificación de pedidos: ${String(loggingError)}. Error original: ${String(error)}\n`,
      );
    }
  }
}
