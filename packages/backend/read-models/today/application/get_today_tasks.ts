import type { TransactionScope } from "../../../shared-kernel/transaction.ts";
import type { Clock } from "../../../shared-kernel/clock.ts";
import type { Failure } from "../../../shared-kernel/result.ts";
import type { PeopleActor } from "../../../modules/people/public.ts";
import type { TaskRecord } from "../../../modules/planning/public.ts";
import {
  actorMayRead,
  type ActorRevalidation,
} from "../../../modules/workspaces/public.ts";
import type { ReadModelTransaction } from "./get_today_interactions.ts";

export interface TodayTasksRepository {
  getDueTasks(
    command: PeopleActor & {
      readonly dueBefore: Date;
      readonly limit: number;
    },
  ): Promise<
    | { readonly items: readonly TaskRecord[]; readonly status: "ready" }
    | Failure<"forbidden">
  >;
}

/**
 * Read models carry no actor join of their own. The `workspaces` port answers
 * whether the actor may still read this workspace — without a lock, because
 * these paths take none — and the repository scopes by workspace alone.
 */
export function createTodayTasks(dependencies: {
  readonly actors: ActorRevalidation;
  readonly transaction: {
    run<T>(
      work: (transaction: ReadModelTransaction) => Promise<T>,
      scope?: TransactionScope,
    ): Promise<T>;
  };
  readonly clock: Clock;
  readonly repository: TodayTasksRepository;
}) {
  const readable = async (
    actor: {
      readonly memberId: string;
      readonly role: "admin" | "member" | "owner";
      readonly userId: string;
      readonly workspaceId: string;
    },
  ): Promise<boolean> => await actorMayRead(dependencies, actor);

  return {
    getDueTasks: async (actor: PeopleActor) => {
      if (!await readable(actor)) return { status: "forbidden" as const };
      const dueBefore = dependencies.clock.now();
      dueBefore.setUTCDate(dueBefore.getUTCDate() + 30);
      return await dependencies.repository.getDueTasks({
        ...actor,
        dueBefore,
        limit: 20,
      });
    },
  };
}

export type TodayTasks = ReturnType<typeof createTodayTasks>;
