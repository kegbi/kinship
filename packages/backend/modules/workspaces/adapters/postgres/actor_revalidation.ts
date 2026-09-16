import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type {
  ActorRevalidation,
  ActorStanding,
} from "../../application/actor_revalidation.ts";

/**
 * The single approved actor-context read, declared in
 * `docs/architecture/module-boundaries.yaml`. It is the only adapter in the
 * repository allowed to join `crm.users`, and the predicate below is the exact
 * one the copied joins carried.
 *
 * `for no key update` is the lock, not `for update`. Both conflict with every
 * `update` or `delete` of these rows, so a revocation still cannot commit
 * between this answer and the caller's write. Unlike `for update`, it does not
 * conflict with the `for key share` that inserting a row referencing a
 * workspace takes, so revalidating first cannot deadlock against a concurrent
 * transaction that holds an advisory lock and then inserts such a row.
 */
export class PostgresActorRevalidation implements ActorRevalidation {
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
