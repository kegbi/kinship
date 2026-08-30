import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type { MemberUiStateRepository } from "../../application/member_ui_state.ts";

export class PostgresMemberUiStateRepository
  implements MemberUiStateRepository {
  async read(command: Parameters<MemberUiStateRepository["read"]>[0]) {
    const result = await sql<{ readonly uiState: unknown }>`
      select preference.ui_state as "uiState" from crm.users account
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
    `.execute(databaseFromSession(command.transaction));
    return result.rows[0]
      ? { status: "ready" as const, uiState: result.rows[0].uiState }
      : { status: "forbidden" as const };
  }

  async lock(command: Parameters<MemberUiStateRepository["lock"]>[0]) {
    const database = databaseFromSession(command.transaction);
    const authorized = await sql<{ readonly authorized: boolean }>`
      select true as authorized from crm.users account
      join crm.workspace_members member on member.user_id = account.id
      join crm.workspaces workspace on workspace.id = member.workspace_id
      where account.id = ${command.userId}::uuid
        and account.status = 'active' and account.deleted_at is null
        and member.id = ${command.memberId}::uuid
        and member.workspace_id = ${command.workspaceId}::uuid
        and member.role = ${command.role}
        and member.status = 'active' and member.left_at is null
        and workspace.id = ${command.workspaceId}::uuid
        and workspace.status = 'active' and workspace.deleted_at is null
      for update of member
    `.execute(database);
    if (authorized.rows[0]?.authorized !== true) {
      return { status: "forbidden" as const };
    }
    const preferences = await sql<{ readonly uiState: unknown }>`
      select ui_state as "uiState" from crm.member_preferences
      where member_id = ${command.memberId}::uuid
      for update
    `.execute(database);
    return {
      status: "ready" as const,
      uiState: preferences.rows[0]?.uiState,
    };
  }

  async save(command: Parameters<MemberUiStateRepository["save"]>[0]) {
    const result = await sql<{ readonly saved: boolean }>`
      insert into crm.member_preferences (member_id, ui_state, updated_at)
      values (
        ${command.memberId}::uuid,
        ${command.uiState}::jsonb,
        now()
      )
      on conflict (member_id) do update set
        ui_state = excluded.ui_state,
        updated_at = excluded.updated_at
      returning true as saved
    `.execute(databaseFromSession(command.transaction));
    return result.rows[0]?.saved === true;
  }
}
