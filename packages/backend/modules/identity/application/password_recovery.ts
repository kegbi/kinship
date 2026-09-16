import type { Clock } from "../../../shared-kernel/clock.ts";
import type { IdGenerator } from "../../../shared-kernel/ids.ts";
import type { IdentityTransaction } from "./contracts.ts";
import type { PasswordHasher } from "../ports/security.ts";

export interface PasswordRecoveryTransactionRunner {
  run<T>(work: (transaction: IdentityTransaction) => Promise<T>): Promise<T>;
}

export interface PasswordRecoveryRepository {
  createRequest(command: {
    readonly email: string;
    readonly expiresAt: Date;
    readonly id: string;
    readonly ipAddress?: string;
    readonly now: Date;
    readonly tokenHash: string;
    readonly transaction: IdentityTransaction;
  }): Promise<{ readonly deliveryEmail?: string }>;
  resetPassword(command: {
    readonly newPasswordHash: string;
    readonly now: Date;
    readonly tokenHash: string;
    readonly transaction: IdentityTransaction;
  }): Promise<"expired" | "invalid" | "reset">;
}

export interface PasswordRecoveryMail {
  sendPasswordReset(message: {
    readonly email: string;
    readonly expiresAt: Date;
    readonly token: string;
  }): Promise<void>;
}

export interface PasswordRecoveryFacade {
  request(command: {
    readonly email: string;
    readonly ipAddress?: string;
  }): Promise<{
    readonly delivery: "delivered" | "failed" | "not-applicable" | "timed-out";
  }>;
  reset(command: {
    readonly password: string;
    readonly token: string;
  }): Promise<"expired" | "invalid" | "reset">;
}

export function createPasswordRecovery(dependencies: {
  readonly clock: Clock;
  readonly delay?: (milliseconds: number) => Promise<void>;
  readonly deliveryWindowMilliseconds?: number;
  readonly hasher: PasswordHasher;
  readonly ids: IdGenerator;
  readonly mail: PasswordRecoveryMail;
  readonly repository: PasswordRecoveryRepository;
  readonly tokens: {
    create(): Promise<{ readonly hash: string; readonly raw: string }>;
    hash(raw: string): Promise<string>;
  };
  readonly transaction: PasswordRecoveryTransactionRunner;
}): PasswordRecoveryFacade {
  const deliveryWindowMilliseconds = dependencies.deliveryWindowMilliseconds ??
    1_500;
  if (
    !Number.isFinite(deliveryWindowMilliseconds) ||
    deliveryWindowMilliseconds < 100 || deliveryWindowMilliseconds > 5_000
  ) {
    throw new Error("Password recovery delivery window must be 100-5000ms.");
  }
  const delay = dependencies.delay ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  return {
    async request(command) {
      const now = dependencies.clock.now();
      const expiresAt = new Date(now.getTime() + 60 * 60_000);
      const token = await dependencies.tokens.create();
      const delivery = await dependencies.transaction.run((transaction) =>
        dependencies.repository.createRequest({
          email: command.email,
          expiresAt,
          id: dependencies.ids.create(),
          ...(command.ipAddress ? { ipAddress: command.ipAddress } : {}),
          now,
          tokenHash: token.hash,
          transaction,
        })
      );
      const publicWindow = delay(deliveryWindowMilliseconds);
      if (!delivery.deliveryEmail) {
        await publicWindow;
        return { delivery: "not-applicable" };
      }
      const provider = dependencies.mail.sendPasswordReset({
        email: delivery.deliveryEmail,
        expiresAt,
        token: token.raw,
      }).then(
        () => "delivered" as const,
        () => "failed" as const,
      );
      const outcome = await Promise.race([
        provider,
        publicWindow.then(() => "timed-out" as const),
      ]);
      await publicWindow;
      return { delivery: outcome };
    },
    async reset(command) {
      const [newPasswordHash, tokenHash] = await Promise.all([
        dependencies.hasher.hash(command.password),
        dependencies.tokens.hash(command.token),
      ]);
      return await dependencies.transaction.run((transaction) =>
        dependencies.repository.resetPassword({
          newPasswordHash,
          now: dependencies.clock.now(),
          tokenHash,
          transaction,
        })
      );
    },
  };
}
