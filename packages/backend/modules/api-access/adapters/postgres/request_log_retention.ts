import { type Kysely, sql } from "kysely";
import type { ApplicationDatabase } from "../../../../platform/postgres/database.ts";
import type {
  RequestLogRetentionBatch,
  RequestLogRetentionRepository,
} from "../../ports/request_log_retention.ts";
import { AUTHENTICATION_THROTTLE_PATHS } from "../../domain/authentication_throttle.ts";
import { MAIL_BUDGET_PATH_PATTERN } from "./outbound_mail_budget.ts";

const THROTTLED_PATHS = Object.values(AUTHENTICATION_THROTTLE_PATHS);

/**
 * One bounded delete over `api_request_logs_time_idx`, the oldest rows first:
 * a sign-in or MFA throttle row once the throttle no longer reads it, a
 * mail-budget reservation only once its own, longer, retention has passed.
 * No other row is deleted: whatever else the table logs is not read by the
 * throttle or the budget, so their windows say nothing about it.
 */
export class PostgresRequestLogRetention
  implements RequestLogRetentionRepository {
  constructor(private readonly database: Kysely<ApplicationDatabase>) {}

  async deleteExpired(batch: RequestLogRetentionBatch): Promise<number> {
    const deleted = await sql<{ id: string }>`
      delete from crm.api_request_logs
      where id in (
        select log.id from crm.api_request_logs log
        where log.occurred_at < ${batch.requestsBefore}
          and (
            (log.method = 'POST' and log.path = any(${THROTTLED_PATHS}::text[]))
            or (
              log.path like ${MAIL_BUDGET_PATH_PATTERN}
              and log.occurred_at < ${batch.mailBudgetBefore}
            )
          )
        order by log.occurred_at
        limit ${batch.limit}
      )
      returning id
    `.execute(this.database);
    return deleted.rows.length;
  }
}
