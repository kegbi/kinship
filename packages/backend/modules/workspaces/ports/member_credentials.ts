/**
 * What happens to a member's API credentials when they stop belonging to a
 * workspace (SECT-07).
 *
 * `api-access` owns tokens and depends on this module, so the call cannot go
 * the other way through its facade. The contract is declared here, beside the
 * use cases that remove somebody, and the composition root fills it with
 * api-access's own use case. It runs inside the transaction that suspended
 * the member, recorded their leaving, or deleted their account, so a removed
 * member and a live token of theirs are never both committed.
 *
 * A role change alone does not call it: a demoted member's token already
 * answers with the role they hold when it is used.
 */

import type { WorkspaceRole } from "../domain/roles.ts";
import type { Correlation } from "../../../shared-kernel/telemetry.ts";

export interface MemberCredentialRevocation {
  /**
   * Revokes every token and calendar feed `subjectUserId` holds in the
   * actor's workspace, audited against the actor.
   */
  revokeMemberCredentials(command: {
    readonly actor: Correlation & {
      readonly memberId: string;
      readonly role: WorkspaceRole;
      readonly userId: string;
      readonly workspaceId: string;
    };
    readonly occurredAt: Date;
    readonly subjectUserId: string;
    readonly transaction: { readonly opaque: unknown };
  }): Promise<void>;
}
