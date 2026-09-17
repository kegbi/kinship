import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type {
  ActorContext,
  ActorRecipients,
  ActorRevalidation,
  ActorStanding,
  EligibleRecipient,
  RevalidatedActor,
} from "../../ports/actors.ts";
import type { ActiveWorkspaceContext } from "../../ports/context.ts";
import type { ActiveWorkspaceResolver } from "../../ports/session.ts";

/**
 * The single approved actor-context read, declared in
 * `docs/architecture/module-boundaries.yaml`. It is the only adapter outside
 * `identity` allowed to read `crm.users`, and the predicate below is the exact
 * one the copied joins carried.
 *
 * `for no key update` is the lock, not `for update`. Both conflict with every
 * `update` or `delete` of these rows, so a revocation still cannot commit
 * between this answer and the caller's write. Unlike `for update`, it does not
 * conflict with the `for key share` that inserting a row referencing a
 * workspace takes, so revalidating first cannot deadlock against a concurrent
 * transaction that holds an advisory lock and then inserts such a row.
 */
export class PostgresActorRevalidation
  implements ActorContext, ActorRecipients, ActorRevalidation {
  async listEligible(
    command: Parameters<ActorRecipients["listEligible"]>[0],
  ): Promise<readonly EligibleRecipient[]> {
    const result = await sql<{
      readonly member_id: string;
      readonly user_id: string;
    }>`
      select member.id::text as member_id, account.id::text as user_id
      from crm.users account
      join crm.workspace_members member on member.user_id = account.id
      join crm.workspaces workspace on workspace.id = member.workspace_id
      where member.workspace_id = ${command.workspaceId}::uuid
        and account.status = 'active' and account.deleted_at is null
        and member.status = 'active' and member.left_at is null
        and workspace.status = 'active' and workspace.deleted_at is null
      order by member.id
    `.execute(databaseFromSession(command.transaction));
    return result.rows.map((row) => ({
      memberId: row.member_id,
      userId: row.user_id,
      workspaceId: command.workspaceId,
    }));
  }

  async filterEligible(
    command: Parameters<ActorRecipients["filterEligible"]>[0],
  ): Promise<readonly EligibleRecipient[]> {
    if (command.memberIds.length === 0) return [];
    const result = await sql<{
      readonly member_id: string;
      readonly user_id: string;
      readonly workspace_id: string;
    }>`
      select member.id::text as member_id, account.id::text as user_id,
        workspace.id::text as workspace_id
      from crm.users account
      join crm.workspace_members member on member.user_id = account.id
      join crm.workspaces workspace on workspace.id = member.workspace_id
      where member.id = any(${command.memberIds}::uuid[])
        and account.status = 'active' and account.deleted_at is null
        and member.status = 'active' and member.left_at is null
        and workspace.status = 'active' and workspace.deleted_at is null
      order by member.id
    `.execute(databaseFromSession(command.transaction));
    return result.rows.map((row) => ({
      memberId: row.member_id,
      userId: row.user_id,
      workspaceId: row.workspace_id,
    }));
  }

  async describe(
    command: Parameters<ActorContext["describe"]>[0],
  ): Promise<RevalidatedActor | undefined> {
    const result = await sql<{
      readonly member_id: string;
      readonly role: RevalidatedActor["role"];
    }>`
      select member.id::text as member_id, member.role
      from crm.users account
      join crm.workspace_members member on member.user_id = account.id
      join crm.workspaces workspace on workspace.id = member.workspace_id
      where account.id = ${command.userId}::uuid
        and account.status = 'active' and account.deleted_at is null
        and member.workspace_id = ${command.workspaceId}::uuid
        and member.role in ('owner', 'admin', 'member')
        and member.status = 'active' and member.left_at is null
        and workspace.status = 'active' and workspace.deleted_at is null
      order by member.joined_at asc nulls last, member.id asc
      limit 1
    `.execute(databaseFromSession(command.transaction));
    const row = result.rows[0];
    return row
      ? {
        memberId: row.member_id,
        role: row.role,
        userId: command.userId,
        workspaceId: command.workspaceId,
      }
      : undefined;
  }

  async revalidate(
    command: Parameters<ActorRevalidation["revalidate"]>[0],
  ): Promise<ActorStanding> {
    const result = await sql<{ readonly active: boolean }>`
      select true as active
      from crm.users account
      join crm.workspace_members member on member.user_id = account.id
      join crm.workspaces workspace on workspace.id = member.workspace_id
      where account.id = ${command.userId}::uuid
        and account.status = 'active'
        and account.deleted_at is null
        and member.id = ${command.memberId}::uuid
        and member.workspace_id = ${command.workspaceId}::uuid
        and member.role = ${command.role}
        and member.role in ('owner', 'admin', 'member')
        and member.status = 'active'
        and member.left_at is null
        and workspace.id = ${command.workspaceId}::uuid
        and workspace.status = 'active'
        and workspace.deleted_at is null
      ${
      command.lock
        ? sql`for no key update of account, member, workspace`
        : sql``
    }
    `.execute(databaseFromSession(command.transaction));
    return result.rows[0]?.active === true ? "active" : "revoked";
  }
}

/**
 * The other half of the same question: which workspaces may an authenticated
 * user enter at all? Sign-in asks this before any actor context exists, so it
 * cannot use `revalidate`, and it reads the same three tables under the same
 * ownership. It therefore lives in this adapter, which keeps
 * `docs/architecture/module-boundaries.yaml` naming exactly one file that
 * reads identity's user row.
 */
export class PostgresActiveWorkspaceResolver
  implements ActiveWorkspaceResolver {
  async listActiveContexts(command: {
    readonly transaction: Parameters<
      ActiveWorkspaceResolver["listActiveContexts"]
    >[0]["transaction"];
    readonly userId: string;
  }): Promise<readonly ActiveWorkspaceContext[]> {
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
      order by wm.joined_at asc nulls last, wm.id asc
      for share of u, wm, w
    `.execute(databaseFromSession(command.transaction));
    return result.rows;
  }

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
