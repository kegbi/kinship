import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type {
  GiftRepository,
  StoredDebt,
  StoredGift,
} from "../../application/gift_management.ts";

interface GiftRow {
  readonly amount: string | null;
  readonly comment: string | null;
  readonly created_at: string;
  readonly currency_code: string | null;
  readonly event_at: string | null;
  readonly id: string;
  readonly name: string;
  readonly person_id: string;
  readonly recipient_person_id: string | null;
  readonly status: StoredGift["status"];
  readonly updated_at: string;
  readonly url: string | null;
}

interface DebtRow {
  readonly amount: string;
  readonly created_at: string;
  readonly currency_code: string | null;
  readonly direction: StoredDebt["direction"];
  readonly id: string;
  readonly person_id: string;
  readonly reason: string | null;
  readonly settled_at: string | null;
  readonly status: StoredDebt["status"];
  readonly updated_at: string;
}

const giftColumns = sql`
  gift.id::text, gift.person_id::text, gift.recipient_person_id::text,
  gift.name, gift.url, gift.comment, gift.status,
  gift.event_at::text, gift.amount::text, gift.currency_code,
  to_char(gift.created_at at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at,
  to_char(gift.updated_at at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at
`;
const debtColumns = sql`
  debt.id::text, debt.person_id::text, debt.direction, debt.status,
  debt.amount::text, debt.currency_code, debt.reason, debt.settled_at::text,
  to_char(debt.created_at at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at,
  to_char(debt.updated_at at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at
`;

function gift(row: GiftRow): StoredGift {
  return {
    ...(row.amount ? { amount: row.amount } : {}),
    ...(row.comment ? { comment: row.comment } : {}),
    createdAt: row.created_at,
    ...(row.currency_code ? { currencyCode: row.currency_code } : {}),
    ...(row.event_at ? { eventAt: row.event_at } : {}),
    id: row.id,
    name: row.name,
    personId: row.person_id,
    ...(row.recipient_person_id
      ? { recipientPersonId: row.recipient_person_id }
      : {}),
    status: row.status,
    updatedAt: row.updated_at,
    ...(row.url ? { url: row.url } : {}),
  };
}

function debt(row: DebtRow): StoredDebt {
  return {
    amount: row.amount,
    createdAt: row.created_at,
    ...(row.currency_code ? { currencyCode: row.currency_code } : {}),
    direction: row.direction,
    id: row.id,
    personId: row.person_id,
    ...(row.reason ? { reason: row.reason } : {}),
    ...(row.settled_at ? { settledAt: row.settled_at } : {}),
    status: row.status,
    updatedAt: row.updated_at,
  };
}

/**
 * The subject of every gift or debt: a person this workspace still owns. The
 * actor's own standing is `ActorRevalidation`'s question, asked by
 * `createGiftManagement` before any of these run.
 */
async function personStatus(command: {
  readonly personId: string;
  readonly transaction: Parameters<GiftRepository["list"]>[0]["transaction"];
  readonly workspaceId: string;
  readonly lock?: boolean;
}): Promise<"active" | "archived" | "not-found"> {
  const result = await sql<{ readonly archived: boolean }>`
    select person.archived_at is not null as archived
    from crm.people person
    where person.id = ${command.personId}::uuid
      and person.workspace_id = ${command.workspaceId}::uuid
      and person.deleted_at is null
    ${command.lock ? sql`for update of person` : sql``}
  `.execute(databaseFromSession(command.transaction));
  return result.rows[0]
    ? (result.rows[0].archived ? "archived" : "active")
    : "not-found";
}

export class PostgresGiftRepository implements GiftRepository {
  async createGift(
    command: Parameters<GiftRepository["createGift"]>[0],
  ): Promise<Awaited<ReturnType<GiftRepository["createGift"]>>> {
    const status = await personStatus({ ...command, lock: true });
    if (status !== "active") {
      return {
        status: status === "archived" ? "archived-write-rejected" : "not-found",
      };
    }
    const result = await sql<GiftRow>`
      with inserted as (
        insert into crm.gifts (
          id, workspace_id, person_id, recipient_person_id, name, url,
          comment, status, event_at, amount, currency_code, created_at, updated_at
        )
        select ${command.id}::uuid, ${command.workspaceId}::uuid,
          ${command.personId}::uuid,
          ${command.recipientPersonId ?? null}::uuid, ${command.name},
          ${command.url ?? null}, ${command.comment ?? null}, ${command.status},
          ${command.eventAt ?? null}::timestamptz,
          ${command.amount ?? null}::numeric, ${command.currencyCode ?? null},
          ${command.occurredAt}, ${command.occurredAt}
        where ${command.recipientPersonId ?? null}::uuid is null or exists (
          select 1 from crm.people recipient
          where recipient.id = ${command.recipientPersonId ?? null}::uuid
            and recipient.workspace_id = ${command.workspaceId}::uuid
            and recipient.deleted_at is null
        )
        returning *
      )
      select ${giftColumns} from inserted gift
    `.execute(databaseFromSession(command.transaction));
    return result.rows[0]
      ? { gift: gift(result.rows[0]), status: "created" }
      : { status: "not-found" };
  }

