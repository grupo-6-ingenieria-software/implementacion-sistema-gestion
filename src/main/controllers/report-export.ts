import { isReportExportRequest } from "../../shared/monthly-sales";
import type { ControllerHandler, RegisteredController } from "./base";
import { restockReportExportController } from "./restock-report-export";
import { createMonthlySalesExportHandler } from "./monthly-sales-export";
import { PRODUCTS_MOST_SOLD_REPORT_TYPE } from "../../shared/products-most-sold";
import { createProductsMostSoldExportHandler } from "./products-most-sold-export";

export function createReportExportController(
  monthly: ControllerHandler = createMonthlySalesExportHandler(),
  restock: RegisteredController = restockReportExportController,
  productsMostSold: ControllerHandler = createProductsMostSoldExportHandler(),
): RegisteredController {
  return {
    metadata: restock.metadata,
    handle: (payload, context) => {
      if (!isReportExportRequest(context.channel, payload)) return restock.handle(payload, context);
      if ((payload as { tipo?: unknown }).tipo === PRODUCTS_MOST_SOLD_REPORT_TYPE) return productsMostSold(payload, context);
      return monthly(payload, context);
    },
  };
}

export const reportExportController = createReportExportController();
