import { sql } from "kysely";
import { pickDefined } from "../../../../platform/postgres/rows.ts";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import { instantColumn } from "../../../../platform/postgres/timestamps.ts";
import { PostgresTransactionRunner } from "../../../../platform/postgres/transactions.ts";
import {
  type ApiTokenRecord,
  CALENDAR_FEED_SCOPE,
  CALENDAR_FEED_TOKEN_NAME,
  type CalendarFeedRecord,
  type StoredTokenScope,
} from "../../domain/token_rules.ts";
import type { ApiTokenRepository } from "../../ports/api_token_repository.ts";
import type { CalendarFeedRepository } from "../../ports/calendar_feed_repository.ts";
import type { ApiTokenTransaction } from "../../ports/context.ts";

interface TokenRow {
  readonly created_at: string;
  readonly expires_at: string | null;
  readonly id: string;
  readonly last_used_at: string | null;
  readonly name: string;
  readonly revoked_at: string | null;
  readonly scopes: StoredTokenScope[];
}

interface AuthenticationRow extends TokenRow {
  readonly hash: string;
  readonly user_id: string;
  readonly workspace_id: string;
}

const columns = sql`
  token.id::text, token.name, token.scopes,
  ${instantColumn("token.created_at")} as created_at,
  case when token.expires_at is null then null else ${
  instantColumn("token.expires_at")
} end as expires_at,
  case when token.last_used_at is null then null else ${
  instantColumn("token.last_used_at")
} end as last_used_at,
  case when token.revoked_at is null then null else ${
  instantColumn("token.revoked_at")
} end as revoked_at
`;

function record(row: TokenRow): ApiTokenRecord {
  return {
    createdAt: row.created_at,
    ...pickDefined({ expiresAt: row.expires_at }),
    id: row.id,
    ...pickDefined({ lastUsedAt: row.last_used_at }),
    name: row.name,
    ...pickDefined({ revokedAt: row.revoked_at }),
    scopes: row.scopes,
  };
}

export class PostgresApiTokenTransaction
  extends PostgresTransactionRunner<ApiTokenTransaction> {}

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
        and not (${CALENDAR_FEED_SCOPE} = any(token.scopes))
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
        and not (${CALENDAR_FEED_SCOPE} = any(token.scopes))
      returning ${columns}
    `.execute(databaseFromSession(command.transaction));
    const value = result.rows[0];
    return value
      ? { record: record(value), status: "revoked" as const }
      : { status: "not-found" as const };
  }
}

interface FeedRow {
  readonly created_at: string;
  readonly id: string;
  readonly last_used_at: string | null;
}

const feedColumns = sql`
  token.id::text, ${instantColumn("token.created_at")} as created_at,
  case when token.last_used_at is null then null else ${
  instantColumn("token.last_used_at")
} end as last_used_at
`;

function feed(row: FeedRow): CalendarFeedRecord {
  return {
    createdAt: row.created_at,
    id: row.id,
    ...pickDefined({ lastUsedAt: row.last_used_at }),
  };
}

/**
 * A member's calendar feed (GAP-052): an `api_tokens` row whose scopes are
 * exactly `calendar.read`. The personal-token listing and revocation above
 * leave these rows out, so a feed is managed only from its own section.
 */
export class PostgresCalendarFeedRepository implements CalendarFeedRepository {
  async active(command: Parameters<CalendarFeedRepository["active"]>[0]) {
    const result = await sql<FeedRow>`
      select ${feedColumns}
      from crm.api_tokens token
      where token.user_id = ${command.userId}::uuid
        and token.workspace_id = ${command.workspaceId}::uuid
        and ${CALENDAR_FEED_SCOPE} = any(token.scopes)
        and token.revoked_at is null
        and (token.expires_at is null or token.expires_at > now())
      order by token.created_at desc, token.id desc
      limit 1
    `.execute(databaseFromSession(command.transaction));
    const value = result.rows[0];
    return value ? feed(value) : undefined;
  }

  async create(command: Parameters<CalendarFeedRepository["create"]>[0]) {
    const result = await sql<FeedRow>`
      insert into crm.api_tokens as token (
        id, user_id, workspace_id, name, token_hash, scopes, created_at,
        updated_at
      )
      values (
        ${command.id}::uuid, ${command.userId}::uuid,
        ${command.workspaceId}::uuid, ${CALENDAR_FEED_TOKEN_NAME},
        ${command.hash}, array[${CALENDAR_FEED_SCOPE}]::text[],
        ${command.occurredAt}, ${command.occurredAt}
      )
      returning ${feedColumns}
    `.execute(databaseFromSession(command.transaction));
    return feed(result.rows[0]!);
  }

  async revokeActive(
    command: Parameters<CalendarFeedRepository["revokeActive"]>[0],
  ) {
    const result = await sql<FeedRow>`
      update crm.api_tokens token
      set revoked_at = ${command.occurredAt}, updated_at = ${command.occurredAt}
      where token.user_id = ${command.userId}::uuid
        and token.workspace_id = ${command.workspaceId}::uuid
        and ${CALENDAR_FEED_SCOPE} = any(token.scopes)
        and token.revoked_at is null
      returning ${feedColumns}
    `.execute(databaseFromSession(command.transaction));
    return result.rows.map(feed);
  }
}
