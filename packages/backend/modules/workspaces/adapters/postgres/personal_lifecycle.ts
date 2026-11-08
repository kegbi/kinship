import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import { inWorkspace } from "../../../../platform/postgres/transactions.ts";
import type { PersonalLifecycleMembership } from "../../domain/personal_lifecycle_rules.ts";
import type { PersonalLifecycleMemberships } from "../../ports/personal_lifecycle.ts";
import { revokeInvitationsOfInviters } from "./invitation_authority.ts";

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
        select membership.workspace_id::text as "workspaceId"
        from crm.account_lifecycle_memberships(${command.userId}::uuid)
          as membership
        order by membership.workspace_id
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
    // An account's memberships, and each workspace's owners, span
    // workspaces: the account-lifecycle function reads them (ADR 0008).
    const result = await sql<MembershipRow>`
      select membership.member_id::text as "memberId",
        membership.workspace_id::text as "workspaceId",
        membership.workspace_name as "workspaceName", membership.role,
        membership.status, membership.active_owner_count as "activeOwnerCount"
      from crm.account_lifecycle_memberships(${command.userId}::uuid)
        as membership
      order by lower(membership.workspace_name), membership.workspace_id
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

  inMembershipWorkspace<T>(
    command: Parameters<
      PersonalLifecycleMemberships["inMembershipWorkspace"]
    >[0],
    work: () => Promise<T>,
  ): Promise<T> {
    return inWorkspace(
      databaseFromSession(command.transaction),
      command.workspaceId,
      work,
    );
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
    // Somebody who has left can no longer vouch for an invitee (SECT-04).
    await revokeInvitationsOfInviters(command.transaction, {
      memberId: command.memberId,
    });
  }

  async leaveAll(
    command: Parameters<PersonalLifecycleMemberships["leaveAll"]>[0],
  ): Promise<void> {
    // Each membership lives in its own workspace, so the transaction visits
    // them one at a time and returns to the scope it came with (ADR 0008).
    const database = databaseFromSession(command.transaction);
    const memberships = await sql<{
      readonly memberId: string;
      readonly workspaceId: string;
    }>`
      select membership.member_id::text as "memberId",
        membership.workspace_id::text as "workspaceId"
      from crm.account_lifecycle_memberships(${command.userId}::uuid)
        as membership
      order by membership.workspace_id
    `.execute(database);
    for (const { memberId, workspaceId } of memberships.rows) {
      await inWorkspace(database, workspaceId, async () => {
        await sql`
          update crm.workspace_members set status = 'left',
            left_at = ${command.leftAt}, updated_at = ${command.leftAt}
          where id = ${memberId}::uuid and user_id = ${command.userId}::uuid
            and status <> 'left' and left_at is null
        `.execute(database);
        await revokeInvitationsOfInviters(command.transaction, { memberId });
      });
    }
  }
}
