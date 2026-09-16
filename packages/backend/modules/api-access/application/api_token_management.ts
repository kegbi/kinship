import type { Clock } from "../../../shared-kernel/clock.ts";
import type { Failure } from "../../../shared-kernel/result.ts";
import type {
  ActorContext,
  ActorRevalidation,
} from "../../workspaces/public.ts";

export const API_TOKEN_SCOPES = ["people:read"] as const;
export type ApiTokenScope = typeof API_TOKEN_SCOPES[number];

export interface ApiTokenActor {
  readonly memberId: string;
  readonly role: "owner" | "admin" | "member";
  readonly userId: string;
  readonly workspaceId: string;
}

export interface ApiTokenRecord {
  readonly createdAt: string;
  readonly expiresAt?: string;
  readonly id: string;
  readonly lastUsedAt?: string;
  readonly name: string;
  readonly revokedAt?: string;
  readonly scopes: readonly ApiTokenScope[];
}

export interface ApiTokenTransaction {
  readonly opaque: unknown;
}

export interface ApiTokenRepository {
  create(
    command: ApiTokenActor & {
      readonly expiresAt?: Date;
      readonly hash: string;
      readonly id: string;
      readonly name: string;
      readonly occurredAt: Date;
      readonly scopes: readonly ApiTokenScope[];
      readonly transaction: ApiTokenTransaction;
    },
  ): Promise<
    | { readonly record: ApiTokenRecord; readonly status: "created" }
    | Failure<"forbidden">
  >;
  findForAuthentication(command: {
    readonly id: string;
    readonly transaction: ApiTokenTransaction;
  }): Promise<
    | {
      readonly hash: string;
      readonly record: ApiTokenRecord;
      readonly status: "found";
      readonly userId: string;
      readonly workspaceId: string;
    }
    | Failure<"not-found">
  >;
  list(
    command: ApiTokenActor & { readonly transaction: ApiTokenTransaction },
  ): Promise<readonly ApiTokenRecord[]>;
  markUsed(command: {
    readonly id: string;
    readonly occurredAt: Date;
    readonly transaction: ApiTokenTransaction;
  }): Promise<boolean>;
  revoke(
    command: ApiTokenActor & {
      readonly id: string;
      readonly occurredAt: Date;
      readonly transaction: ApiTokenTransaction;
    },
  ): Promise<
    | { readonly record: ApiTokenRecord; readonly status: "revoked" }
    | Failure<"forbidden" | "not-found">
  >;
}

export interface ApiTokenAudit {
  record(command: {
    readonly action: "created" | "revoked";
    readonly actor: ApiTokenActor;
    readonly occurredAt: Date;
    readonly record: ApiTokenRecord;
    readonly transaction: ApiTokenTransaction;
  }): Promise<void>;
}

export interface ApiTokenDependencies {
  readonly actorContext: ActorContext;
  readonly actors: ActorRevalidation;
  readonly audit: ApiTokenAudit;
  readonly clock: Clock;
  readonly ids: { next(): string };
  readonly repository: ApiTokenRepository;
  readonly secrets: {
    create(): Promise<{ readonly hash: string; readonly raw: string }>;
    matches(raw: string, hash: string): Promise<boolean>;
  };
  readonly transaction: {
    run<T>(work: (transaction: ApiTokenTransaction) => Promise<T>): Promise<T>;
  };
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
  create(actor: ApiTokenActor, input: {
    readonly expiresAt?: string;
    readonly name: string;
    readonly scopes: readonly ApiTokenScope[];
  }): Promise<
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

const tokenPattern =
  /^kin_pat_([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Za-z0-9_-]{16,128})$/i;

function privileged(actor: ApiTokenActor): boolean {
  return actor.role === "owner" || actor.role === "admin";
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
    authenticate: async (rawToken, requiredScope, requestedWorkspaceId) => {
      const matched = tokenPattern.exec(rawToken);
      if (!matched?.[1] || !matched[2]) return { status: "invalid" };
      const id = matched[1];
      const rawSecret = matched[2];
      return await dependencies.transaction.run(async (transaction) => {
        const found = await dependencies.repository.findForAuthentication({
          id,
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
        const valid = !found.record.revokedAt &&
          (!found.record.expiresAt ||
            Date.parse(found.record.expiresAt) > now.getTime()) &&
          found.record.scopes.includes(requiredScope) &&
          (!requestedWorkspaceId ||
            actor.workspaceId === requestedWorkspaceId) &&
          await dependencies.secrets.matches(rawSecret, found.hash);
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
    },
    create: async (actor, input) => {
      if (!privileged(actor)) return { status: "forbidden" };
      const name = input.name.trim();
      const scopes = [...new Set(input.scopes)];
      const now = dependencies.clock.now();
      const expiresAt = input.expiresAt ? new Date(input.expiresAt) : undefined;
      if (
        name.length < 1 || name.length > 100 || scopes.length < 1 ||
        scopes.length !== input.scopes.length ||
        scopes.some((scope) => !API_TOKEN_SCOPES.includes(scope)) ||
        (expiresAt &&
          (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now))
      ) return { status: "invalid" };
      const id = dependencies.ids.next();
      const secret = await dependencies.secrets.create();
      return await dependencies.transaction.run(async (transaction) => {
        if (!await active(actor, transaction, true)) {
          return { status: "forbidden" as const };
        }
        const created = await dependencies.repository.create({
          ...actor,
          ...(expiresAt ? { expiresAt } : {}),
          hash: secret.hash,
          id,
          name,
          occurredAt: now,
          scopes,
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
          secret: `kin_pat_${id}.${secret.raw}`,
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
