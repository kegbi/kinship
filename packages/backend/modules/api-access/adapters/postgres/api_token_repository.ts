import { type Kysely, sql } from "kysely";
import type { ApplicationDatabase } from "../../../../platform/postgres/database.ts";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type {
  ApiTokenActor,
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
  readonly member_id: string;
  readonly role: ApiTokenActor["role"];
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

const actorPredicate = (actor: ApiTokenActor) =>
  sql`
  account.id = ${actor.userId}::uuid
  and account.status = 'active' and account.deleted_at is null
  and member.id = ${actor.memberId}::uuid
  and member.workspace_id = ${actor.workspaceId}::uuid
  and member.user_id = account.id and member.role = ${actor.role}
  and member.role in ('owner', 'admin')
  and member.status = 'active' and member.left_at is null
  and workspace.id = member.workspace_id
  and workspace.status = 'active' and workspace.deleted_at is null
`;

export class PostgresApiTokenTransaction {
  constructor(private readonly database: Kysely<ApplicationDatabase>) {}

  run<T>(work: (transaction: ApiTokenTransaction) => Promise<T>): Promise<T> {
    return this.database.transaction().execute((transaction) =>
      work({ opaque: transaction })
    );
  }
}

export class PostgresApiTokenRepository implements ApiTokenRepository {
  constructor(private readonly database: Kysely<ApplicationDatabase>) {}

  async create(command: Parameters<ApiTokenRepository["create"]>[0]) {
    const result = await sql<TokenRow>`
      insert into crm.api_tokens as token (
        id, user_id, workspace_id, name, token_hash, scopes, expires_at,
        created_at, updated_at
      )
      select ${command.id}::uuid, account.id, workspace.id, ${command.name},
        ${command.hash}, ${command.scopes}::text[], ${
      command.expiresAt ?? null
    },
        ${command.occurredAt}, ${command.occurredAt}
      from crm.users account
      join crm.workspace_members member on member.user_id = account.id
      join crm.workspaces workspace on workspace.id = member.workspace_id
      where ${actorPredicate(command)}
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
      select ${columns}, token.token_hash as hash, account.id::text as user_id,
        member.id::text as member_id, member.role,
        workspace.id::text as workspace_id
      from crm.api_tokens token
      join crm.users account on account.id = token.user_id
      join crm.workspace_members member
        on member.user_id = account.id and member.workspace_id = token.workspace_id
      join crm.workspaces workspace on workspace.id = member.workspace_id
      where token.id = ${command.id}::uuid
        and account.status = 'active' and account.deleted_at is null
        and member.status = 'active' and member.left_at is null
        and workspace.status = 'active' and workspace.deleted_at is null
      for update of token
    `.execute(databaseFromSession(command.transaction));
    const value = result.rows[0];
    return value
      ? {
        actor: {
          memberId: value.member_id,
          role: value.role,
          userId: value.user_id,
          workspaceId: value.workspace_id,
        },
        hash: value.hash,
        record: record(value),
        status: "found" as const,
      }
      : { status: "not-found" as const };
  }

  async list(actor: ApiTokenActor) {
    const result = await sql<TokenRow>`
      select ${columns}
      from crm.users account
      join crm.workspace_members member on member.user_id = account.id
      join crm.workspaces workspace on workspace.id = member.workspace_id
      join crm.api_tokens token
        on token.user_id = account.id and token.workspace_id = workspace.id
      where ${actorPredicate(actor)}
      order by token.created_at desc, token.id desc
    `.execute(this.database);
    if (result.rows.length > 0) return result.rows.map(record);
    const authorized = await sql<{ readonly allowed: boolean }>`
      select true as allowed
      from crm.users account
      join crm.workspace_members member on member.user_id = account.id
      join crm.workspaces workspace on workspace.id = member.workspace_id
      where ${actorPredicate(actor)}
    `.execute(this.database);
    return authorized.rows[0]?.allowed ? [] : "forbidden";
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
      from crm.users account, crm.workspace_members member, crm.workspaces workspace
      where token.id = ${command.id}::uuid
        and token.user_id = account.id and token.workspace_id = workspace.id
        and ${actorPredicate(command)} and token.revoked_at is null
      returning ${columns}
    `.execute(databaseFromSession(command.transaction));
    const value = result.rows[0];
    if (value) return { record: record(value), status: "revoked" as const };
    const authorized = await sql<{ readonly allowed: boolean }>`
      select true as allowed from crm.users account
      join crm.workspace_members member on member.user_id = account.id
      join crm.workspaces workspace on workspace.id = member.workspace_id
      where ${actorPredicate(command)}
    `.execute(databaseFromSession(command.transaction));
    return authorized.rows[0]?.allowed
      ? { status: "not-found" as const }
      : { status: "forbidden" as const };
  }
}
