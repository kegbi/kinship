/**
 * The journal use case.
 *
 * Every mutation here has the same shape: check what the member wrote, open
 * one transaction, re-establish their standing under lock inside it, do the
 * work, and record the audit event beside it. What the member wrote is judged
 * by `domain/journal_rules.ts` and the work itself is the repository's, so
 * what is left in this file is the order of those steps and nothing else.
 *
 * Two of those steps are optional and only run when the caller asks (MCP-D4).
 * A post created with a `requestId` derives its identifier from it, the way a
 * task does: the identifier is locked, a post already stored under it is
 * returned when it is the same post and refused as `idempotency-conflict`
 * when it is not. A post edited with `expectedUpdatedAt` is read under lock
 * first and refused as `stale` when that is no longer its revision. Without
 * either field both writes are exactly what they were.
 *
 * A post is deleted permanently, so its delete leaves a request tombstone in
 * the same transaction (MCP-E3), and a keyed create that finds no row under
 * its derived identifier asks for one and is refused as `request-deleted`
 * rather than recording the post again. The row is read before the tombstone:
 * under READ COMMITTED each statement sees every delete committed before it
 * began, and a delete removes the row and writes its tombstone in one commit,
 * so a create that missed the row cannot also miss the tombstone.
 */

import type { Clock } from "../../../shared-kernel/clock.ts";
import type { RequestTombstones } from "../../../shared-kernel/request_tombstone.ts";
import type { Failure } from "../../../shared-kernel/result.ts";
import { runOrUnavailable } from "../../../shared-kernel/transaction.ts";
import { isInstant, uuid } from "../../../shared-kernel/validation.ts";
import {
  type DayRatingInput,
  deriveJournalPostId,
  instant,
  type JournalPostCreateInput,
  type JournalPostUpdateInput,
  postMatches,
  validateDayRating,
  validateJournalPost,
} from "../domain/journal_rules.ts";
import type { JournalAudit } from "../ports/audit.ts";
import type {
  JournalActor,
  JournalTransaction,
  JournalTransactionRunner,
} from "../ports/context.ts";
import type { JournalRepository } from "../ports/journal_repository.ts";
import type { JournalActivityReference } from "../../interactions/public.ts";
import type { ActorRevalidation } from "../../workspaces/public.ts";

export interface JournalManagementDependencies {
  readonly activities: JournalActivityReference;
  readonly actors: ActorRevalidation;
  readonly audit: JournalAudit;
  readonly clock: Clock;
  readonly ids: { next(): string };
  readonly repository: JournalRepository;
  /** Governance's request tombstones, for a deleted keyed post (MCP-E3). */
  readonly tombstones: RequestTombstones;
  readonly transaction: JournalTransactionRunner;
}

