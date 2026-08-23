import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type {
  PersonalLifecycleMembership,
  PersonalLifecycleMemberships,
} from "../../application/personal_lifecycle.ts";

interface MembershipRow {
  readonly activeOwnerCount: number;
  readonly memberId: string;
  readonly role: "admin" | "member" | "owner";
  readonly status: "active" | "suspended";
  readonly workspaceId: string;
  readonly workspaceName: string;
}

export class PostgresPersonalLifecycleMemberships
  implements PersonalLifecycleMemberships {
  async inspect(
    command: Parameters<PersonalLifecycleMemberships["inspect"]>[0],
  ): Promise<{ readonly memberships: readonly PersonalLifecycleMembership[] }> {
    const database = databaseFromSession(command.transaction);
    if (command.lock) {
      const workspaceIds = await sql<{ readonly workspaceId: string }>`
        select wm.workspace_id::text as "workspaceId"
        from crm.workspace_members wm
        join crm.workspaces w on w.id = wm.workspace_id
        where wm.user_id = ${command.userId}::uuid
          and wm.status <> 'left' and wm.left_at is null
          and w.status = 'active' and w.deleted_at is null
        order by wm.workspace_id
      `.execute(database);
      for (const { workspaceId } of workspaceIds.rows) {
        await sql`
          select pg_advisory_xact_lock(hashtextextended(${workspaceId}, 2))
        `.execute(database);
        await sql`
          select id from crm.workspaces where id = ${workspaceId}::uuid
          for update
        `.execute(database);
      }
    }
    const result = await sql<MembershipRow>`
      select wm.id::text as "memberId", wm.workspace_id::text as "workspaceId",
        w.name as "workspaceName", wm.role, wm.status,
        (select count(*)::int from crm.workspace_members owners
          where owners.workspace_id = wm.workspace_id
            and owners.role = 'owner' and owners.status = 'active'
            and owners.left_at is null) as "activeOwnerCount"
      from crm.workspace_members wm
      join crm.workspaces w on w.id = wm.workspace_id
      where wm.user_id = ${command.userId}::uuid
        and wm.status <> 'left' and wm.left_at is null
        and w.status = 'active' and w.deleted_at is null
      order by lower(w.name), wm.workspace_id
    `.execute(database);
    return {
      memberships: result.rows.map((row) => ({
        finalOwner: row.status === "active" && row.role === "owner" &&
          row.activeOwnerCount === 1,
        memberId: row.memberId,
        role: row.role,
        status: row.status,
        workspaceId: row.workspaceId,
        workspaceName: row.workspaceName,
      })),
    };
  }

  async leaveCurrent(
    command: Parameters<PersonalLifecycleMemberships["leaveCurrent"]>[0],
  ): Promise<void> {
    const result = await sql<{ readonly id: string }>`
      update crm.workspace_members set status = 'left', left_at = ${command.leftAt},
        updated_at = ${command.leftAt}
      where id = ${command.memberId}::uuid
        and user_id = ${command.userId}::uuid
        and workspace_id = ${command.workspaceId}::uuid
        and status = 'active' and left_at is null
      returning id::text
    `.execute(databaseFromSession(command.transaction));
    if (!result.rows[0]) throw new Error("Active membership is unavailable.");
  }

  async leaveAll(
    command: Parameters<PersonalLifecycleMemberships["leaveAll"]>[0],
  ): Promise<void> {
    await sql`
      update crm.workspace_members set status = 'left', left_at = ${command.leftAt},
        updated_at = ${command.leftAt}
      where user_id = ${command.userId}::uuid
        and status <> 'left' and left_at is null
    `.execute(databaseFromSession(command.transaction));
  }
}
