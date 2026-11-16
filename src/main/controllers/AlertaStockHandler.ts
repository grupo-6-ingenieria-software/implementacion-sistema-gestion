import { findControllerById } from "../../shared/controllers";
import { db } from "../../db/client";
import {
  controllerError,
  controllerSuccess,
  type RegisteredController,
} from "./BaseControladorAuxiliar";
import { loadStockAlerts, type DashboardDb } from "./ConsultasDashboardAuxiliar";

const metadata = findControllerById("stock-alert")!;

export const alertaStockHandler: RegisteredController = {
  metadata,
  handle: async () => {
    try {
      return controllerSuccess(
        await loadStockIndicator(db as unknown as DashboardDb),
      );
    } catch (error) {
      console.error(error);
      return controllerError(
        "TECHNICAL_ERROR",
        "No fue posible cargar la informacion solicitada.",
        metadata.id,
      );
    }
  },
};

export const loadStockIndicator = loadStockAlerts;
