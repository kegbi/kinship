/**
 * An invitation is only as good as its inviter's authority (SECT-04).
 *
 * A pending invitation hands its role to whoever accepts it, so it stays
 * usable only while the member who sent it is still an active owner or admin
 * of that workspace. Two statements carry the rule, and every adapter that
 * changes a membership or spends an invitation uses them rather than its own
 * copy:
 *
 * - `INVITER_HOLDS_AUTHORITY` is the predicate acceptance and inspection read,
 *   which also refuses an invitation whose inviter row has gone.
 * - `revokeInvitationsOfInviters` revokes, in the caller's transaction, the
 *   pending invitations of the given members that no longer hold authority.
 *   Demotion, suspension, leaving, and deleting an account call it right after
 *   their membership write, so a removed inviter and a live invitation of
 *   theirs are never both committed.
 *
 * Every path takes its locks in one order — the workspace, then the inviter's
 * membership, then the invitation — or a membership change and an acceptance
 * of that member's invitation deadlock: the change holds the membership and
 * waits for the invitation, while acceptance holds the invitation and its new
 * membership's foreign keys wait for the workspace and the inviter.
 * Membership changes already lock in that order; `lockInvitationAuthority`
 * is how inspection and acceptance do before they lock the invitation.
 *
 * Before the workspace, inspection and acceptance take the workspace's
 * member-administration advisory lock shared. A member change, leaving, an
 * account deletion, and a workspace reset or delete take it exclusively
 * before any row of the workspace, and a reset or delete then locks every
 * member row before the workspace row (MCP-F3). Without it, an acceptance
 * could hold the workspace row and wait for its inviter's member row while a
 * reset held that member row and waited for the workspace row.
 */

import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";

/**
 * True when the invitation aliased `wi` was sent by a member who is still an
 * active owner or admin of its workspace.
 */
export const INVITER_HOLDS_AUTHORITY = sql<boolean>`exists (
  select 1 from crm.workspace_members inviter
  where inviter.id = wi.invited_by_member_id
    and inviter.workspace_id = wi.workspace_id
    and inviter.role in ('owner', 'admin') and inviter.status = 'active'
    and inviter.left_at is null
)`;

/**
 * Takes the locks that come before the invitation's own: the workspace's
 * member-administration lock, shared; its workspace, which leaving and
 * account deletion lock first and the new membership's key needs; then its
 * inviter's membership, which demotion and suspension lock. An invitation's
 * workspace and inviter never change, so reading them unlocked is safe; a
 * membership change already waiting here commits its revocation before the
 * caller reads the invitation.
 */
export async function lockInvitationAuthority(
  transaction: { readonly opaque: unknown },
  tokenHash: string,
): Promise<void> {
  const database = databaseFromSession(transaction);
  // The invitee belongs to no workspace yet. The invitation function scopes
  // this transaction to the workspace the token hash names (ADR 0008), so
  // every later statement of the inspection or acceptance runs there.
  await sql`select crm.enter_invitation_workspace(${tokenHash})`
    .execute(database);
  const invitation = await sql<{
    readonly invitedByMemberId: string | null;
    readonly workspaceId: string;
  }>`
    select workspace_id::text as "workspaceId",
      invited_by_member_id::text as "invitedByMemberId"
    from crm.workspace_invitations where token_hash = ${tokenHash}
  `.execute(database);
  const found = invitation.rows[0];
  if (!found) return;
  await sql`
    select pg_advisory_xact_lock_shared(
      hashtextextended(${found.workspaceId}, 2)
    )
  `.execute(database);
  await sql`
    select id from crm.workspaces where id = ${found.workspaceId}::uuid
    for key share
  `.execute(database);
  if (found.invitedByMemberId === null) return;
  await sql`
    select id from crm.workspace_members
    where id = ${found.invitedByMemberId}::uuid
      and workspace_id = ${found.workspaceId}::uuid
    for share
  `.execute(database);
}

/**
 * Revokes the pending invitations sent by `inviters` — membership ids, or
 * every membership of one identity — whose sender no longer holds authority.
 */
export async function revokeInvitationsOfInviters(
  transaction: { readonly opaque: unknown },
  inviters:
    | { readonly memberId: string }
    | { readonly userId: string },
): Promise<void> {
  const sender = "memberId" in inviters
    ? sql`inviter.id = ${inviters.memberId}::uuid`
    : sql`inviter.user_id = ${inviters.userId}::uuid`;
  await sql`
    update crm.workspace_invitations wi
    set status = 'revoked', updated_at = now()
    from crm.workspace_members inviter
    where inviter.id = wi.invited_by_member_id
      and inviter.workspace_id = wi.workspace_id
      and ${sender}
      and wi.status = 'pending'
      and not (inviter.role in ('owner', 'admin')
        and inviter.status = 'active' and inviter.left_at is null)
  `.execute(databaseFromSession(transaction));
}
