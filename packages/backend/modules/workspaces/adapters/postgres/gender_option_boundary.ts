import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";

/**
 * The workspace gender vocabulary a person's identity refers to (GAP-047),
 * read in PostgreSQL. The option row is held `for key share` until the
 * transaction ends, so it cannot be deleted under the edit that chose it.
 */
export class PostgresGenderOptionBoundary {
  async inspect(command: {
    readonly genderOptionId: string;
    readonly transaction: { readonly opaque: unknown };
    readonly workspaceId: string;
  }): Promise<
    | { readonly status: "not-found" }
    | { readonly archived: boolean; readonly status: "ready" }
  > {
    const option = (await sql<{ readonly is_archived: boolean }>`
      select is_archived from crm.gender_options
      where id = ${command.genderOptionId}::uuid
        and workspace_id = ${command.workspaceId}::uuid
      for key share
    `.execute(databaseFromSession(command.transaction))).rows[0];
    return option
      ? { archived: option.is_archived, status: "ready" }
      : { status: "not-found" };
  }
}
