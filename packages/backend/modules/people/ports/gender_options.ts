/**
 * The workspace gender vocabulary a person's identity refers to (GAP-047).
 *
 * `people` stores which option a person is described with; `workspaces` owns
 * the options themselves. An edit that chooses a different option asks this
 * port whether the option belongs to the person's workspace and is still
 * current. The actor's standing is not this port's question: the use case has
 * already revalidated it under lock.
 */

import type { GenderOptionInspection } from "../domain/lifecycle_rules.ts";
import type { PeopleTransaction } from "./context.ts";

export interface PersonGenderOptions {
  /**
   * The option `genderOptionId` names in `workspaceId`, holding it until the
   * transaction ends so it cannot be deleted under the edit; `not-found` when
   * no option of that workspace has the identifier.
   */
  inspect(command: {
    readonly genderOptionId: string;
    readonly transaction: PeopleTransaction;
    readonly workspaceId: string;
  }): Promise<GenderOptionInspection>;
}
