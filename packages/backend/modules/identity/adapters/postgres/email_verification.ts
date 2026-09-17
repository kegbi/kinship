import { type Kysely, sql } from "kysely";
import type { Clock } from "../../../../shared-kernel/clock.ts";
import type { IdGenerator } from "../../../../shared-kernel/ids.ts";
import type { ApplicationDatabase } from "../../../../platform/postgres/database.ts";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type { IdentityTransaction } from "../../ports/context.ts";
import type { ExactCredentialVersion } from "../../ports/authentication.ts";
import type {
  ApplicationEntryContext,
  ApplicationEntryWorkspaces,
  EmailVerificationFacade,
  VerificationResult,
  VerifiedIdentityEntry,
  VerifiedIdentityEntryAuthority,
  VerifiedIdentityEntryFacade,
} from "../../ports/email_verification.ts";
import { SecureTokenService } from "../crypto/secure_tokens.ts";

interface VerificationRow {
  readonly expires_at: Date;
  readonly used_at: Date | null;
  readonly user_id: string;
}

interface VerificationCandidate {
  readonly user_id: string;
}

export class PostgresEmailVerification
  implements EmailVerificationFacade, VerifiedIdentityEntryFacade {
  constructor(
    private readonly database: Kysely<ApplicationDatabase>,
    private readonly tokens: SecureTokenService,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly workspaces: ApplicationEntryWorkspaces,
  ) {}

  async verify(rawToken: string): Promise<VerificationResult> {
    const tokenHash = await this.tokens.hash(rawToken);
    return await this.database.transaction().execute(async (transaction) => {
      const candidateResult = await sql<VerificationCandidate>`
        select user_id::text
        from crm.email_verification_tokens
        where token_hash = ${tokenHash}
      `.execute(transaction);
      const candidate = candidateResult.rows[0];
      if (!candidate) return { status: "invalid" };
      const userResult = await sql<{
        email_verified_at: Date | null;
        status: string;
      }>`
        select status, email_verified_at
        from crm.users
        where id = ${candidate.user_id}::uuid
        for update
      `.execute(transaction);
      const user = userResult.rows[0];
      if (
        !user || user.status !== "active" || user.email_verified_at !== null
      ) {
        return { status: "replayed" };
      }
      const tokenResult = await sql<VerificationRow>`
        select user_id::text, expires_at, used_at
        from crm.email_verification_tokens
        where token_hash = ${tokenHash}
          and user_id = ${candidate.user_id}::uuid
        for update
      `.execute(transaction);
      const token = tokenResult.rows[0];
      if (!token) return { status: "invalid" };
      if (token.used_at !== null) return { status: "replayed" };
      const now = this.clock.now();
      if (new Date(token.expires_at).getTime() <= now.getTime()) {
        return { status: "expired" };
      }
      const handoff = await this.tokens.create();
      await sql`
        update crm.users
        set email_verified_at = ${now}, updated_at = ${now}
        where id = ${token.user_id}::uuid and status = 'active'
          and email_verified_at is null
      `.execute(transaction);
      await sql`
        update crm.email_verification_tokens
        set used_at = ${now}
        where user_id = ${token.user_id}::uuid and used_at is null
      `.execute(transaction);
      await sql`
        insert into crm.user_sessions (
          id, user_id, session_hash, purpose, created_at, last_seen_at, expires_at, revoked_at
        ) values (
          ${this.ids.create()}::uuid, ${token.user_id}::uuid, ${handoff.hash}, 'verified-entry',
          ${now}, ${now}, ${new Date(now.getTime() + 10 * 60 * 1_000)}, null
        )
      `.execute(transaction);
      return { status: "verified", entryToken: handoff.raw };
    });
  }

  async consumeApplicationEntry(
    rawToken: string,
  ): Promise<ApplicationEntryContext | undefined> {
    const sessionHash = await this.tokens.hash(rawToken);
    const now = this.clock.now();
    return await this.database.transaction().execute(async (transaction) => {
      const result = await sql<{
        readonly firstName: string;
        readonly userId: string;
      }>`
        select
          u.id::text as "userId",
          u.first_name as "firstName"
        from crm.user_sessions s
        join crm.users u on u.id = s.user_id
        where s.session_hash = ${sessionHash}
          and s.purpose = 'verified-entry' and s.revoked_at is null
          and s.expires_at > ${now}
          and u.email_verified_at is not null
          and u.status = 'active'
        for update of s
      `.execute(transaction);
      const identity = result.rows[0];
      if (!identity) return undefined;
      // `workspaces` answers which workspace the user enters; a user without
      // one keeps the handoff unspent, exactly as the joined query did.
      const workspace = await this.workspaces.resolveActiveContext({
        transaction: { opaque: transaction },
        userId: identity.userId,
      });
      if (!workspace) return undefined;
      await sql`
        update crm.user_sessions set revoked_at = ${now}, last_seen_at = ${now}
        where session_hash = ${sessionHash} and purpose = 'verified-entry'
          and revoked_at is null
      `.execute(transaction);
      return { ...identity, ...workspace };
    });
  }

  async issueVerifiedIdentityEntry(command: {
    readonly credentialVersion: ExactCredentialVersion;
    readonly expectedEmail: string;
    readonly ipAddress?: string;
    readonly transaction: IdentityTransaction;
    readonly userAgent?: string;
    readonly userId: string;
  }): Promise<VerifiedIdentityEntryAuthority> {
    const database = databaseFromSession(command.transaction);
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + 10 * 60_000);
    const entry = await this.tokens.create();
    const credential = await sql<{
      readonly credential_version: string;
    }>`
      select coalesce(extract(epoch from password_changed_at)::text, 'none')
        credential_version
      from crm.users
      where id = ${command.userId}::uuid and status = 'active'
        and email = ${command.expectedEmail}
        and email_verified_at is not null
        and exists (
          select 1 from crm.email_verification_tokens evt
          where evt.user_id = crm.users.id and evt.used_at is not null
        )
      for share
    `.execute(database);
    if (
      !credential.rows[0] ||
      credential.rows[0].credential_version !== command.credentialVersion
    ) {
      throw new Error("Verified identity credential changed.");
    }
    const inserted = await sql<{ readonly id: string }>`
      insert into crm.user_sessions (
        id, user_id, session_hash, purpose, ip_address, user_agent,
        created_at, last_seen_at, expires_at, revoked_at
      )
      select ${this.ids.create()}::uuid, u.id, ${entry.hash}, 'verified-entry',
        ${command.ipAddress ?? null}::inet, ${command.userAgent ?? null},
        ${now}, ${now}, ${expiresAt}, null
      from crm.users u
      where u.id = ${command.userId}::uuid and u.status = 'active'
        and u.email = ${command.expectedEmail}
        and u.email_verified_at is not null
        and exists (
          select 1 from crm.email_verification_tokens evt
          where evt.user_id = u.id and evt.used_at is not null
        )
      returning id::text
    `.execute(database);
    const entryId = inserted.rows[0]?.id;
    if (!entryId) throw new Error("Verified identity entry is unavailable.");
    const postcondition = await sql<{ readonly valid: boolean }>`
      select count(*) = 1 valid from crm.user_sessions
      where id = ${entryId}::uuid and user_id = ${command.userId}::uuid
        and session_hash = ${entry.hash} and expires_at = ${expiresAt}
        and purpose = 'verified-entry' and revoked_at is null
    `.execute(database);
    if (postcondition.rows[0]?.valid !== true) {
      throw new Error("Verified identity entry postcondition failed.");
    }
    return { expiresAt, token: entry.raw };
  }

  async consumeVerifiedIdentityEntry(command: {
    readonly expectedEmail: string;
    readonly rawToken: string;
    readonly transaction: IdentityTransaction;
  }): Promise<VerifiedIdentityEntry | undefined> {
    const sessionHash = await this.tokens.hash(command.rawToken);
    const now = this.clock.now();
    const database = databaseFromSession(command.transaction);
    const result = await sql<
      { readonly firstName: string; readonly userId: string }
    >`
      select u.id::text as "userId", u.first_name as "firstName"
      from crm.user_sessions s
      join crm.users u on u.id = s.user_id
      where s.session_hash = ${sessionHash}
        and s.purpose = 'verified-entry'
        and s.revoked_at is null and s.expires_at > ${now}
        and u.email = ${command.expectedEmail}
        and u.email_verified_at is not null and u.status = 'active'
        and exists (
          select 1 from crm.email_verification_tokens evt
          where evt.user_id = u.id and evt.used_at is not null
        )
      for update of s, u
    `.execute(database);
    const identity = result.rows[0];
    if (!identity) return undefined;
    await sql`
      update crm.user_sessions set revoked_at = ${now}, last_seen_at = ${now}
      where session_hash = ${sessionHash} and purpose = 'verified-entry'
        and revoked_at is null
    `.execute(database);
    return identity;
  }
}
