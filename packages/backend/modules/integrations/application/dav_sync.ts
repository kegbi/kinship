import type { Clock } from "../../../shared-kernel/clock.ts";
import type { IdGenerator } from "../../../shared-kernel/ids.ts";
import type { Failure } from "../../../shared-kernel/result.ts";

export type DavRole = "admin" | "member" | "owner";
export const DAV_REMOTE_URL_MAX_BYTES = 2_048;
export interface DavActor {
  readonly memberId: string;
  readonly role: DavRole;
  readonly userId: string;
  readonly workspaceId: string;
}
export type DavOutcome =
  | "auth-failure"
  | "conflict"
  | "never"
  | "partial"
  | "success";
export interface DavSubscription {
  readonly id: string;
  readonly isActive: boolean;
  readonly lastError?: string;
  readonly lastOutcome: DavOutcome;
  readonly lastSyncedAt?: string;
  readonly name: string;
  readonly remoteSyncToken?: string;
  readonly remoteUrl: string;
  readonly username?: string;
}
export interface StoredDavSubscription extends DavSubscription {
  readonly claimToken: string;
  readonly encryptedPassword: string;
}
export interface DavObjectCheckpoint {
  readonly coreId: string;
  readonly etag: string;
  readonly kind: "person" | "task";
  readonly status: "conflict" | "deleted" | "error" | "synced";
}
export interface DavObjectRecord extends DavObjectCheckpoint {
  readonly href: string;
  readonly payload: string;
  readonly uid: string;
}
export type DavPublicErrorCode =
  | "dav_authentication_failed"
  | "dav_claim_lost"
  | "dav_remote_conflict"
  | "dav_sync_failed";
export interface DavAuditEvent {
  readonly action: "configure" | "disable" | "sync";
  readonly code?: DavPublicErrorCode;
  readonly occurredAt: Date;
  readonly outcome: "conflict" | "failure" | "partial" | "success";
  readonly subscriptionId: string;
}
type ClaimCommand = DavActor & {
  readonly claimToken: string;
  readonly subscriptionId: string;
};
export interface DavTransaction {
  readonly opaque: unknown;
}
export interface DavRepository {
  authorize(actor: DavActor): Promise<boolean>;
  claim(
    actor: DavActor,
    subscriptionId: string,
    claimToken: string,
    claimedAt: Date,
  ): Promise<StoredDavSubscription | undefined>;
  create(
    command: DavActor & {
      readonly encryptedPassword: string;
      readonly id: string;
      readonly name: string;
      readonly occurredAt: Date;
      readonly remoteUrl: string;
      readonly username?: string;
    },
  ): Promise<DavSubscription | undefined>;
  disable(
    actor: DavActor,
    subscriptionId: string,
    occurredAt?: Date,
  ): Promise<DavSubscription | undefined>;
  withClaimedObject(
    command: ClaimCommand,
    href: string,
    work: (
      existing: DavObjectCheckpoint | undefined,
      transaction: DavTransaction,
    ) => Promise<DavObjectRecord | undefined>,
  ): Promise<"claim-lost" | "processed" | "skipped">;
  list(actor: DavActor): Promise<readonly DavSubscription[]>;
  recordAudit(actor: DavActor, event: DavAuditEvent): Promise<boolean>;
  recordOutcome(
    command: ClaimCommand,
    outcome: {
      readonly clearRemoteSyncToken?: boolean;
      readonly error?: DavPublicErrorCode;
      readonly occurredAt: Date;
      readonly remoteSyncToken?: string;
      readonly status: Exclude<DavOutcome, "never">;
    },
  ): Promise<DavSubscription | undefined>;
}

interface ContactPayload {
  readonly familyName?: string;
  readonly givenName: string;
  readonly nickname?: string;
}
interface TaskPayload {
  readonly description?: string;
  readonly dueAt?: string;
  readonly title: string;
}
type DavUpsertChange =
  | {
    readonly changeType: "create" | "update";
    readonly etag: string;
    readonly href: string;
    readonly kind: "person";
    readonly payload: ContactPayload;
    readonly raw?: string;
    readonly uid: string;
  }
  | {
    readonly changeType: "create" | "update";
    readonly etag: string;
    readonly href: string;
    readonly kind: "task";
    readonly payload: TaskPayload;
    readonly raw?: string;
    readonly uid: string;
  };
