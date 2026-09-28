/**
 * The personal access token use case.
 *
 * Three of the four paths have the same shape: refuse a member outright, open
 * one transaction, re-establish the caller's standing inside it, do the work,
 * and record the audit event beside it. Only the listing takes no lock, so a
 * page of tokens cannot block one being minted.
 *
 * `authenticate` is the fourth and reads the other way round. Nobody has
 * established an actor yet — all that has arrived is a string somebody pasted
 * into a program — so the token is parsed, the row is found by the identifier
 * inside it, and `workspaces` is asked whether the user and workspace it names
 * still add up to somebody. Only then is the secret compared, because that is
 * the one expensive step and everything cheaper has already had its chance to
 * refuse. `markUsed` is what makes the acceptance visible to its owner.
 */

import type { Clock } from "../../../shared-kernel/clock.ts";
import type { Failure } from "../../../shared-kernel/result.ts";
import {
  type ApiTokenInput,
  type ApiTokenRecord,
  type ApiTokenScope,
  parseToken,
  privileged,
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
import type { ApiTokenSecrets } from "../ports/secrets.ts";
import { authenticatePresented } from "./token_authentication.ts";
import type {
  ActorContext,
  ActorRevalidation,
} from "../../workspaces/public.ts";

export interface ApiTokenDependencies {
  readonly actorContext: ActorContext;
  readonly actors: ActorRevalidation;
  readonly audit: ApiTokenAudit;
  readonly clock: Clock;
  readonly ids: { next(): string };
  readonly repository: ApiTokenRepository;
  readonly secrets: ApiTokenSecrets;
  readonly transaction: ApiTokenTransactionRunner;
}

export interface ApiTokenManagement {
  authenticate(
    rawToken: string,
    requiredScope: ApiTokenScope,
    requestedWorkspaceId?: string,
  ): Promise<
    | { readonly actor: ApiTokenActor; readonly status: "authenticated" }
    | { readonly status: "invalid" }
  >;
  create(actor: ApiTokenActor, input: ApiTokenInput): Promise<
    | {
      readonly record: ApiTokenRecord;
      readonly secret: string;
      readonly status: "created";
    }
    | Failure<"forbidden", "invalid">
  >;
  list(actor: ApiTokenActor): Promise<
    | { readonly records: readonly ApiTokenRecord[]; readonly status: "ready" }
    | Failure<"forbidden">
  >;
  revoke(actor: ApiTokenActor, id: string): Promise<
    | { readonly record: ApiTokenRecord; readonly status: "revoked" }
    | Failure<"forbidden" | "not-found">
  >;
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
      });
    },
    list: async (actor) => {
      if (!privileged(actor)) return { status: "forbidden" };
      return await dependencies.transaction.run(async (transaction) => {
        if (!await active(actor, transaction, false)) {
          return { status: "forbidden" as const };
        }
        const records = await dependencies.repository.list({
          ...actor,
          transaction,
        });
        return { records, status: "ready" as const };
      });
    },
    revoke: async (actor, id) => {
      if (!privileged(actor)) return { status: "forbidden" };
      const now = dependencies.clock.now();
      return await dependencies.transaction.run(async (transaction) => {
        if (!await active(actor, transaction, true)) {
          return { status: "forbidden" as const };
        }
        const result = await dependencies.repository.revoke({
          ...actor,
          id,
          occurredAt: now,
          transaction,
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
      });
    },
  };
}
