/**
 * The identity side of inviting somebody into a workspace.
 *
 * `workspaces` owns invitations and may not read identity's tables, so the
 * three questions it has to ask are declared here and answered by an adapter.
 * All four are narrow on purpose: whether an address already has an identity,
 * whether a given identity has proved that exact address, whether an inviter
 * proved theirs long enough ago to send invitations (SECA-03), and the names to
 * show beside the members a workspace already has. Nothing here hands back a
 * credential, a session, or an address the caller did not already name.
 */

import type { IdentityTransaction } from "./context.ts";

export interface InvitationIdentityDisplaySummary {
  readonly email: string;
  readonly name: string;
  readonly userId: string;
}

export interface InvitationIdentityFacade {
  findIdentityIdByEmail(command: {
    readonly email: string;
    readonly transaction: IdentityTransaction;
  }): Promise<string | undefined>;
  /**
   * True when the active identity verified its address at or before
   * `verifiedBy`; an unverified or inactive identity is never established.
   */
  isAddressVerifiedBy(command: {
    readonly transaction: IdentityTransaction;
    readonly userId: string;
    readonly verifiedBy: Date;
  }): Promise<boolean>;
  isVerifiedInvitationIdentity(command: {
    readonly expectedEmail: string;
    readonly transaction: IdentityTransaction;
    readonly userId: string;
  }): Promise<boolean>;
  listIdentityDisplaySummaries(command: {
    readonly transaction: IdentityTransaction;
    readonly userIds: readonly string[];
  }): Promise<readonly InvitationIdentityDisplaySummary[]>;
}
