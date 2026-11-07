/**
 * The membership row's scratch column, read and written two ways.
 *
 * Both contracts have a `lock` beside their read because a save is a
 * read-modify-write of one JSON column: two tabs saving different fields at
 * once would otherwise each write back what they read, and one of them would
 * lose. The lock is taken inside the caller's transaction and released with
 * it.
 *
 * `save` answers with a boolean rather than a record because the only thing
 * that can go wrong at that point is that the membership is no longer there,
 * and the use case has nothing more to say about that than `forbidden`.
 */

import type { Failure } from "../../../shared-kernel/result.ts";
import type {
  MemberUiStateActor,
  MemberUiStateTransaction,
  RecentPeopleActor,
  RecentPeopleTransaction,
} from "./context.ts";

type StoredUiState = Readonly<Record<string, unknown>>;

export interface MemberUiStateRepository {
  read(
    command: MemberUiStateActor & {
      readonly transaction: MemberUiStateTransaction;
    },
  ): Promise<
    | Failure<"forbidden">
    | { readonly status: "ready"; readonly uiState: unknown }
  >;
  lock(
    command: MemberUiStateActor & {
      readonly transaction: MemberUiStateTransaction;
    },
  ): Promise<
    | Failure<"forbidden">
    | { readonly status: "ready"; readonly uiState: unknown }
  >;
  save(
    command: MemberUiStateActor & {
      readonly transaction: MemberUiStateTransaction;
      readonly uiState: StoredUiState;
    },
  ): Promise<boolean>;
}

export interface RecentPeopleRepository {
  lock(
    command: RecentPeopleActor & {
      readonly transaction: RecentPeopleTransaction;
    },
  ): Promise<
    | Failure<"forbidden">
    | { readonly status: "ready"; readonly uiState: unknown }
  >;
  save(
    command: RecentPeopleActor & {
      readonly transaction: RecentPeopleTransaction;
      readonly uiState: StoredUiState;
    },
  ): Promise<boolean>;
}

/**
 * Whether a person is in the actor's workspace (AUD-T1, SECT-09). People own
 * that table and depend on this module, so the composition root fills this
 * port from the people module instead of this module reading the people table.
 */
export interface RecentPersonScope {
  inWorkspace(command: {
    readonly personId: string;
    readonly transaction: RecentPeopleTransaction;
    readonly workspaceId: string;
  }): Promise<boolean>;
}
