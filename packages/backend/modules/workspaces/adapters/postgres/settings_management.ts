import { sql } from "kysely";
import { pickDefined } from "../../../../platform/postgres/rows.ts";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type {
  ResolvedMemberPreferences,
  WorkspaceConfiguration,
  WorkspaceMemberRecord,
} from "../../domain/settings_rules.ts";
import type { WorkspaceSettingsRepository } from "../../ports/settings_repository.ts";
import { revokeInvitationsOfInviters } from "./invitation_authority.ts";

export interface PreferenceRow {
  readonly effectiveTimezone: string;
  readonly contactNameOrder: string;
  readonly contactSortOrder: string;
  readonly currencyCode: string | null;
  readonly digestTime: string | null;
  readonly fluidLayout: boolean;
  readonly locale: string;
  readonly measurementSystem: "imperial" | "metric";
  readonly reminderDelivery: ResolvedMemberPreferences["reminderDelivery"];
  readonly temperatureScale: "celsius" | "fahrenheit";
  readonly timezone: string | null;
}

interface WorkspaceRow {
  readonly defaultCurrencyCode: string | null;
  readonly defaultLocale: string;
  readonly defaultReminderTime: string;
  readonly defaultTimezone: string | null;
  readonly name: string;
  readonly slug: string | null;
}

/** The member's reminder delivery, read the way the contract spells it. */
const reminderColumns = sql`
  mp.reminder_delivery as "reminderDelivery",
  to_char(mp.digest_time, 'HH24:MI') as "digestTime"
`;

/**
 * A member's resolved preferences, selected from `mp` (`member_preferences`)
 * and `ws` (the workspace's `workspace_settings`, left-joined) as
 * `PreferenceRow`. The session read selects the same columns (AUD-F3).
 */
export const memberPreferenceColumns = sql`
  mp.timezone, mp.locale,
  coalesce(mp.timezone, ws.default_timezone, 'UTC') as "effectiveTimezone",
  mp.temperature_scale as "temperatureScale",
  mp.measurement_system as "measurementSystem",
  mp.currency_code::text as "currencyCode",
  mp.contact_sort_order as "contactSortOrder",
  mp.contact_name_order as "contactNameOrder",
  mp.fluid_layout as "fluidLayout",
  ${reminderColumns}
`;

export function preferences(row: PreferenceRow): ResolvedMemberPreferences {
  return {
    effectiveTimezone: row.effectiveTimezone,
    contactNameOrder: row.contactNameOrder,
    contactSortOrder: row.contactSortOrder,
    ...pickDefined({
      currencyCode: row.currencyCode,
      digestTime: row.digestTime,
    }),
    fluidLayout: row.fluidLayout,
    locale: row.locale,
    measurementSystem: row.measurementSystem,
    reminderDelivery: row.reminderDelivery,
    temperatureScale: row.temperatureScale,
    ...pickDefined({ timezone: row.timezone }),
  };
}

function workspace(row: WorkspaceRow): WorkspaceConfiguration {
  return {
    ...pickDefined({ defaultCurrencyCode: row.defaultCurrencyCode }),
    defaultLocale: row.defaultLocale,
    defaultReminderTime: row.defaultReminderTime.slice(0, 5),
    ...pickDefined({ defaultTimezone: row.defaultTimezone }),
    name: row.name,
    ...pickDefined({ slug: row.slug }),
  };
}

export class PostgresWorkspaceSettings implements WorkspaceSettingsRepository {
  async getPreferences(
    command: Parameters<WorkspaceSettingsRepository["getPreferences"]>[0],
  ): Promise<ResolvedMemberPreferences | undefined> {
    const result = await sql<PreferenceRow>`
      select ${memberPreferenceColumns}
      from crm.workspace_members wm
      join crm.member_preferences mp on mp.member_id = wm.id
      join crm.workspaces w on w.id = wm.workspace_id
      left join crm.workspace_settings ws on ws.workspace_id = w.id
      where wm.id = ${command.memberId}::uuid
        and wm.user_id = ${command.userId}::uuid
        and wm.workspace_id = ${command.workspaceId}::uuid
        and wm.status = 'active' and wm.left_at is null
        and w.status = 'active' and w.deleted_at is null
    `.execute(databaseFromSession(command.transaction));
    return result.rows[0] ? preferences(result.rows[0]) : undefined;
  }

