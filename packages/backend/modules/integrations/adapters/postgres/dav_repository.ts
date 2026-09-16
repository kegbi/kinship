import { type Kysely, sql } from "kysely";
import type { ApplicationDatabase } from "../../../../platform/postgres/database.ts";
import { pickDefined } from "../../../../platform/postgres/rows.ts";
import type {
  DavActor,
  DavActorRevalidation,
  DavAuditEvent,
  DavOutcome,
  DavRepository,
  DavSubscription,
  StoredDavSubscription,
} from "../../application/dav_sync.ts";

interface SubscriptionRow {
  readonly capabilities: unknown;
  readonly encrypted_password?: string | null;
  readonly id: string;
  readonly is_active: boolean;
  readonly last_synced_at: Date | null;
  readonly name: string;
  readonly remote_sync_token: string | null;
  readonly remote_url: string;
  readonly username: string | null;
}
interface DavAudit {
  record(
    command: {
      readonly actor: DavActor;
      readonly event: DavAuditEvent;
      readonly transaction: { readonly opaque: unknown };
    },
  ): Promise<void>;
}
const errors = new Set([
  "dav_authentication_failed",
  "dav_claim_lost",
  "dav_remote_conflict",
  "dav_sync_failed",
]);
function capabilities(value: unknown): { error?: string; outcome: DavOutcome } {
  const record = typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : {};
  const outcomes: readonly DavOutcome[] = [
    "auth-failure",
    "conflict",
    "never",
    "partial",
    "success",
  ];
  return {
    ...(typeof record.lastError === "string" && errors.has(record.lastError)
      ? { error: record.lastError }
      : {}),
    outcome: outcomes.includes(record.lastOutcome as DavOutcome)
      ? record.lastOutcome as DavOutcome
      : "never",
  };
}
function mapped(row: SubscriptionRow): DavSubscription {
  const state = capabilities(row.capabilities);
  return {
    id: row.id,
    isActive: row.is_active,
    ...pickDefined({ lastError: state.error }),
    lastOutcome: state.outcome,
    ...(row.last_synced_at
      ? { lastSyncedAt: row.last_synced_at.toISOString() }
      : {}),
    name: row.name,
    ...pickDefined({ remoteSyncToken: row.remote_sync_token }),
    remoteUrl: row.remote_url,
    ...pickDefined({ username: row.username }),
  };
}
async function lockSubscription(
  database: Kysely<ApplicationDatabase>,
  actor: DavActor,
  subscriptionId: string,
): Promise<SubscriptionRow | undefined> {
  const result = await sql<SubscriptionRow>`select
    id::text,name,remote_url,username,encrypted_password,is_active,capabilities,remote_sync_token,last_synced_at
    from crm.dav_address_book_subscriptions subscription
    where id=${subscriptionId}::uuid and workspace_id=${actor.workspaceId}::uuid
    for update of subscription`.execute(database);
  return result.rows[0];
}
async function lockDavContext(
  actors: DavActorRevalidation,
  database: Kysely<ApplicationDatabase>,
  actor: DavActor,
  subscriptionId: string,
): Promise<SubscriptionRow | undefined> {
  const standing = await actors.revalidate({
    ...actor,
    lock: true,
    transaction: { opaque: database },
  });
  if (standing !== "active") return undefined;
  return await lockSubscription(database, actor, subscriptionId);
}
function claimState(value: unknown): {
  readonly claimedAt?: Date;
  readonly token?: string;
} {
  const record = typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : {};
  const claimedAt = typeof record.syncClaimedAt === "string"
    ? new Date(record.syncClaimedAt)
    : undefined;
  return {
    ...(claimedAt && Number.isFinite(claimedAt.getTime()) ? { claimedAt } : {}),
    ...(typeof record.syncClaimToken === "string"
      ? { token: record.syncClaimToken }
      : {}),
  };
}

/**
 * `createDavSyncManagement` refuses a member role, and the actor's standing is
 * the `workspaces` port's answer throughout, so these queries scope by
 * workspace and subscription ownership alone.
 */
