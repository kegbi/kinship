import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type {
  IdentityPersonalLifecycleFacade,
  IdentityPersonalLifecycleInspection,
} from "../../ports/personal_lifecycle.ts";
import type { PasswordHasher } from "../../ports/security.ts";

export class PostgresIdentityPersonalLifecycle
  implements IdentityPersonalLifecycleFacade {
  constructor(private readonly hasher: PasswordHasher) {}

  async inspectIdentity(
    command: Parameters<IdentityPersonalLifecycleFacade["inspectIdentity"]>[0],
  ): Promise<IdentityPersonalLifecycleInspection | undefined> {
    const result = await sql<{
      readonly activeSessionCount: number;
      readonly email: string;
    }>`
      select u.email::text,
        (select count(*)::int from crm.user_sessions us
          where us.user_id = u.id and us.purpose = 'authenticated'
            and us.revoked_at is null
            and us.expires_at > ${command.now ?? new Date()})
          as "activeSessionCount"
      from crm.users u
      where u.id = ${command.userId}::uuid and u.status = 'active'
        and u.deleted_at is null
    `.execute(databaseFromSession(command.transaction));
    return result.rows[0];
  }

  async verifyPassword(
    command: Parameters<IdentityPersonalLifecycleFacade["verifyPassword"]>[0],
  ): Promise<boolean> {
    const result = await sql<{ readonly passwordHash: string | null }>`
      select password_hash as "passwordHash"
      from crm.users
      where id = ${command.userId}::uuid and status = 'active'
        and deleted_at is null
      for update
    `.execute(databaseFromSession(command.transaction));
    const passwordHash = result.rows[0]?.passwordHash;
    return passwordHash
      ? await this.hasher.verify(command.password, passwordHash)
      : false;
  }

  async deleteIdentity(
    command: Parameters<IdentityPersonalLifecycleFacade["deleteIdentity"]>[0],
  ): Promise<void> {
    const database = databaseFromSession(command.transaction);
    await sql`
      delete from crm.password_reset_requests
      where user_id = ${command.userId}::uuid
    `.execute(database);
    await sql`
      delete from crm.email_verification_tokens
      where user_id = ${command.userId}::uuid
    `.execute(database);
    await sql`
      delete from crm.user_mfa_totp where user_id = ${command.userId}::uuid
    `.execute(database);
    await sql`
      delete from crm.user_recovery_codes where user_id = ${command.userId}::uuid
    `.execute(database);
    await sql`
      delete from crm.webauthn_credentials where user_id = ${command.userId}::uuid
    `.execute(database);
    await sql`
      update crm.user_sessions set revoked_at = coalesce(revoked_at, ${command.deletedAt})
      where user_id = ${command.userId}::uuid
    `.execute(database);
    const result = await sql<{ readonly id: string }>`
      update crm.users set
        email = 'deleted+' || id::text || '@invalid.kinship.local',
        password_hash = null, first_name = '', last_name = '',
        pending_workspace_name = null,
        status = 'deleted', email_verified_at = null,
        last_login_at = null, password_changed_at = null,
        deleted_at = ${command.deletedAt}, updated_at = ${command.deletedAt}
      where id = ${command.userId}::uuid and status = 'active'
        and deleted_at is null
      returning id::text
    `.execute(database);
    if (!result.rows[0]) throw new Error("Active identity is unavailable.");
  }

  async revokeSessions(
    command: Parameters<IdentityPersonalLifecycleFacade["revokeSessions"]>[0],
  ): Promise<void> {
    await sql`
      update crm.user_sessions set revoked_at = coalesce(revoked_at, ${command.revokedAt})
      where user_id = ${command.userId}::uuid and revoked_at is null
    `.execute(databaseFromSession(command.transaction));
  }
}
