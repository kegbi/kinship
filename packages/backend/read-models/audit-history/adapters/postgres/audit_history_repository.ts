import { sql } from "kysely";
import type { Kysely } from "kysely";
import type { ApplicationDatabase } from "../../../../platform/postgres/database.ts";
import { personDisplayNameSql } from "../../../../platform/postgres/person_display.ts";
import { pickDefined } from "../../../../platform/postgres/rows.ts";
import { instantColumn } from "../../../../platform/postgres/timestamps.ts";
import { UNNAMED_PERSON } from "../../../../modules/people/public.ts";
import type {
  AuditHistoryRepository,
  AuditHistoryRepositoryItem,
} from "../../application/list_audit_history.ts";

interface ContextRow {
  readonly person_archived_at: Date | null;
  readonly person_id: string | null;
  readonly person_name: string | null;
  readonly valid_actor: boolean;
}

interface AuditRow {
  readonly action: string;
  readonly actor_id: string | null;
  readonly actor_name: string;
  readonly id: string;
  readonly occurred_at: string;
  readonly payload: unknown;
  readonly person_id: string | null;
  readonly person_name: string | null;
  readonly subject_id: string | null;
  readonly subject_type: string | null;
}

function payload(value: unknown): Readonly<Record<string, unknown>> {
  const parsed = typeof value === "string"
    ? (() => {
      try {
        return JSON.parse(value) as unknown;
      } catch {
        return undefined;
      }
    })()
    : value;
  return parsed !== null && typeof parsed === "object" &&
      !Array.isArray(parsed)
    ? parsed as Readonly<Record<string, unknown>>
    : {};
}

function mapItem(row: AuditRow): AuditHistoryRepositoryItem {
  return {
    action: row.action,
    actor: {
      ...pickDefined({ id: row.actor_id }),
      name: row.actor_name,
    },
    id: row.id,
    occurredAt: row.occurred_at,
    payload: payload(row.payload),
    ...(row.person_id && row.person_name
      ? { person: { id: row.person_id, name: row.person_name } }
      : {}),
    subject: {
      ...pickDefined({ id: row.subject_id, type: row.subject_type }),
    },
  };
}

export class PostgresAuditHistoryRepository implements AuditHistoryRepository {
  constructor(private readonly database: Kysely<ApplicationDatabase>) {}

  async list(
    command: Parameters<AuditHistoryRepository["list"]>[0],
  ): Promise<Awaited<ReturnType<AuditHistoryRepository["list"]>>> {
    const context = await sql<ContextRow>`
      select exists (
        select 1 from crm.workspace_members member
        join crm.workspaces workspace on workspace.id = member.workspace_id
        where member.user_id = ${command.userId}::uuid
          and member.id = ${command.memberId}::uuid
          and member.workspace_id = ${command.workspaceId}::uuid
          and member.role = ${command.role}
          and member.role in ('owner', 'admin')
          and member.status = 'active' and member.left_at is null
          and workspace.id = ${command.workspaceId}::uuid
          and workspace.status = 'active' and workspace.deleted_at is null
      ) as valid_actor,
      person.id::text as person_id,
      ${sql.raw(personDisplayNameSql(UNNAMED_PERSON, "person"))} as person_name,
      person.archived_at as person_archived_at
      from (values (true)) seed(value)
      left join crm.people person
        on person.id = ${command.personId ?? null}::uuid
        and person.workspace_id = ${command.workspaceId}::uuid
        and person.deleted_at is null
    `.execute(this.database);
    const resolved = context.rows[0];
    if (!resolved?.valid_actor) return { status: "forbidden" };
    if (command.personId && (!resolved.person_id || !resolved.person_name)) {
      return { status: "not-found" };
    }

    if (command.actorMemberId) {
      const actorScope = await sql<{ readonly valid: boolean }>`
        select exists (select 1 from crm.workspace_members
          where id = ${command.actorMemberId}::uuid
            and workspace_id = ${command.workspaceId}::uuid) as valid
      `.execute(this.database);
      if (!actorScope.rows[0]?.valid) return { status: "not-found" };
    }

    if (command.after) {
      const anchor = await sql<{ readonly valid: boolean }>`
        select exists (select 1 from crm.audit_events event
          where event.id = ${command.after.id}::uuid
            and event.workspace_id = ${command.workspaceId}::uuid
            and event.occurred_at = ${command.after.timestamp}::timestamptz
            and (${command.personId ?? null}::uuid is null
              or event.person_id = ${command.personId ?? null}::uuid)
            and (${command.actorMemberId ?? null}::uuid is null
              or event.actor_member_id = ${command.actorMemberId ?? null}::uuid)
            and (${command.action ?? null}::text is null
              or event.action = ${command.action ?? null})
            and (${command.from ?? null}::timestamptz is null
              or event.occurred_at >= ${command.from ?? null}::timestamptz)
            and (${command.to ?? null}::timestamptz is null
              or event.occurred_at < ${command.to ?? null}::timestamptz)
        ) as valid
      `.execute(this.database);
      if (!anchor.rows[0]?.valid) return { status: "stale-cursor" };
    }

    const result = await sql<AuditRow>`
      select event.id::text, event.action, event.payload,
        ${instantColumn("event.occurred_at")} as occurred_at,
        event.actor_member_id::text as actor_id,
        coalesce(nullif(event.actor_name_snapshot, ''),
          case when event.actor_member_id is null then 'System'
            else 'Workspace member ' || event.actor_member_id::text end
        ) as actor_name,
        event.person_id::text as person_id,
        case when event.person_id is null then null else coalesce(
          nullif(trim(concat_ws(' ', nullif(person.given_name, ''), person.family_name)), ''),
          nullif(person.nickname, ''), 'Deleted person'
        ) end as person_name,
        event.subject_type, event.subject_id::text
      from crm.audit_events event
      left join crm.people person on person.id = event.person_id
        and person.workspace_id = event.workspace_id
      where event.workspace_id = ${command.workspaceId}::uuid
        and (${command.personId ?? null}::uuid is null
          or event.person_id = ${command.personId ?? null}::uuid)
        and (${command.actorMemberId ?? null}::uuid is null
          or event.actor_member_id = ${command.actorMemberId ?? null}::uuid)
        and (${command.action ?? null}::text is null
          or event.action = ${command.action ?? null})
        and (${command.from ?? null}::timestamptz is null
          or event.occurred_at >= ${command.from ?? null}::timestamptz)
        and (${command.to ?? null}::timestamptz is null
          or event.occurred_at < ${command.to ?? null}::timestamptz)
        ${
      command.after
        ? sql`and (event.occurred_at, event.id) <
          (${command.after.timestamp}::timestamptz, ${command.after.id}::uuid)`
        : sql``
    }
      order by event.occurred_at desc, event.id desc
      limit ${command.limit + 1}
    `.execute(this.database);
    const visible = result.rows.slice(0, command.limit);
    const final = visible.at(-1);
    return {
      items: visible.map(mapItem),
      ...(result.rows.length > command.limit && final
        ? { next: { id: final.id, timestamp: final.occurred_at } }
        : {}),
      ...(resolved.person_id && resolved.person_name
        ? { person: { id: resolved.person_id, name: resolved.person_name } }
        : {}),
      status: resolved.person_archived_at ? "archived" : "ready",
    };
  }
}
