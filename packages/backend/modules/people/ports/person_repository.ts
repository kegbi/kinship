/**
 * How the module stores and finds a person.
 *
 * `lockRequest` is the idempotency gate: it takes the advisory lock a derived
 * identifier names, so two retries of one creation queue behind each other
 * instead of racing. `getRequestedIdentity` is what the retry then reads: the
 * same lookup as `getIdentity`, except that a soft-deleted person still
 * answers, as `deleted`, because the identifier a request derived stays taken
 * by the row its first attempt wrote. `assertCreatedPostcondition` is the other half of the
 * same discipline — the write is read back inside the transaction, so a
 * creation that silently did nothing fails loudly. Every identity the port
 * answers carries the stored revision, rendered in SQL to the microsecond the
 * lifecycle writes compare, so the creation and the identity read hand a
 * caller the `expectedUpdatedAt` its next write needs.
 */

import type { Failure } from "../../../shared-kernel/result.ts";
import type {
  CreatePersonInput,
  NewPersonIdentity,
  PersonIdentity,
  PossibleDuplicate,
} from "../domain/person_identity.ts";
import type { PeopleActor, PeopleTransaction } from "./context.ts";

/** What a stored person turns out to be, if the actor may see them at all. */
export type PersonIdentityLookup =
  | { readonly person: PersonIdentity; readonly status: "ready" }
  | { readonly person: PersonIdentity; readonly status: "archived" }
  | Failure<"forbidden" | "not-found">;

/** What a derived identifier names: a person, a deleted one, or nobody. */
export type RequestedPersonLookup =
  | PersonIdentityLookup
  | Failure<never, "deleted">;

export interface PeopleRepository {
  lockRequest(command: {
    readonly id: string;
    readonly transaction: PeopleTransaction;
  }): Promise<void>;
  findPossibleDuplicates(
    command: PeopleActor & CreatePersonInput & {
      readonly transaction: PeopleTransaction;
    },
  ): Promise<readonly PossibleDuplicate[]>;
  getIdentity(
    command: PeopleActor & {
      readonly personId: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<PersonIdentityLookup>;
  getRequestedIdentity(
    command: PeopleActor & {
      readonly personId: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<RequestedPersonLookup>;
  create(
    command: PeopleActor & NewPersonIdentity & {
      readonly transaction: PeopleTransaction;
    },
  ): Promise<PersonIdentity | undefined>;
  assertCreatedPostcondition(
    command: PeopleActor & NewPersonIdentity & {
      readonly transaction: PeopleTransaction;
    },
  ): Promise<void>;
}
