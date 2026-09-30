import { isReportExportRequest } from "../../shared/monthly-sales";
import type { ControllerHandler, RegisteredController } from "./base";
import { restockReportExportController } from "./restock-report-export";
import { createMonthlySalesExportHandler } from "./monthly-sales-export";

export function createReportExportController(
  monthly: ControllerHandler = createMonthlySalesExportHandler(),
  restock: RegisteredController = restockReportExportController,
): RegisteredController {
  return {
    metadata: restock.metadata,
    handle: (payload, context) => isReportExportRequest(context.channel, payload)
      ? monthly(payload, context)
      : restock.handle(payload, context),
  };
}

export const reportExportController = createReportExportController();
