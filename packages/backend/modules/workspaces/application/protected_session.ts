/**
 * The protected session coordinator.
 *
 * Signing in is two rounds — a password, then a factor if there is one — and
 * both rounds have the same spine: equalize the response time, reserve against
 * the throttle, run the attempt, and finalize with what it came to. What
 * differs is only what is proved, so the two methods below read as the same
 * sequence twice rather than sharing a parameterised one; the shared parts are
 * in `protected_session_context.ts` and `protected_session_entry.ts`.
 *
 * The subtle case in both is `mfa-required`. The challenge is only handed back
 * to somebody who could actually use it: a caller signing in to a workspace is
 * asked for a factor only once a membership has been found, so an attacker
 * with a correct password learns nothing about whether the account belongs
 * anywhere. A caller in an identity-only flow is asked straight away, because
 * there is no membership to find yet.
 *
 * `resolve` is the read the rest of the API is built on: a session token
 * becomes a membership and the list of workspaces the same user could switch
 * to, or nothing at all.
 */

import type { ProtectedSessionResult } from "../domain/session_rules.ts";
import { client, requested } from "../domain/session_rules.ts";
import type {
  ActiveWorkspaceContext,
  ResolvedSessionContext,
} from "../ports/context.ts";
import {
  admittedAttempt,
  type CompleteMfaCommand,
  type ProtectedSessionDependencies,
  recordFailure,
  rejectedByBudget,
  type SignInCommand,
} from "./protected_session_context.ts";
import {
  establishIdentityEntry,
  establishSession,
} from "./protected_session_entry.ts";
import { admitResolved } from "./actor_admission.ts";

/**
 * The workspace a resolution acts in: the requested one when the user may
 * enter it, otherwise the first the user joined. `contexts` is already in
 * that order, and the database writes a uuid in lower case.
 */
function activeContext(
  contexts: readonly ActiveWorkspaceContext[],
  requestedWorkspaceId: string | undefined,
): ActiveWorkspaceContext | undefined {
  const requested = requestedWorkspaceId?.toLowerCase();
  return requested === undefined
    ? contexts[0]
    : contexts.find((context) => context.workspaceId === requested);
}

/**
 * A password sign-in that proved the password hands its browser a fresh device
 * token (AUD-A3): a session, or a challenge for the second factor, both of
 * which already tell the caller the password was right. Identity-only entry
 * is not a sign-in to this route, so it gets none.
 */
async function withSignInDevice(
  dependencies: ProtectedSessionDependencies,
  command: SignInCommand,
  result: ProtectedSessionResult,
): Promise<ProtectedSessionResult> {
  if (
    !dependencies.signInDevices || command.identityOnly ||
    (result.status !== "authenticated" && result.status !== "mfa-required")
  ) {
    return result;
  }
  try {
    const device = await dependencies.signInDevices.issue({
      issuedAt: dependencies.clock.now(),
      subject: command.email,
    });
    return { ...result, device };
  } catch {
    // The sign-in already succeeded; a browser without a device token only
    // loses the ceiling exemption next time.
    return result;
  }
}

