/**
 * Activity-report composition. Only a declared composition root imports it.
 */

import type { SharedComposition } from "../../platform/composition.ts";
import { PostgresActivityReportRepository } from "./adapters/postgres/activity_report_repository.ts";
import { createActivityReport } from "./public.ts";

export function composeActivityReport(shared: SharedComposition) {
  return createActivityReport({
    actors: shared.actors,
    repository: new PostgresActivityReportRepository(shared.database),
    transaction: shared.peopleTransaction,
  });
}
