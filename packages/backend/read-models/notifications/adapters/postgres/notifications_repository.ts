import { type Kysely, type RawBuilder, sql } from "kysely";
import type { ApplicationDatabase } from "../../../../platform/postgres/database.ts";
import { personDisplayNameSql } from "../../../../platform/postgres/person_display.ts";
import { pickDefined } from "../../../../platform/postgres/rows.ts";
import { MILLISECOND_INSTANT_FORMAT } from "../../../../platform/postgres/timestamps.ts";
import { UNNAMED_PERSON } from "../../../../modules/people/public.ts";
import type {
  NotificationKind,
  NotificationRecord,
  NotificationsActor,
  NotificationsRepository,
} from "../../ports/notifications_repository.ts";

interface FeedRow {
  readonly id: string;
  readonly kind: NotificationKind;
  readonly occurred_at: string;
  readonly person_archived: boolean | null;
  readonly person_id: string | null;
  readonly person_name: string | null;
  readonly subject_id: string | null;
  readonly title: string | null;
}

const PERSON_NAME = sql.raw(personDisplayNameSql(UNNAMED_PERSON, "person"));

/**
 * The member's feed as one union, every arm scoped to the workspace and
 * addressed to the member alone. Each item's time is cut to milliseconds, the
 * precision the read-through watermark is stored at, so an item is never
 * after the watermark that was set from its own time.
 *
 * - Delivered in-app reminders are the member's own occurrences (`member_id`)
 *   of a live reminder in this workspace, timed by when they became visible.
 * - Undeliverable email reminders are `planning.reminder-failed` events on
 *   the email channel whose occurrence is the member's own, of a reminder
 *   that was not deleted.
 * - Finished data jobs are the member's own `export.completed` and
 *   `import.committed` events, and only while the member still holds a role
 *   that may run them (`data.export`, `data.import`).
 * - Accepted invitations are `workspace.member-joined` events for a member
 *   this member invited.
 *
 * A notification about a person who has since been deleted is left out.
 */
function feed(actor: NotificationsActor): RawBuilder<FeedRow> {
  const workspaceId = sql`${actor.workspaceId}::uuid`;
  const memberId = sql`${actor.memberId}::uuid`;
  return sql<FeedRow>`
    select 'reminder' as kind, occurrence.id,
      date_trunc('milliseconds', occurrence.visible_at) as at,
      coalesce(nullif(occurrence.title_snapshot, ''), reminder.title) as title,
      reminder.person_id, null::uuid as subject_id
    from crm.reminder_occurrences occurrence
    join crm.reminders reminder on reminder.id = occurrence.reminder_id
      and reminder.workspace_id = ${workspaceId}
      and reminder.deleted_at is null
    where occurrence.member_id = ${memberId}
      and occurrence.channel = 'in_app'
      and occurrence.status = 'sent'
      and occurrence.visible_at is not null
    union all
    select 'reminder-email-failed', event.id,
      date_trunc('milliseconds', event.occurred_at),
      coalesce(nullif(occurrence.title_snapshot, ''), reminder.title),
      reminder.person_id, null::uuid
    from crm.audit_events event
    join crm.reminder_occurrences occurrence on occurrence.id = event.subject_id
      and occurrence.member_id = ${memberId}
      and occurrence.channel = 'email'
    join crm.reminders reminder on reminder.id = occurrence.reminder_id
      and reminder.workspace_id = ${workspaceId}
      and reminder.deleted_at is null
    where event.workspace_id = ${workspaceId}
      and event.action = 'planning.reminder-failed'
      and event.subject_type = 'reminder_occurrence'
    union all
    select case event.action when 'export.completed' then 'export-ready'
        else 'import-finished' end,
      event.id, date_trunc('milliseconds', event.occurred_at), null,
      null::uuid, event.subject_id
    from crm.audit_events event
    join crm.workspace_members member on member.id = ${memberId}
      and member.workspace_id = ${workspaceId}
      and member.role in ('owner', 'admin')
    where event.workspace_id = ${workspaceId}
      and event.actor_member_id = ${memberId}
      and event.action in ('export.completed', 'import.committed')
    union all
    select 'invitation-accepted', event.id,
      date_trunc('milliseconds', event.occurred_at), null, null::uuid,
      event.subject_id
    from crm.audit_events event
    join crm.workspace_members joined on joined.id = event.subject_id
      and joined.workspace_id = ${workspaceId}
      and joined.invited_by_member_id = ${memberId}
      and joined.id <> ${memberId}
    where event.workspace_id = ${workspaceId}
      and event.action = 'workspace.member-joined'
  `;
}

/** The feed with its people named, and a deleted person's items gone. */
function visible(actor: NotificationsActor) {
  return sql`
    select item.*, person.archived_at is not null as person_archived,
      case when person.id is null then null else ${PERSON_NAME} end
        as person_name
    from (${feed(actor)}) item
    left join crm.people person on person.id = item.person_id
      and person.workspace_id = ${actor.workspaceId}::uuid
    where item.person_id is null
      or (person.id is not null and person.deleted_at is null)
  `;
}

function record(row: FeedRow): NotificationRecord {
  return {
    id: row.id,
    kind: row.kind,
    occurredAt: row.occurred_at,
    ...(row.person_id && row.person_name
      ? {
        person: {
          archived: row.person_archived === true,
          id: row.person_id,
          name: row.person_name,
        },
      }
      : {}),
    ...pickDefined({ subjectId: row.subject_id, title: row.title }),
  };
}

export class PostgresNotificationsRepository
  implements NotificationsRepository {
  constructor(private readonly database: Kysely<ApplicationDatabase>) {}

  async uiState(actor: NotificationsActor): Promise<unknown> {
    const result = await sql<{ readonly ui_state: unknown }>`
      select preference.ui_state
      from crm.member_preferences preference
      join crm.workspace_members member on member.id = preference.member_id
      where preference.member_id = ${actor.memberId}::uuid
        and member.workspace_id = ${actor.workspaceId}::uuid
    `.execute(this.database);
    return result.rows[0]?.ui_state;
  }

  async list(
    command: Parameters<NotificationsRepository["list"]>[0],
  ): Promise<readonly NotificationRecord[]> {
    const after = command.after
      ? sql`where (visible.at, visible.id) <
          (${command.after.at}::timestamptz, ${command.after.id}::uuid)`
      : sql``;
    const result = await sql<FeedRow>`
      select visible.kind, visible.id::text,
        to_char(visible.at at time zone 'UTC',
          ${sql.lit(MILLISECOND_INSTANT_FORMAT)}) as occurred_at,
        visible.title, visible.person_id::text, visible.person_name,
        visible.person_archived, visible.subject_id::text
      from (${visible(command)}) visible
      ${after}
      order by visible.at desc, visible.id desc
      limit ${command.limit}
    `.execute(this.database);
    return result.rows.map(record);
  }

  async countUnread(
    command: Parameters<NotificationsRepository["countUnread"]>[0],
  ): Promise<number> {
    const since = command.readThrough
      ? sql`where visible.at > ${command.readThrough}::timestamptz`
      : sql``;
    const result = await sql<{ readonly count: number }>`
      select count(*)::int as count from (
        select 1 from (${visible(command)}) visible
        ${since}
        limit ${command.cap}
      ) unread
    `.execute(this.database);
    return result.rows[0]?.count ?? 0;
  }
}
