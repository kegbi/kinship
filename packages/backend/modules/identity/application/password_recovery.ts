/**
 * The password recovery use case.
 *
 * Requesting a reset is written the way it is for one reason: the endpoint
 * must take the same observable time whether or not the address belongs to
 * anybody. The window opens before the outcome is known and is awaited on
 * every path, including the one where there is nobody to write to, and the
 * provider's own answer races the window rather than replacing it — so a slow
 * mail provider reports `timed-out` and still answers on time.
 *
 * Resetting hashes the new password and the presented token in parallel and
 * hands both to one repository call, so the token is spent and the password
 * replaced together and a link cannot be used twice.
 */

import type { Clock } from "../../../shared-kernel/clock.ts";
import type { IdGenerator } from "../../../shared-kernel/ids.ts";
import {
  deliveryWindow,
  passwordResetExpiry,
} from "../domain/identity_rules.ts";
import type {
  IdentityTokenService,
  PasswordRecoveryFacade,
  PasswordRecoveryMail,
  PasswordRecoveryRepository,
  PasswordRecoveryTransactionRunner,
} from "../ports/password_recovery.ts";
import type { PasswordHasher } from "../ports/security.ts";

export interface PasswordRecoveryDependencies {
  readonly clock: Clock;
  readonly delay?: (milliseconds: number) => Promise<void>;
  readonly deliveryWindowMilliseconds?: number;
  readonly hasher: PasswordHasher;
  readonly ids: IdGenerator;
  readonly mail: PasswordRecoveryMail;
  readonly repository: PasswordRecoveryRepository;
  readonly tokens: IdentityTokenService;
  readonly transaction: PasswordRecoveryTransactionRunner;
}

export function createPasswordRecovery(
  dependencies: PasswordRecoveryDependencies,
): PasswordRecoveryFacade {
  const windowMilliseconds = deliveryWindow(
    dependencies.deliveryWindowMilliseconds,
  );
  const delay = dependencies.delay ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  return {
    async request(command) {
      const now = dependencies.clock.now();
      const expiresAt = passwordResetExpiry(now);
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
      const publicWindow = delay(windowMilliseconds);
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
