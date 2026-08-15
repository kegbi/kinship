import type { PeopleActor, PeopleTransaction } from "./create_person.ts";

export type ImportantDateKind =
  | "birthday"
  | "custom"
  | "deceased"
  | "first_met";
export type ImportantDatePrecision =
  | "day"
  | "full"
  | "month"
  | "month_day"
  | "unknown"
  | "year"
  | "year_month";
export type ImportantDateAction = "create" | "delete" | "update";

export interface ImportantDateValue {
  readonly day?: number;
  readonly isAgeBased: boolean;
  readonly isYearApproximate: boolean;
  readonly kind: ImportantDateKind;
  readonly label?: string;
  readonly month?: number;
  readonly notes?: string;
  readonly precision: ImportantDatePrecision;
  readonly year?: number;
}

export interface ImportantDateRecord extends ImportantDateValue {
  readonly createdAt: string;
  readonly id: string;
  readonly personId: string;
  readonly scheduling: "annual-reminder" | "not-schedulable";
  readonly updatedAt: string;
}

export interface ImportantDateContextLock {
  readonly status: "archived" | "forbidden" | "not-found" | "ready";
}

export type ImportantDateLock =
  | { readonly date: ImportantDateRecord; readonly status: "ready" }
  | { readonly status: "not-found" };

interface ImportantDateMutationCommand extends PeopleActor {
  readonly occurredAt: Date;
  readonly personId: string;
  readonly transaction: PeopleTransaction;
}

