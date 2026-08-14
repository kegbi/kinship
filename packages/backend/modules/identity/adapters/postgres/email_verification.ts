import { type Kysely, sql } from "kysely";
import type { ApplicationDatabase } from "../../../../platform/postgres/database.ts";
import type {
  ApplicationEntryContext,
  EmailVerificationFacade,
  VerificationResult,
} from "../../application/email_verification.ts";
import { SecureTokenService } from "../crypto/secure_tokens.ts";

interface VerificationRow {
  readonly expires_at: Date;
  readonly used_at: Date | null;
  readonly user_id: string;
}

interface VerificationCandidate {
  readonly user_id: string;
}

export interface VerificationClock {
  now(): Date;
}

export interface VerificationIds {
  create(): string;
}

export class PostgresEmailVerification implements EmailVerificationFacade {
  constructor(
    private readonly database: Kysely<ApplicationDatabase>,
    private readonly tokens: SecureTokenService,
    private readonly clock: VerificationClock,
    private readonly ids: VerificationIds,
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
          id, user_id, session_hash, created_at, last_seen_at, expires_at, revoked_at
        ) values (
          ${this.ids.create()}::uuid, ${token.user_id}::uuid, ${handoff.hash},
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
      const result = await sql<ApplicationEntryContext>`
        select
          u.id::text as "userId",
          u.first_name as "firstName",
          wm.id::text as "memberId",
          w.id::text as "workspaceId",
          w.name as "workspaceName"
        from crm.user_sessions s
        join crm.users u on u.id = s.user_id
        join crm.workspace_members wm on wm.user_id = u.id
        join crm.workspaces w on w.id = wm.workspace_id
        where s.session_hash = ${sessionHash}
          and s.revoked_at is null
          and s.expires_at > ${now}
          and u.email_verified_at is not null
          and u.status = 'active'
          and wm.status = 'active'
          and w.status = 'active'
        for update of s
      `.execute(transaction);
      const context = result.rows[0];
      if (!context) return undefined;
      await sql`
        update crm.user_sessions set revoked_at = ${now}, last_seen_at = ${now}
        where session_hash = ${sessionHash} and revoked_at is null
      `.execute(transaction);
      return context;
    });
  }
}
