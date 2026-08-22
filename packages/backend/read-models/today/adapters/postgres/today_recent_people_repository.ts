import { type Kysely, sql } from "kysely";
import type { ApplicationDatabase } from "../../../../platform/postgres/database.ts";
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
          from crm.users account
          join crm.workspace_members member on member.user_id = account.id
          join crm.workspaces workspace on workspace.id = member.workspace_id
          left join crm.member_preferences preference on preference.member_id = member.id
          where account.id = ${command.userId}::uuid
            and account.status = 'active' and account.deleted_at is null
            and member.id = ${command.memberId}::uuid
            and member.workspace_id = ${command.workspaceId}::uuid
            and member.role = ${command.role}
            and member.status = 'active' and member.left_at is null
            and workspace.id = ${command.workspaceId}::uuid
            and workspace.status = 'active' and workspace.deleted_at is null
        `.execute(transaction);
        if (context.rows.length === 0) return { status: "forbidden" as const };
        const ids = idsFromUiState(context.rows[0]?.uiState, command.limit);
        if (ids.length === 0) {
          return { people: [], status: "ready" as const };
        }
        const result = await sql<{
          readonly archived: boolean;
          readonly id: string;
          readonly name: string;
        }>`
          select person.id::text, person.archived_at is not null as archived,
            coalesce(
              nullif(trim(concat_ws(' ', nullif(person.given_name, ''), person.family_name)), ''),
              nullif(person.nickname, ''),
              'Unnamed person'
            ) as name
          from unnest(array[${sql.join(ids.map((id) => sql`${id}`))}]::text[])
            with ordinality as recent(person_id, position)
          join crm.people person on person.id::text = recent.person_id
            and person.workspace_id = ${command.workspaceId}::uuid
          where person.deleted_at is null
          order by recent.position
          limit ${command.limit}
        `.execute(transaction);
        return { people: result.rows, status: "ready" as const };
      });
  }
}
