/**
 * A pair of people a member said are not duplicates (REL-064, `PEOPLE-008`).
 *
 * `person_duplicate_dismissals` keeps each unordered pair once per workspace,
 * lower person id first, and every member shares it. The repository is only
 * ever handed a pair already in that order.
 */

import type { PeopleTransaction } from "./context.ts";

export interface PersonDuplicatePairCommand {
  readonly personHighId: string;
  readonly personLowId: string;
  readonly transaction: PeopleTransaction;
  readonly workspaceId: string;
}

export interface PersonDuplicateDismissalRepository {
  /**
   * Locks both people against a concurrent merge or delete and answers how
   * many of the two exist, undeleted, in the workspace.
   */
  lockPair(command: PersonDuplicatePairCommand): Promise<number>;
  /**
   * Stores the decision as the member, and answers whether it was new: a pair
   * already dismissed is left as it was.
   */
  dismiss(
    command: PersonDuplicatePairCommand & { readonly memberId: string },
  ): Promise<boolean>;
}
