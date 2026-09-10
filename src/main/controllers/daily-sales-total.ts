import { controllers } from '../../shared/controllers';
import { db } from '../../db/client';
import { controllerError, controllerSuccess, type RegisteredController } from './base';
import { loadDailySalesSummary, loadDailySaleRows, loadDailyCashRegister, summarizeDailySales, buildCashSummary, type DashboardDb } from './dashboard-queries';

const metadata = controllers[8];

export const dailySalesTotalController: RegisteredController = {
  metadata,
  handle: async () => {
    try {
      return controllerSuccess(
        await loadDailySalesSummary(db as unknown as DashboardDb),
      );
    } catch (error) {
      console.error(error);
      return controllerError(
        'TECHNICAL_ERROR',
        'No fue posible cargar la informacion solicitada.',
        metadata.id,
      );
    }
  },
};

/** C09: ventas y caja a partir de las mismas líneas históricas. */
export async function loadSalesIndicator(database: DashboardDb, now = new Date()) {
  const rows = await loadDailySaleRows(database, now);
  const sales = summarizeDailySales(rows);
  const cash = await loadDailyCashRegister(database, now);
  return { sales, cashSummary: buildCashSummary(cash, rows, sales) };
}
