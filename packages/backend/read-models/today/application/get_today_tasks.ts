import type { PeopleActor } from "../../../modules/people/public.ts";
import type { TaskRecord } from "../../../modules/planning/public.ts";

export interface TodayTasksRepository {
  getDueTasks(
    command: PeopleActor & {
      readonly dueBefore: Date;
      readonly limit: number;
    },
  ): Promise<
    | { readonly items: readonly TaskRecord[]; readonly status: "ready" }
    | { readonly status: "forbidden" }
  >;
}

export function createTodayTasks(dependencies: {
  readonly clock: { now(): Date };
  readonly repository: TodayTasksRepository;
}) {
  return {
    getDueTasks: (actor: PeopleActor) => {
      const dueBefore = dependencies.clock.now();
      dueBefore.setUTCDate(dueBefore.getUTCDate() + 30);
      return dependencies.repository.getDueTasks({
        ...actor,
        dueBefore,
        limit: 20,
      });
    },
  };
}

export type TodayTasks = ReturnType<typeof createTodayTasks>;
