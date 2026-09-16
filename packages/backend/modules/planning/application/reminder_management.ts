import type { Clock } from "../../../shared-kernel/clock.ts";
import { deterministicId } from "../../../shared-kernel/ids.ts";
import type {
  Failure,
  ValidationFailure,
} from "../../../shared-kernel/result.ts";
import { isoDate, isoTime, uuid } from "../../../shared-kernel/validation.ts";
import type {
  PeopleActor,
  PeopleTransaction,
  RelationshipPersonBoundary,
} from "../../people/public.ts";
import type { ActorRevalidation } from "../../workspaces/public.ts";

/** The namespaces that make a reminder or cadence idempotent across retries. */
const ID_NAMESPACE = {
  cadence: "kinship.planning.cadence-id.v1",
  reminder: "kinship.planning.reminder-id.v1",
} as const;

export type RecurrenceUnit = "day" | "month" | "none" | "week" | "year";
export type CadenceUnit = Exclude<RecurrenceUnit, "none">;
export type ReminderOccurrenceStatus =
  | "cancelled"
  | "claimed"
  | "failed"
  | "manual_attention"
  | "pending"
  | "retry"
  | "sent"
  | "skipped";

export interface CalendarOccurrence {
  readonly deliverAt: string;
  readonly occursOn: string;
}

export interface ReminderDefinitionRecord {
  readonly anchorOn: string;
  readonly createdAt: string;
  readonly id: string;
  readonly isActive: boolean;
  readonly nextOccurrence?: ReminderOccurrenceRecord;
  readonly personId: string;
  readonly recurrenceInterval: number;
  readonly recurrenceUnit: RecurrenceUnit;
  readonly sendTime: string;
  readonly title: string;
  readonly updatedAt: string;
}

export interface ReminderOccurrenceRecord {
  readonly attemptCount: number;
  readonly deliverAt: string;
  readonly error?: string;
  readonly id: string;
  readonly occursOn: string;
  readonly providerEffectAt?: string;
  readonly sentAt?: string;
  readonly status: ReminderOccurrenceStatus;
  readonly visibleAt?: string;
}

export interface StayInTouchCadenceRecord {
  readonly id: string;
  readonly intervalCount: number;
  readonly intervalUnit: CadenceUnit;
  readonly isActive: boolean;
  readonly lastContactedAt?: string;
  readonly nextDueAt: string;
  readonly personId: string;
  readonly updatedAt: string;
}

/**
 * The set-based half of the actor question, answered by `workspaces`. The
 * delivery scans below reach many actors at once, so a per-actor
 * `ActorRevalidation` cannot express them; this port is declared here so the
 * repository adapters, which may not import another module, can be given the
 * one approved implementation at the composition root.
 */
export interface ReminderRecipients {
  listEligible(command: {
    readonly transaction: { readonly opaque: unknown };
    readonly workspaceId: string;
  }): Promise<
    readonly { readonly memberId: string; readonly workspaceId: string }[]
  >;
  filterEligible(command: {
    readonly memberIds: readonly string[];
    readonly transaction: { readonly opaque: unknown };
  }): Promise<
    readonly { readonly memberId: string; readonly workspaceId: string }[]
  >;
}

