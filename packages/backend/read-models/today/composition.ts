/**
 * Today composition. Only a declared composition root imports it.
 *
 * The five panels of the today page are one read model with five repositories.
 */

import type { SharedComposition } from "../../platform/composition.ts";
import { PostgresTodayAttentionRepository } from "./adapters/postgres/today_attention_repository.ts";
import { PostgresTodayInteractionsRepository } from "./adapters/postgres/today_interactions_repository.ts";
import { PostgresTodayRecentPeopleRepository } from "./adapters/postgres/today_recent_people_repository.ts";
import { PostgresTodayRemindersRepository } from "./adapters/postgres/today_reminders_repository.ts";
import { PostgresTodayTasksRepository } from "./adapters/postgres/today_tasks_repository.ts";
import {
  createTodayAttention,
  createTodayInteractions,
  createTodayRecentPeople,
  createTodayReminders,
  createTodayTasks,
} from "./public.ts";

export function composeToday(shared: SharedComposition) {
  const scope = {
    actors: shared.actors,
    transaction: shared.peopleTransaction,
  };
  const timed = { ...scope, clock: shared.clock };
  return {
    attention: createTodayAttention({
      ...timed,
      repository: new PostgresTodayAttentionRepository(shared.database),
    }),
    interactions: createTodayInteractions({
      ...scope,
      repository: new PostgresTodayInteractionsRepository(shared.database),
    }),
    recentPeople: createTodayRecentPeople({
      ...scope,
      repository: new PostgresTodayRecentPeopleRepository(shared.database),
    }),
    reminders: createTodayReminders({
      ...timed,
      repository: new PostgresTodayRemindersRepository(shared.database),
    }),
    tasks: createTodayTasks({
      ...timed,
      repository: new PostgresTodayTasksRepository(shared.database),
    }),
  };
}
