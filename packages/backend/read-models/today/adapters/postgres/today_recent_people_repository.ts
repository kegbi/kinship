import { type Kysely, sql } from "kysely";
import type { ApplicationDatabase } from "../../../../platform/postgres/database.ts";
import { personDisplayNameSql } from "../../../../platform/postgres/person_display.ts";
import { UNNAMED_PERSON } from "../../../../modules/people/public.ts";
import type { TodayRecentPeopleRepository } from "../../application/get_today_recent_people.ts";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function idsFromUiState(value: unknown, limit: number): readonly string[] {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [];
  }
  const candidate = (value as Record<string, unknown>).recentPersonIds;
  if (!Array.isArray(candidate)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (let index = 0; index < candidate.length && ids.length < limit; index++) {
    const value = candidate[index];
    if (typeof value !== "string" || !UUID.test(value)) continue;
    const id = value.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export class PostgresTodayRecentPeopleRepository
  implements TodayRecentPeopleRepository {
  constructor(private readonly database: Kysely<ApplicationDatabase>) {}

  async list(command: Parameters<TodayRecentPeopleRepository["list"]>[0]) {
    return await this.database.transaction().setIsolationLevel(
      "repeatable read",
    )
      .execute(async (transaction) => {
        const context = await sql<{ readonly uiState: unknown }>`
          select preference.ui_state as "uiState"
          from crm.member_preferences preference
          where preference.member_id = ${command.memberId}::uuid
        `.execute(transaction);
        const ids = idsFromUiState(context.rows[0]?.uiState, command.limit);
        if (ids.length === 0) {
          return { people: [], status: "ready" as const };
        }
        // The ids are typed, not the column, so each is one probe of the
        // people key rather than a scan of the workspace (BEQ-13).
        const result = await sql<{
          readonly archived: boolean;
          readonly id: string;
          readonly name: string;
        }>`
          select person.id::text, person.archived_at is not null as archived,
            ${sql.raw(personDisplayNameSql(UNNAMED_PERSON, "person"))} as name
          from unnest(array[${sql.join(ids.map((id) => sql`${id}`))}]::uuid[])
            with ordinality as recent(person_id, position)
          join crm.people person on person.id = recent.person_id
            and person.workspace_id = ${command.workspaceId}::uuid
          where person.deleted_at is null
          order by recent.position
          limit ${command.limit}
        `.execute(transaction);
        return { people: result.rows, status: "ready" as const };
      });
  }
}
