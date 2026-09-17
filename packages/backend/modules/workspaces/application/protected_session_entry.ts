/**
 * Turning a proved identity into something the caller can hold.
 *
 * There are two, and which one is used decides what the caller gets. A normal
 * sign-in lands in a workspace, so `establishSession` resolves the membership
 * first and refuses when there is none — proving who you are is not the same
 * as being allowed in. Registration and invitation flows sign somebody in
 * before they belong anywhere, so `establishIdentityEntry` issues a short-lived
 * entry token bound to the address that was proved, and nothing else.
 *
 * Both do their work in one transaction and then read it back. The session,
 * the membership, and the audit event are each asserted inside the transaction
 * that wrote them, so a session that was issued against something that turned
 * out not to be there unwinds rather than being handed out. The throttle is
 * finalized in the same transaction for the same reason.
 */

import { client, requested } from "../domain/session_rules.ts";
import type { ProtectedSessionResult } from "../domain/session_rules.ts";
import type { ProtectedSessionDependencies } from "./protected_session_context.ts";

/** The command either sign-in path hands to `establishSession`. */
export interface EstablishSessionCommand {
  readonly credentialVersion?: Date | null;
  readonly ipAddress?: string;
  readonly previousSessionToken?: string;
  readonly reservationId?: string;
  readonly requestedWorkspaceId?: string;
  readonly userAgent?: string;
  readonly userId: string;
}

/** A session in a workspace, or a refusal because there is no membership. */
export async function establishSession(
  dependencies: ProtectedSessionDependencies,
  command: EstablishSessionCommand,
): Promise<ProtectedSessionResult> {
  return await dependencies.transaction.run(async (transaction) => {
    const context = await dependencies.workspace.resolveActiveContext({
      ...requested(command),
      transaction,
      userId: command.userId,
    });
    if (!context) return { status: "membership-inactive" };
    const session = await dependencies.identity.issueSession({
      ...client(command),
      ...(Object.hasOwn(command, "credentialVersion")
        ? { credentialVersion: command.credentialVersion ?? null }
        : {}),
      ...(command.previousSessionToken
        ? { previousToken: command.previousSessionToken }
        : {}),
      transaction,
      userId: command.userId,
    });
    const occurredAt = dependencies.clock.now();
    const auditEventId = await dependencies.audit.record({
      context,
      occurredAt,
      outcome: "succeeded",
      transaction,
    });
    await dependencies.identity.assertSessionPostcondition({
      expiresAt: session.expiresAt,
      token: session.token,
      transaction,
      userId: command.userId,
    });
    await dependencies.workspace.assertActiveContextPostcondition({
      ...context,
      transaction,
    });
    await dependencies.audit.assertPostcondition({
      auditEventId,
      context,
      occurredAt,
      outcome: "succeeded",
      transaction,
    });
    if (command.reservationId) {
      await dependencies.attemptBudget.finalize({
        reservationId: command.reservationId,
        statusCode: 200,
        transaction,
        userId: command.userId,
      });
    }
    return {
      expiresAt: session.expiresAt,
      member: { id: context.memberId, role: context.role },
      sessionToken: session.token,
      status: "authenticated",
      userId: command.userId,
      workspace: { id: context.workspaceId, name: context.workspaceName },
    };
  });
}

/** A short-lived entry token for somebody who does not belong anywhere yet. */
export async function establishIdentityEntry(
  dependencies: ProtectedSessionDependencies,
  command: {
    readonly entryCredentialVersion: string;
    readonly expectedEmail: string;
    readonly ipAddress?: string;
    readonly reservationId: string;
    readonly userAgent?: string;
    readonly userId: string;
  },
): Promise<ProtectedSessionResult> {
  return await dependencies.transaction.run(async (transaction) => {
    if (!dependencies.identityEntry) {
      throw new Error("Verified identity entry issuance is unavailable.");
    }
    const entry = await dependencies.identityEntry
      .issueVerifiedIdentityEntry({
        ...client(command),
        credentialVersion: command.entryCredentialVersion,
        expectedEmail: command.expectedEmail,
        transaction,
        userId: command.userId,
      });
    await dependencies.attemptBudget.finalize({
      reservationId: command.reservationId,
      statusCode: 200,
      transaction,
      userId: command.userId,
    });
    return {
      entryToken: entry.token,
      expiresAt: entry.expiresAt,
      status: "identity-authenticated",
    };
  });
}
