import { isReportExportRequest } from "../../shared/reports";
import type { ControllerHandler, RegisteredController } from "./base";
import { restockReportExportController } from "./restock-report-export";
import { createReportExportHandler } from "./report-export-service";

export function createReportExportController(
  reports: ControllerHandler = createReportExportHandler(),
  restock: RegisteredController = restockReportExportController,
): RegisteredController {
  return {
    metadata: restock.metadata,
    handle: (payload, context) => isReportExportRequest(context.channel, payload)
      ? reports(payload, context)
      : restock.handle(payload, context),
  };
}

export const reportExportController = createReportExportController();
