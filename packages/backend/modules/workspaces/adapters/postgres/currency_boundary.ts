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
}
