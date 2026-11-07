import type { Clock } from "../../../shared-kernel/clock.ts";
import type { Failure } from "../../../shared-kernel/result.ts";
import type { PeopleActor } from "../../../modules/people/public.ts";
import {
  actorMayRead,
  type ActorRevalidation,
} from "../../../modules/workspaces/public.ts";
import type { ReadModelTransaction } from "./get_today_interactions.ts";

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
    | Failure<"forbidden">
    | {
      readonly cadences: readonly TodayCadenceItem[];
      readonly reminders: readonly TodayReminderItem[];
      readonly status: "ready";
      readonly timezone: string;
    }
  >;
}

/**
 * Read models carry no actor join of their own. The `workspaces` port answers
 * whether the actor may still read this workspace — without a lock, because
 * these paths take none — and the repository scopes by workspace alone.
 */
export function createTodayReminders(dependencies: {
  readonly actors: ActorRevalidation;
  readonly transaction: {
    run<T>(
      work: (transaction: ReadModelTransaction) => Promise<T>,
    ): Promise<T>;
  };
  readonly clock: Clock;
  readonly repository: TodayRemindersRepository;
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
    get: async (actor: PeopleActor) =>
      await readable(actor)
        ? await dependencies.repository.get({
          ...actor,
          now: dependencies.clock.now(),
        })
        : { status: "forbidden" as const },
  };
}

export type TodayReminders = ReturnType<typeof createTodayReminders>;
