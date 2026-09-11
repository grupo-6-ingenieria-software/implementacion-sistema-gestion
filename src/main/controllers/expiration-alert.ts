import { controllers } from "../../shared/controllers";
import { db } from "../../db/client";
import {
  controllerError,
  controllerSuccess,
  type RegisteredController,
} from "./base";
import { loadExpirationAlerts, type DashboardDb } from "./dashboard-queries";

const metadata = controllers[7];

export const expirationAlertController: RegisteredController = {
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