export type DavRemoteChange = DavUpsertChange | {
  readonly changeType: "delete";
  readonly etag: string;
  readonly href: string;
  readonly kind: "person" | "task";
  readonly uid: string;
};
export interface DavRemoteClient {
  pull(
    command: {
      readonly password: string;
      readonly remoteSyncToken?: string;
      readonly remoteUrl: string;
      readonly username?: string;
    },
  ): Promise<
    {
      readonly changes: readonly DavRemoteChange[];
      readonly remoteSyncToken: string;
    }
  >;
}
const REMOTE_MESSAGES = {
  auth: "Remote DAV authentication failed.",
  conflict: "Remote DAV state changed. A full retry is required.",
  temporary: "Remote DAV is temporarily unavailable.",
} as const;
export class DavRemoteFailure extends Error {
  constructor(readonly kind: keyof typeof REMOTE_MESSAGES, _detail?: string) {
    super(REMOTE_MESSAGES[kind]);
  }
}
interface PeopleFacade {
  ensure(
    actor: DavActor,
    input: ContactPayload & { readonly requestId: string },
    transaction: DavTransaction,
  ): Promise<
    | { readonly person: { readonly id: string }; readonly status: "ready" }
    | Failure<"forbidden", "idempotency-conflict" | "validation-error">
  >;
  update(
    actor: DavActor,
    personId: string,
    input: ContactPayload,
    transaction: DavTransaction,
  ): Promise<{ readonly status: string }>;
  archive(
    actor: DavActor,
    personId: string,
    transaction: DavTransaction,
  ): Promise<{ readonly status: string }>;
  restore(
    actor: DavActor,
    personId: string,
    transaction: DavTransaction,
  ): Promise<{ readonly status: string }>;
}
interface TaskFacade {
  create(
    actor: DavActor,
    input: TaskPayload & { readonly requestId: string },
    transaction: DavTransaction,
  ): Promise<
    | { readonly status: "created"; readonly task: { readonly id: string } }
    | Failure<
      "archived-write-rejected" | "forbidden" | "not-found",
      "idempotency-conflict" | "stale" | "validation-error"
    >
  >;
  update(
    actor: DavActor,
    taskId: string,
    input: TaskPayload,
    transaction: DavTransaction,
  ): Promise<{ readonly status: string }>;
  complete(
    actor: DavActor,
    taskId: string,
    transaction: DavTransaction,
  ): Promise<{ readonly status: string }>;
  reopen(
    actor: DavActor,
    taskId: string,
    transaction: DavTransaction,
  ): Promise<{ readonly status: string }>;
}
export interface DavSyncDependencies {
  readonly clock: Clock;
  readonly ids:
    & IdGenerator
    & { fromRemote(value: string): string | Promise<string> };
  readonly people: PeopleFacade;
  readonly remote: DavRemoteClient;
  readonly repository: DavRepository;
  readonly secrets: {
    open(value: string): Promise<string>;
    seal(value: string): Promise<string>;
  };
  readonly tasks: TaskFacade;
}

