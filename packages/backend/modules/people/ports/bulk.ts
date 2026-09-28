/**
 * What a bulk action asks outside the people it acts on (GAP-051).
 *
 * Tagging several people names one tag, and a tag from another workspace is
 * a refusal of the whole request rather than of every person in it. People
 * owns the workspace's tags, so the lookup is one workspace-scoped existence
 * check by id, run inside the transaction that already revalidated the actor.
 */

import type { PeopleTransaction } from "./context.ts";

export interface PeopleBulkTagLookup {
  exists(command: {
    readonly tagId: string;
    readonly transaction: PeopleTransaction;
    readonly workspaceId: string;
  }): Promise<boolean>;
}
