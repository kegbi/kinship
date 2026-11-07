/**
 * The membership side of somebody leaving or deleting their account.
 *
 * `inspect` takes an optional lock because it is asked twice for different
 * reasons: the preview page reads it without one, and the write re-reads it
 * with one, so the answer cannot change between deciding that somebody is not
 * the last owner and letting them go.
 *
 * `leaveCurrent` and `leaveAll` are separate rather than one method with a
 * flag, because they end differently: leaving one workspace moves somebody to
 * another, and leaving all of them precedes deleting the account itself. Both
 * revoke the pending invitations the leaver sent, in the same transaction,
 * because nobody who has left can vouch for an invitee (SECT-04).
 */

import type { PersonalLifecycleMembership } from "../domain/personal_lifecycle_rules.ts";
import type {
  PersonalLifecycleActor,
  PersonalLifecycleTransaction,
} from "./context.ts";

export interface PersonalLifecycleMemberships {
  inspect(command: {
    readonly lock?: boolean;
    readonly transaction: PersonalLifecycleTransaction;
    readonly userId: string;
  }): Promise<{
    readonly memberships: readonly PersonalLifecycleMembership[];
  }>;
  leaveCurrent(
    command: PersonalLifecycleActor & {
      readonly leftAt: Date;
      readonly transaction: PersonalLifecycleTransaction;
    },
  ): Promise<void>;
  leaveAll(command: {
    readonly leftAt: Date;
    readonly transaction: PersonalLifecycleTransaction;
    readonly userId: string;
  }): Promise<void>;
}

export interface PersonalLifecycleAudit {
  record(command: {
    readonly action: string;
    readonly actorMemberId: string;
    readonly occurredAt: Date;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly subjectId: string;
    readonly subjectType: string;
    readonly transaction: PersonalLifecycleTransaction;
    readonly workspaceId: string;
  }): Promise<void>;
}
