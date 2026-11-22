import { type Kysely, sql } from "kysely";
import type { Clock } from "../../../../shared-kernel/clock.ts";
import type { IdGenerator } from "../../../../shared-kernel/ids.ts";
import { isUuid } from "../../../../shared-kernel/validation.ts";
import type { ApplicationDatabase } from "../../../../platform/postgres/database.ts";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type {
  AuthenticatedSession,
  IdentityAuthenticationFacade,
  MfaAuthenticationResult,
  PasswordAuthenticationResult,
  SessionPrincipal,
} from "../../ports/authentication.ts";
import type { IdentityTransaction } from "../../ports/context.ts";
import type { PasswordHasher } from "../../ports/security.ts";
import { SecureTokenService } from "../crypto/secure_tokens.ts";
import { AesGcmMfaSecretBox, verifyTotp } from "../crypto/totp.ts";

interface CredentialRow {
  readonly app_credential: boolean;
  readonly credential_version: string;
  readonly has_mfa: boolean;
  readonly password_hash: string | null;
  readonly password_changed_at: Date | null;
  readonly status: string;
  readonly user_id: string;
}

/** How long a proved password waits for its second factor. */
const CHALLENGE_MILLISECONDS = 5 * 60_000;
/** Wrong factors one challenge absorbs before it refuses every factor. */
const CHALLENGE_ATTEMPTS = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A `kinship_mfa` value is `<row id>.<secret>`: the id finds the
 * `mfa-challenge` row, and only the secret proves the caller holds it.
 */
function parseChallenge(
  token: string,
): { readonly id: string; readonly secret: string } | undefined {
  const [id, secret, rest] = token.split(".");
  return id && secret && rest === undefined && UUID.test(id)
    ? { id, secret }
    : undefined;
}

