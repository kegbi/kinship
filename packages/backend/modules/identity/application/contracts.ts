export interface IdentityTransaction {
  readonly opaque: unknown;
}

export interface CreatePendingUserCommand {
  readonly email: string;
  readonly expiresAt: Date;
  readonly firstName: string;
  readonly lastName: string;
  readonly passwordHash: string;
  readonly tokenHash: string;
  readonly transaction: IdentityTransaction;
  readonly userId: string;
  readonly verificationTokenId: string;
}

export interface PendingUser {
  readonly userId: string;
}

export interface IdentityRegistrationFacade {
  createPendingUser(command: CreatePendingUserCommand): Promise<PendingUser>;
  assertPendingUserPostconditions(command: {
    readonly email: string;
    readonly expiresAt: Date;
    readonly firstName: string;
    readonly lastName: string;
    readonly passwordHash: string;
    readonly tokenHash: string;
    readonly transaction: IdentityTransaction;
    readonly userId: string;
    readonly verificationTokenId: string;
  }): Promise<void>;
  createRetryVerificationToken(command: {
    readonly createdAt: Date;
    readonly email: string;
    readonly expiresAt: Date;
    readonly tokenHash: string;
    readonly transaction: IdentityTransaction;
    readonly verificationTokenId: string;
  }): Promise<
    { readonly email: string; readonly created: boolean } | undefined
  >;
}

export class IdentityConflictError extends Error {
  constructor() {
    super("Identity already exists.");
    this.name = "IdentityConflictError";
  }
}
