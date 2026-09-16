import { sql } from "kysely";
import { pickDefined } from "../../../../platform/postgres/rows.ts";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type {
  IdentityAccountSettingsFacade,
  IdentityProfile,
  IdentitySessionSummary,
} from "../../application/account_settings.ts";
import { SecureTokenService } from "../crypto/secure_tokens.ts";

export class PostgresIdentityAccountSettings
  implements IdentityAccountSettingsFacade {
  constructor(
    private readonly tokens: SecureTokenService,
  ) {}

  async getProfile(
    command: Parameters<IdentityAccountSettingsFacade["getProfile"]>[0],
  ): Promise<IdentityProfile | undefined> {
    const result = await sql<IdentityProfile>`
      select email::text, first_name as "firstName", last_name as "lastName"
      from crm.users where id = ${command.userId}::uuid and status = 'active'
        and deleted_at is null
    `.execute(databaseFromSession(command.transaction));
    return result.rows[0];
  }

  async updateProfile(
    command: Parameters<IdentityAccountSettingsFacade["updateProfile"]>[0],
  ): Promise<IdentityProfile | undefined> {
    const result = await sql<IdentityProfile>`
      update crm.users set first_name = ${command.firstName},
        last_name = ${command.lastName}, updated_at = now()
      where id = ${command.userId}::uuid and status = 'active'
        and deleted_at is null
      returning email::text, first_name as "firstName", last_name as "lastName"
    `.execute(databaseFromSession(command.transaction));
    return result.rows[0];
  }

  async listSessions(
    command: Parameters<IdentityAccountSettingsFacade["listSessions"]>[0],
  ): Promise<readonly IdentitySessionSummary[]> {
    const currentHash = await this.#sessionHash(command.currentToken);
    const result = await sql<{
      readonly createdAt: Date;
      readonly current: boolean;
      readonly expiresAt: Date;
      readonly id: string;
      readonly ipAddress: string | null;
      readonly lastSeenAt: Date;
      readonly userAgent: string | null;
    }>`
      select id::text, created_at as "createdAt", last_seen_at as "lastSeenAt",
        expires_at as "expiresAt", ip_address::text as "ipAddress",
        user_agent as "userAgent", session_hash = ${currentHash} as current
      from crm.user_sessions
      where user_id = ${command.userId}::uuid and revoked_at is null
        and purpose = 'authenticated' and expires_at > ${command.now}
      order by current desc, last_seen_at desc, id
    `.execute(databaseFromSession(command.transaction));
    return result.rows.map((row) => ({
      createdAt: new Date(row.createdAt),
      current: row.current,
      expiresAt: new Date(row.expiresAt),
      id: row.id,
      ...pickDefined({ ipAddress: row.ipAddress }),
      lastSeenAt: new Date(row.lastSeenAt),
      ...pickDefined({ userAgent: row.userAgent }),
    }));
  }

  async revokeOwnedSession(
    command: Parameters<
      IdentityAccountSettingsFacade["revokeOwnedSession"]
    >[0],
  ): ReturnType<IdentityAccountSettingsFacade["revokeOwnedSession"]> {
    const database = databaseFromSession(command.transaction);
    const target = await sql<{
      readonly active: boolean;
      readonly sessionHash: string;
      readonly userId: string | null;
    }>`
      select user_id::text as "userId", session_hash as "sessionHash",
        revoked_at is null and expires_at > ${command.now}
          and purpose = 'authenticated' as active
      from crm.user_sessions where id = ${command.sessionId}::uuid
      for update
    `.execute(database);
    const session = target.rows[0];
    if (!session || !session.active) return { status: "stale" };
    if (session.userId !== command.userId) return { status: "forbidden" };
    const currentHash = await this.#sessionHash(command.currentToken);
    const revoked = await sql<{ readonly id: string }>`
      update crm.user_sessions set revoked_at = ${command.now},
        last_seen_at = ${command.now}
      where id = ${command.sessionId}::uuid and user_id = ${command.userId}::uuid
        and revoked_at is null and expires_at > ${command.now}
        and purpose = 'authenticated'
      returning id::text
    `.execute(database);
    if (!revoked.rows[0]) return { status: "stale" };
    return { current: session.sessionHash === currentHash, status: "revoked" };
  }

  #sessionHash(token: string): Promise<string> {
    return this.tokens.hash(`authenticated-session:${token}`);
  }
}