export class PostgresIdentityAuthentication
  implements IdentityAuthenticationFacade {
  readonly #dummyHash: Promise<string>;

  constructor(
    private readonly database: Kysely<ApplicationDatabase>,
    private readonly hasher: PasswordHasher,
    private readonly tokens: SecureTokenService,
    private readonly secretBox: AesGcmMfaSecretBox,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {
    this.#dummyHash = hasher.hash("constant-shape-invalid-password-work");
  }

  async authenticationSubjectForMfa(challengeToken: string): Promise<string> {
    const challenge = parseChallenge(challengeToken);
    const userId = challenge &&
      await this.#challengeUser(this.database, challenge.id);
    return userId
      ? `user:${userId}`
      : `challenge:${await this.tokens.hash(challengeToken)}`;
  }

  async resolveAuthenticationAuditUser(command: {
    readonly scope: "mfa" | "password";
    readonly subject: string;
  }): Promise<string | undefined> {
    const candidateMfaUserId = command.scope === "mfa" &&
        command.subject.startsWith("user:")
      ? command.subject.slice("user:".length)
      : undefined;
    const mfaUserId = isUuid(candidateMfaUserId)
      ? candidateMfaUserId
      : "00000000-0000-0000-0000-000000000000";
    const result = await sql<{ readonly user_id: string }>`
      select u.id::text user_id
      from crm.users u
      where u.status = 'active' and u.password_hash is not null
        and u.email_verified_at is not null
        and exists (
          select 1 from crm.email_verification_tokens evt
          where evt.user_id = u.id and evt.used_at is not null
        )
        and (
          (${command.scope} = 'password' and u.email = ${command.subject})
          or (${command.scope} = 'mfa' and u.id = ${mfaUserId}::uuid)
        )
      limit 1
    `.execute(this.database);
    return result.rows[0]?.user_id;
  }

  async authenticatePassword(command: {
    readonly email: string;
    readonly ipAddress?: string;
    readonly password: string;
    readonly userAgent?: string;
  }): Promise<PasswordAuthenticationResult> {
    const now = this.clock.now();
    const result = await sql<CredentialRow>`
      select u.id::text user_id, u.password_hash, u.password_changed_at,
        coalesce(extract(epoch from u.password_changed_at)::text, 'none')
          credential_version,
        u.status,
        exists (
          select 1 from crm.email_verification_tokens evt
          where evt.user_id = u.id and evt.used_at is not null
        ) app_credential,
        exists (
          select 1 from crm.user_mfa_totp mfa
          where mfa.user_id = u.id and mfa.confirmed_at is not null
        ) has_mfa
      from crm.users u where u.email = ${command.email}
    `.execute(this.database);
    const credential = result.rows[0];
    const usable = credential?.status === "active" &&
      credential.app_credential &&
      credential.password_hash !== null;
    const hash = usable ? credential.password_hash! : await this.#dummyHash;
    const valid = await this.hasher.verify(command.password, hash);
    // The caller's durable attempt budget is the only throttle (AUD-A3).
    if (!usable || !valid) {
      return {
        ...(usable ? { auditUserId: credential.user_id } : {}),
        status: "invalid",
      };
    }
    if (this.hasher.needsUpgrade(hash)) {
      await this.#upgradeHash(credential.user_id, hash, command.password, now);
    }
    if (!credential.has_mfa) {
      return {
        credentialVersion: credential.password_changed_at,
        entryCredentialVersion: credential.credential_version,
        status: "verified",
        userId: credential.user_id,
      };
    }
    const challengeId = this.ids.create();
    const secret = (await this.tokens.create()).raw;
    const challengeHash = await this.#challengeHash(
      secret,
      0,
      credential.credential_version,
    );
    await sql`
      insert into crm.user_sessions (
        id, user_id, session_hash, purpose, ip_address, user_agent,
        created_at, last_seen_at, expires_at, revoked_at
      ) values (
        ${challengeId}::uuid, ${credential.user_id}::uuid, ${challengeHash},
        'mfa-challenge', ${command.ipAddress ?? null}::inet,
        ${command.userAgent ?? null}, ${now}, ${now},
        ${new Date(now.getTime() + CHALLENGE_MILLISECONDS)}, null
      )
    `.execute(this.database);
    return {
      challengeToken: `${challengeId}.${secret}`,
      credentialVersion: credential.password_changed_at,
      entryCredentialVersion: credential.credential_version,
      status: "mfa-required",
      userId: credential.user_id,
    };
  }

  /**
   * Re-hashes a verified password under the current cost. Only the exact hash
   * that was verified is replaced, so a concurrent reset always wins, and the
   * credential version is untouched: an upgrade is not a password change.
   *
   * The upgrade is best effort. The password is already proved, so a hashing
   * or storage failure leaves the verified hash in place and the sign-in goes
   * on; the next successful sign-in tries again.
   */
  async #upgradeHash(
    userId: string,
    verifiedHash: string,
    password: string,
    now: Date,
  ): Promise<void> {
    try {
      const upgraded = await this.hasher.hash(password);
      await sql`
        update crm.users set password_hash = ${upgraded}, updated_at = ${now}
        where id = ${userId}::uuid and password_hash = ${verifiedHash}
      `.execute(this.database);
    } catch {
      // Deliberately swallowed: see above.
    }
  }

  /**
   * Answers a challenge with a factor, on whichever process proved the
   * password (SECA-06). An attempt locks the user, then the challenge row, the
   * order a password reset takes them in, so attempts on one challenge are
   * counted one at a time and a reset either revokes the row first or waits.
   */
  async completeMfa(command: {
    readonly challengeToken: string;
    readonly factor: string;
    readonly transaction: IdentityTransaction;
  }): Promise<MfaAuthenticationResult> {
    const database = databaseFromSession(command.transaction);
    const parsed = parseChallenge(command.challengeToken);
    const userId = parsed && await this.#challengeUser(database, parsed.id);
    if (!parsed || !userId) return { status: "expired" };
    const now = this.clock.now();
    const mfaResult = await sql<{
      readonly encrypted_secret: string;
      readonly credential_version: string;
      readonly last_used_at: Date | null;
      readonly password_changed_at: Date | null;
    }>`
      select mfa.encrypted_secret, mfa.last_used_at, u.password_changed_at,
        coalesce(extract(epoch from u.password_changed_at)::text, 'none')
          credential_version
      from crm.users u join crm.user_mfa_totp mfa on mfa.user_id = u.id
      where u.id = ${userId}::uuid and u.status = 'active'
        and mfa.confirmed_at is not null
      for update of u, mfa
    `.execute(database);
    const mfa = mfaResult.rows[0];
    const challengeResult = await sql<{
      readonly expires_at: Date;
      readonly revoked: boolean;
      readonly session_hash: string;
    }>`
      select session_hash, expires_at, revoked_at is not null revoked
      from crm.user_sessions
      where id = ${parsed.id}::uuid and purpose = 'mfa-challenge'
      for update
    `.execute(database);
    const challenge = challengeResult.rows[0];
    const expiresAt = new Date(challenge?.expires_at ?? 0).getTime();
    if (!challenge || challenge.revoked || expiresAt <= now.getTime()) {
      return { auditUserId: userId, status: "expired" };
    }
    // A credential changed since the password was proved, or a secret that is
    // not this row's, matches no attempt count; either way the row is spent.
    const failures = mfa &&
      await this.#challengeFailures(
        challenge.session_hash,
        parsed.secret,
        mfa.credential_version,
      );
    if (!mfa || failures === undefined) {
      await this.#revokeChallenge(database, parsed.id, now);
      return { auditUserId: userId, status: "expired" };
    }
    if (failures >= CHALLENGE_ATTEMPTS) {
      return {
        auditUserId: userId,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((expiresAt - now.getTime()) / 1_000),
        ),
        status: "rate-limited",
      };
    }
    let accepted = false;
    if (/^\d{6}$/.test(command.factor)) {
      const secret = await this.secretBox.decrypt(
        mfa.encrypted_secret,
        userId,
      );
      if (secret) {
        const verification = await verifyTotp(
          secret,
          command.factor,
          now,
          mfa.last_used_at ?? undefined,
        );
        if (verification.valid) {
          const acceptedAt = new Date(verification.counter * 30_000);
          await sql`
            update crm.user_mfa_totp set last_used_at = ${acceptedAt},
              updated_at = ${now}
            where user_id = ${userId}::uuid
          `.execute(database);
          accepted = true;
        }
      }
    } else {
      const recoveryHash = await this.tokens.hash(command.factor.trim());
      const recovery = await sql<{ readonly id: string }>`
        select id::text from crm.user_recovery_codes
        where user_id = ${userId}::uuid
          and code_hash = ${recoveryHash} and used_at is null
        for update
      `.execute(database);
      if (recovery.rows[0]) {
        await sql`
          update crm.user_recovery_codes set used_at = ${now}
          where id = ${recovery.rows[0].id}::uuid and used_at is null
        `.execute(database);
        accepted = true;
      }
    }
    if (!accepted) {
      const counted = await this.#challengeHash(
        parsed.secret,
        failures + 1,
        mfa.credential_version,
      );
      await sql`
        update crm.user_sessions set session_hash = ${counted},
          last_seen_at = ${now}
        where id = ${parsed.id}::uuid and purpose = 'mfa-challenge'
      `.execute(database);
      return { auditUserId: userId, status: "invalid" };
    }
    await this.#revokeChallenge(database, parsed.id, now);
    return {
      credentialVersion: mfa.password_changed_at,
      entryCredentialVersion: mfa.credential_version,
      status: "verified",
      userId,
    };
  }

  async issueSession(command: {
    readonly credentialVersion?: Date | null;
    readonly ipAddress?: string;
    readonly previousToken?: string;
    readonly transaction: IdentityTransaction;
    readonly userAgent?: string;
    readonly userId: string;
  }): Promise<AuthenticatedSession> {
    const database = databaseFromSession(command.transaction);
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + 12 * 60 * 60_000);
    const session = await this.tokens.create();
    const sessionHash = await this.#sessionHash(session.raw);
    const credential = await sql<{
      readonly password_changed_at: Date | null;
    }>`
      select password_changed_at from crm.users
      where id = ${command.userId}::uuid and status = 'active'
        and email_verified_at is not null
        and exists (
          select 1 from crm.email_verification_tokens evt
          where evt.user_id = crm.users.id and evt.used_at is not null
        )
      for share
    `.execute(database);
    if (
      !credential.rows[0] ||
      (Object.hasOwn(command, "credentialVersion") &&
        !sameCredentialVersion(
          credential.rows[0].password_changed_at,
          command.credentialVersion ?? null,
        ))
    ) {
      throw new Error("Session credential changed.");
    }
    if (command.previousToken) {
      const previousHash = await this.#sessionHash(command.previousToken);
      await sql`
        update crm.user_sessions set revoked_at = ${now}, last_seen_at = ${now}
        where session_hash = ${previousHash} and purpose = 'authenticated'
          and revoked_at is null
      `.execute(database);
    }
    const inserted = await sql<{ readonly id: string }>`
      insert into crm.user_sessions (
        id, user_id, session_hash, purpose, ip_address, user_agent,
        created_at, last_seen_at, expires_at, revoked_at
      )
      select ${this.ids.create()}::uuid, u.id, ${sessionHash}, 'authenticated',
        ${command.ipAddress ?? null}::inet, ${command.userAgent ?? null},
        ${now}, ${now}, ${expiresAt}, null
      from crm.users u
      where u.id = ${command.userId}::uuid and u.status = 'active'
        and u.email_verified_at is not null
        and exists (
          select 1 from crm.email_verification_tokens evt
          where evt.user_id = u.id and evt.used_at is not null
        )
      returning id::text
    `.execute(database);
    if (!inserted.rows[0]) throw new Error("Session principal is inactive.");
    await sql`
      update crm.users set last_login_at = ${now}, updated_at = ${now}
      where id = ${command.userId}::uuid
    `.execute(database);
    return { expiresAt, token: session.raw };
  }

  async assertSessionPostcondition(command: {
    readonly expiresAt: Date;
    readonly token: string;
    readonly transaction: IdentityTransaction;
    readonly userId: string;
  }): Promise<void> {
    const hash = await this.#sessionHash(command.token);
    const result = await sql<{ readonly valid: boolean }>`
      select count(*) = 1 valid from crm.user_sessions
      where user_id = ${command.userId}::uuid and session_hash = ${hash}
        and purpose = 'authenticated'
        and expires_at = ${command.expiresAt} and revoked_at is null
    `.execute(databaseFromSession(command.transaction));
    if (result.rows[0]?.valid !== true) {
      throw new Error("Authenticated session postcondition failed.");
    }
  }

  /**
   * One statement for the session, and a second only when its presence is a
   * minute old. Neither needs the other's snapshot, so there is no
   * transaction around them: the caller's connection, or the pool, runs each
   * on its own (BEQ-04).
   */
  async resolveSession(
    token: string,
    connection?: IdentityTransaction,
  ): Promise<SessionPrincipal | undefined> {
    const hash = await this.#sessionHash(token);
    const now = this.clock.now();
    const database = connection
      ? databaseFromSession(connection)
      : this.database;
    const presenceStaleBefore = new Date(now.getTime() - 60_000);
    const result = await sql<{
      readonly presenceStale: boolean;
      readonly userId: string;
    }>`
      select u.id::text as "userId",
        s.last_seen_at < ${presenceStaleBefore} as "presenceStale"
      from crm.user_sessions s join crm.users u on u.id = s.user_id
      where s.session_hash = ${hash} and s.revoked_at is null
        and s.purpose = 'authenticated'
        and s.expires_at > ${now} and u.status = 'active'
        and u.email_verified_at is not null
        and exists (
          select 1 from crm.email_verification_tokens evt
          where evt.user_id = u.id and evt.used_at is not null
        )
    `.execute(database);
    const principal = result.rows[0];
    if (!principal) return undefined;
    // A read only records presence, so it neither locks the session nor
    // writes it more than once a minute; revocation is decided by the
    // predicate above on every request (AUD-K2). The update keeps its own
    // guards, so a revocation that lands in between is never overwritten.
    if (principal.presenceStale) {
      await sql`
        update crm.user_sessions set last_seen_at = ${now}
        where session_hash = ${hash} and purpose = 'authenticated'
          and revoked_at is null and last_seen_at < ${presenceStaleBefore}
      `.execute(database);
    }
    return { userId: principal.userId };
  }

  async revokeSession(command: {
    readonly token: string;
    readonly transaction: IdentityTransaction;
  }): Promise<boolean> {
    const hash = await this.#sessionHash(command.token);
    const now = this.clock.now();
    const revoked = await sql<{ readonly id: string }>`
      update crm.user_sessions set revoked_at = ${now}, last_seen_at = ${now}
      where session_hash = ${hash} and revoked_at is null
        and purpose = 'authenticated' and expires_at > ${now}
      returning id::text
    `.execute(databaseFromSession(command.transaction));
    return revoked.rows.length === 1;
  }

  #sessionHash(token: string): Promise<string> {
    return this.tokens.hash(`authenticated-session:${token}`);
  }

  /**
   * A challenge row's hash commits to its secret, to the credential version
   * the password was proved against, and to the wrong factors it has
   * absorbed. Each wrong factor rewrites it with the next count, so the count
   * is as durable as the row, and a password changed since matches no count.
   */
  #challengeHash(
    secret: string,
    failures: number,
    credentialVersion: string,
  ): Promise<string> {
    return this.tokens.hash(
      `mfa-challenge:${failures}:${credentialVersion}:${secret}`,
    );
  }

  /** The wrong factors a stored hash records, or none if it matches none. */
  async #challengeFailures(
    sessionHash: string,
    secret: string,
    credentialVersion: string,
  ): Promise<number | undefined> {
    for (let failures = 0; failures <= CHALLENGE_ATTEMPTS; failures += 1) {
      const candidate = await this.#challengeHash(
        secret,
        failures,
        credentialVersion,
      );
      if (candidate === sessionHash) return failures;
    }
    return undefined;
  }

  /** Whose challenge row an id names, in whatever state the row is. */
  async #challengeUser(
    database: Kysely<ApplicationDatabase>,
    challengeId: string,
  ): Promise<string | undefined> {
    const result = await sql<{ readonly user_id: string }>`
      select user_id::text from crm.user_sessions
      where id = ${challengeId}::uuid and purpose = 'mfa-challenge'
    `.execute(database);
    return result.rows[0]?.user_id;
  }

  async #revokeChallenge(
    database: Kysely<ApplicationDatabase>,
    challengeId: string,
    now: Date,
  ): Promise<void> {
    await sql`
      update crm.user_sessions set revoked_at = ${now}, last_seen_at = ${now}
      where id = ${challengeId}::uuid and purpose = 'mfa-challenge'
        and revoked_at is null
    `.execute(database);
  }
}

function sameCredentialVersion(
  left: Date | null,
  right: Date | null,
): boolean {
  return left === null
    ? right === null
    : right !== null && left.getTime() === right.getTime();
}
