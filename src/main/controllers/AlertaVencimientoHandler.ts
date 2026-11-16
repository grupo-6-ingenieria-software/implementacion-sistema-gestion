import { findControllerById } from "../../shared/controllers";
import { db } from "../../db/client";
import {
  controllerError,
  controllerSuccess,
  type RegisteredController,
} from "./BaseControladorAuxiliar";
import { loadExpirationAlerts, type DashboardDb } from "./ConsultasDashboardAuxiliar";

const metadata = findControllerById("expiration-alert")!;

export const alertaVencimientoHandler: RegisteredController = {
  metadata,
  handle: async () => {
    try {
      return controllerSuccess(
        await loadExpirationIndicator(db as unknown as DashboardDb),
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

export const loadExpirationIndicator = loadExpirationAlerts;
