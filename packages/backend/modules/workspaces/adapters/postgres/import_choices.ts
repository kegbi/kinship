import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type { ImportChoicesBoundary } from "../../ports/import_choices.ts";
export class PostgresImportChoicesBoundary implements ImportChoicesBoundary {
  async options(c: Parameters<ImportChoicesBoundary["options"]>[0]) {
    const db = databaseFromSession(c.transaction);
    const currencies = await sql<
      { code: string }
    >`select code::text from crm.currencies where is_active order by code for share`
      .execute(db);
    const genders = await sql<
      { id: string; name: string; archived: boolean }
    >`select id::text,name,is_archived as archived from crm.gender_options where workspace_id=${c.workspaceId}::uuid order by sort_order,name for share`
      .execute(db);
    return {
      currencies: currencies.rows.map((r) => r.code),
      genders: genders.rows,
    };
  }
  async setTimezone(c: Parameters<ImportChoicesBoundary["setTimezone"]>[0]) {
    const result =
      await sql`insert into crm.member_preferences(member_id,timezone) select id,${c.timezone} from crm.workspace_members where id=${c.memberId}::uuid and workspace_id=${c.workspaceId}::uuid on conflict(member_id) do update set timezone=excluded.timezone,updated_at=now() returning member_id`
        .execute(databaseFromSession(c.transaction));
    if (!result.rows.length) {
      throw new Error("Importing member is outside the workspace.");
    }
  }
}
