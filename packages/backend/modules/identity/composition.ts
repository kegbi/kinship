/**
 * Identity composition.
 *
 * Only a declared composition root imports this file. It owns every identity
 * adapter — the hashers, the token service, the secret boxes, and the four
 * PostgreSQL facades — and hands back the ports the rest of the system knows
 * identity by.
 *
 * The MFA keyset arrives as a port rather than being read here: deciding which
 * keyset a deployment runs with is a root's job, not a module's.
 */

import type { SharedComposition } from "../../platform/composition.ts";
import { Argon2idPasswordHasher } from "./adapters/crypto/argon2id.ts";
import {
  SecureTokenService,
  WebCryptoRandomSource,
} from "./adapters/crypto/secure_tokens.ts";
import { AesGcmMfaSecretBox } from "./adapters/crypto/totp.ts";
import { PostgresEmailVerification } from "./adapters/postgres/email_verification.ts";
import { PostgresIdentityAccountSettings } from "./adapters/postgres/account_settings.ts";
import { PostgresIdentityAuthentication } from "./adapters/postgres/authentication.ts";
import { PostgresIdentityPersonalLifecycle } from "./adapters/postgres/personal_lifecycle.ts";
import { PostgresIdentityRegistration } from "./adapters/postgres/identity_repository.ts";
import { PostgresInvitationIdentity } from "./adapters/postgres/invitation_identity.ts";
import { PostgresPasswordRecoveryRepository } from "./adapters/postgres/password_recovery.ts";
import { createPasswordRecovery } from "./public.ts";
import type { MfaEncryptionKeyset } from "./adapters/crypto/totp.ts";
import type { PasswordRecoveryMail } from "./ports/password_recovery.ts";

export { decodeMfaEncryptionKeyset } from "./adapters/crypto/totp.ts";

/** The Argon2id cost the deployment runs with. */
const PASSWORD_HASH_PARAMETERS = {
  memoryKiB: 19_456,
  iterations: 2,
  parallelism: 1,
  saltLength: 16,
  hashLength: 32,
};

export interface IdentityPorts {
  readonly mail: PasswordRecoveryMail;
  readonly mfaKeyset: MfaEncryptionKeyset;
}

export function composeIdentity(
  shared: SharedComposition,
  ports: IdentityPorts,
) {
  const random = new WebCryptoRandomSource();
  const tokens = new SecureTokenService(random);
  const hasher = new Argon2idPasswordHasher(random, PASSWORD_HASH_PARAMETERS);
  return {
    accountSettings: new PostgresIdentityAccountSettings(tokens),
    authentication: new PostgresIdentityAuthentication(
      shared.database,
      hasher,
      tokens,
      new AesGcmMfaSecretBox(ports.mfaKeyset, random),
      shared.clock,
      shared.ids,
    ),
    hasher,
    invitations: new PostgresInvitationIdentity(),
    passwordRecovery: createPasswordRecovery({
      clock: shared.clock,
      hasher,
      ids: shared.ids,
      mail: ports.mail,
      repository: new PostgresPasswordRecoveryRepository(),
      tokens,
      transaction: shared.transaction,
    }),
    personalLifecycle: new PostgresIdentityPersonalLifecycle(hasher),
    registration: new PostgresIdentityRegistration(tokens),
    tokens,
    verification: new PostgresEmailVerification(
      shared.database,
      tokens,
      shared.clock,
      shared.ids,
      shared.workspaceEntry,
    ),
  };
}
