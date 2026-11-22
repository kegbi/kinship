/**
 * The personal access token use case.
 *
 * Three of the four paths have the same shape: refuse a member outright, open
 * one transaction, re-establish the caller's standing inside it, do the work,
 * and record the audit event beside it. Only the listing takes no lock, so a
 * page of tokens cannot block one being minted. Listing and revoking reach
 * every personal token of the workspace, not only the caller's: the owner and
 * administrators are the ones who can see a credential somebody else left
 * behind and kill it (SECT-07), and each listed token names its issuer.
 *
 * `revokeMemberCredentials` is the workspaces module's hook. When a member is
 * suspended, leaves, or deletes their account, every token and feed they hold
 * in that workspace is revoked in the transaction that removed them, so
 * reinstating somebody never brings an old credential back to life.
 *
 * `authenticate` is the fourth and reads the other way round. Nobody has
 * established an actor yet — all that has arrived is a string somebody pasted
 * into a program — so the token is parsed, the row is found by the identifier
 * inside it, and `workspaces` is asked whether the user and workspace it names
 * still add up to somebody. Only then is the secret compared, because that is
 * the one expensive step and everything cheaper has already had its chance to
 * refuse. `markUsed` is what makes the acceptance visible to its owner.
 * `introspect` is the same acceptance without a required scope, for the one
 * route that tells a client what its token is (MCP-A1).
 */

import type { Clock } from "../../../shared-kernel/clock.ts";
import type { Failure } from "../../../shared-kernel/result.ts";
import {
  type ApiTokenInput,
  type ApiTokenListEntry,
  type ApiTokenRecord,
  type ApiTokenScope,
  listedTokens,
  parseToken,
  renderToken,
  validateApiToken,
} from "../domain/token_rules.ts";
import type { ApiTokenAudit } from "../ports/audit.ts";
import type { ApiTokenRepository } from "../ports/api_token_repository.ts";
import type {
  ApiTokenActor,
  ApiTokenTransaction,
  ApiTokenTransactionRunner,
} from "../ports/context.ts";
import type { ApiTokenIssuers } from "../ports/issuers.ts";
import type { ApiTokenSecrets } from "../ports/secrets.ts";
import {
  authenticatePresented,
  introspectPresented,
  type TokenAuthentication,
  type TokenIntrospection,
} from "./token_authentication.ts";
import {
  type ActorContext,
  type ActorRevalidation,
  // Tokens are an administrative facility; a member neither mints nor sees one.
  privileged,
} from "../../workspaces/public.ts";

export interface ApiTokenDependencies {
  readonly actorContext: ActorContext;
  readonly actors: ActorRevalidation;
  readonly audit: ApiTokenAudit;
  readonly clock: Clock;
  readonly ids: { next(): string };
  readonly issuers: ApiTokenIssuers;
  readonly repository: ApiTokenRepository;
  readonly secrets: ApiTokenSecrets;
  readonly transaction: ApiTokenTransactionRunner;
}

export interface ApiTokenManagement {
  authenticate(
    rawToken: string,
    requiredScope: ApiTokenScope,
    requestedWorkspaceId?: string,
  ): Promise<TokenAuthentication>;
  /**
   * The presented personal token and the membership it acts as, whatever
   * grant it carries (MCP-A1). Every other check `authenticate` makes still
   * applies — revoked, expired, the bound workspace, a current membership,
   * the secret — and the use is recorded the same way.
   */
  introspect(
    rawToken: string,
    requestedWorkspaceId?: string,
  ): Promise<TokenIntrospection>;
  create(actor: ApiTokenActor, input: ApiTokenInput): Promise<
    | {
      readonly record: ApiTokenRecord;
      readonly secret: string;
      readonly status: "created";
    }
    | Failure<"forbidden", "invalid">
  >;
  list(actor: ApiTokenActor): Promise<
    | {
      readonly records: readonly ApiTokenListEntry[];
      readonly status: "ready";
    }
    | Failure<"forbidden">
  >;
  revoke(actor: ApiTokenActor, id: string): Promise<
    | { readonly record: ApiTokenRecord; readonly status: "revoked" }
    | Failure<"forbidden" | "not-found">
  >;
  /**
   * Revokes every token `subjectUserId` holds in the actor's workspace,
   * inside the caller's transaction, audited against the actor. The caller
   * has already decided the member is gone; nothing is re-checked here.
   */
  revokeMemberCredentials(command: {
    readonly actor: ApiTokenActor;
    readonly occurredAt: Date;
    readonly subjectUserId: string;
    readonly transaction: ApiTokenTransaction;
  }): Promise<void>;
}