export interface ReminderRepository {
  lockRequest(command: {
    readonly id: string;
    readonly transaction: PeopleTransaction;
  }): Promise<void>;
  findReminder(
    command: PeopleActor & {
      readonly id: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<ReminderDefinitionRecord | undefined>;
  createReminder(
    command: PeopleActor & {
      readonly anchorOn: string;
      readonly id: string;
      readonly occurredAt: Date;
      readonly personId: string;
      readonly recurrenceInterval: number;
      readonly recurrenceUnit: RecurrenceUnit;
      readonly sendTime: string;
      readonly title: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<ReminderDefinitionRecord | undefined>;
  upsertOccurrences(
    command: PeopleActor & {
      readonly occurrences: readonly CalendarOccurrence[];
      readonly reminder: ReminderDefinitionRecord;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<readonly ReminderOccurrenceRecord[]>;
  setReminderActive(
    command: PeopleActor & {
      readonly active: boolean;
      readonly id: string;
      readonly occurredAt: Date;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<
    | {
      readonly reminder: ReminderDefinitionRecord;
      readonly wasActive: boolean;
    }
    | undefined
  >;
  cancelFutureOccurrences(
    command: PeopleActor & {
      readonly now: Date;
      readonly reminderId: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<void>;
  upsertCadence(
    command: PeopleActor & {
      readonly id: string;
      readonly intervalCount: number;
      readonly intervalUnit: CadenceUnit;
      readonly nextDueAt: string;
      readonly occurredAt: Date;
      readonly personId: string;
      readonly requestFingerprint: string;
      readonly requestId: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<StayInTouchCadenceRecord | undefined>;
  findCadenceRequest(
    command: PeopleActor & {
      readonly requestId: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<
    | {
      readonly cadence: StayInTouchCadenceRecord;
      readonly requestFingerprint: string;
    }
    | undefined
  >;
  updateCadenceFromInteraction(command: {
    readonly happenedAt: string;
    readonly memberId: string;
    readonly personIds: readonly string[];
    readonly transaction: PeopleTransaction;
    readonly workspaceId: string;
  }): Promise<void>;
  regenerateForTimezone(
    command: PeopleActor & {
      readonly memberId: string;
      readonly now: Date;
      readonly timezone: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<void>;
  regenerateForWorkspaceTimezone(
    command: {
      readonly now: Date;
      readonly timezone: string;
      readonly transaction: PeopleTransaction;
      readonly workspaceId: string;
    },
  ): Promise<void>;
  listPerson(
    command: PeopleActor & {
      readonly personId: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<{
    readonly cadences: readonly StayInTouchCadenceRecord[];
    readonly reminders: readonly ReminderDefinitionRecord[];
  }>;
}

export interface ReminderWorkspaceBoundary {
  effectiveTimezone(
    command: PeopleActor & {
      readonly transaction: PeopleTransaction;
    },
  ): Promise<
    | Failure<"forbidden">
    | { readonly status: "ready"; readonly timezone: string }
  >;
}

export type ReminderAuditAction =
  | "cadence-created"
  | "created"
  | "disabled"
  | "generated";

export interface ReminderAudit {
  record(command: {
    readonly action: ReminderAuditAction;
    readonly actor: PeopleActor;
    readonly occurredAt: Date;
    readonly subjectId: string;
    readonly transaction: PeopleTransaction;
  }): Promise<void>;
}

export interface ReminderManagementDependencies {
  readonly actors: ActorRevalidation;
  readonly audit: ReminderAudit;
  readonly clock: Clock;
  readonly people: RelationshipPersonBoundary;
  readonly repository: ReminderRepository;
  readonly transaction: {
    run<T>(work: (transaction: PeopleTransaction) => Promise<T>): Promise<T>;
  };
  readonly workspace: ReminderWorkspaceBoundary;
}

export interface CreateReminderInput {
  readonly anchorOn: string;
  readonly personId: string;
  readonly recurrenceInterval: number;
  readonly recurrenceUnit: RecurrenceUnit;
  readonly requestId: string;
  readonly sendTime: string;
  readonly title: string;
}

export interface CreateCadenceInput {
  readonly intervalCount: number;
  readonly intervalUnit: CadenceUnit;
  readonly personId: string;
  readonly requestId: string;
}

export type ReminderMutationResult =
  | { readonly reminder: ReminderDefinitionRecord; readonly status: "created" }
  | { readonly cadence: StayInTouchCadenceRecord; readonly status: "created" }
  | Failure<
    "archived-write-rejected" | "forbidden" | "not-found",
    "idempotency-conflict"
  >
  | ValidationFailure;

function zonedInstant(
  date: Temporal.PlainDate,
  sendTime: string,
  timezone: string,
): string {
  const time = Temporal.PlainTime.from(sendTime);
  return Temporal.ZonedDateTime.from({
    day: date.day,
    hour: time.hour,
    minute: time.minute,
    month: date.month,
    second: time.second,
    timeZone: timezone,
    year: date.year,
  }, { disambiguation: "compatible" }).toInstant().toString();
}

function addCalendar(
  anchor: Temporal.PlainDate,
  unit: RecurrenceUnit,
  amount: number,
): Temporal.PlainDate {
  if (unit === "none" || amount === 0) return anchor;
  return anchor.add(
    unit === "day"
      ? { days: amount }
      : unit === "week"
      ? { weeks: amount }
      : unit === "month"
      ? { months: amount }
      : { years: amount },
  );
}

export function generateCalendarOccurrences(input: {
  readonly anchorOn: string;
  readonly count: number;
  readonly from: string;
  readonly recurrenceInterval: number;
  readonly recurrenceUnit: RecurrenceUnit;
  readonly sendTime: string;
  readonly timezone: string;
}): readonly CalendarOccurrence[] {
  const anchor = Temporal.PlainDate.from(input.anchorOn);
  const from = Temporal.Instant.from(input.from);
  const count = Math.max(1, Math.min(32, Math.trunc(input.count)));
  const interval = Math.max(
    1,
    Math.min(100, Math.trunc(input.recurrenceInterval)),
  );
  const occurrences: CalendarOccurrence[] = [];
  const localFrom = from.toZonedDateTimeISO(input.timezone).toPlainDate();
  const distance = input.recurrenceUnit === "day"
    ? anchor.until(localFrom, { largestUnit: "day" }).days
    : input.recurrenceUnit === "week"
    ? anchor.until(localFrom, { largestUnit: "day" }).days / 7
    : input.recurrenceUnit === "month"
    ? (localFrom.year - anchor.year) * 12 + localFrom.month - anchor.month
    : input.recurrenceUnit === "year"
    ? localFrom.year - anchor.year
    : 0;
  // Start one recurrence before the coarse calendar distance. That small
  // overlap preserves constrained month/year edges without scanning history.
  const firstIndex = input.recurrenceUnit === "none"
    ? 0
    : Math.max(0, Math.floor(distance / interval) - 1);
  const maximumIterations = input.recurrenceUnit === "none" ? 1 : count + 3;
  for (let offset = 0; offset < maximumIterations; offset += 1) {
    const index = firstIndex + offset;
    const date = addCalendar(anchor, input.recurrenceUnit, index * interval);
    const deliverAt = zonedInstant(date, input.sendTime, input.timezone);
    if (Temporal.Instant.compare(Temporal.Instant.from(deliverAt), from) >= 0) {
      occurrences.push({ deliverAt, occursOn: date.toString() });
      if (occurrences.length >= count) break;
    }
  }
  return occurrences;
}

function cadenceDueAt(
  contactedAt: string,
  intervalCount: number,
  intervalUnit: CadenceUnit,
  timezone: string,
): string {
  const contacted = Temporal.Instant.from(contactedAt).toZonedDateTimeISO(
    timezone,
  );
  return contacted.add(
    intervalUnit === "day"
      ? { days: intervalCount }
      : intervalUnit === "week"
      ? { weeks: intervalCount }
      : intervalUnit === "month"
      ? { months: intervalCount }
      : { years: intervalCount },
  ).toInstant().toString();
}

async function cadenceFingerprint(input: CreateCadenceInput): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      `kinship.planning.cadence-request.v1\u0000${input.personId.toLowerCase()}\u0000${input.intervalCount}\u0000${input.intervalUnit}`,
    ),
  );
  return [...new Uint8Array(digest)].map((value) =>
    value.toString(16).padStart(2, "0")
  ).join("");
}

export function createReminderManagement(
  dependencies: ReminderManagementDependencies,
) {
  /**
   * The actor's standing, asked first inside the caller's transaction and
   * under lock, because every path below writes or reads on its behalf.
   */
  const actorIsActive = async (
    actor: PeopleActor,
    transaction: PeopleTransaction,
  ): Promise<boolean> =>
    await dependencies.actors.revalidate({
      ...actor,
      lock: true,
      transaction,
    }) === "active";

  const writablePerson = async (
    actor: PeopleActor,
    personId: string,
    transaction: PeopleTransaction,
  ) => {
    const result = await dependencies.people.inspect({
      ...actor,
      lock: true,
      personIds: [personId],
      transaction,
    });
    return result.status === "archived"
      ? "archived-write-rejected" as const
      : result.status;
  };
  return {
    createReminder: async (
      actor: PeopleActor,
      input: CreateReminderInput,
    ): Promise<ReminderMutationResult> => {
      const errors: Record<string, string> = {};
      const title = input.title.trim();
      if (!title || title.length > 500) {
        errors.title = "Add a title of at most 500 characters.";
      }
      if (uuid(input.personId) === undefined) {
        errors.personId = "Choose a person from this workspace.";
      }
      if (uuid(input.requestId) === undefined) {
        errors.requestId = "Use a canonical request identifier.";
      }
      if (isoDate(input.anchorOn) === undefined) {
        errors.anchorOn = "Choose a calendar date.";
      }
      const sendTime = isoTime(input.sendTime);
      if (!sendTime) errors.sendTime = "Choose a local delivery time.";
      if (
        !Number.isInteger(input.recurrenceInterval) ||
        input.recurrenceInterval < 1 || input.recurrenceInterval > 100
      ) {
        errors.recurrenceInterval = "Choose an interval from 1 to 100.";
      }
      try {
        if (isoDate(input.anchorOn) !== undefined) {
          Temporal.PlainDate.from(input.anchorOn);
        }
      } catch {
        errors.anchorOn = "Choose a valid calendar date.";
      }
      if (Object.keys(errors).length > 0) {
        return { errors, status: "validation-error" };
      }
      return await dependencies.transaction.run(async (transaction) => {
        if (!await actorIsActive(actor, transaction)) {
          return { status: "forbidden" };
        }
        const zone = await dependencies.workspace.effectiveTimezone({
          ...actor,
          transaction,
        });
        if (zone.status !== "ready") return { status: "forbidden" };
        const person = await writablePerson(
          actor,
          input.personId.toLowerCase(),
          transaction,
        );
        if (person !== "ready") return { status: person };
        const id = await deterministicId(ID_NAMESPACE.reminder, [
          actor.workspaceId,
          input.requestId,
        ]);
        await dependencies.repository.lockRequest({ id, transaction });
        const replay = await dependencies.repository.findReminder({
          ...actor,
          id,
          transaction,
        });
        if (replay) {
          const matches = replay.personId === input.personId.toLowerCase() &&
            replay.title === title &&
            replay.anchorOn === input.anchorOn &&
            replay.sendTime === sendTime &&
            replay.recurrenceUnit === input.recurrenceUnit &&
            replay.recurrenceInterval === input.recurrenceInterval;
          return matches
            ? { reminder: replay, status: "created" }
            : { status: "idempotency-conflict" };
        }
        const occurredAt = dependencies.clock.now();
        const reminder = await dependencies.repository.createReminder({
          ...actor,
          anchorOn: input.anchorOn,
          id,
          occurredAt,
          personId: input.personId.toLowerCase(),
          recurrenceInterval: input.recurrenceInterval,
          recurrenceUnit: input.recurrenceUnit,
          sendTime: sendTime!,
          title,
          transaction,
        });
        if (!reminder) return { status: "not-found" };
        await dependencies.audit.record({
          action: "created",
          actor,
          occurredAt,
          subjectId: id,
          transaction,
        });
        const occurrences = generateCalendarOccurrences({
          anchorOn: reminder.anchorOn,
          count: reminder.recurrenceUnit === "none" ? 1 : 8,
          from: occurredAt.toISOString(),
          recurrenceInterval: reminder.recurrenceInterval,
          recurrenceUnit: reminder.recurrenceUnit,
          sendTime: reminder.sendTime,
          timezone: zone.timezone,
        });
        const generated = await dependencies.repository.upsertOccurrences({
          ...actor,
          occurrences,
          reminder,
          transaction,
        });
        if (generated.length > 0) {
          await dependencies.audit.record({
            action: "generated",
            actor,
            occurredAt,
            subjectId: id,
            transaction,
          });
        }
        return {
          reminder: {
            ...reminder,
            ...(generated[0] ? { nextOccurrence: generated[0] } : {}),
          },
          status: "created",
        };
      });
    },
    createCadence: async (
      actor: PeopleActor,
      input: CreateCadenceInput,
    ): Promise<ReminderMutationResult> => {
      const errors: Record<string, string> = {};
      if (uuid(input.personId) === undefined) {
        errors.personId = "Choose a person from this workspace.";
      }
      if (uuid(input.requestId) === undefined) {
        errors.requestId = "Use a canonical request identifier.";
      }
      if (
        !Number.isInteger(input.intervalCount) || input.intervalCount < 1 ||
        input.intervalCount > 100
      ) {
        errors.intervalCount = "Choose an interval from 1 to 100.";
      }
      if (Object.keys(errors).length > 0) {
        return { errors, status: "validation-error" };
      }
      return await dependencies.transaction.run(async (transaction) => {
        if (!await actorIsActive(actor, transaction)) {
          return { status: "forbidden" };
        }
        const zone = await dependencies.workspace.effectiveTimezone({
          ...actor,
          transaction,
        });
        if (zone.status !== "ready") return { status: "forbidden" };
        const person = await writablePerson(
          actor,
          input.personId.toLowerCase(),
          transaction,
        );
        if (person !== "ready") return { status: person };
        const occurredAt = dependencies.clock.now();
        const id = await deterministicId(ID_NAMESPACE.cadence, [
          actor.workspaceId,
          input.requestId,
        ]);
        const requestFingerprint = await cadenceFingerprint(input);
        await dependencies.repository.lockRequest({ id, transaction });
        const replay = await dependencies.repository.findCadenceRequest({
          ...actor,
          requestId: input.requestId.toLowerCase(),
          transaction,
        });
        if (replay) {
          return replay.requestFingerprint === requestFingerprint
            ? { cadence: replay.cadence, status: "created" }
            : { status: "idempotency-conflict" };
        }
        const cadence = await dependencies.repository.upsertCadence({
          ...actor,
          id,
          intervalCount: input.intervalCount,
          intervalUnit: input.intervalUnit,
          nextDueAt: cadenceDueAt(
            occurredAt.toISOString(),
            input.intervalCount,
            input.intervalUnit,
            zone.timezone,
          ),
          occurredAt,
          personId: input.personId.toLowerCase(),
          requestFingerprint,
          requestId: input.requestId.toLowerCase(),
          transaction,
        });
        if (!cadence) return { status: "not-found" };
        await dependencies.audit.record({
          action: "cadence-created",
          actor,
          occurredAt,
          subjectId: cadence.id,
          transaction,
        });
        return { cadence, status: "created" };
      });
    },
    setActive: async (actor: PeopleActor, id: string, active: boolean) =>
      await dependencies.transaction.run(async (transaction) => {
        if (!await actorIsActive(actor, transaction)) {
          return { status: "forbidden" as const };
        }
        const occurredAt = dependencies.clock.now();
        const zone = active
          ? await dependencies.workspace.effectiveTimezone({
            ...actor,
            transaction,
          })
          : undefined;
        if (zone?.status === "forbidden") {
          return { status: "forbidden" as const };
        }
        const changed = await dependencies.repository.setReminderActive({
          ...actor,
          active,
          id,
          occurredAt,
          transaction,
        });
        if (!changed) return { status: "not-found" as const };
        const reminder = changed.reminder;
        if (!active) {
          await dependencies.repository.cancelFutureOccurrences({
            ...actor,
            now: occurredAt,
            reminderId: reminder.id,
            transaction,
          });
          await dependencies.audit.record({
            action: "disabled",
            actor,
            occurredAt,
            subjectId: id,
            transaction,
          });
        } else if (!changed.wasActive && zone?.status === "ready") {
          const occurrences = generateCalendarOccurrences({
            anchorOn: reminder.anchorOn,
            count: reminder.recurrenceUnit === "none" ? 1 : 8,
            from: occurredAt.toISOString(),
            recurrenceInterval: reminder.recurrenceInterval,
            recurrenceUnit: reminder.recurrenceUnit,
            sendTime: reminder.sendTime,
            timezone: zone.timezone,
          });
          const generated = await dependencies.repository.upsertOccurrences({
            ...actor,
            occurrences,
            reminder,
            transaction,
          });
          if (generated.length > 0) {
            await dependencies.audit.record({
              action: "generated",
              actor,
              occurredAt,
              subjectId: id,
              transaction,
            });
          }
          return {
            reminder: {
              ...reminder,
              ...(generated[0] ? { nextOccurrence: generated[0] } : {}),
            },
            status: "saved" as const,
          };
        }
        return { reminder, status: "saved" as const };
      }),
    listPerson: async (actor: PeopleActor, personId: string) =>
      await dependencies.transaction.run(async (transaction) => {
        if (!await actorIsActive(actor, transaction)) {
          return { status: "forbidden" as const };
        }
        const result = await dependencies.repository.listPerson({
          ...actor,
          personId: personId.toLowerCase(),
          transaction,
        });
        return { ...result, status: "ready" as const };
      }),
    interactionRecorded: async (event: {
      readonly happenedAt: string;
      readonly memberId: string;
      readonly personIds: readonly string[];
      readonly transaction: PeopleTransaction;
      readonly workspaceId: string;
    }): Promise<void> => {
      if (
        event.personIds.length === 0 ||
        !Number.isFinite(Date.parse(event.happenedAt))
      ) return;
      await dependencies.repository.updateCadenceFromInteraction({
        ...event,
        personIds: [...new Set(event.personIds.map((id) => id.toLowerCase()))]
          .sort(),
      });
    },
    timezoneChanged: async (
      actor: PeopleActor,
      transaction: PeopleTransaction,
    ): Promise<void> => {
      if (!await actorIsActive(actor, transaction)) return;
      const zone = await dependencies.workspace.effectiveTimezone({
        ...actor,
        transaction,
      });
      if (zone.status !== "ready") return;
      await dependencies.repository.regenerateForTimezone({
        ...actor,
        now: dependencies.clock.now(),
        timezone: zone.timezone,
        transaction,
      });
    },
    workspaceTimezoneChanged: async (
      actor: PeopleActor,
      timezone: string,
      transaction: PeopleTransaction,
    ): Promise<void> => {
      await dependencies.repository.regenerateForWorkspaceTimezone({
        now: dependencies.clock.now(),
        timezone,
        transaction,
        workspaceId: actor.workspaceId,
      });
    },
  };
}

export type ReminderManagement = ReturnType<typeof createReminderManagement>;