  async createDebt(
    command: Parameters<GiftRepository["createDebt"]>[0],
  ): Promise<Awaited<ReturnType<GiftRepository["createDebt"]>>> {
    const status = await personStatus({ ...command, lock: true });
    if (status !== "active") {
      return {
        status: status === "archived" ? "archived-write-rejected" : "not-found",
      };
    }
    const result = await sql<DebtRow>`
      with inserted as (
        insert into crm.debts (
          id, workspace_id, person_id, direction, status, amount,
          currency_code, reason, settled_at, created_at, updated_at
        ) values (
          ${command.id}::uuid, ${command.workspaceId}::uuid,
          ${command.personId}::uuid, ${command.direction}, ${command.status},
          ${command.amount}::numeric, ${command.currencyCode ?? null},
          ${command.reason ?? null}, ${command.settledAt ?? null},
          ${command.occurredAt}, ${command.occurredAt}
        ) returning *
      ) select ${debtColumns} from inserted debt
    `.execute(databaseFromSession(command.transaction));
    return result.rows[0]
      ? { debt: debt(result.rows[0]), status: "created" }
      : { status: "not-found" };
  }

  async findGift(
    command: Parameters<GiftRepository["findGift"]>[0],
  ): Promise<Awaited<ReturnType<GiftRepository["findGift"]>>> {
    const status = await personStatus({ ...command, lock: true });
    if (status !== "active") {
      return {
        status: status === "archived" ? "archived-write-rejected" : "not-found",
      };
    }
    const result = await sql<GiftRow>`
      select ${giftColumns}
      from crm.gifts gift
      where gift.workspace_id = ${command.workspaceId}::uuid
        and gift.person_id = ${command.personId}::uuid
        and gift.id = ${command.id}::uuid
      for update of gift
    `.execute(databaseFromSession(command.transaction));
    return result.rows[0]
      ? { gift: gift(result.rows[0]), status: "found" }
      : { status: "not-found" };
  }

  async findDebt(
    command: Parameters<GiftRepository["findDebt"]>[0],
  ): Promise<Awaited<ReturnType<GiftRepository["findDebt"]>>> {
    const status = await personStatus({ ...command, lock: true });
    if (status !== "active") {
      return {
        status: status === "archived" ? "archived-write-rejected" : "not-found",
      };
    }
    const result = await sql<DebtRow>`
      select ${debtColumns}
      from crm.debts debt
      where debt.workspace_id = ${command.workspaceId}::uuid
        and debt.person_id = ${command.personId}::uuid
        and debt.id = ${command.id}::uuid
      for update of debt
    `.execute(databaseFromSession(command.transaction));
    return result.rows[0]
      ? { debt: debt(result.rows[0]), status: "found" }
      : { status: "not-found" };
  }

  async list(
    command: Parameters<GiftRepository["list"]>[0],
  ): Promise<Awaited<ReturnType<GiftRepository["list"]>>> {
    if (await personStatus(command) === "not-found") {
      return { status: "not-found" };
    }
    const database = databaseFromSession(command.transaction);
    const gifts = await sql<GiftRow>`
      select ${giftColumns}
      from crm.gifts gift
      where gift.workspace_id = ${command.workspaceId}::uuid
        and gift.person_id = ${command.personId}::uuid
      order by gift.updated_at desc, gift.id
    `.execute(database);
    const debts = await sql<DebtRow>`
      select ${debtColumns}
      from crm.debts debt
      where debt.workspace_id = ${command.workspaceId}::uuid
        and debt.person_id = ${command.personId}::uuid
      order by debt.updated_at desc, debt.id
    `.execute(database);
    return {
      debts: debts.rows.map(debt),
      gifts: gifts.rows.map(gift),
      status: "ready",
    };
  }

  async saveGift(
    command: Parameters<GiftRepository["saveGift"]>[0],
  ): Promise<Awaited<ReturnType<GiftRepository["saveGift"]>>> {
    const status = await personStatus({ ...command, lock: true });
    if (status !== "active") {
      return {
        status: status === "archived" ? "archived-write-rejected" : "not-found",
      };
    }
    const result = await sql<GiftRow>`
      with updated as (
        update crm.gifts set status = ${command.status},
          updated_at = ${command.occurredAt}
        where id = ${command.id}::uuid
          and workspace_id = ${command.workspaceId}::uuid
          and person_id = ${command.personId}::uuid
        returning *
      ) select ${giftColumns}
        from updated gift
    `.execute(databaseFromSession(command.transaction));
    return result.rows[0]
      ? { gift: gift(result.rows[0]), status: "saved" }
      : { status: "not-found" };
  }

  async saveDebt(
    command: Parameters<GiftRepository["saveDebt"]>[0],
  ): Promise<Awaited<ReturnType<GiftRepository["saveDebt"]>>> {
    const status = await personStatus({ ...command, lock: true });
    if (status !== "active") {
      return {
        status: status === "archived" ? "archived-write-rejected" : "not-found",
      };
    }
    const result = await sql<DebtRow>`
      with updated as (
        update crm.debts set status = ${command.status},
          settled_at = ${command.settledAt ?? null},
          updated_at = ${command.occurredAt}
        where id = ${command.id}::uuid
          and workspace_id = ${command.workspaceId}::uuid
          and person_id = ${command.personId}::uuid
        returning *
      ) select ${debtColumns} from updated debt
    `.execute(databaseFromSession(command.transaction));
    return result.rows[0]
      ? { debt: debt(result.rows[0]), status: "saved" }
      : { status: "not-found" };
  }
}
