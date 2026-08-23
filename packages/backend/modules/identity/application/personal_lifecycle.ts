import type { IdentityTransaction } from "./contracts.ts";

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
