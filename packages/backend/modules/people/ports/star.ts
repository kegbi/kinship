/**
 * Whether a person is starred (GAP-053, `PEOPLE-010`).
 *
 * `people.is_starred` is one flag on the person row, shared by the whole
 * workspace rather than kept per member. Starring does not move the person's
 * own revision, so an open identity editor stays current, as an avatar change
 * leaves it.
 */

import type { Failure } from "../../../shared-kernel/result.ts";
import type { PeopleActor, PeopleTransaction } from "./context.ts";

export interface PersonStarRepository {
  /** Locks the person and answers whether they are archived and starred. */
  lock(
    command: PeopleActor & {
      readonly personId: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<
    | {
      readonly archived: boolean;
      readonly starred: boolean;
      readonly status: "ready";
    }
    | Failure<"not-found">
  >;
  /** Sets the flag on the person the caller locked. */
  save(
    command: PeopleActor & {
      readonly personId: string;
      readonly starred: boolean;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<void>;
}
