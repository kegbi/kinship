/**
 * Accepting a presented token, for every kind of token the module mints.
 *
 * A personal access token and a calendar feed's secret differ only in how
 * their text is spelled; after parsing, both are a row identifier and a
 * secret. So the acceptance is written once: find the row by the identifier,
 * ask `workspaces` whether the user and workspace it names still add up to an
 * actor, decide everything cheap — revoked, expired, the wrong scope, the
 * wrong workspace — and only then compare the secret against the stored hash
 * in constant time, and record the use.
 */

import { type StoredTokenScope, usable } from "../domain/token_rules.ts";
import type { ApiTokenActor } from "../ports/context.ts";
import type { ApiTokenDependencies } from "./api_token_management.ts";

export type TokenAuthentication =
  | { readonly actor: ApiTokenActor; readonly status: "authenticated" }
  | { readonly status: "invalid" };

export async function authenticatePresented(
  dependencies: Pick<
    ApiTokenDependencies,
    "actorContext" | "clock" | "repository" | "secrets" | "transaction"
  >,
  presented: { readonly id: string; readonly secret: string } | undefined,
  requiredScope: StoredTokenScope,
  requestedWorkspaceId?: string,
): Promise<TokenAuthentication> {
  if (!presented) return { status: "invalid" };
  return await dependencies.transaction.run(async (transaction) => {
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
    const valid = usable({
      now,
      record: found.record,
      ...(requestedWorkspaceId ? { requestedWorkspaceId } : {}),
      requiredScope,
      workspaceId: actor.workspaceId,
    }) && await dependencies.secrets.matches(presented.secret, found.hash);
    if (!valid) return { status: "invalid" };
    if (
      !await dependencies.repository.markUsed({
        id: found.record.id,
        occurredAt: now,
        transaction,
      })
    ) return { status: "invalid" };
    return { actor, status: "authenticated" };
  });
}
