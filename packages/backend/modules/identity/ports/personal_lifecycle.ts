/**
 * The identity side of somebody deleting their own account.
 *
 * `workspaces` runs the cascade; identity is asked three things in the middle
 * of it. `verifyPassword` is a re-authentication, because deleting an account
 * is the one action a stolen session must not be able to take. `inspectIdentity`
 * reports the address and how many sessions are live, which is what the
 * confirmation page shows. `deleteIdentity` and `revokeSessions` are the write,
 * split so a cascade can end every session before the row goes.
 */

import type { IdentityTransaction } from "./context.ts";

export interface IdentityPersonalLifecycleInspection {
  readonly activeSessionCount: number;
  readonly email: string;
}

export interface IdentityPersonalLifecycleFacade {
  inspectIdentity(command: {
    readonly now?: Date;
    readonly transaction: IdentityTransaction;
    readonly userId: string;
  }): Promise<IdentityPersonalLifecycleInspection | undefined>;
  verifyPassword(command: {
    readonly password: string;
    readonly transaction: IdentityTransaction;
    readonly userId: string;
  }): Promise<boolean>;
  deleteIdentity(command: {
    readonly deletedAt: Date;
    readonly transaction: IdentityTransaction;
    readonly userId: string;
  }): Promise<void>;
  revokeSessions(command: {
    readonly revokedAt: Date;
    readonly transaction: IdentityTransaction;
    readonly userId: string;
  }): Promise<void>;
}
