import { findControllerById } from "../../shared/controllers";
import { db } from "../../db/client";
import {
  controllerError,
  controllerSuccess,
  type RegisteredController,
} from "./BaseControladorAuxiliar";
import {
  loadDailySalesSummary,
  loadDailySaleRows,
  loadDailyCashRegister,
  summarizeDailySales,
  buildCashSummary,
  type DashboardDb,
} from "./ConsultasDashboardAuxiliar";

const metadata = findControllerById("daily-sales-total")!;

export const totalVentasDiaHandler: RegisteredController = {
  metadata,
  handle: async () => {
    try {
      return controllerSuccess(
        await loadDailySalesSummary(db as unknown as DashboardDb),
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

export async function loadSalesIndicator(
  database: DashboardDb,
  now = new Date(),
) {
  const rows = await loadDailySaleRows(database, now);
  const sales = summarizeDailySales(rows);
  const cash = await loadDailyCashRegister(database, now);
  return { sales, cashSummary: buildCashSummary(cash, rows, sales) };
}
