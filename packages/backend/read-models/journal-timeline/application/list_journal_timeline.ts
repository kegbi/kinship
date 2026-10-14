import type { Failure } from "../../../shared-kernel/result.ts";
import {
  decodeJournalCursor,
  encodeJournalCursor,
  type JournalPageAnchor,
} from "../../../modules/journal/public.ts";
import type { PeopleActor } from "../../../modules/people/public.ts";
import type { ActorRevalidation } from "../../../modules/workspaces/public.ts";

/** The largest page this timeline serves, as the contract publishes it. */
export const JOURNAL_PAGE_LIMIT_MAXIMUM = 50;
/** The page it serves when the caller names no size. */
export const JOURNAL_PAGE_LIMIT_DEFAULT = 20;

/** Where a caller asked the timeline to resume, and how many rows. */
export interface ListJournalInput {
  readonly cursor?: string;
  readonly limit?: number;
}

/** The page size this timeline accepts, clamped to what it will serve. */
export function journalPageLimit(limit: number | undefined): number {
  return Math.max(
    1,
    Math.min(
      JOURNAL_PAGE_LIMIT_MAXIMUM,
      Math.trunc(limit ?? JOURNAL_PAGE_LIMIT_DEFAULT),
    ),
  );
}

export interface ReadModelTransaction {
  readonly opaque: unknown;
}

export interface JournalLinkableActivity {
  readonly happenedAt: string;
  readonly id: string;
  readonly summary: string;
}

export type JournalTimelineItem =
  | {
    readonly activity: {
      readonly id: string;
      readonly participants: readonly {
        readonly id: string;
        readonly name: string;
      }[];
      readonly summary: string;
    };
    readonly id: string;
    readonly occurredAt: string;
    readonly type: "activity";
  }
  | {
    readonly dayRating: {
      readonly comment?: string;
      readonly id: string;
      readonly ratedOn: string;
      readonly rating: number;
    };
    readonly id: string;
    readonly occurredAt: string;
    readonly type: "day-rating";
  }
  | {
    readonly id: string;
    readonly occurredAt: string;
    readonly post: {
      readonly body: string;
      readonly id: string;
      readonly title?: string;
      readonly updatedAt: string;
    };
    readonly type: "post";
  };

/** What one page of the timeline asks for. */
export interface JournalTimelineQuery {
  readonly after?: JournalPageAnchor;
  readonly itemId?: string;
  readonly limit: number;
}

export interface JournalTimelineRepository {
  read(
    actor: PeopleActor,
    query: JournalTimelineQuery,
  ): Promise<
    | {
      readonly activities: readonly JournalLinkableActivity[];
      readonly items: readonly JournalTimelineItem[];
      readonly next?: JournalPageAnchor;
      readonly status: "ready";
    }
    | Failure<"forbidden" | "not-found">
  >;
}

export function createJournalTimeline(
  dependencies: {
    readonly actors: ActorRevalidation;
    readonly transaction: {
      run<T>(
        work: (transaction: ReadModelTransaction) => Promise<T>,
      ): Promise<T>;
    };
    readonly repository: JournalTimelineRepository;
  },
) {
  const readable = async (actor: PeopleActor): Promise<boolean> =>
    await dependencies.transaction.run((transaction) =>
      dependencies.actors.revalidate({ ...actor, lock: false, transaction })
    ) === "active";

  return {
    get: async (actor: PeopleActor, itemId: string) => {
      try {
        if (!await readable(actor)) return { status: "forbidden" as const };
        const result = await dependencies.repository.read(actor, {
          itemId,
          limit: 1,
        });
        if (result.status !== "ready") return result;
        return result.items[0]
          ? { item: result.items[0], status: "ready" as const }
          : { status: "not-found" as const };
      } catch {
        return { status: "unavailable" as const };
      }
    },
    list: async (actor: PeopleActor, input: ListJournalInput = {}) => {
      const after = input.cursor
        ? decodeJournalCursor(input.cursor, actor.workspaceId)
        : undefined;
      if (input.cursor && !after) {
        return { status: "validation-error" as const };
      }
      try {
        if (!await readable(actor)) return { status: "forbidden" as const };
        const result = await dependencies.repository.read(actor, {
          ...(after ? { after } : {}),
          limit: journalPageLimit(input.limit),
        });
        if (result.status !== "ready") return result;
        const { next, ...page } = result;
        return {
          ...page,
          ...(next
            ? { nextCursor: encodeJournalCursor(next, actor.workspaceId) }
            : {}),
        };
      } catch {
        return { status: "unavailable" as const };
      }
    },
  };
}

export type JournalTimeline = ReturnType<typeof createJournalTimeline>;
