/**
 * The duplicate review on the people directory (GAP-049, PEOPLE-008).
 *
 * Two active people in the workspace are offered as a possible duplicate when
 * their full names are the same once case and spacing are ignored, or when
 * they share an email address or a phone number. The canonical schema has no
 * accent-folding extension, so names are compared by `lower` and trimmed,
 * collapsed whitespace only. The pairs are computed when they are asked for,
 * from the people module's rows and the workspace's contact-method kinds, and
 * never stored: merging a pair, or editing either person, simply stops it
 * being found. The one thing stored is a member's decision that two people
 * are not duplicates (REL-064): a pair in `person_duplicate_dismissals` is
 * never offered again, to any member of the workspace.
 *
 * The review is bounded. A value more than `PEOPLE_DUPLICATE_GROUP_LIMIT`
 * people share pairs nobody, and it shows at most `PEOPLE_DUPLICATE_PAIR_LIMIT` pairs,
 * oldest first, and says when there are more, because the answer to a long
 * list is to merge some and look again rather than to page through it.
 */

import type { TransactionScope } from "../../../shared-kernel/transaction.ts";
import type { Failure } from "../../../shared-kernel/result.ts";
import {
  actorMayRead,
  type ActorRevalidation,
} from "../../../modules/workspaces/public.ts";
import type { PersonAvatarRecord } from "../../../modules/people/public.ts";
import type {
  PeopleDirectoryActor,
  ReadModelTransaction,
} from "./list_people.ts";

export const PEOPLE_DUPLICATE_PAIR_LIMIT = 20;

/**
 * The most people one name, email address, or phone number may be shared by
 * and still pair them. A value more people share is a placeholder — an
 * office switchboard, a "0000" typed to fill a field — and pairing everyone
 * who shares it would build a pair for every two of them.
 */
export const PEOPLE_DUPLICATE_GROUP_LIMIT = 5;

/** Why two people look like the same person. */
export type PeopleDuplicateReason = "email" | "name" | "phone";

export interface PeopleDuplicatePerson {
  readonly avatar?: PersonAvatarRecord;
  readonly familyName?: string;
  readonly givenName: string;
  readonly id: string;
  readonly middleName?: string;
  readonly nickname?: string;
  /** The revision a merge of this pair is decided against. */
  readonly updatedAt: string;
}

export interface PeopleDuplicatePairRecord {
  /** The two people, the one added first first. */
  readonly people: readonly [PeopleDuplicatePerson, PeopleDuplicatePerson];
  readonly reasons: readonly PeopleDuplicateReason[];
}

export interface PeopleDuplicatesRepository {
  listPairs(command: {
    /** Values shared by more people than this pair nobody. */
    readonly groupLimit: number;
    readonly limit: number;
    readonly workspaceId: string;
  }): Promise<readonly PeopleDuplicatePairRecord[]>;
}

export type ListPeopleDuplicatesResult =
  | Failure<"forbidden">
  | {
    readonly pairs: readonly PeopleDuplicatePairRecord[];
    readonly status: "ready";
    /** More pairs exist than were shown. */
    readonly truncated: boolean;
  };

export function createPeopleDuplicates(dependencies: {
  readonly actors: ActorRevalidation;
  readonly repository: PeopleDuplicatesRepository;
  readonly transaction: {
    run<T>(
      work: (transaction: ReadModelTransaction) => Promise<T>,
      scope?: TransactionScope,
    ): Promise<T>;
  };
}) {
  return {
    list: async (
      actor: PeopleDirectoryActor,
    ): Promise<ListPeopleDuplicatesResult> => {
      if (!await actorMayRead(dependencies, actor)) {
        return { status: "forbidden" };
      }
      const pairs = await dependencies.repository.listPairs({
        groupLimit: PEOPLE_DUPLICATE_GROUP_LIMIT,
        limit: PEOPLE_DUPLICATE_PAIR_LIMIT + 1,
        workspaceId: actor.workspaceId,
      });
      return {
        pairs: pairs.slice(0, PEOPLE_DUPLICATE_PAIR_LIMIT),
        status: "ready",
        truncated: pairs.length > PEOPLE_DUPLICATE_PAIR_LIMIT,
      };
    },
  };
}

export type PeopleDuplicates = ReturnType<typeof createPeopleDuplicates>;
