import { type Kysely, sql } from "kysely";
import type { ApplicationDatabase } from "../../../../platform/postgres/database.ts";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type {
  WorkspaceLifecycleCounts,
  WorkspaceLifecycleRepository,
  WorkspaceLifecycleSecurityAudit,
  WorkspaceLifecycleSnapshot,
} from "../../application/workspace_lifecycle.ts";

interface SnapshotRow extends WorkspaceLifecycleCounts {
  readonly activeSessionCount: number;
  readonly revision: string;
  readonly workspaceName: string;
}

async function impactToken(
  workspaceId: string,
  counts: WorkspaceLifecycleCounts,
  objectKeys: readonly string[],
  revision: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify({
    counts,
    objectKeys: [...objectKeys].sort(),
    revision,
    workspaceId,
  }));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

export class PostgresWorkspaceLifecycleRepository
  implements WorkspaceLifecycleRepository {
  constructor(private readonly database: Kysely<ApplicationDatabase>) {}

  async inspect(
    command: Parameters<WorkspaceLifecycleRepository["inspect"]>[0],
  ): Promise<WorkspaceLifecycleSnapshot | undefined> {
    const database = databaseFromSession(command.transaction);
    if (command.lock) {
      await sql`
        select pg_advisory_xact_lock(hashtextextended(${command.workspaceId}, 7))
      `.execute(database);
    }
    const result = await sql<SnapshotRow>`
      select w.name as "workspaceName",
        (select count(*)::int from crm.workspace_members m
          where m.workspace_id = w.id and m.status <> 'left'
            and m.left_at is null) as members,
        (select count(*)::int from crm.user_sessions s
          where s.user_id in (select member.user_id from crm.workspace_members member
            where member.workspace_id = w.id and member.status <> 'left'
              and member.left_at is null)
            and s.revoked_at is null
            and s.expires_at > now()) as "activeSessionCount",
        md5(jsonb_build_object(
          'workspace', to_jsonb(w),
          'members', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from crm.workspace_members t where t.workspace_id=w.id), '[]'::jsonb),
          'preferences', coalesce((select jsonb_agg(to_jsonb(t) order by t.member_id) from crm.member_preferences t join crm.workspace_members owned on owned.id=t.member_id where owned.workspace_id=w.id), '[]'::jsonb),
          'invitations', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from crm.workspace_invitations t where t.workspace_id=w.id), '[]'::jsonb),
          'settings', coalesce((select jsonb_agg(to_jsonb(t)) from crm.workspace_settings t where t.workspace_id=w.id), '[]'::jsonb),
          'modules', coalesce((select jsonb_agg(to_jsonb(t) order by t.key) from crm.workspace_profile_modules t where t.workspace_id=w.id), '[]'::jsonb),
          'genders', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from crm.gender_options t where t.workspace_id=w.id), '[]'::jsonb),
          'methodTypes', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from crm.contact_method_types t where t.workspace_id=w.id), '[]'::jsonb),
          'contactLabels', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from crm.contact_labels t where t.workspace_id=w.id), '[]'::jsonb),
          'activityCategories', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from crm.activity_type_categories t where t.workspace_id=w.id), '[]'::jsonb),
          'activityTypes', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from crm.activity_types t where t.workspace_id=w.id), '[]'::jsonb),
          'eventCategories', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from crm.life_event_categories t where t.workspace_id=w.id), '[]'::jsonb),
          'eventTypes', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from crm.life_event_types t where t.workspace_id=w.id), '[]'::jsonb),
          'relationshipGroups', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from crm.relationship_type_groups t where t.workspace_id=w.id), '[]'::jsonb),
          'relationshipTypes', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from crm.relationship_types t where t.workspace_id=w.id), '[]'::jsonb)
        )::text) revision
      from crm.workspaces w
      join crm.workspace_members actor on actor.workspace_id = w.id
        and actor.id = ${command.memberId}::uuid
        and actor.user_id = ${command.userId}::uuid
        and actor.role = 'owner' and actor.status = 'active'
        and actor.left_at is null
      where w.id = ${command.workspaceId}::uuid and w.status = 'active'
        and w.deleted_at is null
      ${command.lock ? sql`for update of w, actor` : sql``}
    `.execute(database);
    const row = result.rows[0];
    if (!row) return undefined;
    const counts: WorkspaceLifecycleCounts = {
      activities: 0,
      auditEvents: 0,
      calls: 0,
      debts: 0,
      exports: 0,
      files: 0,
      gifts: 0,
      imports: 0,
      integrations: 0,
      journalPosts: 0,
      lifeEvents: 0,
      members: row.members,
      messages: 0,
      notes: 0,
      operations: 0,
      people: 0,
      relationships: 0,
      reminders: 0,
      tasks: 0,
    };
    const objectKeys: readonly string[] = [];
    return {
      activeSessionCount: row.activeSessionCount,
      counts,
      impactToken: await impactToken(
        command.workspaceId,
        counts,
        objectKeys,
        row.revision,
      ),
      objectKeys,
      workspaceName: row.workspaceName,
    };
  }

  async resetWorkspace(
    command: Parameters<WorkspaceLifecycleRepository["resetWorkspace"]>[0],
  ): Promise<void> {
    const database = databaseFromSession(command.transaction);
    await sql`create temporary table workspace_reset_workspace on commit drop as
      select * from crm.workspaces where id = ${command.workspaceId}::uuid`
      .execute(database);
    await sql`create temporary table workspace_reset_members on commit drop as
      select * from crm.workspace_members where workspace_id = ${command.workspaceId}::uuid`
      .execute(database);
    await sql`create temporary table workspace_reset_preferences on commit drop as
      select preferences.* from crm.member_preferences preferences
      join crm.workspace_members member on member.id = preferences.member_id
      where member.workspace_id = ${command.workspaceId}::uuid`.execute(
      database,
    );
    await sql`create temporary table workspace_reset_settings on commit drop as
      select * from crm.workspace_settings where workspace_id = ${command.workspaceId}::uuid`
      .execute(database);
    await sql`create temporary table workspace_reset_modules on commit drop as
      select * from crm.workspace_profile_modules where workspace_id = ${command.workspaceId}::uuid`
      .execute(database);
    await sql`update crm.user_sessions set revoked_at = coalesce(revoked_at, ${command.occurredAt})
      where user_id in (select user_id from crm.workspace_members
        where workspace_id = ${command.workspaceId}::uuid)`
      .execute(database);
    await sql`insert into crm.workspace_lifecycle_records (
        id, workspace_id, actor_user_id, action, outcome, impact_counts, object_keys,
        cleanup_status, occurred_at, created_at
      ) values (
        ${command.recordId}::uuid, ${command.workspaceId}::uuid,
        ${command.userId}::uuid, 'reset', 'succeeded', ${
      JSON.stringify(command.counts)
    }::text::jsonb,
        ${JSON.stringify(command.objectKeys)}::text::jsonb, 'pending',
        ${command.occurredAt}, ${command.occurredAt}
      )`.execute(database);
    await sql`delete from crm.workspaces where id = ${command.workspaceId}::uuid`
      .execute(database);
    await sql`insert into crm.workspaces select * from workspace_reset_workspace`
      .execute(database);
    await sql`insert into crm.workspace_members
      select id, workspace_id, user_id, role, status, null, null, joined_at,
        left_at, created_at, ${command.occurredAt} from workspace_reset_members`
      .execute(database);
    await sql`insert into crm.member_preferences select * from workspace_reset_preferences`
      .execute(database);
    await sql`insert into crm.workspace_settings
      select workspace_id, default_locale, default_timezone,
        default_currency_code, null, default_reminder_time, ${command.occurredAt}
      from workspace_reset_settings`.execute(database);
    await sql`insert into crm.workspace_profile_modules select * from workspace_reset_modules`
      .execute(database);
  }

  async deleteWorkspace(
    command: Parameters<WorkspaceLifecycleRepository["deleteWorkspace"]>[0],
  ): Promise<void> {
    const database = databaseFromSession(command.transaction);
    await sql`update crm.user_sessions set revoked_at = coalesce(revoked_at, ${command.occurredAt})
      where user_id in (select user_id from crm.workspace_members
        where workspace_id = ${command.workspaceId}::uuid)`
      .execute(database);
    await sql`insert into crm.workspace_lifecycle_records (
        id, workspace_id, actor_user_id, action, outcome, impact_counts, object_keys,
        cleanup_status, occurred_at, created_at
      ) values (
        ${command.recordId}::uuid, ${command.workspaceId}::uuid,
        ${command.userId}::uuid, 'delete', 'succeeded', ${
      JSON.stringify(command.counts)
    }::text::jsonb,
        ${JSON.stringify(command.objectKeys)}::text::jsonb, 'pending',
        ${command.occurredAt}, ${command.occurredAt}
      )`.execute(database);
    const deleted = await sql<{ readonly id: string }>`
      delete from crm.workspaces where id = ${command.workspaceId}::uuid
      returning id::text
    `.execute(database);
    if (!deleted.rows[0]) throw new Error("Active workspace is unavailable.");
  }

  async listPendingCleanups(
    command: Parameters<WorkspaceLifecycleRepository["listPendingCleanups"]>[0],
  ): Promise<
    readonly {
      readonly objectKeys: readonly string[];
      readonly recordId: string;
    }[]
  > {
    const result = await sql<{
      readonly objectKeys: unknown;
      readonly recordId: string;
    }>`select id::text as "recordId", object_keys as "objectKeys"
      from crm.workspace_lifecycle_records where cleanup_status = 'pending'
      order by created_at, id limit ${command.limit}`.execute(this.database);
    return result.rows.map((row) => ({
      objectKeys: Array.isArray(row.objectKeys)
        ? row.objectKeys.filter((key): key is string => typeof key === "string")
        : [],
      recordId: row.recordId,
    }));
  }

  async completeCleanup(
    command: Parameters<WorkspaceLifecycleRepository["completeCleanup"]>[0],
  ): Promise<void> {
    await sql`update crm.workspace_lifecycle_records set cleanup_status = 'complete',
      cleanup_completed_at = ${command.completedAt}, object_keys = '[]'::jsonb
      where id = ${command.recordId}::uuid and cleanup_status = 'pending'`
      .execute(this.database);
  }
}

export class PostgresWorkspaceLifecycleSecurityAudit
  implements WorkspaceLifecycleSecurityAudit {
  async record(
    command: Parameters<WorkspaceLifecycleSecurityAudit["record"]>[0],
  ): Promise<void> {
    const database = databaseFromSession(command.transaction);
    await sql`insert into crm.workspace_lifecycle_records (
        id, workspace_id, actor_user_id, action, outcome, impact_counts,
        object_keys, cleanup_status, occurred_at, cleanup_completed_at,
        created_at
      ) values (
        ${crypto.randomUUID()}::uuid, ${command.workspaceId}::uuid,
        ${command.userId}::uuid, ${command.action}, ${command.outcome},
        '{}'::jsonb, '[]'::jsonb, 'complete', ${command.occurredAt},
        ${command.occurredAt}, ${command.occurredAt}
      )`.execute(database);
  }
}
