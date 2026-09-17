/**
 * Running one subscription against its remote.
 *
 * The run claims the subscription first, so a second run started while this
 * one is working finds it busy rather than racing it, and every later call
 * carries that claim. Losing the claim mid-run is not an error to swallow: it
 * is thrown, caught where the outcome is recorded, and reported as a partial
 * sync, because the rows this run stopped touching are another run's now.
 *
 * `applyChange` is the whole of what a remote change means locally. Matching
 * etags mean nothing happened. A delete archives the person or completes the
 * task rather than removing anything — a remote that forgets somebody is not
 * a reason for this workspace to. An update to an object that was deleted here
 * restores it first, because the remote is saying it is back. And an object
 * that has never been seen is created under an identifier derived from its
 * remote identity, so seeing it twice cannot make it twice.
 *
 * Every core refusal becomes a thrown error rather than a status, because the
 * write is inside the repository's claimed transaction: unwinding it is how a
 * checkpoint that would have lied about what was stored is never written.
 */

import {
  type DavRemoteChange,
  publicFailure,
  remoteIdentity,
} from "../domain/dav_rules.ts";
import type { DavActor } from "../ports/context.ts";
import type { DavRemoteClient } from "../ports/dav_remote.ts";
import { authorized, type DavSyncDependencies } from "./dav_context.ts";

export function createDavSynchronize(dependencies: DavSyncDependencies) {
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
    synchronize: async (actor: DavActor, subscriptionId: string) => {
      if (!await authorized(dependencies, actor)) {
        return { status: "forbidden" as const };
      }
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
