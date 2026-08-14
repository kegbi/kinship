import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type {
  ActiveWorkspaceContext,
  ActiveWorkspaceResolver,
} from "../../application/protected_session.ts";

export class PostgresActiveWorkspaceResolver
  implements ActiveWorkspaceResolver {
  async resolveAuditContext(command: {
    readonly transaction: Parameters<
      ActiveWorkspaceResolver["resolveAuditContext"]
    >[0]["transaction"];
    readonly userId: string;
  }): Promise<ActiveWorkspaceContext | undefined> {
    const result = await sql<ActiveWorkspaceContext>`
      select wm.id::text as "memberId", wm.role, u.id::text as "userId",
        w.id::text as "workspaceId", w.name as "workspaceName"
      from crm.users u
      join crm.workspace_members wm on wm.user_id = u.id
      join crm.workspaces w on w.id = wm.workspace_id
      where u.id = ${command.userId}::uuid
      order by (wm.status = 'active' and wm.left_at is null) desc,
        wm.joined_at asc nulls last, wm.id asc
      limit 1
      for share of u, wm, w
    `.execute(databaseFromSession(command.transaction));
    return result.rows[0];
  }

  async resolveActiveContext(command: {
    readonly requestedWorkspaceId?: string;
    readonly transaction: Parameters<
      ActiveWorkspaceResolver["resolveActiveContext"]
    >[0]["transaction"];
    readonly userId: string;
  }): Promise<ActiveWorkspaceContext | undefined> {
    const result = await sql<ActiveWorkspaceContext>`
      select wm.id::text as "memberId", wm.role, u.id::text as "userId",
        w.id::text as "workspaceId", w.name as "workspaceName"
      from crm.users u
      join crm.workspace_members wm on wm.user_id = u.id
      join crm.workspaces w on w.id = wm.workspace_id
      where u.id = ${command.userId}::uuid and u.status = 'active'
        and u.email_verified_at is not null
        and wm.status = 'active' and wm.left_at is null
        and w.status = 'active' and w.deleted_at is null
        and (${command.requestedWorkspaceId ?? null}::uuid is null
          or w.id = ${command.requestedWorkspaceId ?? null}::uuid)
      order by wm.joined_at asc nulls last, wm.id asc
      limit 1
      for share of u, wm, w
    `.execute(databaseFromSession(command.transaction));
    return result.rows[0];
  }

  async assertActiveContextPostcondition(
    command: ActiveWorkspaceContext & {
      readonly transaction: Parameters<
        ActiveWorkspaceResolver["assertActiveContextPostcondition"]
      >[0]["transaction"];
    },
  ): Promise<void> {
    const result = await sql<{ readonly valid: boolean }>`
      select count(*) = 1 valid
      from crm.workspace_members wm
      join crm.workspaces w on w.id = wm.workspace_id
      where wm.id = ${command.memberId}::uuid
        and wm.user_id = ${command.userId}::uuid
        and wm.workspace_id = ${command.workspaceId}::uuid
        and wm.role = ${command.role} and wm.status = 'active'
        and wm.left_at is null and w.status = 'active'
        and w.deleted_at is null and w.name = ${command.workspaceName}
    `.execute(databaseFromSession(command.transaction));
    if (result.rows[0]?.valid !== true) {
      throw new Error("Active workspace context postcondition failed.");
    }
  }
}