export function createApiTokenManagement(
  dependencies: ApiTokenDependencies,
): ApiTokenManagement {
  /**
   * The actor's standing, asked first inside the caller's transaction. Write
   * paths lock the actor's rows; the listing keeps its lock-free concurrency.
   */
  const active = async (
    actor: ApiTokenActor,
    transaction: ApiTokenTransaction,
    lock: boolean,
  ): Promise<boolean> =>
    await dependencies.actors.revalidate({ ...actor, lock, transaction }) ===
      "active";

  return {
    authenticate: (rawToken, requiredScope, requestedWorkspaceId) =>
      authenticatePresented(
        dependencies,
        parseToken(rawToken),
        requiredScope,
        requestedWorkspaceId,
      ),
    introspect: (rawToken, requestedWorkspaceId) =>
      introspectPresented(
        dependencies,
        parseToken(rawToken),
        requestedWorkspaceId,
      ),
    create: async (actor, input) => {
      if (!privileged(actor)) return { status: "forbidden" };
      const now = dependencies.clock.now();
      const values = validateApiToken(input, now);
      if (!values) return { status: "invalid" };
      const id = dependencies.ids.next();
      const secret = await dependencies.secrets.create();
      return await dependencies.transaction.run(async (transaction) => {
        if (!await active(actor, transaction, true)) {
          return { status: "forbidden" as const };
        }
        const created = await dependencies.repository.create({
          ...actor,
          ...values,
          hash: secret.hash,
          id,
          occurredAt: now,
          transaction,
        });
        if (created.status !== "created") return created;
        await dependencies.audit.record({
          action: "created",
          actor,
          occurredAt: now,
          record: created.record,
          transaction,
        });
        return {
          record: created.record,
          secret: renderToken(id, secret.raw),
          status: "created" as const,
        };
      }, { workspaceId: actor.workspaceId });
    },
    list: async (actor) => {
      if (!privileged(actor)) return { status: "forbidden" };
      return await dependencies.transaction.run(async (transaction) => {
        if (!await active(actor, transaction, false)) {
          return { status: "forbidden" as const };
        }
        const issued = await dependencies.repository.list({
          transaction,
          workspaceId: actor.workspaceId,
        });
        const issuers = await dependencies.issuers
          .listIdentityDisplaySummaries({
            transaction,
            userIds: [...new Set(issued.map((record) => record.userId))],
          });
        return {
          records: listedTokens(issued, issuers),
          status: "ready" as const,
        };
      }, { workspaceId: actor.workspaceId });
    },
    revoke: async (actor, id) => {
      if (!privileged(actor)) return { status: "forbidden" };
      const now = dependencies.clock.now();
      return await dependencies.transaction.run(async (transaction) => {
        if (!await active(actor, transaction, true)) {
          return { status: "forbidden" as const };
        }
        const result = await dependencies.repository.revoke({
          id,
          occurredAt: now,
          transaction,
          workspaceId: actor.workspaceId,
        });
        if (result.status !== "revoked") return result;
        await dependencies.audit.record({
          action: "revoked",
          actor,
          occurredAt: now,
          record: result.record,
          transaction,
        });
        return result;
      }, { workspaceId: actor.workspaceId });
    },
    revokeMemberCredentials: async (command) => {
      const revoked = await dependencies.repository.revokeHeldBy({
        occurredAt: command.occurredAt,
        transaction: command.transaction,
        userId: command.subjectUserId,
        workspaceId: command.actor.workspaceId,
      });
      for (const record of revoked) {
        await dependencies.audit.record({
          action: "revoked",
          actor: command.actor,
          occurredAt: command.occurredAt,
          record,
          transaction: command.transaction,
        });
      }
    },
  };
}
