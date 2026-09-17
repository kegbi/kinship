/**
 * How the module stores and finds a person.
 *
 * `lockRequest` is the idempotency gate: it takes the advisory lock a derived
 * identifier names, so two retries of one creation queue behind each other
 * instead of racing. `assertCreatedPostcondition` is the other half of the
 * same discipline — the write is read back inside the transaction, so a
 * creation that silently did nothing fails loudly.
 */

import type { Failure } from "../../../shared-kernel/result.ts";
import type {
  CreatePersonInput,
  PersonIdentity,
  PossibleDuplicate,
} from "../domain/person_identity.ts";
import type { PeopleActor, PeopleTransaction } from "./context.ts";

/** What a stored person turns out to be, if the actor may see them at all. */
export type PersonIdentityLookup =
  | { readonly person: PersonIdentity; readonly status: "ready" }
  | { readonly person: PersonIdentity; readonly status: "archived" }
  | Failure<"forbidden" | "not-found">;

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
  create(
    command: PeopleActor & PersonIdentity & {
      readonly transaction: PeopleTransaction;
    },
  ): Promise<PersonIdentity | undefined>;
  assertCreatedPostcondition(
    command: PeopleActor & PersonIdentity & {
      readonly transaction: PeopleTransaction;
    },
  ): Promise<void>;
}
