import type { Failure } from "../../../shared-kernel/result.ts";
import type { ActorRevalidation } from "../../../modules/workspaces/public.ts";

export interface ReadModelTransaction {
  readonly opaque: unknown;
}
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
    | Failure<"forbidden">
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
    | Failure<"forbidden">
  >;
}

/**
 * Read models carry no actor join of their own. The `workspaces` port answers
 * whether the actor may still read this workspace — without a lock, because
 * these paths take none — and the repository scopes by workspace alone.
 */
export function createTodayInteractions(dependencies: {
  readonly actors: ActorRevalidation;
  readonly transaction: {
    run<T>(
      work: (transaction: ReadModelTransaction) => Promise<T>,
    ): Promise<T>;
  };
  readonly repository: TodayInteractionsRepository;
}) {
  const readable = async (
    actor: {
      readonly memberId: string;
      readonly role: "admin" | "member" | "owner";
      readonly userId: string;
      readonly workspaceId: string;
    },
  ): Promise<boolean> =>
    await dependencies.transaction.run((transaction) =>
      dependencies.actors.revalidate({ ...actor, lock: false, transaction })
    ) === "active";

  return {
    getFavoriteNotes: async (actor: ActivityReportActor) =>
      await readable(actor)
        ? await dependencies.repository.getFavoriteNotes({
          ...actor,
          favoriteLimit: 8,
        })
        : { status: "forbidden" as const },
    getRecentActivity: async (actor: ActivityReportActor) =>
      await readable(actor)
        ? await dependencies.repository.getRecentActivity({
          ...actor,
          recentLimit: 20,
        })
        : { status: "forbidden" as const },
  };
}

export type TodayInteractions = ReturnType<typeof createTodayInteractions>;
