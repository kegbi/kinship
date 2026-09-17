/**
 * Remembering which people a member last looked at.
 *
 * One write, and the whole of it is a read-modify-write of one JSON column, so
 * it takes the actor's lock and then the row's: two tabs recording two people
 * at once would otherwise each write back the list they read, and one of them
 * would lose.
 *
 * The identifier is canonicalised before anything is written, and a value that
 * is not one is refused rather than dropped — recording a person nobody can
 * name would put a row in the list that no page can render.
 */

import {
  canonicalPersonId,
  withRecentPerson,
} from "../domain/ui_state_rules.ts";
import type { ActorRevalidation } from "../ports/actors.ts";
import type {
  RecentPeopleActor,
  RecentPeopleTransactionRunner,
} from "../ports/context.ts";
import type { RecentPeopleRepository } from "../ports/ui_state_repository.ts";

export interface RecentPeopleDependencies {
  readonly actors: ActorRevalidation;
  readonly repository: RecentPeopleRepository;
  readonly transaction: RecentPeopleTransactionRunner;
}

export function createRecentPeopleManagement(
  dependencies: RecentPeopleDependencies,
) {
  return {
    async record(
      actor: RecentPeopleActor,
      personId: string,
    ) {
      return await dependencies.transaction.run(async (transaction) => {
        const standing = await dependencies.actors.revalidate({
          ...actor,
          lock: true,
          transaction,
        });
        if (standing === "revoked") return { status: "forbidden" as const };
        const locked = await dependencies.repository.lock({
          ...actor,
          transaction,
        });
        if (locked.status !== "ready") return locked;
        const canonical = canonicalPersonId(personId);
        if (!canonical) return { status: "forbidden" as const };
        return await dependencies.repository.save({
            ...actor,
            transaction,
            uiState: withRecentPerson(locked.uiState, canonical),
          })
          ? { status: "recorded" as const }
          : { status: "forbidden" as const };
      });
    },
  };
}

export type RecentPeopleManagement = ReturnType<
  typeof createRecentPeopleManagement
>;
