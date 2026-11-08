/**
 * The directory's tag facet (GAP-053, `PEOPLE-010`): the workspace's tags
 * with how many people of the view shown carry each, most carried first.
 *
 * It is bounded to the top thirty. When the workspace has more tags in use,
 * `truncated` says so, and every other tag stays reachable through the tag
 * filter's own paged, searchable options.
 */

import type { TransactionScope } from "../../../shared-kernel/transaction.ts";
import type { Failure } from "../../../shared-kernel/result.ts";
import {
  actorMayRead,
  type ActorRevalidation,
} from "../../../modules/workspaces/public.ts";
import type {
  PeopleDirectoryActor,
  PeopleDirectoryLifecycle,
  PeopleDirectoryTag,
  ReadModelTransaction,
} from "./list_people.ts";

/** The most tags the facet shows. */
export const PEOPLE_TAG_FACET_LIMIT = 30;

export interface PeopleTagFacetEntry extends PeopleDirectoryTag {
  /** People of the view who carry the tag; always at least one. */
  readonly count: number;
}

export interface PeopleTagFacetRepository {
  /**
   * The tags carried by at least one non-deleted person of `lifecycle`, by
   * count descending, then name and id; at most `limit`.
   */
  listTagFacet(
    command: PeopleDirectoryActor & {
      readonly lifecycle: PeopleDirectoryLifecycle;
      readonly limit: number;
    },
  ): Promise<readonly PeopleTagFacetEntry[]>;
}

export type ListPeopleTagFacetResult =
  | Failure<"forbidden">
  | {
    readonly lifecycle: PeopleDirectoryLifecycle;
    readonly status: "ready";
    readonly tags: readonly PeopleTagFacetEntry[];
    readonly truncated: boolean;
  };

export function createPeopleTagFacet(dependencies: {
  readonly actors: ActorRevalidation;
  readonly transaction: {
    run<T>(
      work: (transaction: ReadModelTransaction) => Promise<T>,
      scope?: TransactionScope,
    ): Promise<T>;
  };
  readonly repository: PeopleTagFacetRepository;
}) {
  return {
    list: async (
      actor: PeopleDirectoryActor,
      input: { readonly lifecycle: PeopleDirectoryLifecycle },
    ): Promise<ListPeopleTagFacetResult> => {
      if (!await actorMayRead(dependencies, actor)) {
        return { status: "forbidden" };
      }
      const tags = await dependencies.repository.listTagFacet({
        ...actor,
        lifecycle: input.lifecycle,
        limit: PEOPLE_TAG_FACET_LIMIT + 1,
      });
      return {
        lifecycle: input.lifecycle,
        status: "ready",
        tags: tags.slice(0, PEOPLE_TAG_FACET_LIMIT),
        truncated: tags.length > PEOPLE_TAG_FACET_LIMIT,
      };
    },
  };
}

export type PeopleTagFacet = ReturnType<typeof createPeopleTagFacet>;
