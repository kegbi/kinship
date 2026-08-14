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

  async assertFirstWorkspacePostconditions(command: {
    readonly joinedAt: Date;
    readonly memberId: string;
    readonly name: string;
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
  }
}
