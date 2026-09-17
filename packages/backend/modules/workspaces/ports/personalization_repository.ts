/**
 * How a workspace's personalizable vocabularies are read and changed.
 *
 * `PersonalizationRepository` is what the use case holds, and it is
 * deliberately the same three methods whichever section is being changed: the
 * routing between sections happens behind it, so a new section does not change
 * this contract. `inspect` exists for one reason — a delete with no
 * replacement has to know whether the entry is still referred to before it
 * commits to anything.
 *
 * `WorkspacePersonalizationRepository` is the wider contract the router holds,
 * with the authorization check and the two-step delete a section that spans
 * modules needs: prepare inside the workspace's lock, then let the owning
 * module do its part, then delete.
 */

import type { Failure } from "../../../shared-kernel/result.ts";
import type {
  PersonalizationEntry,
  PersonalizationMutation,
  PersonalizationMutationResult,
  PersonalizationResult,
  PersonalizationSection,
} from "../domain/personalization_rules.ts";
import type { PersonalizationTransaction, SettingsActor } from "./context.ts";

export interface PersonalizationRepository {
  inspect(
    command: SettingsActor & {
      readonly id: string;
      readonly section: PersonalizationSection;
      readonly transaction: PersonalizationTransaction;
    },
  ): Promise<
    | { readonly entry: PersonalizationEntry; readonly status: "ready" }
    | Failure<"forbidden" | "not-found" | "unavailable">
  >;
  list(
    command: SettingsActor & {
      readonly section: PersonalizationSection;
      readonly transaction: PersonalizationTransaction;
    },
  ): Promise<PersonalizationResult>;
  mutate(
    command: SettingsActor & PersonalizationMutation & {
      readonly section: PersonalizationSection;
      readonly transaction: PersonalizationTransaction;
    },
  ): Promise<PersonalizationMutationResult>;
}

export type WorkspacePersonalizationDeleteCommand = SettingsActor & {
  readonly action: "delete";
  readonly expectedUpdatedAt: string;
  readonly id: string;
  readonly replacementId?: string;
  readonly section: PersonalizationSection;
  readonly transaction: PersonalizationTransaction;
};

export interface WorkspacePersonalizationRepository
  extends PersonalizationRepository {
  authorize(
    command: Parameters<PersonalizationRepository["list"]>[0],
  ): Promise<boolean>;
  prepareDelete(command: WorkspacePersonalizationDeleteCommand): Promise<
    | { readonly entry: PersonalizationEntry; readonly status: "ready" }
    | Failure<
      "forbidden" | "not-found" | "unavailable",
      "invalid" | "required-default" | "stale"
    >
  >;
  deletePrepared(
    command: WorkspacePersonalizationDeleteCommand,
  ): Promise<{ readonly id: string; readonly status: "deleted" }>;
}
