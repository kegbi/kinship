/**
 * The vocabulary a member picks an interaction from.
 *
 * Nothing here decides anything: the workspace owns the activity types and the
 * emotions, and this file only establishes the actor, bounds the page, and
 * passes the search and cursor terms on.
 */

import { active, type InteractionDependencies } from "./interaction_context.ts";
import type { InteractionActor } from "../ports/context.ts";

/** What a member may narrow the option lists by. */
export interface InteractionOptionsInput {
  readonly activityTypeCursor?: string;
  readonly activityTypeSearch?: string;
  readonly emotionCursor?: string;
  readonly emotionSearch?: string;
  readonly limit?: number;
}

export function createInteractionListing(
  dependencies: InteractionDependencies,
) {
  return {
    options: (
      actor: InteractionActor,
      input: InteractionOptionsInput = {},
    ) =>
      dependencies.transaction.run(async (transaction) => {
        if (!await active(dependencies, actor, transaction, false)) {
          return { status: "forbidden" as const };
        }
        return await dependencies.workspace.options({
          ...actor,
          ...(input.activityTypeCursor
            ? { activityTypeCursor: input.activityTypeCursor }
            : {}),
          ...(input.activityTypeSearch?.trim()
            ? { activityTypeSearch: input.activityTypeSearch.trim() }
            : {}),
          ...(input.emotionCursor
            ? { emotionCursor: input.emotionCursor }
            : {}),
          ...(input.emotionSearch?.trim()
            ? { emotionSearch: input.emotionSearch.trim() }
            : {}),
          limit: Math.max(1, Math.min(20, Math.trunc(input.limit ?? 20))),
          transaction,
        });
      }, { workspaceId: actor.workspaceId }),
  };
}