export interface ImportantDateRepository {
  lockContext(
    command: PeopleActor & {
      readonly personId: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<ImportantDateContextLock>;
  lockDate(
    command: PeopleActor & {
      readonly dateId: string;
      readonly personId: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<ImportantDateLock>;
  list(
    command: PeopleActor & {
      readonly personId: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<readonly ImportantDateRecord[]>;
  create(
    command: ImportantDateMutationCommand & {
      readonly id: string;
      readonly value: ImportantDateValue;
    },
  ): Promise<ImportantDateRecord | undefined>;
  update(
    command: ImportantDateMutationCommand & {
      readonly dateId: string;
      readonly expectedUpdatedAt: string;
      readonly value: ImportantDateValue;
    },
  ): Promise<ImportantDateRecord | undefined>;
  delete(
    command: ImportantDateMutationCommand & {
      readonly dateId: string;
      readonly expectedUpdatedAt: string;
    },
  ): Promise<boolean>;
  assertPostcondition(
    command: ImportantDateMutationCommand & {
      readonly action: ImportantDateAction;
      readonly after?: ImportantDateRecord;
      readonly before?: ImportantDateRecord;
    },
  ): Promise<void>;
}

export interface ImportantDatePublisher {
  regenerate(
    command: PeopleActor & {
      readonly after?: ImportantDateRecord;
      readonly before?: ImportantDateRecord;
      readonly occurredAt: Date;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<void>;
}

export interface ImportantDateAudit {
  record(command: {
    readonly action: ImportantDateAction;
    readonly actor: PeopleActor;
    readonly after?: ImportantDateRecord;
    readonly before?: ImportantDateRecord;
    readonly occurredAt: Date;
    readonly transaction: PeopleTransaction;
  }): Promise<string>;
  assertPostcondition(command: {
    readonly action: ImportantDateAction;
    readonly actor: PeopleActor;
    readonly after?: ImportantDateRecord;
    readonly auditId: string;
    readonly before?: ImportantDateRecord;
    readonly occurredAt: Date;
    readonly transaction: PeopleTransaction;
  }): Promise<void>;
}

export interface ImportantDateDependencies {
  readonly audit: ImportantDateAudit;
  readonly clock: { now(): Date };
  readonly ids: { create(): string };
  readonly publisher: ImportantDatePublisher;
  readonly repository: ImportantDateRepository;
  readonly transaction: {
    run<T>(work: (transaction: PeopleTransaction) => Promise<T>): Promise<T>;
  };
}

export interface ImportantDateUpdateInput extends ImportantDateValue {
  readonly expectedUpdatedAt: string;
}

export interface ImportantDateDeleteInput {
  readonly expectedUpdatedAt: string;
}

export type ImportantDateFailure =
  | { readonly status: "archived-write-rejected" }
  | { readonly status: "conflict" }
  | { readonly status: "forbidden" }
  | { readonly status: "not-found" }
  | { readonly status: "stale" };

export type ImportantDateMutationResult =
  | ImportantDateFailure
  | {
    readonly errors: Readonly<Record<string, string>>;
    readonly status: "validation-error";
  }
  | { readonly date: ImportantDateRecord; readonly status: "created" }
  | { readonly date: ImportantDateRecord; readonly status: "updated" }
  | { readonly dateId: string; readonly status: "deleted" };
type ImportantDateMutationFailure = ImportantDateFailure | {
  readonly errors: Readonly<Record<string, string>>;
  readonly status: "validation-error";
};
export type ImportantDateCreateResult = ImportantDateMutationFailure | {
  readonly date: ImportantDateRecord;
  readonly status: "created";
};
export type ImportantDateUpdateResult = ImportantDateMutationFailure | {
  readonly date: ImportantDateRecord;
  readonly status: "updated";
};
export type ImportantDateDeleteResult = ImportantDateMutationFailure | {
  readonly dateId: string;
  readonly status: "deleted";
};

export type ImportantDateListResult =
  | { readonly status: "forbidden" }
  | { readonly status: "not-found" }
  | {
    readonly dates: readonly ImportantDateRecord[];
    readonly status: "archived" | "ready";
  };

function optional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalize(input: ImportantDateValue): ImportantDateValue {
  const label = optional(input.label);
  const notes = optional(input.notes);
  return {
    ...(input.day === undefined ? {} : { day: input.day }),
    isAgeBased: input.isAgeBased,
    isYearApproximate: input.isYearApproximate,
    kind: input.kind,
    ...(label ? { label } : {}),
    ...(input.month === undefined ? {} : { month: input.month }),
    ...(notes ? { notes } : {}),
    precision: input.precision,
    ...(input.year === undefined ? {} : { year: input.year }),
  };
}

const componentShape: Readonly<
  Record<ImportantDatePrecision, readonly ("day" | "month" | "year")[]>
> = {
  day: ["day"],
  full: ["year", "month", "day"],
  month: ["month"],
  month_day: ["month", "day"],
  unknown: [],
  year: ["year"],
  year_month: ["year", "month"],
};

function realCalendarDate(year: number, month: number, day: number): boolean {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= (days[month - 1] ?? 0);
}

function validate(value: ImportantDateValue): Readonly<Record<string, string>> {
  const errors: Record<string, string> = {};
  const expected = componentShape[value.precision];
  for (const component of ["year", "month", "day"] as const) {
    const present = value[component] !== undefined;
    if (present !== expected.includes(component)) {
      errors[component] = present
        ? `Remove ${component}; it contradicts ${value.precision} precision.`
        : `Enter ${component} for ${value.precision} precision.`;
    }
  }
  if (
    value.year !== undefined &&
    (!Number.isInteger(value.year) || value.year < 1 || value.year > 9999)
  ) errors.year = "Enter a year from 1 through 9999.";
  if (
    value.month !== undefined &&
    (!Number.isInteger(value.month) || value.month < 1 || value.month > 12)
  ) errors.month = "Enter a month from 1 through 12.";
  if (
    value.day !== undefined &&
    (!Number.isInteger(value.day) || value.day < 1 || value.day > 31)
  ) errors.day = "Enter a day from 1 through 31.";
  if (
    value.month !== undefined && value.day !== undefined &&
    !errors.month && !errors.day &&
    !realCalendarDate(value.year ?? 2000, value.month, value.day)
  ) errors.day = "Enter a real calendar date.";
  if (value.isYearApproximate && value.year === undefined) {
    errors.isYearApproximate = "An approximate year still needs a year value.";
  }
  if (value.isAgeBased && value.year === undefined) {
    errors.isAgeBased = "Age display needs a known year.";
  }
  if (value.kind === "custom" && !value.label) {
    errors.label = "Enter an honest label for this custom date.";
  }
  if (value.kind !== "custom" && value.label) {
    errors.label = "Core dates use their standard label.";
  }
  if ((value.label?.length ?? 0) > 200) {
    errors.label = "Use 200 characters or fewer.";
  }
  if ((value.notes?.length ?? 0) > 2_000) {
    errors.notes = "Use 2,000 characters or fewer.";
  }
  return errors;
}

function contextFailure(context: ImportantDateContextLock) {
  if (context.status === "archived") {
    return { status: "archived-write-rejected" as const };
  }
  return context.status === "forbidden"
    ? { status: "forbidden" as const }
    : { status: "not-found" as const };
}

export function createImportantDateManagement(
  dependencies: ImportantDateDependencies,
) {
  const persist = async (
    actor: PeopleActor,
    personId: string,
    action: ImportantDateAction,
    transaction: PeopleTransaction,
    occurredAt: Date,
    before: ImportantDateRecord | undefined,
    after: ImportantDateRecord | undefined,
    publish = true,
  ) => {
    if (publish) {
      await dependencies.publisher.regenerate({
        ...actor,
        ...(after ? { after } : {}),
        ...(before ? { before } : {}),
        occurredAt,
        transaction,
      });
    }
    const auditCommand = {
      action,
      actor,
      ...(after ? { after } : {}),
      ...(before ? { before } : {}),
      occurredAt,
      transaction,
    };
    const auditId = await dependencies.audit.record(auditCommand);
    await dependencies.repository.assertPostcondition({
      action,
      ...actor,
      ...(after ? { after } : {}),
      ...(before ? { before } : {}),
      occurredAt,
      personId,
      transaction,
    });
    await dependencies.audit.assertPostcondition({ ...auditCommand, auditId });
  };

  return {
    list: (
      actor: PeopleActor,
      personId: string,
    ): Promise<ImportantDateListResult> =>
      dependencies.transaction.run(async (transaction) => {
        const context = await dependencies.repository.lockContext({
          ...actor,
          personId,
          transaction,
        });
        if (context.status === "forbidden" || context.status === "not-found") {
          return { status: context.status };
        }
        return {
          dates: await dependencies.repository.list({
            ...actor,
            personId,
            transaction,
          }),
          status: context.status,
        };
      }),
    create: async (
      actor: PeopleActor,
      personId: string,
      rawValue: ImportantDateValue,
    ): Promise<ImportantDateCreateResult> => {
      const value = normalize(rawValue);
      const errors = validate(value);
      if (Object.keys(errors).length > 0) {
        return { errors, status: "validation-error" };
      }
      return await dependencies.transaction.run(async (transaction) => {
        const context = await dependencies.repository.lockContext({
          ...actor,
          personId,
          transaction,
        });
        if (context.status !== "ready") return contextFailure(context);
        const occurredAt = dependencies.clock.now();
        const date = await dependencies.repository.create({
          ...actor,
          id: dependencies.ids.create(),
          occurredAt,
          personId,
          transaction,
          value,
        });
        if (!date) return { status: "conflict" };
        await persist(
          actor,
          personId,
          "create",
          transaction,
          occurredAt,
          undefined,
          date,
        );
        return { date, status: "created" };
      });
    },
    update: async (
      actor: PeopleActor,
      personId: string,
      dateId: string,
      rawInput: ImportantDateUpdateInput,
    ): Promise<ImportantDateUpdateResult> => {
      const { expectedUpdatedAt, ...rawValue } = rawInput;
      const value = normalize(rawValue);
      const errors = validate(value);
      if (!Number.isFinite(Date.parse(expectedUpdatedAt))) {
        return {
          errors: { expectedUpdatedAt: "Refresh this date before saving." },
          status: "validation-error",
        };
      }
      if (Object.keys(errors).length > 0) {
        return { errors, status: "validation-error" };
      }
      return await dependencies.transaction.run(async (transaction) => {
        const context = await dependencies.repository.lockContext({
          ...actor,
          personId,
          transaction,
        });
        if (context.status !== "ready") return contextFailure(context);
        const locked = await dependencies.repository.lockDate({
          ...actor,
          dateId,
          personId,
          transaction,
        });
        if (locked.status === "not-found") return locked;
        if (locked.date.updatedAt !== expectedUpdatedAt) {
          return { status: "stale" };
        }
        const occurredAt = dependencies.clock.now();
        const date = await dependencies.repository.update({
          ...actor,
          dateId,
          expectedUpdatedAt,
          occurredAt,
          personId,
          transaction,
          value,
        });
        if (!date) return { status: "conflict" };
        await persist(
          actor,
          personId,
          "update",
          transaction,
          occurredAt,
          locked.date,
          date,
        );
        return { date, status: "updated" };
      });
    },
    delete: async (
      actor: PeopleActor,
      personId: string,
      dateId: string,
      input: ImportantDateDeleteInput,
    ): Promise<ImportantDateDeleteResult> => {
      if (!Number.isFinite(Date.parse(input.expectedUpdatedAt))) {
        return {
          errors: { expectedUpdatedAt: "Refresh this date before deleting." },
          status: "validation-error",
        };
      }
      return await dependencies.transaction.run(async (transaction) => {
        const context = await dependencies.repository.lockContext({
          ...actor,
          personId,
          transaction,
        });
        if (context.status !== "ready") return contextFailure(context);
        const locked = await dependencies.repository.lockDate({
          ...actor,
          dateId,
          personId,
          transaction,
        });
        if (locked.status === "not-found") return locked;
        if (locked.date.updatedAt !== input.expectedUpdatedAt) {
          return { status: "stale" };
        }
        const occurredAt = dependencies.clock.now();
        await dependencies.publisher.regenerate({
          ...actor,
          before: locked.date,
          occurredAt,
          transaction,
        });
        const deleted = await dependencies.repository.delete({
          ...actor,
          dateId,
          expectedUpdatedAt: input.expectedUpdatedAt,
          occurredAt,
          personId,
          transaction,
        });
        if (!deleted) return { status: "stale" };
        await persist(
          actor,
          personId,
          "delete",
          transaction,
          occurredAt,
          locked.date,
          undefined,
          false,
        );
        return { dateId, status: "deleted" };
      });
    },
  };
}

export type ImportantDateManagement = ReturnType<
  typeof createImportantDateManagement
>;
