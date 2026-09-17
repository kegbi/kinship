import { type Kysely, sql } from "kysely";
import type { Clock } from "../../../../shared-kernel/clock.ts";
import type { IdGenerator } from "../../../../shared-kernel/ids.ts";
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

interface Challenge {
  readonly credentialVersion: Date | null;
  readonly entryCredentialVersion: string;
  readonly expiresAt: number;
  failures: number;
  readonly userId: string;
}

class AttemptWindow {
  readonly #attempts = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMilliseconds: number,
    private readonly maximumKeys = 10_000,
  ) {}

  retryAfter(key: string, now: number): number | undefined {
    const recent = (this.#attempts.get(key) ?? []).filter((instant) =>
      instant > now - this.windowMilliseconds
    );
    if (recent.length === 0) this.#attempts.delete(key);
    else this.#attempts.set(key, recent);
    if (recent.length < this.limit) return undefined;
    return Math.max(
      1,
      Math.ceil((recent[0]! + this.windowMilliseconds - now) / 1_000),
    );
  }

  fail(key: string, now: number): void {
    if (!this.#attempts.has(key) && this.#attempts.size >= this.maximumKeys) {
      const oldest = this.#attempts.keys().next().value;
      if (oldest) this.#attempts.delete(oldest);
    }
    this.#attempts.set(key, [...(this.#attempts.get(key) ?? []), now]);
  }

  clear(key: string): void {
    this.#attempts.delete(key);
  }
}

