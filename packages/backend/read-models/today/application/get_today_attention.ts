import type { Clock } from "../../../shared-kernel/clock.ts";
import type { Failure } from "../../../shared-kernel/result.ts";
import type { PeopleActor } from "../../../modules/people/public.ts";
import type { ActorRevalidation } from "../../../modules/workspaces/public.ts";
import type { ReadModelTransaction } from "./get_today_interactions.ts";

export interface TodayAttentionPerson {
  readonly archived: boolean;
  readonly id: string;
  readonly name: string;
  readonly unavailable?: boolean;
}

interface TodayAttentionBase {
  readonly dueAt: string;
  readonly id: string;
  readonly person?: TodayAttentionPerson;
  readonly title: string;
}

export type TodayAttentionItem =
  | (TodayAttentionBase & { readonly kind: "task" })
  | (TodayAttentionBase & {
    readonly kind: "important-date" | "life-event" | "reminder";
    /**
     * The channel of the listed delivery. An email one is listed only when
     * it failed or needs attention (REL-059).
     */
    readonly channel: "email" | "in_app";
    readonly occursOn: string;
    readonly reminderStatus:
      | "failed"
      | "manual_attention"
      | "pending"
      | "retry";
  })
  | (TodayAttentionBase & {
    readonly kind: "cadence";
    readonly lastContactedAt?: string;
    readonly person: TodayAttentionPerson;
  });

export interface TodayAttentionRepository {
  getSnapshot(
    command: PeopleActor & {
      readonly now: Date;
      readonly perAttentionGroupLimit: number;
      readonly upcomingLimit: number;
    },
  ): Promise<
    | Failure<"forbidden">
    | {
      readonly items: readonly TodayAttentionItem[];
      readonly status: "ready";
      readonly timezone: string;
    }
  >;
}

const ATTENTION_LIMIT = 20;
const UPCOMING_LIMIT = 30;

export function todayAttentionWindow(now: Date, timezone: string) {
  const today = Temporal.Instant.from(now.toISOString()).toZonedDateTimeISO(
    timezone,
  ).startOfDay();
  return {
    date: today.toPlainDate().toString(),
    nextSevenDaysEnd: new Date(today.add({ days: 8 }).epochMilliseconds),
    thirtyDaysEnd: new Date(today.add({ days: 31 }).epochMilliseconds),
    todayStart: new Date(today.epochMilliseconds),
    tomorrowStart: new Date(today.add({ days: 1 }).epochMilliseconds),
  };
}

function compare(left: TodayAttentionItem, right: TodayAttentionItem): number {
  const due = Temporal.Instant.compare(
    Temporal.Instant.from(left.dueAt),
    Temporal.Instant.from(right.dueAt),
  );
  if (due) return due;
  const name = (left.person?.name ?? left.title).toLocaleLowerCase("en")
    .localeCompare(
      (right.person?.name ?? right.title).toLocaleLowerCase("en"),
      "en",
    );
  return name || left.kind.localeCompare(right.kind, "en") ||
    left.id.localeCompare(right.id, "en");
}

/**
 * Read models carry no actor join of their own. The `workspaces` port answers
 * whether the actor may still read this workspace — without a lock, because
 * these paths take none — and the repository scopes by workspace alone.
 */
export function createTodayAttention(dependencies: {
  readonly actors: ActorRevalidation;
  readonly transaction: {
    run<T>(
      work: (transaction: ReadModelTransaction) => Promise<T>,
    ): Promise<T>;
  };
  readonly clock: Clock;
  readonly repository: TodayAttentionRepository;
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
    async get(actor: PeopleActor) {
      if (!await readable(actor)) return { status: "forbidden" as const };
      const now = dependencies.clock.now();
      const result = await dependencies.repository.getSnapshot({
        ...actor,
        now,
        perAttentionGroupLimit: ATTENTION_LIMIT,
        upcomingLimit: UPCOMING_LIMIT,
      });
      if (result.status !== "ready") return result;
      const window = todayAttentionWindow(now, result.timezone);
      const seen = new Set<string>();
      const unique = [...result.items].sort(compare).filter((item) => {
        const key = `${item.kind}:${item.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const before = (item: TodayAttentionItem, bound: Date) =>
        Temporal.Instant.compare(
          Temporal.Instant.from(item.dueAt),
          Temporal.Instant.from(bound.toISOString()),
        ) < 0;
      return {
        attention: {
          overdue: unique.filter((item) => before(item, window.todayStart))
            .slice(
              0,
              ATTENTION_LIMIT,
            ),
          today: unique.filter((item) =>
            !before(item, window.todayStart) &&
            before(item, window.tomorrowStart)
          ).slice(0, ATTENTION_LIMIT),
          nextSevenDays: unique.filter((item) =>
            !before(item, window.tomorrowStart) &&
            before(item, window.nextSevenDaysEnd)
          ).slice(0, ATTENTION_LIMIT),
        },
        date: window.date,
        status: "ready" as const,
        timezone: result.timezone,
        upcoming: unique.filter((item) =>
          !before(item, window.nextSevenDaysEnd) &&
          before(item, window.thirtyDaysEnd)
        ).slice(0, UPCOMING_LIMIT),
      };
    },
  };
}

export type TodayAttention = ReturnType<typeof createTodayAttention>;
