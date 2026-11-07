/**
 * How the module moves a person between lifecycle states.
 *
 * `lock` names the action it is locking for, so the adapter can decide what a
 * given actor may even attempt before the row is read. `mutate` takes the same
 * action and the revision the caller expected, so the update is the optimistic
 * check rather than a blind write, and `assertPostcondition` reads the result
 * back inside the transaction.
 */

import type { Failure } from "../../../shared-kernel/result.ts";
import type {
  EditPersonInput,
  PersonLifecycleAction,
  PersonLifecycleRecord,
} from "../domain/lifecycle_rules.ts";
import type { PeopleActor, PeopleTransaction } from "./context.ts";

/** The locked person, or why the actor cannot act on them. */
export type PersonLifecycleLock =
  | Failure<"forbidden" | "not-found">
  | { readonly person: PersonLifecycleRecord; readonly status: "ready" };

export interface PersonLifecycleRepository {
  lock(
    command: PeopleActor & {
      readonly action: PersonLifecycleAction;
      readonly personId: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<PersonLifecycleLock>;
  mutate(
    command: PeopleActor & {
      readonly action: PersonLifecycleAction;
      readonly expectedUpdatedAt: string;
      readonly input?: Omit<EditPersonInput, "expectedUpdatedAt">;
      readonly occurredAt: Date;
      readonly personId: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<PersonLifecycleRecord | undefined>;
  assertPostcondition(
    command: PeopleActor & {
      readonly action: PersonLifecycleAction;
      readonly before: PersonLifecycleRecord;
      readonly person: PersonLifecycleRecord;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<void>;
}

/**
 * Planning's side of a restore, in the same transaction: while a person is
 * archived their recurring reminders gain no new dates, so the dates a long
 * archive let pass are refilled the moment they are back.
 */
export interface PersonRestorePublisher {
  restored(
    command: PeopleActor & {
      readonly occurredAt: Date;
      readonly personId: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<void>;
}