function validConfiguration(
  input: {
    readonly name: string;
    readonly password: string;
    readonly remoteUrl: string;
    readonly username?: string;
  },
) {
  try {
    const parsed = new URL(input.remoteUrl);
    const remoteUrl = parsed.toString();
    const name = input.name.trim();
    const username = input.username?.trim();
    if (
      new TextEncoder().encode(remoteUrl).length > DAV_REMOTE_URL_MAX_BYTES ||
      parsed.protocol !== "https:" || parsed.username || parsed.password ||
      !parsed.hostname || !name || name.length > 100 || !input.password ||
      input.password.length > 4096 || (username?.length ?? 0) > 255
    ) return undefined;
    return {
      name,
      remoteUrl,
      ...(username ? { username } : {}),
    };
  } catch {
    return undefined;
  }
}
function remoteIdentity(
  actor: DavActor,
  subscriptionId: string,
  change: DavRemoteChange,
) {
  return `${actor.workspaceId}:${subscriptionId}:${change.kind}:${change.uid}`;
}
function publicFailure(
  error: unknown,
): {
  readonly code: DavPublicErrorCode;
  readonly status: "auth-failure" | "conflict" | "partial";
} {
  if (error instanceof DavRemoteFailure && error.kind === "auth") {
    return { code: "dav_authentication_failed", status: "auth-failure" };
  }
  if (error instanceof DavRemoteFailure && error.kind === "conflict") {
    return { code: "dav_remote_conflict", status: "conflict" };
  }
  return { code: "dav_sync_failed", status: "partial" };
}

