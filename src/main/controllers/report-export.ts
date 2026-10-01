import { isReportExportRequest } from "../../shared/monthly-sales";
import type { ControllerHandler, RegisteredController } from "./base";
import { restockReportExportController } from "./restock-report-export";
import { createMonthlySalesExportHandler } from "./monthly-sales-export";
import { CATEGORY_PROFITABILITY_REPORT_TYPE } from "../../shared/category-profitability";
import { createCategoryProfitabilityExportHandler } from "./category-profitability-export";

export function createReportExportController(
  monthly: ControllerHandler = createMonthlySalesExportHandler(),
  restock: RegisteredController = restockReportExportController,
  profitability: ControllerHandler = createCategoryProfitabilityExportHandler(),
): RegisteredController {
  return {
    metadata: restock.metadata,
    handle: (payload, context) => {
      if (!isReportExportRequest(context.channel, payload)) return restock.handle(payload, context);
      if ((payload as { tipo: unknown }).tipo === CATEGORY_PROFITABILITY_REPORT_TYPE) return profitability(payload, context);
      return monthly(payload, context);
    },
  };
}

export const reportExportController = createReportExportController();
