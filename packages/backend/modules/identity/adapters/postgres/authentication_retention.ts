import { type Kysely, type RawBuilder, sql } from "kysely";
import type { ApplicationDatabase } from "../../../../platform/postgres/database.ts";
import type {
  AuthenticationRetentionRepository,
  RetentionBatch,
} from "../../ports/retention.ts";
import { REGISTRANT_VERIFIER_PATTERN } from "./registrant_verifier.ts";

/**
 * The retention deletes, each one bounded statement on its own connection, so
 * nothing a sign-in or a verification waits on is held across a batch.
 */
export class PostgresAuthenticationRetention
  implements AuthenticationRetentionRepository {
  constructor(private readonly database: Kysely<ApplicationDatabase>) {}

  async deleteEndedSessions(batch: RetentionBatch): Promise<number> {
    return await this.#count(sql<{ id: string }>`
      delete from crm.user_sessions
      where id in (
        select id from crm.user_sessions
        where expires_at < ${batch.before} or revoked_at < ${batch.before}
        limit ${batch.limit}
      )
      returning id
    `);
  }

  async deleteResetRequests(batch: RetentionBatch): Promise<number> {
    return await this.#count(sql<{ id: string }>`
      delete from crm.password_reset_requests
      where id in (
        select id from crm.password_reset_requests
        where created_at < ${batch.before}
        limit ${batch.limit}
      )
      returning id
    `);
  }

  async deleteSpentVerificationTokens(batch: RetentionBatch): Promise<number> {
    // The kept token is the one every credential check asks for: each verified
    // user's latest spent verification token. A user without one keeps every
    // row, since only a user named in `kept` loses any. The table has no
    // `user_id` index, so the kept tokens are found in one pass and joined,
    // rather than looked up once per candidate row.
    return await this.#count(sql<{ id: string }>`
      with kept as (
        select distinct on (kept.user_id) kept.user_id, kept.id
        from crm.email_verification_tokens kept
        where kept.used_at is not null
          and kept.token_hash not like ${REGISTRANT_VERIFIER_PATTERN}
        order by kept.user_id, kept.used_at desc, kept.created_at desc,
          kept.id desc
      )
      delete from crm.email_verification_tokens
      where id in (
        select evt.id from crm.email_verification_tokens evt
        join kept on kept.user_id = evt.user_id
        join crm.users u on u.id = evt.user_id
        where u.email_verified_at is not null
          and evt.created_at < ${batch.before}
          and evt.id <> kept.id
        limit ${batch.limit}
      )
      returning id
    `);
  }

  async #count(statement: RawBuilder<{ id: string }>): Promise<number> {
    return (await statement.execute(this.database)).rows.length;
  }
}
