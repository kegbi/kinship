/**
 * Accepting a presented token, for every kind of token the module mints.
 *
 * A personal access token and a calendar feed's secret differ only in how
 * their text is spelled; after parsing, both are a row identifier and a
 * secret. So the acceptance is written once: find the row by the identifier,
 * ask `workspaces` whether the user and workspace it names still add up to an
 * actor, decide everything cheap — revoked, expired, the wrong scope, the
 * wrong workspace — and only then compare the secret against the stored hash
 * in constant time, and record the use — at most once per
 * `TOKEN_USE_RECORD_INTERVAL_MS`, so a polling client does not rewrite the
 * row on every request.
 *
 * Two questions are asked of it. `authenticatePresented` asks whether the
 * token carries one required scope, which every token-enabled route and the
 * calendar feed ask. `introspectPresented` asks only whether it is a current
 * personal token at all, and answers with the token's own record, for the one
 * route that tells a client what its token is (MCP-A1). Both name the accepted
 * row, so the request can name its credential in audit.
 */

import {
  type ApiTokenRecord,
  type ApiTokenScope,
  personalScopes,
  type StoredTokenScope,
  TOKEN_USE_RECORD_INTERVAL_MS,
  usable,
  usableWithAnyGrant,
} from "../domain/token_rules.ts";
import type { ApiTokenActor } from "../ports/context.ts";
import type { ApiTokenDependencies } from "./api_token_management.ts";

export type TokenAuthentication =
  | {
    readonly actor: ApiTokenActor;
    readonly status: "authenticated";
    /** The accepted token's row id, which the request's audit names. */
    readonly tokenId: string;
  }
  | { readonly status: "invalid" };

/** A personal token, as it describes itself to the client presenting it. */
export interface PresentedTokenRecord {
  readonly expiresAt?: string;
  readonly id: string;
  readonly name: string;
  readonly scopes: readonly ApiTokenScope[];
}

export type TokenIntrospection =
  | {
    readonly actor: ApiTokenActor;
    readonly status: "authenticated";
    readonly token: PresentedTokenRecord;
  }
  | { readonly status: "invalid" };

type AcceptanceDependencies = Pick<
  ApiTokenDependencies,
  "actorContext" | "clock" | "repository" | "secrets" | "transaction"
>;

type Presented = { readonly id: string; readonly secret: string } | undefined;

/** What decides a found row, before its secret is compared. */
type Usable = (command: {
  readonly now: Date;
  readonly record: ApiTokenRecord;
  readonly workspaceId: string;
}) => boolean;

type Acceptance =
  | {
    readonly actor: ApiTokenActor;
    readonly record: ApiTokenRecord;
    readonly status: "accepted";
  }
  | { readonly status: "invalid" };

/** The one acceptance both questions share. */
async function accept(
  dependencies: AcceptanceDependencies,
  presented: Presented,
  accepts: Usable,
): Promise<Acceptance> {
  if (!presented) return { status: "invalid" };
  return await dependencies.transaction.run(
    async (transaction): Promise<Acceptance> => {
      const found = await dependencies.repository.findForAuthentication({
        id: presented.id,
        transaction,
      });
      if (found.status !== "found") return { status: "invalid" };
      // The token names a user and a workspace; `workspaces` says which
      // membership, if any, still grants an actor context.
      const actor = await dependencies.actorContext.describe({
        transaction,
        userId: found.userId,
        workspaceId: found.workspaceId,
      });
      if (!actor) return { status: "invalid" };
      const now = dependencies.clock.now();
      const valid = accepts({
        now,
        record: found.record,
        workspaceId: actor.workspaceId,
      }) && await dependencies.secrets.matches(presented.secret, found.hash);
      if (!valid) return { status: "invalid" };
      // The row is locked, so it is still exactly what was just accepted;
      // whether the use is written is bookkeeping, never part of the verdict.
      await dependencies.repository.markUsed({
        id: found.record.id,
        occurredAt: now,
        staleBefore: new Date(now.getTime() - TOKEN_USE_RECORD_INTERVAL_MS),
        transaction,
      });
      return { actor, record: found.record, status: "accepted" };
    },
  );
}

export async function authenticatePresented(
  dependencies: AcceptanceDependencies,
  presented: Presented,
  requiredScope: StoredTokenScope,
  requestedWorkspaceId?: string,
): Promise<TokenAuthentication> {
  const accepted = await accept(dependencies, presented, (command) =>
    usable({
      ...command,
      ...(requestedWorkspaceId ? { requestedWorkspaceId } : {}),
      requiredScope,
    }));
  return accepted.status === "accepted"
    ? {
      actor: accepted.actor,
      status: "authenticated",
      tokenId: accepted.record.id,
    }
    : accepted;
}

export async function introspectPresented(
  dependencies: AcceptanceDependencies,
  presented: Presented,
  requestedWorkspaceId?: string,
): Promise<TokenIntrospection> {
  const accepted = await accept(
    dependencies,
    presented,
    (command) =>
      usableWithAnyGrant({
        ...command,
        ...(requestedWorkspaceId ? { requestedWorkspaceId } : {}),
      }),
  );
  if (accepted.status !== "accepted") return accepted;
  const { expiresAt, id, name } = accepted.record;
  return {
    actor: accepted.actor,
    status: "authenticated",
    token: {
      ...(expiresAt ? { expiresAt } : {}),
      id,
      name,
      scopes: personalScopes(accepted.record),
    },
  };
}
