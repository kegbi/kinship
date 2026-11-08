import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type { MemberUiStateRepository } from "../../ports/ui_state_repository.ts";
import {
  memberPreferenceColumns,
  type PreferenceRow,
  preferences as preferencesOf,
} from "./settings_management.ts";

/**
 * The actor's standing is established by `ActorRevalidation` before any of
 * these run, so this repository only scopes by the member row that owns the
 * preferences.
 */
export class PostgresMemberUiStateRepository
  implements MemberUiStateRepository {
  async read(command: Parameters<MemberUiStateRepository["read"]>[0]) {
    const result = await sql<{ readonly uiState: unknown }>`
      select preference.ui_state as "uiState"
      from crm.member_preferences preference
      where preference.member_id = ${command.memberId}::uuid
    `.execute(databaseFromSession(command.transaction));
    return { status: "ready" as const, uiState: result.rows[0]?.uiState };
  }

  /**
   * One statement for the session: the scratch column and the preferences
   * of the same row, bound to the actor's workspace and user as well as the
   * member, so no other membership's row can answer (AUD-F3).
   */
  async readSession(
    command: Parameters<MemberUiStateRepository["readSession"]>[0],
  ) {
    const result = await sql<PreferenceRow & { readonly uiState: unknown }>`
      select mp.ui_state as "uiState", ${memberPreferenceColumns}
      from crm.workspace_members wm
      join crm.member_preferences mp on mp.member_id = wm.id
      left join crm.workspace_settings ws on ws.workspace_id = wm.workspace_id
      where wm.id = ${command.memberId}::uuid
        and wm.user_id = ${command.userId}::uuid
        and wm.workspace_id = ${command.workspaceId}::uuid
    `.execute(databaseFromSession(command.transaction));
    const row = result.rows[0];
    return row
      ? {
        preferences: preferencesOf(row),
        status: "ready" as const,
        uiState: row.uiState,
      }
      : { status: "ready" as const, uiState: undefined };
  }

  async lock(command: Parameters<MemberUiStateRepository["lock"]>[0]) {
    const preferences = await sql<{ readonly uiState: unknown }>`
      select ui_state as "uiState" from crm.member_preferences
      where member_id = ${command.memberId}::uuid
      for update
    `.execute(databaseFromSession(command.transaction));
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
