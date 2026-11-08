/**
 * What workspaces knows about a pending registration that identity does not
 * (SECA-04, AUD-A2): whether somebody is still waiting on it, and which
 * workspaces it was provisioned with before workspaces waited for
 * verification.
 */

import type { RegistrationTransaction } from "./context.ts";
import type { WorkspaceRegistrationWriter } from "./registration_repository.ts";

/**
 * `deletePendingWorkspaces` is the same statement replacing a pending
 * registration runs: the workspaces each named user created that nobody else
 * belongs to — what a registration was provisioned with before AUD-A2.
 */
export interface PendingRegistrationRetentionRepository
  extends Pick<WorkspaceRegistrationWriter, "deletePendingWorkspaces"> {
  /**
   * Of `users`, the ids that must stay: anybody a pending, unexpired
   * invitation is addressed to, and anybody with a membership in a workspace
   * that is not their own unshared pending one.
   */
  heldPendingRegistrations(command: {
    readonly now: Date;
    readonly transaction: RegistrationTransaction;
    readonly users: readonly {
      readonly email: string;
      readonly userId: string;
    }[];
  }): Promise<ReadonlySet<string>>;
}