export function createDavSyncManagement(dependencies: DavSyncDependencies) {
  async function authorized(actor: DavActor) {
    return (actor.role === "owner" || actor.role === "admin") &&
      await dependencies.repository.authorize(actor);
  }
  async function applyChange(
    actor: DavActor,
    subscriptionId: string,
    claimToken: string,
    change: DavRemoteChange,
  ): Promise<"processed" | "skipped"> {
    const claim = { ...actor, claimToken, subscriptionId };
    const result = await dependencies.repository.withClaimedObject(
      claim,
      change.href,
      async (existing, transaction) => {
        if (existing?.etag === change.etag) return undefined;
        if (change.changeType === "delete") {
          if (!existing) return undefined;
          const deleted = existing.kind === "person"
            ? await dependencies.people.archive(
              actor,
              existing.coreId,
              transaction,
            )
            : await dependencies.tasks.complete(
              actor,
              existing.coreId,
              transaction,
            );
          if (!["archived", "saved", "unchanged"].includes(deleted.status)) {
            throw new Error("core-delete");
          }
          return {
            coreId: existing.coreId,
            etag: change.etag,
            href: change.href,
            kind: existing.kind,
            payload: "",
            status: "deleted" as const,
            uid: change.uid,
          };
        }
        let coreId = existing?.coreId;
        if (coreId) {
          if (existing?.status === "deleted") {
            const restored = change.kind === "person"
              ? await dependencies.people.restore(actor, coreId, transaction)
              : await dependencies.tasks.reopen(actor, coreId, transaction);
            if (!["restored", "saved", "unchanged"].includes(restored.status)) {
              throw new Error("core-restore");
            }
          }
          const updated = change.kind === "person"
            ? await dependencies.people.update(
              actor,
              coreId,
              change.payload,
              transaction,
            )
            : await dependencies.tasks.update(
              actor,
              coreId,
              change.payload,
              transaction,
            );
          if (!["updated", "saved", "unchanged"].includes(updated.status)) {
            throw new Error("core-update");
          }
        } else {
          const requestId = await dependencies.ids.fromRemote(
            remoteIdentity(actor, subscriptionId, change),
          );
          const created = change.kind === "person"
            ? await dependencies.people.ensure(actor, {
              ...change.payload,
              requestId,
            }, transaction)
            : await dependencies.tasks.create(actor, {
              ...change.payload,
              requestId,
            }, transaction);
          coreId = "person" in created
            ? created.person.id
            : "task" in created
            ? created.task.id
            : undefined;
          if (!coreId) throw new Error("core-create");
        }
        return {
          coreId,
          etag: change.etag,
          href: change.href,
          kind: change.kind,
          payload: change.raw ?? JSON.stringify(change.payload),
          status: "synced" as const,
          uid: change.uid,
        };
      },
    );
    if (result === "claim-lost") throw new Error("claim-lost");
    return result;
  }
  return {
    configure: async (
      actor: DavActor,
      input: {
        readonly name: string;
        readonly password: string;
        readonly remoteUrl: string;
        readonly username?: string;
      },
    ) => {
      if (!await authorized(actor)) return { status: "forbidden" as const };
      const id = dependencies.ids.create();
      const occurredAt = dependencies.clock.now();
      const recordFailure = () =>
        dependencies.repository.recordAudit(actor, {
          action: "configure",
          code: "dav_sync_failed",
          occurredAt,
          outcome: "failure",
          subscriptionId: id,
        });
      const checked = validConfiguration(input);
      if (!checked) {
        await recordFailure();
        return { status: "invalid" as const };
      }
      let subscription: DavSubscription | undefined;
      try {
        subscription = await dependencies.repository.create({
          ...actor,
          encryptedPassword: await dependencies.secrets.seal(input.password),
          id,
          occurredAt,
          ...checked,
        });
      } catch {
        await recordFailure();
        throw new Error("dav_sync_failed");
      }
      if (!subscription) {
        await recordFailure();
        return { status: "forbidden" as const };
      }
      return { status: "configured" as const, subscription };
    },
    disable: async (actor: DavActor, subscriptionId: string) => {
      if (!await authorized(actor)) return { status: "forbidden" as const };
      const subscription = await dependencies.repository.disable(
        actor,
        subscriptionId,
        dependencies.clock.now(),
      );
      return subscription
        ? { status: "disabled" as const, subscription }
        : { status: "not-found" as const };
    },
    list: async (actor: DavActor) =>
      !await authorized(actor)
        ? { status: "forbidden" as const, subscriptions: [] }
        : {
          status: "ready" as const,
          subscriptions: await dependencies.repository.list(actor),
        },
    synchronize: async (actor: DavActor, subscriptionId: string) => {
      if (!await authorized(actor)) return { status: "forbidden" as const };
      const claimToken = dependencies.ids.create();
      const subscription = await dependencies.repository.claim(
        actor,
        subscriptionId,
        claimToken,
        dependencies.clock.now(),
      );
      if (!subscription) {
        const visible = (await dependencies.repository.list(actor)).find((
          item,
        ) => item.id === subscriptionId);
        return visible
          ? { status: visible.isActive ? "busy" as const : "disabled" as const }
          : { status: "not-found" as const };
      }
      const claim = { ...actor, claimToken, subscriptionId };
      let pulled: Awaited<ReturnType<DavRemoteClient["pull"]>>;
      try {
        pulled = await dependencies.remote.pull({
          password: await dependencies.secrets.open(
            subscription.encryptedPassword,
          ),
          ...(subscription.remoteSyncToken
            ? { remoteSyncToken: subscription.remoteSyncToken }
            : {}),
          remoteUrl: subscription.remoteUrl,
          ...(subscription.username ? { username: subscription.username } : {}),
        });
      } catch (error) {
        const failure = publicFailure(error);
        const saved = await dependencies.repository.recordOutcome(claim, {
          ...(failure.status === "conflict"
            ? { clearRemoteSyncToken: true }
            : {}),
          error: failure.code,
          occurredAt: dependencies.clock.now(),
          status: failure.status,
        });
        return saved
          ? { status: failure.status, subscription: saved }
          : { status: "busy" as const };
      }
      let processed = 0;
      try {
        for (const change of pulled.changes) {
          if (
            await applyChange(actor, subscriptionId, claimToken, change) ===
              "processed"
          ) processed++;
        }
      } catch (error) {
        const code = error instanceof Error && error.message === "claim-lost"
          ? "dav_claim_lost"
          : "dav_sync_failed";
        const saved = await dependencies.repository.recordOutcome(claim, {
          error: code,
          occurredAt: dependencies.clock.now(),
          status: "partial",
        });
        return saved
          ? { processed, status: "partial" as const, subscription: saved }
          : { status: "busy" as const };
      }
      const saved = await dependencies.repository.recordOutcome(claim, {
        occurredAt: dependencies.clock.now(),
        remoteSyncToken: pulled.remoteSyncToken,
        status: "success",
      });
      return saved
        ? { processed, status: "success" as const, subscription: saved }
        : { status: "busy" as const };
    },
  };
}
export type DavSyncManagement = ReturnType<typeof createDavSyncManagement>;
