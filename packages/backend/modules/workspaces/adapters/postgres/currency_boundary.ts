import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type { WorkspaceCurrencyBoundary } from "../../ports/currency_boundary.ts";

export class PostgresWorkspaceCurrencyBoundary
  implements WorkspaceCurrencyBoundary {
  async isSupported(
    command: Parameters<WorkspaceCurrencyBoundary["isSupported"]>[0],
  ): Promise<boolean> {
    const result = await sql<{ readonly supported: boolean }>`
      select true as supported from crm.currencies
      where code = ${command.code} and is_active = true
      for share
    `.execute(databaseFromSession(command.transaction));
    return result.rows[0]?.supported === true;
  }

  async listSupported(
    command: Parameters<WorkspaceCurrencyBoundary["listSupported"]>[0],
  ): Promise<readonly string[]> {
    const result = await sql<{ readonly code: string }>`
      select code::text from crm.currencies
      where is_active = true order by code
    `.execute(databaseFromSession(command.transaction));
    return result.rows.map((row) => row.code);
  }

  async preferredFor(
    command: Parameters<WorkspaceCurrencyBoundary["preferredFor"]>[0],
  ): Promise<string | undefined> {
    const result = await sql<{ readonly code: string | null }>`
      select coalesce(
        (select currency.code from crm.member_preferences preference
          join crm.currencies currency
            on currency.code = preference.currency_code and currency.is_active
          where preference.member_id = ${command.memberId}::uuid),
        (select currency.code from crm.workspace_settings setting
          join crm.currencies currency
            on currency.code = setting.default_currency_code
            and currency.is_active
          where setting.workspace_id = ${command.workspaceId}::uuid)
      )::text as code
    `.execute(databaseFromSession(command.transaction));
    return result.rows[0]?.code ?? undefined;
  }
}