export class PostgresDavRepository implements DavRepository {
  constructor(
    private readonly database: Kysely<ApplicationDatabase>,
    private readonly audit: DavAudit,
    private readonly actors: DavActorRevalidation,
  ) {}
  async authorize(actor: DavActor): Promise<boolean> {
    return await this.actors.revalidate({
      ...actor,
      lock: false,
      transaction: { opaque: this.database },
    }) === "active";
  }
  async claim(
    actor: DavActor,
    subscriptionId: string,
    claimToken: string,
    claimedAt: Date,
  ) {
    return await this.database.transaction().execute(async (transaction) => {
      const locked = await lockDavContext(
        this.actors,
        transaction,
        actor,
        subscriptionId,
      );
      if (!locked?.is_active) return undefined;
      const active = claimState(locked.capabilities);
      if (
        active.claimedAt &&
        active.claimedAt.getTime() >= claimedAt.getTime() - 300_000
      ) return undefined;
      const result = await sql<
        SubscriptionRow
      >`update crm.dav_address_book_subscriptions set
        capabilities=(capabilities-'syncClaimToken'-'syncClaimedAt') ||
          jsonb_build_object('syncClaimToken',${claimToken}::text,'syncClaimedAt',${claimedAt}::timestamptz::text),
        updated_at=now() where id=${subscriptionId}::uuid
        returning id::text,name,remote_url,username,encrypted_password,is_active,capabilities,remote_sync_token,last_synced_at`
        .execute(transaction);
      const row = result.rows[0];
      return row?.encrypted_password
        ? {
          ...mapped(row),
          claimToken,
          encryptedPassword: row.encrypted_password,
        } as StoredDavSubscription
        : undefined;
    });
  }
  async create(command: Parameters<DavRepository["create"]>[0]) {
    return await this.database.transaction().execute(async (transaction) => {
      const standing = await this.actors.revalidate({
        ...command,
        lock: true,
        transaction: { opaque: transaction },
      });
      if (standing !== "active") return undefined;
      const book = await sql<
        { id: string }
      >`insert into crm.dav_address_books(workspace_id,owner_member_id,name,uri)
        values (${command.workspaceId}::uuid,${command.memberId}::uuid,${command.name},${`subscription-${command.id}`})
        returning id::text`.execute(transaction);
      if (!book.rows[0]) return undefined;
      const result = await sql<
        SubscriptionRow
      >`insert into crm.dav_address_book_subscriptions
        (id,workspace_id,owner_member_id,local_address_book_id,name,remote_url,username,encrypted_password,capabilities)
        values (${command.id}::uuid,${command.workspaceId}::uuid,${command.memberId}::uuid,${
        book.rows[0].id
      }::uuid,
          ${command.name},${command.remoteUrl},${
        command.username ?? null
      },${command.encryptedPassword},'{"lastOutcome":"never"}'::jsonb)
        returning id::text,name,remote_url,username,is_active,capabilities,remote_sync_token,last_synced_at`
        .execute(transaction);
      if (!result.rows[0]) return undefined;
      await this.audit.record({
        actor: command,
        event: {
          action: "configure",
          occurredAt: command.occurredAt,
          outcome: "success",
          subscriptionId: command.id,
        },
        transaction: { opaque: transaction },
      });
      return mapped(result.rows[0]);
    });
  }
  async disable(
    actor: DavActor,
    subscriptionId: string,
    occurredAt = new Date(),
  ) {
    return await this.database.transaction().execute(async (transaction) => {
      const locked = await lockDavContext(
        this.actors,
        transaction,
        actor,
        subscriptionId,
      );
      if (!locked) return undefined;
      const result = await sql<
        SubscriptionRow
      >`update crm.dav_address_book_subscriptions subscription set
        is_active=false,updated_at=now(),capabilities=capabilities-'syncClaimToken'-'syncClaimedAt'
        where id=${subscriptionId}::uuid
        returning id::text,name,remote_url,username,is_active,capabilities,remote_sync_token,last_synced_at`
        .execute(transaction);
      if (!result.rows[0]) return undefined;
      await this.audit.record({
        actor,
        event: {
          action: "disable",
          occurredAt,
          outcome: "success",
          subscriptionId,
        },
        transaction: { opaque: transaction },
      });
      return mapped(result.rows[0]);
    });
  }
  async withClaimedObject(
    command: Parameters<DavRepository["withClaimedObject"]>[0],
    href: string,
    work: Parameters<DavRepository["withClaimedObject"]>[2],
  ) {
    return await this.database.transaction().execute(async (transaction) => {
      const subscription = await lockDavContext(
        this.actors,
        transaction,
        command,
        command.subscriptionId,
      );
      if (
        !subscription?.is_active ||
        claimState(subscription.capabilities).token !== command.claimToken
      ) return "claim-lost" as const;
      const result = await sql<
        {
          core_id: string;
          etag: string;
          kind: "person" | "task";
          sync_status: "conflict" | "deleted" | "error" | "synced";
        }
      >`select coalesce(person_id,task_id)::text core_id,etag,object_kind kind,sync_status
        from crm.dav_objects where workspace_id=${command.workspaceId}::uuid
          and subscription_id=${command.subscriptionId}::uuid and href=${href}
        order by created_at desc limit 1 for update`.execute(transaction);
      const row = result.rows[0];
      const record = await work(
        row
          ? {
            coreId: row.core_id,
            etag: row.etag,
            kind: row.kind,
            status: row.sync_status,
          }
          : undefined,
        { opaque: transaction },
      );
      if (!record) return "skipped" as const;
      const updated = await sql<{ id: string }>`update crm.dav_objects set
        ${
        sql.raw(record.kind === "person" ? "person_id" : "task_id")
      }=${record.coreId}::uuid,
        remote_uid=${record.uid},etag=${record.etag},${
        sql.raw(record.kind === "person" ? "vcard" : "icalendar")
      }=${record.payload},
        sync_status=${record.status},last_synced_at=now(),updated_at=now(),deleted_at=case when ${record.status}='deleted' then now() else null end
        where workspace_id=${command.workspaceId}::uuid and subscription_id=${command.subscriptionId}::uuid and href=${record.href}
        returning id::text`.execute(transaction);
      if (!updated.rows[0]) {
        await sql`insert into crm.dav_objects(workspace_id,subscription_id,object_kind,
        ${
          sql.raw(record.kind === "person" ? "person_id" : "task_id")
        },remote_uid,href,etag,
        ${
          sql.raw(record.kind === "person" ? "vcard" : "icalendar")
        },sync_status,last_synced_at,deleted_at)
        values (${command.workspaceId}::uuid,${command.subscriptionId}::uuid,${record.kind},${record.coreId}::uuid,
          ${record.uid},${record.href},${record.etag},${record.payload},${record.status},now(),case when ${record.status}='deleted' then now() else null end)`
          .execute(transaction);
      }
      return "processed" as const;
    });
  }
  async list(actor: DavActor) {
    const result = await sql<
      SubscriptionRow
    >`select id::text,name,remote_url,username,is_active,capabilities,remote_sync_token,last_synced_at
      from crm.dav_address_book_subscriptions where workspace_id=${actor.workspaceId}::uuid
      order by created_at desc,id desc`.execute(this.database);
    return result.rows.map(mapped);
  }
  async recordAudit(actor: DavActor, event: DavAuditEvent): Promise<boolean> {
    return await this.database.transaction().execute(async (transaction) => {
      const standing = await this.actors.revalidate({
        ...actor,
        lock: true,
        transaction: { opaque: transaction },
      });
      if (standing !== "active") return false;
      const owned = await sql<{ allowed: boolean }>`select
        (exists(select 1 from crm.dav_address_book_subscriptions where id=${event.subscriptionId}::uuid
          and workspace_id=${actor.workspaceId}::uuid)
        or (${event.action}::text='configure' and not exists(select 1 from crm.dav_address_book_subscriptions
          where id=${event.subscriptionId}::uuid))) allowed`.execute(
        transaction,
      );
      if (!owned.rows[0]?.allowed) return false;
      await this.audit.record({
        actor,
        event,
        transaction: { opaque: transaction },
      });
      return true;
    });
  }
  async recordOutcome(
    command: Parameters<DavRepository["recordOutcome"]>[0],
    outcome: Parameters<DavRepository["recordOutcome"]>[1],
  ) {
    return await this.database.transaction().execute(async (transaction) => {
      const locked = await lockDavContext(
        this.actors,
        transaction,
        command,
        command.subscriptionId,
      );
      if (
        !locked?.is_active ||
        claimState(locked.capabilities).token !== command.claimToken
      ) return undefined;
      const result = await sql<
        SubscriptionRow
      >`update crm.dav_address_book_subscriptions subscription set
        capabilities=(capabilities-'syncClaimToken'-'syncClaimedAt'-'lastError'-'lastOutcome') ||
          jsonb_strip_nulls(jsonb_build_object('lastOutcome',${outcome.status}::text,
            'lastError',${outcome.error ?? null}::text)),
        remote_sync_token=case when ${
        outcome.clearRemoteSyncToken ?? false
      } then null
          when ${outcome.remoteSyncToken ?? null}::text is not null then ${
        outcome.remoteSyncToken ?? null
      } else remote_sync_token end,
        last_synced_at=case when ${outcome.status}='success' then ${outcome.occurredAt}::timestamptz else last_synced_at end,updated_at=now()
        where id=${command.subscriptionId}::uuid
        returning id::text,name,remote_url,username,is_active,capabilities,remote_sync_token,last_synced_at`
        .execute(transaction);
      if (!result.rows[0]) return undefined;
      await this.audit.record({
        actor: command,
        event: {
          action: "sync",
          ...pickDefined({ code: outcome.error }),
          occurredAt: outcome.occurredAt,
          outcome: outcome.status === "success"
            ? "success"
            : outcome.status === "conflict"
            ? "conflict"
            : "partial",
          subscriptionId: command.subscriptionId,
        },
        transaction: { opaque: transaction },
      });
      return mapped(result.rows[0]);
    });
  }
}