export function createProtectedSessionCoordinator(
  dependencies: ProtectedSessionDependencies,
): {
  completeMfa(command: CompleteMfaCommand): Promise<ProtectedSessionResult>;
  establishVerifiedEntry(command: {
    readonly ipAddress?: string;
    readonly previousSessionToken?: string;
    readonly userAgent?: string;
    readonly userId: string;
  }): Promise<ProtectedSessionResult>;
  resolve(command: {
    readonly requestedWorkspaceId?: string;
    readonly sessionToken: string;
  }): Promise<ResolvedSessionContext | undefined>;
  /** Whether an active session was ended; a stale token is not an error. */
  signOut(sessionToken: string): Promise<boolean>;
  signIn(command: SignInCommand): Promise<ProtectedSessionResult>;
} {
  return {
    async signIn(command) {
      return await dependencies.responseEqualizer.run(async () => {
        const admission = await dependencies.attemptBudget.reserve({
          clientAddress: command.ipAddress,
          ...(command.deviceToken ? { deviceToken: command.deviceToken } : {}),
          occurredAt: dependencies.clock.now(),
          scope: "password",
          subject: command.email,
        });
        if (admission.status === "rate-limited") {
          return await rejectedByBudget(
            dependencies,
            "password",
            command.email,
            admission.reservationId,
            admission.retryAfterSeconds,
          );
        }
        const result = await admittedAttempt(
          dependencies,
          admission.reservationId,
          async (reservationId) => {
            const primary = await dependencies.identity.authenticatePassword({
              ...client(command),
              email: command.email,
              password: command.password,
            });
            if (primary.status === "invalid") {
              await recordFailure(dependencies, primary.auditUserId);
              return { status: "invalid-credentials" };
            }
            if (primary.status === "mfa-required") {
              if (command.identityOnly && command.expectedEmail) {
                return {
                  challengeToken: primary.challengeToken,
                  status: "mfa-required",
                };
              }
              const hasContext = await dependencies.transaction.run(
                (transaction) =>
                  dependencies.workspace.resolveActiveContext({
                    ...requested(command),
                    transaction,
                    userId: primary.userId,
                  }),
              );
              if (hasContext) {
                return {
                  challengeToken: primary.challengeToken,
                  status: "mfa-required",
                };
              }
              await recordFailure(dependencies, primary.userId);
              return { status: "membership-inactive" };
            }
            if (command.identityOnly && command.expectedEmail) {
              return await establishIdentityEntry(dependencies, {
                ...client(command),
                entryCredentialVersion: primary.entryCredentialVersion,
                expectedEmail: command.expectedEmail,
                reservationId,
                userId: primary.userId,
              });
            }
            const established = await establishSession(dependencies, {
              ...client(command),
              ...requested(command),
              ...(command.previousSessionToken
                ? { previousSessionToken: command.previousSessionToken }
                : {}),
              credentialVersion: primary.credentialVersion,
              reservationId,
              userId: primary.userId,
            });
            if (established.status === "membership-inactive") {
              await recordFailure(dependencies, primary.userId);
            }
            return established;
          },
        );
        return await withSignInDevice(dependencies, command, result);
      });
    },
    async completeMfa(command) {
      return await dependencies.responseEqualizer.run(async () => {
        const subject = await dependencies.identity.authenticationSubjectForMfa(
          command.challengeToken,
        );
        const admission = await dependencies.attemptBudget.reserve({
          clientAddress: command.ipAddress,
          occurredAt: dependencies.clock.now(),
          scope: "mfa",
          subject,
        });
        if (admission.status === "rate-limited") {
          return await rejectedByBudget(
            dependencies,
            "mfa",
            subject,
            admission.reservationId,
            admission.retryAfterSeconds,
          );
        }
        return await admittedAttempt(
          dependencies,
          admission.reservationId,
          async (reservationId) => {
            const factor = await dependencies.transaction.run((transaction) =>
              dependencies.identity.completeMfa({
                challengeToken: command.challengeToken,
                factor: command.factor,
                transaction,
              })
            );
            if (factor.status === "invalid") {
              await recordFailure(dependencies, factor.auditUserId);
              return { status: "invalid-mfa" };
            }
            if (factor.status === "expired") {
              await recordFailure(dependencies, factor.auditUserId);
              return { status: "challenge-expired" };
            }
            if (factor.status === "rate-limited") {
              await recordFailure(dependencies, factor.auditUserId);
              return {
                retryAfterSeconds: factor.retryAfterSeconds,
                status: "rate-limited",
              };
            }
            if (command.identityOnly && command.expectedEmail) {
              return await establishIdentityEntry(dependencies, {
                ...client(command),
                entryCredentialVersion: factor.entryCredentialVersion,
                expectedEmail: command.expectedEmail,
                reservationId,
                userId: factor.userId,
              });
            }
            const established = await establishSession(dependencies, {
              ...client(command),
              ...requested(command),
              ...(command.previousSessionToken
                ? { previousSessionToken: command.previousSessionToken }
                : {}),
              credentialVersion: factor.credentialVersion,
              reservationId,
              userId: factor.userId,
            });
            if (established.status === "membership-inactive") {
              await recordFailure(dependencies, factor.userId);
            }
            return established;
          },
        );
      });
    },
    establishVerifiedEntry: (command) =>
      establishSession(dependencies, command),
    async resolve(command) {
      // Two statements on one connection and no transaction around them
      // (BEQ-04): the session, then every workspace the user may enter. The
      // active one is the first of those the request may act in, so it needs
      // no statement of its own.
      const reads = dependencies.connection ?? dependencies.transaction;
      return await reads.run(async (connection) => {
        const principal = await dependencies.identity.resolveSession(
          command.sessionToken,
          connection,
        );
        if (!principal) return undefined;
        const accessibleWorkspaces = await dependencies.workspace
          .listActiveContexts({
            transaction: connection,
            userId: principal.userId,
          });
        const active = activeContext(
          accessibleWorkspaces,
          command.requestedWorkspaceId,
        );
        return active &&
          admitResolved({ ...active, accessibleWorkspaces });
      });
    },
    signOut(sessionToken) {
      return dependencies.transaction.run((transaction) =>
        dependencies.identity.revokeSession({
          token: sessionToken,
          transaction,
        })
      );
    },
  };
}
