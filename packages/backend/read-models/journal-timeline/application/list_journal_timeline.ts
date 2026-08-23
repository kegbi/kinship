import type { PeopleActor } from "../../../modules/people/public.ts";

export interface JournalLinkableActivity {
  readonly happenedAt: string;
  readonly id: string;
  readonly summary: string;
}

export type JournalTimelineItem =
  | {
    readonly activity: { readonly id: string; readonly summary: string };
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

export interface JournalTimelineRepository {
  read(
    actor: PeopleActor,
    itemId?: string,
  ): Promise<
    | {
      readonly activities: readonly JournalLinkableActivity[];
      readonly items: readonly JournalTimelineItem[];
      readonly status: "ready";
    }
    | { readonly status: "forbidden" | "not-found" }
  >;
}

export function createJournalTimeline(
  dependencies: { readonly repository: JournalTimelineRepository },
) {
  return {
    get: async (actor: PeopleActor, itemId: string) => {
      try {
        const result = await dependencies.repository.read(actor, itemId);
        if (result.status !== "ready") return result;
        return result.items[0]
          ? { item: result.items[0], status: "ready" as const }
          : { status: "not-found" as const };
      } catch {
        return { status: "unavailable" as const };
      }
    },
    list: async (actor: PeopleActor) => {
      try {
        return await dependencies.repository.read(actor);
      } catch {
        return { status: "unavailable" as const };
      }
    },
  };
}

export type JournalTimeline = ReturnType<typeof createJournalTimeline>;