export class PostgresIdentityAuthentication
  implements IdentityAuthenticationFacade {
  readonly #challenges = new Map<string, Challenge>();
  readonly #dummyHash: Promise<string>;
  readonly #passwordAttempts = new AttemptWindow(5, 5 * 60_000);

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
    const challengeHash = await this.tokens.hash(challengeToken);
    const challenge = this.#challenges.get(challengeHash);
    return challenge
      ? `user:${challenge.userId}`
      : `challenge:${challengeHash}`;
  }

  async resolveAuthenticationAuditUser(command: {
    readonly scope: "mfa" | "password";
    readonly subject: string;
  }): Promise<string | undefined> {
    const candidateMfaUserId = command.scope === "mfa" &&
        command.subject.startsWith("user:")
      ? command.subject.slice("user:".length)
      : undefined;
    const mfaUserId = candidateMfaUserId &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
          .test(candidateMfaUserId)
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
  }): Promise<PasswordAuthenticationResult> {
    const now = this.clock.now();
    const key = `${
      command.ipAddress ?? "unknown"
    }\n${command.email.toLowerCase()}`;
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
    const retryAfterSeconds = this.#passwordAttempts.retryAfter(
      key,
      now.getTime(),
    );
    if (retryAfterSeconds !== undefined) {
      return {
        ...(usable ? { auditUserId: credential.user_id } : {}),
        retryAfterSeconds,
        status: "rate-limited",
      };
    }
    if (!usable || !valid) {
      this.#passwordAttempts.fail(key, now.getTime());
      return {
        ...(usable ? { auditUserId: credential.user_id } : {}),
        status: "invalid",
      };
    }
    this.#passwordAttempts.clear(key);
    if (!credential.has_mfa) {
      return {
        credentialVersion: credential.password_changed_at,
        entryCredentialVersion: credential.credential_version,
        status: "verified",
        userId: credential.user_id,
      };
    }
    const challenge = await this.tokens.create();
    this.#pruneChallenges(now.getTime());
    this.#challenges.set(challenge.hash, {
      credentialVersion: credential.password_changed_at,
      entryCredentialVersion: credential.credential_version,
      expiresAt: now.getTime() + 5 * 60_000,
      failures: 0,
      userId: credential.user_id,
    });
    return {
      challengeToken: challenge.raw,
      credentialVersion: credential.password_changed_at,
      entryCredentialVersion: credential.credential_version,
      status: "mfa-required",
      userId: credential.user_id,
    };
  }

  async completeMfa(command: {
    readonly challengeToken: string;
    readonly factor: string;
    readonly transaction: IdentityTransaction;
  }): Promise<MfaAuthenticationResult> {
    const challengeHash = await this.tokens.hash(command.challengeToken);
    const challenge = this.#challenges.get(challengeHash);
    const now = this.clock.now();
    if (!challenge || challenge.expiresAt <= now.getTime()) {
      if (challenge) this.#challenges.delete(challengeHash);
      return {
        ...(challenge ? { auditUserId: challenge.userId } : {}),
        status: "expired",
      };
    }
    if (challenge.failures >= 5) {
      return {
        auditUserId: challenge.userId,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((challenge.expiresAt - now.getTime()) / 1_000),
        ),
        status: "rate-limited",
      };
    }
    const database = databaseFromSession(command.transaction);
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
      where u.id = ${challenge.userId}::uuid and u.status = 'active'
        and mfa.confirmed_at is not null
      for update of u, mfa
    `.execute(database);
    const mfa = mfaResult.rows[0];
    if (
      !mfa ||
      mfa.credential_version !== challenge.entryCredentialVersion
    ) {
      this.#challenges.delete(challengeHash);
      return { auditUserId: challenge.userId, status: "expired" };
    }
    let accepted = false;
    if (/^\d{6}$/.test(command.factor)) {
      const secret = await this.secretBox.decrypt(
        mfa.encrypted_secret,
        challenge.userId,
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
            where user_id = ${challenge.userId}::uuid
          `.execute(database);
          accepted = true;
        }
      }
    } else {
      const recoveryHash = await this.tokens.hash(command.factor.trim());
      const recovery = await sql<{ readonly id: string }>`
        select id::text from crm.user_recovery_codes
        where user_id = ${challenge.userId}::uuid
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
      challenge.failures += 1;
      return { auditUserId: challenge.userId, status: "invalid" };
    }
    this.#challenges.delete(challengeHash);
    return {
      credentialVersion: challenge.credentialVersion,
      entryCredentialVersion: challenge.entryCredentialVersion,
      status: "verified",
      userId: challenge.userId,
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

  async resolveSession(token: string): Promise<SessionPrincipal | undefined> {
    const hash = await this.#sessionHash(token);
    const now = this.clock.now();
    return await this.database.transaction().execute(async (transaction) => {
      const result = await sql<{ readonly userId: string }>`
        select u.id::text as "userId"
        from crm.user_sessions s join crm.users u on u.id = s.user_id
        where s.session_hash = ${hash} and s.revoked_at is null
          and s.purpose = 'authenticated'
          and s.expires_at > ${now} and u.status = 'active'
          and u.email_verified_at is not null
          and exists (
            select 1 from crm.email_verification_tokens evt
            where evt.user_id = u.id and evt.used_at is not null
          )
        for update of s
      `.execute(transaction);
      const principal = result.rows[0];
      if (!principal) return undefined;
      await sql`
        update crm.user_sessions set last_seen_at = ${now}
        where session_hash = ${hash} and purpose = 'authenticated'
          and revoked_at is null
      `.execute(transaction);
      return principal;
    });
  }

  async revokeSession(command: {
    readonly token: string;
    readonly transaction: IdentityTransaction;
  }): Promise<void> {
    const hash = await this.#sessionHash(command.token);
    const now = this.clock.now();
    const revoked = await sql<{ readonly id: string }>`
      update crm.user_sessions set revoked_at = ${now}, last_seen_at = ${now}
      where session_hash = ${hash} and revoked_at is null
        and purpose = 'authenticated' and expires_at > ${now}
      returning id::text
    `.execute(databaseFromSession(command.transaction));
    if (revoked.rows.length !== 1) {
      throw new Error("Active session was not revoked.");
    }
  }

  #sessionHash(token: string): Promise<string> {
    return this.tokens.hash(`authenticated-session:${token}`);
  }

  #pruneChallenges(now: number): void {
    for (const [hash, challenge] of this.#challenges) {
      if (challenge.expiresAt <= now) this.#challenges.delete(hash);
    }
    while (this.#challenges.size >= 10_000) {
      const oldest = this.#challenges.keys().next().value;
      if (!oldest) break;
      this.#challenges.delete(oldest);
    }
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