export function createJournalManagement(
  dependencies: JournalManagementDependencies,
) {
  /**
   * Every journal mutation runs here: one transaction, the actor's standing
   * verified under lock first, then the work. The repository no longer carries
   * its own copy of that join and scopes by workspace alone.
   */
  const execute = <T>(
    actor: JournalActor,
    work: (transaction: JournalTransaction, now: Date) => Promise<T>,
  ): Promise<T | Failure<"forbidden" | "unavailable">> => {
    const now = dependencies.clock.now();
    return runOrUnavailable(
      dependencies.transaction,
      async (transaction) => {
        const standing = await dependencies.actors.revalidate({
          ...actor,
          lock: true,
          transaction,
        });
        if (standing === "revoked") return { status: "forbidden" as const };
        return await work(transaction, now);
      },
      { workspaceId: actor.workspaceId },
    );
  };

  return {
    createPost: async (actor: JournalActor, input: JournalPostCreateInput) => {
      const values = validateJournalPost(input);
      const requestId = input.requestId === undefined
        ? undefined
        : uuid(input.requestId);
      if (!values || (input.requestId !== undefined && !requestId)) {
        return { status: "validation-error" as const };
      }
      return await execute(actor, async (transaction, now) => {
        const id = requestId
          ? await deriveJournalPostId(actor.workspaceId, requestId)
          : dependencies.ids.next();
        if (requestId) {
          await dependencies.repository.lockRequest({ id, transaction });
          const replay = await dependencies.repository.findPost({
            ...actor,
            id,
            lock: false,
            transaction,
          });
          if (replay) {
            return postMatches(replay, values)
              ? { post: replay, status: "created" as const }
              : { status: "idempotency-conflict" as const };
          }
          if (
            await dependencies.tombstones.recorded({
              recordId: id,
              transaction,
              workspaceId: actor.workspaceId,
            })
          ) return { status: "request-deleted" as const };
        }
        const result = await dependencies.repository.createPost({
          ...actor,
          ...values,
          id,
          now,
          transaction,
        });
        if (result.status === "created") {
          await dependencies.audit.record({
            action: "created",
            actor,
            itemId: result.post.id,
            itemType: "post",
            occurredAt: now,
            transaction,
          });
        }
        return result;
      });
    },
    deleteItem: async (
      actor: JournalActor,
      itemId: string,
    ) =>
      await execute(actor, async (transaction, now) => {
        const result = await dependencies.repository.deleteItem({
          ...actor,
          itemId,
          transaction,
        });
        if (result.status === "deleted") {
          if (result.postId) {
            await dependencies.tombstones.record({
              deletedAt: now,
              kind: "journal_post",
              recordId: result.postId,
              transaction,
              workspaceId: actor.workspaceId,
            });
          }
          await dependencies.audit.record({
            action: "deleted",
            actor,
            itemId,
            itemType: result.itemType,
            occurredAt: now,
            transaction,
          });
        }
        return result.status === "deleted"
          ? { itemType: result.itemType, status: result.status }
          : result;
      }),
    linkActivity: async (actor: JournalActor, activityId: string) =>
      await execute(actor, async (transaction, now) => {
        const activity = await dependencies.activities.inspect({
          ...actor,
          activityId,
          transaction,
        });
        if (activity.status !== "ready") return activity;
        const occurredAt = instant(activity.occurredAt);
        if (!occurredAt) return { status: "unavailable" as const };
        const result = await dependencies.repository.linkActivity({
          ...actor,
          activityId,
          id: dependencies.ids.next(),
          occurredAt,
          transaction,
        });
        if (result.status === "created") {
          await dependencies.audit.record({
            action: "created",
            actor,
            itemId: result.id,
            itemType: "activity",
            occurredAt: now,
            transaction,
          });
        }
        return result;
      }),
    saveDayRating: async (actor: JournalActor, input: DayRatingInput) => {
      const values = validateDayRating(input);
      if (!values) return { status: "validation-error" as const };
      return await execute(actor, async (transaction, now) => {
        const result = await dependencies.repository.saveDayRating({
          ...actor,
          ...values,
          id: dependencies.ids.next(),
          now,
          transaction,
        });
        if (result.status !== "forbidden") {
          await dependencies.audit.record({
            action: result.status === "created" ? "created" : "updated",
            actor,
            itemId: result.rating.id,
            itemType: "day-rating",
            occurredAt: now,
            transaction,
          });
        }
        return result;
      });
    },
    updatePost: async (
      actor: JournalActor,
      postId: string,
      input: JournalPostUpdateInput,
    ) => {
      const values = validateJournalPost(input);
      const expected = input.expectedUpdatedAt;
      if (!values || (expected !== undefined && !isInstant(expected))) {
        return { status: "validation-error" as const };
      }
      return await execute(actor, async (transaction, now) => {
        if (expected !== undefined) {
          const current = await dependencies.repository.findPost({
            ...actor,
            id: postId,
            lock: true,
            transaction,
          });
          if (!current) return { status: "not-found" as const };
          // A revision is compared exactly as the database issued it.
          if (current.updatedAt !== expected) {
            return { status: "stale" as const };
          }
        }
        const result = await dependencies.repository.updatePost({
          ...actor,
          ...values,
          now,
          postId,
          transaction,
        });
        if (result.status === "updated") {
          await dependencies.audit.record({
            action: "updated",
            actor,
            itemId: result.post.id,
            itemType: "post",
            occurredAt: now,
            transaction,
          });
        }
        return result;
      });
    },
  };
}

export type JournalManagement = ReturnType<typeof createJournalManagement>;
