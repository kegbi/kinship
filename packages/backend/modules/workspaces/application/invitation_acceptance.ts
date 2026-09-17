/**
 * Proving that somebody really did join.
 *
 * Joining a workspace is the one write that hands somebody else's data to a
 * new person, so it is the one write this module reads back. The audit event,
 * the membership, the invitation, and who issued it are all asserted inside
 * the transaction that created them: a half-written acceptance unwinds rather
 * than leaving behind a membership nobody invited, or an invitation that was
 * spent without anybody joining.
 *
 * Both acceptance paths — a member who already had an account, and one who
 * just proved their address — end here, so neither can quietly skip it.
 */

import type { InvitationAcceptance } from "../domain/invitation_rules.ts";
import type { RegistrationTransaction } from "../ports/context.ts";
import type {
  InvitationAudit,
  WorkspaceInvitationRepository,
} from "../ports/invitation_repository.ts";

/** The acceptance the repository has already committed. */
type AcceptedInvitation = Extract<
  InvitationAcceptance,
  { readonly status: "accepted" }
>;

export async function completeAcceptance(
  dependencies: {
    readonly audit: InvitationAudit;
    readonly repository: WorkspaceInvitationRepository;
  },
  command: {
    readonly now: Date;
    readonly result: AcceptedInvitation;
    readonly tokenHash: string;
    readonly transaction: RegistrationTransaction;
    readonly userId: string;
  },
): Promise<void> {
  const { now, result, tokenHash, transaction, userId } = command;
  await dependencies.audit.recordMemberJoined({
    actorMemberId: result.memberId,
    memberId: result.memberId,
    occurredAt: now,
    transaction,
    workspaceId: result.workspaceId,
  });
  await dependencies.repository.assertAcceptancePostcondition({
    acceptedAt: now,
    invitationId: result.invitationId,
    invitedByMemberId: result.invitedByMemberId,
    memberId: result.memberId,
    role: result.role,
    tokenHash,
    transaction,
    userId,
    workspaceId: result.workspaceId,
  });
  await dependencies.audit.assertMemberJoinedPostcondition({
    actorMemberId: result.memberId,
    memberId: result.memberId,
    occurredAt: now,
    transaction,
    workspaceId: result.workspaceId,
  });
}