  async updatePreferences(
    command: Parameters<WorkspaceSettingsRepository["updatePreferences"]>[0],
  ): Promise<ResolvedMemberPreferences | "invalid-currency" | undefined> {
    const database = databaseFromSession(command.transaction);
    if (command.currencyCode) {
      const supported = await sql<{ readonly supported: boolean }>`
        select true as supported from crm.currencies
        where code = ${command.currencyCode} and is_active = true
        for share
      `.execute(database);
      if (supported.rows[0]?.supported !== true) return "invalid-currency";
    }
    const result = await sql<PreferenceRow>`
      update crm.member_preferences mp set
        timezone = ${command.timezone ?? null}, locale = ${command.locale},
        temperature_scale = ${command.temperatureScale},
        measurement_system = ${command.measurementSystem},
        currency_code = ${command.currencyCode ?? null},
        contact_sort_order = ${command.contactSortOrder},
        contact_name_order = ${command.contactNameOrder},
        fluid_layout = ${command.fluidLayout},
        reminder_delivery = coalesce(
          ${command.reminderDelivery ?? null}, mp.reminder_delivery
        ),
        digest_time = case when ${command.digestTime === undefined}
          then mp.digest_time else ${command.digestTime ?? null}::time end,
        updated_at = now()
      from crm.workspace_members wm, crm.workspaces w
      where mp.member_id = wm.id and w.id = wm.workspace_id
        and wm.id = ${command.memberId}::uuid
        and wm.user_id = ${command.userId}::uuid
        and wm.workspace_id = ${command.workspaceId}::uuid
        and wm.status = 'active' and wm.left_at is null
        and w.status = 'active' and w.deleted_at is null
      returning mp.timezone, mp.locale,
        coalesce(mp.timezone, (select default_timezone from crm.workspace_settings
          where workspace_id = wm.workspace_id), 'UTC') as "effectiveTimezone",
        mp.temperature_scale as "temperatureScale",
        mp.measurement_system as "measurementSystem",
        mp.currency_code::text as "currencyCode",
        mp.contact_sort_order as "contactSortOrder",
        mp.contact_name_order as "contactNameOrder",
        mp.fluid_layout as "fluidLayout",
        ${reminderColumns}
    `.execute(database);
    return result.rows[0] ? preferences(result.rows[0]) : undefined;
  }

  async getWorkspace(
    command: Parameters<WorkspaceSettingsRepository["getWorkspace"]>[0],
  ): ReturnType<WorkspaceSettingsRepository["getWorkspace"]> {
    if (command.role === "member") return "forbidden";
    const result = await sql<WorkspaceRow>`
      select w.name, w.slug, ws.default_locale as "defaultLocale",
        ws.default_timezone as "defaultTimezone",
        ws.default_currency_code::text as "defaultCurrencyCode",
        ws.default_reminder_time::text as "defaultReminderTime"
      from crm.workspace_members wm join crm.workspaces w on w.id = wm.workspace_id
      join crm.workspace_settings ws on ws.workspace_id = w.id
      where wm.id = ${command.memberId}::uuid
        and wm.user_id = ${command.userId}::uuid
        and wm.workspace_id = ${command.workspaceId}::uuid
        and wm.role in ('owner', 'admin') and wm.status = 'active'
        and wm.left_at is null and w.status = 'active' and w.deleted_at is null
    `.execute(databaseFromSession(command.transaction));
    return result.rows[0] ? workspace(result.rows[0]) : "forbidden";
  }

  async updateWorkspace(
    command: Parameters<WorkspaceSettingsRepository["updateWorkspace"]>[0],
  ): ReturnType<WorkspaceSettingsRepository["updateWorkspace"]> {
    if (command.role === "member") return "forbidden";
    const database = databaseFromSession(command.transaction);
    const authorization = await sql<{ readonly authorized: boolean }>`
      select true as authorized from crm.workspace_members wm
      join crm.workspaces w on w.id = wm.workspace_id
      where wm.id = ${command.memberId}::uuid
        and wm.user_id = ${command.userId}::uuid
        and wm.workspace_id = ${command.workspaceId}::uuid
        and wm.role in ('owner', 'admin') and wm.status = 'active'
        and wm.left_at is null and w.status = 'active' and w.deleted_at is null
      for update of wm, w
    `.execute(database);
    if (authorization.rows[0]?.authorized !== true) return "forbidden";
    const settings = await sql<{ readonly exists: boolean }>`
      select true as exists from crm.workspace_settings
      where workspace_id = ${command.workspaceId}::uuid
      for update
    `.execute(database);
    if (settings.rows[0]?.exists !== true) return undefined;
    if (command.defaultCurrencyCode) {
      const supported = await sql<{ readonly supported: boolean }>`
        select true as supported from crm.currencies
        where code = ${command.defaultCurrencyCode} and is_active = true
        for share
      `.execute(database);
      if (supported.rows[0]?.supported !== true) return "invalid-currency";
    }
    if (command.slug) {
      await sql`
        select pg_advisory_xact_lock(
          hashtextextended(lower(${command.slug}), 3)
        )
      `.execute(database);
      const conflict = await sql<{ readonly conflict: boolean }>`
        select exists(select 1 from crm.workspaces
          where lower(slug) = lower(${command.slug})
            and id <> ${command.workspaceId}::uuid and deleted_at is null)
          as conflict
      `.execute(database);
      if (conflict.rows[0]?.conflict === true) return "conflict";
    }
    await sql`
      update crm.workspaces set name = ${command.name},
        slug = ${command.slug ?? null}, updated_at = now()
      where id = ${command.workspaceId}::uuid
    `.execute(database);
    const updated = await sql<WorkspaceRow>`
      update crm.workspace_settings set
        default_locale = ${command.defaultLocale},
        default_timezone = ${command.defaultTimezone ?? null},
        default_currency_code = ${command.defaultCurrencyCode ?? null},
        default_reminder_time = ${command.defaultReminderTime}::time,
        updated_at = now()
      where workspace_id = ${command.workspaceId}::uuid
      returning ${command.name}::text as name, ${
      command.slug ?? null
    }::text as slug,
        default_locale as "defaultLocale",
        default_timezone as "defaultTimezone",
        default_currency_code::text as "defaultCurrencyCode",
        default_reminder_time::text as "defaultReminderTime"
    `.execute(database);
    return updated.rows[0] ? workspace(updated.rows[0]) : undefined;
  }

