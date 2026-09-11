import type { DashboardData, DashboardRequest } from "../../shared/dashboard";
import { loadStockIndicator } from "./stock-alert";
import { loadExpirationIndicator } from "./expiration-alert";
import { loadSalesIndicator } from "./daily-sales-total";
import { loadAttendanceIndicator } from "./attendance-summary";
import { type DashboardDb } from "./dashboard-queries";
export * from "./dashboard-queries";

export const dashboardOperations = {
  stock: loadStockIndicator,
  expiration: loadExpirationIndicator,
  sales: loadSalesIndicator,
  attendance: loadAttendanceIndicator,
};

export async function loadDashboardData(
  database: DashboardDb,
  request: DashboardRequest,
  now = new Date(),
  operations = dashboardOperations,
): Promise<DashboardData> {
  const stockAlerts = await operations.stock(database);
  const expirationAlerts = await operations.expiration(database, now);
  const { sales, cashSummary } = await operations.sales(database, now);
  const attendance = await operations.attendance(database, request, now);
  return {
    generatedAt: now.toISOString(),
    sales,
    cashSummary,
    stockAlerts,
    expirationAlerts,
    attendance,
  };
}
