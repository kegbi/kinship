/**
 * The workspace configuration a person's life event refers to (JOURNAL-002).
 *
 * `journal` owns the events; the workspace owns the life-event type
 * vocabulary and whether the life-events profile module is on. The actor's
 * standing is not this boundary's question: callers establish it with
 * `ActorRevalidation` before they ask, so this only reads the workspace's own
 * rows.
 */

import type { Failure } from "../../../shared-kernel/result.ts";

export interface LifeEventWorkspaceTransaction {
  readonly opaque: unknown;
}

/** One type from the workspace's life-event vocabulary. */
export interface WorkspaceLifeEventType {
  /** Hidden for new events but retained for the events that use it. */
  readonly archived: boolean;
  readonly id: string;
  readonly name: string;
}

export type LifeEventWorkspaceInspection =
  | Failure<"not-found", "hidden">
  | { readonly status: "ready"; readonly type?: WorkspaceLifeEventType };

export interface LifeEventWorkspaceBoundary {
  /**
   * Whether the workspace keeps life events at all and, when `typeId` is
   * given, the type it names in this workspace; `not-found` when the type
   * belongs to no type of this workspace. `lock` holds the type row until
   * the transaction ends.
   */
  inspect(command: {
    readonly lock: boolean;
    readonly transaction: LifeEventWorkspaceTransaction;
    readonly typeId?: string;
    readonly workspaceId: string;
  }): Promise<LifeEventWorkspaceInspection>;
}
