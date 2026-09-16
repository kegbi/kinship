import type { Clock } from "../../../shared-kernel/clock.ts";
import type { Failure } from "../../../shared-kernel/result.ts";
import { runOrUnavailable } from "../../../shared-kernel/transaction.ts";
import { boundedText, isInstant } from "../../../shared-kernel/validation.ts";
import type { PeopleActor, PeopleTransaction } from "../../people/public.ts";
import type { JournalActivityReference } from "../../interactions/public.ts";

export interface StoredJournalPost {
  readonly body: string;
  readonly createdAt: string;
  readonly id: string;
  readonly occurredAt: string;
  readonly title?: string;
  readonly updatedAt: string;
}

export interface StoredDayRating {
  readonly comment?: string;
  readonly createdAt: string;
  readonly id: string;
  readonly ratedOn: string;
  readonly rating: number;
  readonly updatedAt: string;
}

export interface JournalRepository {
  createPost(
    command: PeopleActor & {
      readonly body: string;
      readonly id: string;
      readonly now: Date;
      readonly occurredAt: Date;
      readonly title?: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<
    | { readonly post: StoredJournalPost; readonly status: "created" }
    | Failure<"forbidden">
  >;
  deleteItem(
    command: PeopleActor & {
      readonly itemId: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<
    | {
      readonly itemType: "activity" | "day-rating" | "post";
      readonly status: "deleted";
    }
    | Failure<"forbidden" | "not-found">
  >;
  linkActivity(
    command: PeopleActor & {
      readonly activityId: string;
      readonly id: string;
      readonly occurredAt: Date;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<
    {
      readonly activityId: string;
      readonly id: string;
      readonly occurredAt: string;
      readonly status: "created";
    } | Failure<"forbidden" | "not-found">
  >;
  saveDayRating(
    command: PeopleActor & {
      readonly comment?: string;
      readonly id: string;
      readonly now: Date;
      readonly ratedOn: string;
      readonly rating: number;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<
    | {
      readonly rating: StoredDayRating;
      readonly status: "created" | "updated";
    }
    | Failure<"forbidden">
  >;
  updatePost(
    command: PeopleActor & {
      readonly body: string;
      readonly now: Date;
      readonly occurredAt: Date;
      readonly postId: string;
      readonly title?: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<
    | { readonly post: StoredJournalPost; readonly status: "updated" }
    | Failure<"forbidden" | "not-found">
  >;
}

export interface JournalAudit {
  record(command: {
    readonly action: "created" | "deleted" | "updated";
    readonly actor: PeopleActor;
    readonly itemId: string;
    readonly itemType: "activity" | "day-rating" | "post";
    readonly occurredAt: Date;
    readonly transaction: PeopleTransaction;
  }): Promise<string>;
}

export interface JournalManagementDependencies {
  readonly activities: JournalActivityReference;
  readonly audit: JournalAudit;
  readonly clock: Clock;
  readonly ids: { next(): string };
  readonly repository: JournalRepository;
  readonly transaction: {
    run<T>(work: (transaction: PeopleTransaction) => Promise<T>): Promise<T>;
  };
}

/** The point in time itself, because the repository writes a `Date`. */
function instant(value: string): Date | undefined {
  return isInstant(value) ? new Date(value) : undefined;
}

function date(value: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf()) &&
      parsed.toISOString().slice(0, 10) === value
    ? value
    : undefined;
}

export function createJournalManagement(
  dependencies: JournalManagementDependencies,
) {
  const execute = <T>(
    work: (transaction: PeopleTransaction, now: Date) => Promise<T>,
  ): Promise<T | Failure<"unavailable">> => {
    const now = dependencies.clock.now();
    return runOrUnavailable(
      dependencies.transaction,
      (transaction) => work(transaction, now),
    );
  };

  return {
    createPost: async (
      actor: PeopleActor,
      input: {
        readonly body: string;
        readonly occurredAt: string;
        readonly title?: string;
      },
    ) => {
      const body = boundedText(input.body, 50_000);
      const occurredAt = instant(input.occurredAt);
      const title = boundedText(input.title, 500);
      if (!body || !occurredAt || (input.title !== undefined && !title)) {
        return { status: "validation-error" as const };
      }
      return await execute(async (transaction, now) => {
        const result = await dependencies.repository.createPost({
          ...actor,
          body,
          id: dependencies.ids.next(),
          now,
          occurredAt,
          ...(title ? { title } : {}),
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
      actor: PeopleActor,
      itemId: string,
    ) =>
      await execute(async (transaction, now) => {
        const result = await dependencies.repository.deleteItem({
          ...actor,
          itemId,
          transaction,
        });
        if (result.status === "deleted") {
          await dependencies.audit.record({
            action: "deleted",
            actor,
            itemId,
            itemType: result.itemType,
            occurredAt: now,
            transaction,
          });
        }
        return result;
      }),
    linkActivity: async (actor: PeopleActor, activityId: string) =>
      await execute(async (transaction, now) => {
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
    saveDayRating: async (
      actor: PeopleActor,
      input: {
        readonly comment?: string;
        readonly ratedOn: string;
        readonly rating: number;
      },
    ) => {
      const ratedOn = date(input.ratedOn);
      const comment = boundedText(input.comment, 10_000);
      if (
        !ratedOn || !Number.isInteger(input.rating) || input.rating < 1 ||
        input.rating > 5 || (input.comment !== undefined && !comment)
      ) return { status: "validation-error" as const };
      return await execute(async (transaction, now) => {
        const result = await dependencies.repository.saveDayRating({
          ...actor,
          ...(comment ? { comment } : {}),
          id: dependencies.ids.next(),
          now,
          ratedOn,
          rating: input.rating,
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
      actor: PeopleActor,
      postId: string,
      input: {
        readonly body: string;
        readonly occurredAt: string;
        readonly title?: string;
      },
    ) => {
      const body = boundedText(input.body, 50_000);
      const occurredAt = instant(input.occurredAt);
      const title = boundedText(input.title, 500);
      if (!body || !occurredAt || (input.title !== undefined && !title)) {
        return { status: "validation-error" as const };
      }
      return await execute(async (transaction, now) => {
        const result = await dependencies.repository.updatePost({
          ...actor,
          body,
          now,
          occurredAt,
          postId,
          ...(title ? { title } : {}),
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
