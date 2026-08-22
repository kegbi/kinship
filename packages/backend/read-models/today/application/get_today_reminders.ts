import type { PeopleActor } from "../../../modules/people/public.ts";

interface TodayReminderBase {
  readonly attemptCount: number;
  readonly deliverAt: string;
  readonly id: string;
  readonly person: {
    readonly archived: boolean;
    readonly id: string;
    readonly name: string;
  };
  readonly title: string;
  readonly visibleAt?: string;
}

export type TodayReminderItem =
  | (TodayReminderBase & {
    readonly nextAttemptAt: string;
    readonly status: "retry";
  })
  | (TodayReminderBase & {
    readonly nextAttemptAt?: never;
    readonly status:
      | "claimed"
      | "failed"
      | "manual_attention"
      | "pending"
      | "sent";
  });

export interface TodayCadenceItem {
  readonly dueAt: string;
  readonly id: string;
  readonly lastContactedAt?: string;
  readonly person: {
    readonly archived: boolean;
    readonly id: string;
    readonly name: string;
  };
}

export interface TodayRemindersRepository {
  get(command: PeopleActor & { readonly now: Date }): Promise<
    | { readonly status: "forbidden" }
    | {
      readonly cadences: readonly TodayCadenceItem[];
      readonly reminders: readonly TodayReminderItem[];
      readonly status: "ready";
      readonly timezone: string;
    }
  >;
}

export function createTodayReminders(dependencies: {
  readonly clock: { now(): Date };
  readonly repository: TodayRemindersRepository;
}) {
  return {
    get: (actor: PeopleActor) =>
      dependencies.repository.get({ ...actor, now: dependencies.clock.now() }),
  };
}

export type TodayReminders = ReturnType<typeof createTodayReminders>;
