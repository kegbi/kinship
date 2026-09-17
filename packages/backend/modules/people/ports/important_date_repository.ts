/**
 * How the module stores a person's remembered dates, and who hears about it.
 *
 * `lockContext` locks the person the dates hang off, so a date cannot be
 * written against somebody being archived in another transaction.
 * `ImportantDatePublisher` is planning's side of the same transaction: a date
 * that names a month and a day drives a yearly reminder, and regenerating it
 * has to commit or roll back with the date itself.
 */

import type { Failure } from "../../../shared-kernel/result.ts";
import type {
  ImportantDateAction,
  ImportantDateRecord,
  ImportantDateValue,
} from "../domain/important_dates/rules.ts";
import type { PeopleActor, PeopleTransaction } from "./context.ts";

/** Whether the person the dates belong to can be written to at all. */
export interface ImportantDateContextLock {
  readonly status: "archived" | "forbidden" | "not-found" | "ready";
}

/** The locked date, or the fact that there is none. */
export type ImportantDateLock =
  | { readonly date: ImportantDateRecord; readonly status: "ready" }
  | Failure<"not-found">;

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

/** The reminders a person's dates imply, regenerated in the same unit of work. */
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
