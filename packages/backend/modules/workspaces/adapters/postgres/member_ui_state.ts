import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type { MemberUiStateRepository } from "../../application/member_ui_state.ts";

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
