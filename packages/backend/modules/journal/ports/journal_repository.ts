/**
 * How the module stores the journal.
 *
 * Every method takes the actor as well as the transaction, because a journal
 * is one member's and the repository scopes each row by the workspace the
 * caller's standing was just established in. `deleteItem` answers with the
 * kind of item it removed rather than with nothing, because the audit event
 * has to name what went away and the row is gone by the time it is written.
 *
 * `lockRequest` and `findPost` are the retry and revision gates (MCP-D4): the
 * advisory lock a derived post identifier names serializes two retries of one
 * creation, and `findPost` reads the row a retry or a checked edit is judged
 * against, under a row lock when the edit is about to follow.
 *
 * `saveDayRating` is the one upsert: a workspace keeps one rating per day, so
 * the answer says whether the row was created or changed and the audit event
 * follows it.
 */

import type { Failure } from "../../../shared-kernel/result.ts";
import type {
  StoredDayRating,
  StoredJournalPost,
} from "../domain/journal_rules.ts";
import type { JournalActor, JournalTransaction } from "./context.ts";

/** The three kinds of item a journal holds. */
export type JournalItemType = "activity" | "day-rating" | "post";

export interface JournalRepository {
  createPost(
    command: JournalActor & {
      readonly body: string;
      readonly id: string;
      readonly now: Date;
      readonly occurredAt: Date;
      readonly title?: string;
      readonly transaction: JournalTransaction;
    },
  ): Promise<
    | { readonly post: StoredJournalPost; readonly status: "created" }
    | Failure<"forbidden">
  >;
  deleteItem(
    command: JournalActor & {
      readonly itemId: string;
      readonly transaction: JournalTransaction;
    },
  ): Promise<
    | {
      readonly itemType: JournalItemType;
      readonly status: "deleted";
    }
    | Failure<"forbidden" | "not-found">
  >;
  findPost(
    command: JournalActor & {
      readonly id: string;
      readonly lock: boolean;
      readonly transaction: JournalTransaction;
    },
  ): Promise<StoredJournalPost | undefined>;
  linkActivity(
    command: JournalActor & {
      readonly activityId: string;
      readonly id: string;
      readonly occurredAt: Date;
      readonly transaction: JournalTransaction;
    },
  ): Promise<
    {
      readonly activityId: string;
      readonly id: string;
      readonly occurredAt: string;
      readonly status: "created";
    } | Failure<"forbidden" | "not-found">
  >;
  lockRequest(command: {
    readonly id: string;
    readonly transaction: JournalTransaction;
  }): Promise<void>;
  saveDayRating(
    command: JournalActor & {
      readonly comment?: string;
      readonly id: string;
      readonly now: Date;
      readonly ratedOn: string;
      readonly rating: number;
      readonly transaction: JournalTransaction;
    },
  ): Promise<
    | {
      readonly rating: StoredDayRating;
      readonly status: "created" | "updated";
    }
    | Failure<"forbidden">
  >;
  updatePost(
    command: JournalActor & {
      readonly body: string;
      readonly now: Date;
      readonly occurredAt: Date;
      readonly postId: string;
      readonly title?: string;
      readonly transaction: JournalTransaction;
    },
  ): Promise<
    | { readonly post: StoredJournalPost; readonly status: "updated" }
    | Failure<"forbidden" | "not-found">
  >;
}
