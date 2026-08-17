import type {
  ActivityReportActor,
  ActivityReportItem,
} from "../../activity-report/public.ts";

export interface TodayInteractionsRepository {
  getFavoriteNotes(
    command: ActivityReportActor & {
      readonly favoriteLimit: number;
    },
  ): Promise<
    | {
      readonly items: readonly Extract<
        ActivityReportItem,
        { readonly kind: "note" }
      >[];
      readonly status: "ready";
    }
    | { readonly status: "forbidden" }
  >;
  getRecentActivity(
    command: ActivityReportActor & {
      readonly recentLimit: number;
    },
  ): Promise<
    | {
      readonly items: readonly ActivityReportItem[];
      readonly status: "ready";
    }
    | { readonly status: "forbidden" }
  >;
}

export function createTodayInteractions(dependencies: {
  readonly repository: TodayInteractionsRepository;
}) {
  return {
    getFavoriteNotes: (actor: ActivityReportActor) =>
      dependencies.repository.getFavoriteNotes({
        ...actor,
        favoriteLimit: 8,
      }),
    getRecentActivity: (actor: ActivityReportActor) =>
      dependencies.repository.getRecentActivity({
        ...actor,
        recentLimit: 20,
      }),
  };
}

export type TodayInteractions = ReturnType<typeof createTodayInteractions>;