  async listMembers(
    command: Parameters<WorkspaceSettingsRepository["listMembers"]>[0],
  ): ReturnType<WorkspaceSettingsRepository["listMembers"]> {
    if (command.role === "member") return "forbidden";
    const database = databaseFromSession(command.transaction);
    const authorized = await sql<{ readonly authorized: boolean }>`
      select exists(select 1 from crm.workspace_members
        where id = ${command.memberId}::uuid
          and user_id = ${command.userId}::uuid
          and workspace_id = ${command.workspaceId}::uuid
          and role in ('owner', 'admin') and status = 'active'
          and left_at is null) as authorized
    `.execute(database);
    if (authorized.rows[0]?.authorized !== true) return "forbidden";
    const result = await sql<WorkspaceMemberRecord>`
      select id::text, user_id::text as "userId", role, status
      from crm.workspace_members
      where workspace_id = ${command.workspaceId}::uuid
        and status in ('active', 'suspended') and left_at is null
      order by case role when 'owner' then 0 when 'admin' then 1 else 2 end, id
    `.execute(database);
    return result.rows;
  }

  async updateMember(
    command: Parameters<WorkspaceSettingsRepository["updateMember"]>[0],
  ): ReturnType<WorkspaceSettingsRepository["updateMember"]> {
    if (command.role === "member") return "forbidden";
    const database = databaseFromSession(command.transaction);
    await sql`select pg_advisory_xact_lock(hashtextextended(${command.workspaceId}, 2))`
      .execute(database);
    const actor = await sql<{ readonly role: "admin" | "owner" }>`
      select role from crm.workspace_members
      where id = ${command.memberId}::uuid
        and user_id = ${command.userId}::uuid
        and workspace_id = ${command.workspaceId}::uuid
        and role in ('owner', 'admin') and status = 'active' and left_at is null
      for update
    `.execute(database);
    const actingRole = actor.rows[0]?.role;
    if (!actingRole) return "forbidden";
    const targetResult = await sql<WorkspaceMemberRecord>`
      select id::text, user_id::text as "userId", role, status
      from crm.workspace_members
      where id = ${command.targetMemberId}::uuid
        and workspace_id = ${command.workspaceId}::uuid
        and status in ('active', 'suspended') and left_at is null
      for update
    `.execute(database);
    const target = targetResult.rows[0];
    if (!target) return "not-found";
    if (
      actingRole === "admin" &&
      (target.role === "owner" || command.newRole === "owner")
    ) return "forbidden";
    if (
      target.role === "owner" && target.status === "active" &&
      (command.newRole !== "owner" || command.newStatus !== "active")
    ) {
      const owners = await sql<{ readonly count: number }>`
        select count(*)::int as count from crm.workspace_members
        where workspace_id = ${command.workspaceId}::uuid
          and role = 'owner' and status = 'active' and left_at is null
      `.execute(database);
      if (owners.rows[0]?.count === 1) return "last-owner";
    }
    const result = await sql<WorkspaceMemberRecord>`
      update crm.workspace_members set role = ${command.newRole},
        status = ${command.newStatus}, updated_at = now()
      where id = ${command.targetMemberId}::uuid
        and workspace_id = ${command.workspaceId}::uuid
      returning id::text, user_id::text as "userId", role, status
    `.execute(database);
    const updated = result.rows[0];
    if (!updated) return "not-found";
    // A demoted or suspended inviter's pending invitations end with their
    // authority, in this transaction (SECT-04).
    await revokeInvitationsOfInviters(command.transaction, {
      memberId: updated.id,
    });
    return updated;
  }
}
