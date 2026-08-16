import { type Kysely, sql } from "kysely";
import type { ApplicationDatabase } from "../../../../platform/postgres/database.ts";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type {
  RegistrationTransaction,
  RegistrationTransactionRunner,
  WorkspaceRegistrationWriter,
} from "../../application/register_first_workspace.ts";

export class PostgresRegistrationTransaction
  implements RegistrationTransactionRunner {
  constructor(private readonly database: Kysely<ApplicationDatabase>) {}

  run<T>(
    work: (transaction: RegistrationTransaction) => Promise<T>,
  ): Promise<T> {
    return this.database.transaction().execute((transaction) =>
      work({ opaque: transaction })
    );
  }
}

export class PostgresWorkspaceRegistration
  implements WorkspaceRegistrationWriter {
  async createWorkspace(command: {
    readonly createdByUserId: string;
    readonly name: string;
    readonly transaction: RegistrationTransaction;
    readonly workspaceId: string;
  }): Promise<{ readonly workspaceId: string }> {
    await sql`
      insert into crm.workspaces (
        id, name, status, created_by_user_id, created_at, updated_at
      ) values (
        ${command.workspaceId}::uuid, ${command.name}, 'active',
        ${command.createdByUserId}::uuid, now(), now()
      )
    `.execute(databaseFromSession(command.transaction));
    return { workspaceId: command.workspaceId };
  }

  async createOwnerMembership(command: {
    readonly joinedAt: Date;
    readonly memberId: string;
    readonly transaction: RegistrationTransaction;
    readonly userId: string;
    readonly workspaceId: string;
  }): Promise<{ readonly memberId: string }> {
    await sql`
      insert into crm.workspace_members (
        id, workspace_id, user_id, role, status, joined_at, created_at, updated_at
      ) values (
        ${command.memberId}::uuid, ${command.workspaceId}::uuid,
        ${command.userId}::uuid, 'owner', 'active', ${command.joinedAt}, now(), now()
      )
    `.execute(databaseFromSession(command.transaction));
    return { memberId: command.memberId };
  }

  async createMemberPreferences(command: {
    readonly memberId: string;
    readonly transaction: RegistrationTransaction;
  }): Promise<void> {
    await sql`
      insert into crm.member_preferences (member_id) values (${command.memberId}::uuid)
    `.execute(databaseFromSession(command.transaction));
  }

  async createWorkspaceSettings(command: {
    readonly transaction: RegistrationTransaction;
    readonly workspaceId: string;
  }): Promise<void> {
    await sql`
      insert into crm.workspace_settings (workspace_id) values (${command.workspaceId}::uuid)
    `.execute(databaseFromSession(command.transaction));
  }

  async provisionDefaultRelationshipTypes(command: {
    readonly transaction: RegistrationTransaction;
    readonly types: readonly {
      readonly forwardLabel: string;
      readonly reverseLabel: string;
      readonly sortOrder: number;
    }[];
    readonly version: number;
    readonly workspaceId: string;
  }): Promise<void> {
    const database = databaseFromSession(command.transaction);
    await sql`select pg_advisory_xact_lock(hashtextextended(${command.workspaceId}, ${command.version}))`
      .execute(database);
    for (const type of command.types) {
      await sql`
        insert into crm.relationship_types (
          workspace_id, forward_label, reverse_label, is_system, can_delete,
          is_archived, sort_order
        )
        select ${command.workspaceId}::uuid, ${type.forwardLabel},
          ${type.reverseLabel}, true, false, false, ${type.sortOrder}
        where not exists (
          select 1 from crm.relationship_types
          where workspace_id = ${command.workspaceId}::uuid
            and forward_label = ${type.forwardLabel}
            and reverse_label = ${type.reverseLabel}
        )
      `.execute(database);
    }
  }

  async assertFirstWorkspacePostconditions(command: {
    readonly joinedAt: Date;
    readonly memberId: string;
    readonly name: string;
    readonly relationshipTypes: readonly {
      readonly forwardLabel: string;
      readonly reverseLabel: string;
      readonly sortOrder: number;
    }[];
    readonly transaction: RegistrationTransaction;
    readonly userId: string;
    readonly workspaceId: string;
  }): Promise<void> {
    const result = await sql<{ valid: boolean }>`
      select
        (select count(*) = 1 from crm.workspaces
          where id = ${command.workspaceId}::uuid
            and name = ${command.name}
            and created_by_user_id = ${command.userId}::uuid
            and status = 'active' and slug is null and deleted_at is null) and
        (select count(*) = 1 from crm.workspace_members
          where id = ${command.memberId}::uuid
            and user_id = ${command.userId}::uuid
            and workspace_id = ${command.workspaceId}::uuid
            and role = 'owner' and status = 'active'
            and joined_at = ${command.joinedAt}
            and invited_by_member_id is null and self_person_id is null
            and left_at is null) and
        (select count(*) = 1 from crm.member_preferences
          where member_id = ${command.memberId}::uuid and timezone is null
            and locale = 'en' and temperature_scale = 'celsius'
            and measurement_system = 'metric' and currency_code is null
            and contact_sort_order = 'given_name_asc'
            and contact_name_order = 'given_family_nickname'
            and fluid_layout = false and ui_state = '{}'::jsonb) and
        (select count(*) = 1 from crm.workspace_settings
          where workspace_id = ${command.workspaceId}::uuid
            and default_locale = 'en' and default_timezone is null
            and default_currency_code is null
            and default_gender_option_id is null
            and default_reminder_time = time '12:00')
        as valid
    `.execute(databaseFromSession(command.transaction));
    if (result.rows[0]?.valid !== true) {
      throw new Error("First workspace postconditions failed.");
    }
    const relationshipTypes = await sql<{
      can_delete: boolean;
      forward_label: string;
      group_id: string | null;
      is_archived: boolean;
      is_system: boolean;
      reverse_label: string;
      sort_order: number;
    }>`
      select forward_label, reverse_label, is_system, can_delete, is_archived,
        sort_order, group_id::text
      from crm.relationship_types
      where workspace_id = ${command.workspaceId}::uuid
      order by sort_order, id
    `.execute(databaseFromSession(command.transaction));
    if (
      relationshipTypes.rows.length !== command.relationshipTypes.length ||
      relationshipTypes.rows.some((actual, index) => {
        const expected = command.relationshipTypes[index];
        return !expected || actual.forward_label !== expected.forwardLabel ||
          actual.reverse_label !== expected.reverseLabel ||
          actual.sort_order !== expected.sortOrder || !actual.is_system ||
          actual.can_delete || actual.is_archived || actual.group_id !== null;
      })
    ) {
      throw new Error("Default relationship-type postconditions failed.");
    }
  }
}
