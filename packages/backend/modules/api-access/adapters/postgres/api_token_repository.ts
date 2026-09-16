import { type Kysely, sql } from "kysely";
import type { ApplicationDatabase } from "../../../../platform/postgres/database.ts";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type {
  ApiTokenRecord,
  ApiTokenRepository,
  ApiTokenScope,
  ApiTokenTransaction,
} from "../../application/api_token_management.ts";

interface TokenRow {
  readonly created_at: string;
  readonly expires_at: string | null;
  readonly id: string;
  readonly last_used_at: string | null;
  readonly name: string;
  readonly revoked_at: string | null;
  readonly scopes: ApiTokenScope[];
}

interface AuthenticationRow extends TokenRow {
  readonly hash: string;
  readonly user_id: string;
  readonly workspace_id: string;
}

const columns = sql`
  token.id::text, token.name, token.scopes,
  to_char(token.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at,
  case when token.expires_at is null then null else to_char(token.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end as expires_at,
  case when token.last_used_at is null then null else to_char(token.last_used_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end as last_used_at,
  case when token.revoked_at is null then null else to_char(token.revoked_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end as revoked_at
`;

function record(row: TokenRow): ApiTokenRecord {
  return {
    createdAt: row.created_at,
    ...(row.expires_at ? { expiresAt: row.expires_at } : {}),
    id: row.id,
    ...(row.last_used_at ? { lastUsedAt: row.last_used_at } : {}),
    name: row.name,
    ...(row.revoked_at ? { revokedAt: row.revoked_at } : {}),
    scopes: row.scopes,
  };
}

export class PostgresApiTokenTransaction {
  constructor(private readonly database: Kysely<ApplicationDatabase>) {}

  run<T>(work: (transaction: ApiTokenTransaction) => Promise<T>): Promise<T> {
    return this.database.transaction().execute((transaction) =>
      work({ opaque: transaction })
    );
  }
}

export class PostgresApiTokenRepository implements ApiTokenRepository {
  async create(command: Parameters<ApiTokenRepository["create"]>[0]) {
    const result = await sql<TokenRow>`
      insert into crm.api_tokens as token (
        id, user_id, workspace_id, name, token_hash, scopes, expires_at,
        created_at, updated_at
      )
      values (
        ${command.id}::uuid, ${command.userId}::uuid,
        ${command.workspaceId}::uuid, ${command.name},
        ${command.hash}, ${command.scopes}::text[], ${
      command.expiresAt ?? null
    },
        ${command.occurredAt}, ${command.occurredAt}
      )
      returning ${columns}
    `.execute(databaseFromSession(command.transaction));
    const value = result.rows[0];
    return value
      ? { record: record(value), status: "created" as const }
      : { status: "forbidden" as const };
  }

  async findForAuthentication(
    command: Parameters<ApiTokenRepository["findForAuthentication"]>[0],
  ) {
    const result = await sql<AuthenticationRow>`
      select ${columns}, token.token_hash as hash,
        token.user_id::text as user_id, token.workspace_id::text as workspace_id
      from crm.api_tokens token
      where token.id = ${command.id}::uuid
      for update of token
    `.execute(databaseFromSession(command.transaction));
    const value = result.rows[0];
    return value
      ? {
        hash: value.hash,
        record: record(value),
        status: "found" as const,
        userId: value.user_id,
        workspaceId: value.workspace_id,
      }
      : { status: "not-found" as const };
  }

  async list(command: Parameters<ApiTokenRepository["list"]>[0]) {
    const result = await sql<TokenRow>`
      select ${columns}
      from crm.api_tokens token
      where token.user_id = ${command.userId}::uuid
        and token.workspace_id = ${command.workspaceId}::uuid
      order by token.created_at desc, token.id desc
    `.execute(databaseFromSession(command.transaction));
    return result.rows.map(record);
  }

  async markUsed(command: Parameters<ApiTokenRepository["markUsed"]>[0]) {
    const result = await sql<{ readonly id: string }>`
      update crm.api_tokens set last_used_at = ${command.occurredAt},
        updated_at = ${command.occurredAt}
      where id = ${command.id}::uuid and revoked_at is null
      returning id::text
    `.execute(databaseFromSession(command.transaction));
    return result.rows.length === 1;
  }

  async revoke(command: Parameters<ApiTokenRepository["revoke"]>[0]) {
    const result = await sql<TokenRow>`
      update crm.api_tokens token
      set revoked_at = ${command.occurredAt}, updated_at = ${command.occurredAt}
      where token.id = ${command.id}::uuid
        and token.user_id = ${command.userId}::uuid
        and token.workspace_id = ${command.workspaceId}::uuid
        and token.revoked_at is null
      returning ${columns}
    `.execute(databaseFromSession(command.transaction));
    const value = result.rows[0];
    return value
      ? { record: record(value), status: "revoked" as const }
      : { status: "not-found" as const };
  }
}
