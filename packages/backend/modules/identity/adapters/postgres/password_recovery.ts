import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type { PasswordRecoveryRepository } from "../../ports/password_recovery.ts";

export class PostgresPasswordRecoveryRepository
  implements PasswordRecoveryRepository {
  async createRequest(
    command: Parameters<PasswordRecoveryRepository["createRequest"]>[0],
  ): Promise<{ readonly deliveryEmail?: string }> {
    const database = databaseFromSession(command.transaction);
    await sql`
      select pg_advisory_xact_lock(hashtextextended(lower(${command.email}), 0))
    `.execute(database);
    const recent = await sql<{ readonly count: number }>`
      select count(*)::int count from crm.password_reset_requests
      where email = ${command.email}
        and created_at > ${new Date(command.now.getTime() - 15 * 60_000)}
    `.execute(database);
    if ((recent.rows[0]?.count ?? 0) >= 3) return {};
    const user = await sql<
      { readonly email: string; readonly user_id: string }
    >`
      select u.id::text user_id, u.email::text email
      from crm.users u
      where u.email = ${command.email} and u.status = 'active'
        and u.email_verified_at is not null
        and exists (
          select 1 from crm.email_verification_tokens evt
          where evt.user_id = u.id and evt.used_at is not null
        )
    `.execute(database);
    const active = user.rows[0];
    await sql`
      insert into crm.password_reset_requests (
        id, user_id, email, token_hash, requested_ip,
        expires_at, used_at, created_at
      ) values (
        ${command.id}::uuid, ${active?.user_id ?? null}::uuid,
        ${command.email}, ${command.tokenHash},
        ${command.ipAddress ?? null}::inet, ${command.expiresAt}, null,
        ${command.now}
      )
    `.execute(database);
    return active ? { deliveryEmail: active.email } : {};
  }

  async resetPassword(
    command: Parameters<PasswordRecoveryRepository["resetPassword"]>[0],
  ): ReturnType<PasswordRecoveryRepository["resetPassword"]> {
    const database = databaseFromSession(command.transaction);
    const candidate = await sql<{
      readonly expires_at: Date;
      readonly id: string;
      readonly used_at: Date | null;
      readonly user_id: string | null;
    }>`
      select id::text, user_id::text, expires_at, used_at
      from crm.password_reset_requests where token_hash = ${command.tokenHash}
    `.execute(database);
    const request = candidate.rows[0];
    if (!request?.user_id || request.used_at !== null) return "invalid";
    const user = await sql<{ readonly email: string; readonly valid: boolean }>`
      select u.email::text email, (
        u.status = 'active' and u.email_verified_at is not null
        and exists (
          select 1 from crm.email_verification_tokens evt
          where evt.user_id = u.id and evt.used_at is not null
        )
      ) valid
      from crm.users u where u.id = ${request.user_id}::uuid for update
    `.execute(database);
    const lockedRequest = await sql<{
      readonly expires_at: Date;
      readonly used_at: Date | null;
    }>`
      select expires_at, used_at from crm.password_reset_requests
      where id = ${request.id}::uuid and user_id = ${request.user_id}::uuid
      for update
    `.execute(database);
    const locked = lockedRequest.rows[0];
    const identity = user.rows[0];
    if (!locked || locked.used_at !== null || identity?.valid !== true) {
      return "invalid";
    }
    if (new Date(locked.expires_at).getTime() <= command.now.getTime()) {
      return "expired";
    }
    await sql`
      update crm.users set password_hash = ${command.newPasswordHash},
        password_changed_at = ${command.now}, updated_at = ${command.now}
      where id = ${request.user_id}::uuid
    `.execute(database);
    await sql`
      update crm.password_reset_requests set used_at = ${command.now}
      where user_id = ${request.user_id}::uuid and used_at is null
    `.execute(database);
    await sql`
      update crm.user_sessions set revoked_at = ${command.now},
        last_seen_at = ${command.now}
      where user_id = ${request.user_id}::uuid and revoked_at is null
    `.execute(database);
    const postcondition = await sql<{ readonly valid: boolean }>`
      select
        (select password_hash = ${command.newPasswordHash}
          from crm.users where id = ${request.user_id}::uuid) and
        not exists (select 1 from crm.password_reset_requests
          where user_id = ${request.user_id}::uuid and used_at is null) and
        not exists (select 1 from crm.user_sessions
          where user_id = ${request.user_id}::uuid and revoked_at is null)
        valid
    `.execute(database);
    if (postcondition.rows[0]?.valid !== true) {
      throw new Error("Password reset postcondition failed.");
    }
    return { email: identity.email, status: "reset" };
  }
}
