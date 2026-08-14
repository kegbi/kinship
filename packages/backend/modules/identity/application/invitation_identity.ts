import type { IdentityTransaction } from "./contracts.ts";

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
