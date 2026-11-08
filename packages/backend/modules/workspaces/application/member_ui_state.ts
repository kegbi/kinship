/**
 * A member's own interface state.
 *
 * The read takes no lock because nothing depends on it; the save takes one,
 * because it is a read-modify-write of the same JSON column the recent-people
 * list lives in and a save that replaced the column would erase it.
 *
 * Everything about what may be stored, and what is given back, is in
 * `domain/ui_state_rules.ts`: a save is refused before a transaction is opened
 * unless it names a field this module knows, and a read is projected rather
 * than cast, so whatever else the column happens to hold never reaches a page.
 */

import {
  type MemberUiState,
  mergedUiState,
  projection,
  validMemberUiState,
} from "../domain/ui_state_rules.ts";
import type { ActorRevalidation } from "../ports/actors.ts";
import { actorMayRead } from "./actor_admission.ts";
import type {
  MemberUiStateActor,
  MemberUiStateTransactionRunner,
} from "../ports/context.ts";
import type { MemberUiStateRepository } from "../ports/ui_state_repository.ts";

export interface MemberUiStateDependencies {
  readonly actors: ActorRevalidation;
  /**
   * Runs the read on one connection without a transaction. A deployment
   * passes it; without it the read runs inside `transaction`.
   */
  readonly connection?: MemberUiStateTransactionRunner;
  readonly repository: MemberUiStateRepository;
  readonly transaction: MemberUiStateTransactionRunner;
}

export function createMemberUiStateManagement(
  dependencies: MemberUiStateDependencies,
) {
  return {
    /**
     * The actor the request has just resolved is not asked about again
     * (BEQ-04); any other is revalidated first. The read is one statement.
     */
    async read(actor: MemberUiStateActor) {
      if (!await actorMayRead(dependencies, actor)) {
        return { status: "forbidden" as const };
      }
      const reads = dependencies.connection ?? dependencies.transaction;
      const result = await reads.run((connection) =>
        dependencies.repository.read({ ...actor, transaction: connection })
      );
      return result.status === "ready"
        ? { status: "ready" as const, uiState: projection(result.uiState) }
        : result;
    },

    /**
     * What the session carries of the member: the UI state and the resolved
     * preferences, from one statement (AUD-F3), admitted as `read` is.
     */
    async readSession(actor: MemberUiStateActor) {
      if (!await actorMayRead(dependencies, actor)) {
        return { status: "forbidden" as const };
      }
      const reads = dependencies.connection ?? dependencies.transaction;
      const result = await reads.run((connection) =>
        dependencies.repository.readSession({
          ...actor,
          transaction: connection,
        })
      );
      if (result.status !== "ready") return result;
      return {
        ...(result.preferences ? { preferences: result.preferences } : {}),
        status: "ready" as const,
        uiState: projection(result.uiState),
      };
    },

    async save(actor: MemberUiStateActor, input: MemberUiState) {
      if (!validMemberUiState(input)) return { status: "forbidden" as const };
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
        const uiState = mergedUiState(locked.uiState, input);
        return await dependencies.repository.save({
            ...actor,
            transaction,
            uiState,
          })
          ? { status: "ready" as const, uiState: projection(uiState) }
          : { status: "forbidden" as const };
      });
    },
  };
}

export type MemberUiStateManagement = ReturnType<
  typeof createMemberUiStateManagement
>;
