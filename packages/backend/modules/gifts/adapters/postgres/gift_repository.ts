import { type ExpressionBuilder, type Selectable, sql } from "kysely";
import type { Database } from "../../../../platform/postgres/database.ts";
import { pickDefined } from "../../../../platform/postgres/rows.ts";
import { schemaDatabaseFromSession } from "../../../../platform/postgres/session.ts";
import { instantOf } from "../../../../platform/postgres/timestamps.ts";
import type { GiftPageAnchor } from "../../domain/cursors.ts";
import type {
  DebtDirection,
  DebtStatus,
  GiftStatus,
  StoredDebt,
  StoredGift,
} from "../../domain/gift_rules.ts";
import type { GiftRepository } from "../../ports/gift_repository.ts";

/*
 * Every query here is built against the generated `Database`, so `deno check`
 * holds each table, column, and written value to the canonical DDL.
 */

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

/**
 * A row as a query sees it under the alias `gift` or `debt`, whether it was
 * read from its table or returned by the statement that wrote it.
 */
type GiftSource = Selectable<Database["crm.gifts"]>;
type DebtSource = Selectable<Database["crm.debts"]>;

/** The projection every gift query returns, one column per `GiftRow` field. */
function giftColumns<DB extends { gift: GiftSource }>(
  eb: ExpressionBuilder<DB, "gift">,
) {
  return [
    eb.cast<string>(eb.ref("gift.id"), "text").as("id"),
    eb.cast<string>(eb.ref("gift.person_id"), "text").as("person_id"),
    eb.cast<string | null>(eb.ref("gift.recipient_person_id"), "text")
      .as("recipient_person_id"),
    eb.ref("gift.name").as("name"),
    eb.ref("gift.url").as("url"),
    eb.ref("gift.comment").as("comment"),
    eb.ref("gift.status").as("status"),
    eb.cast<string | null>(eb.ref("gift.event_at"), "text").as("event_at"),
    eb.cast<string | null>(eb.ref("gift.amount"), "text").as("amount"),
    eb.ref("gift.currency_code").as("currency_code"),
    instantOf(eb.ref("gift.created_at")).as("created_at"),
    instantOf(eb.ref("gift.updated_at")).as("updated_at"),
  ];
}

/** The projection every debt query returns, one column per `DebtRow` field. */
function debtColumns<DB extends { debt: DebtSource }>(
  eb: ExpressionBuilder<DB, "debt">,
) {
  return [
    eb.cast<string>(eb.ref("debt.id"), "text").as("id"),
    eb.cast<string>(eb.ref("debt.person_id"), "text").as("person_id"),
    eb.ref("debt.direction").as("direction"),
    eb.ref("debt.status").as("status"),
    eb.cast<string>(eb.ref("debt.amount"), "text").as("amount"),
    eb.ref("debt.currency_code").as("currency_code"),
    eb.ref("debt.reason").as("reason"),
    eb.cast<string | null>(eb.ref("debt.settled_at"), "text").as("settled_at"),
    instantOf(eb.ref("debt.created_at")).as("created_at"),
    instantOf(eb.ref("debt.updated_at")).as("updated_at"),
  ];
}

/** The text columns the schema constrains to the domain's vocabularies. */
type GiftVocabulary = { readonly status: GiftStatus };
type DebtVocabulary = {
  readonly direction: DebtDirection;
  readonly status: DebtStatus;
};

/** A page anchor's instant, compared as the `timestamptz` it was read from. */
function anchorInstant(anchor: GiftPageAnchor) {
  return sql<Date>`${anchor.updatedAt}::timestamptz`;
}

function gift(row: GiftRow): StoredGift {
  return {
    ...pickDefined({ amount: row.amount, comment: row.comment }),
    createdAt: row.created_at,
    ...pickDefined({ currencyCode: row.currency_code, eventAt: row.event_at }),
    id: row.id,
    name: row.name,
    personId: row.person_id,
    ...pickDefined({ recipientPersonId: row.recipient_person_id }),
    status: row.status,
    updatedAt: row.updated_at,
    ...pickDefined({ url: row.url }),
  };
}

function debt(row: DebtRow): StoredDebt {
  return {
    amount: row.amount,
    createdAt: row.created_at,
    ...pickDefined({ currencyCode: row.currency_code }),
    direction: row.direction,
    id: row.id,
    personId: row.person_id,
    ...pickDefined({ reason: row.reason, settledAt: row.settled_at }),
    status: row.status,
    updatedAt: row.updated_at,
  };
}

/** The anchor of the page after this one, when one more row was read. */
function anchorOf(
  rows: readonly { readonly id: string; readonly updated_at: string }[],
  page: readonly { readonly id: string; readonly updated_at: string }[],
  limit: number,
): GiftPageAnchor | undefined {
  const final = page.at(-1);
  return rows.length > limit && final
    ? { id: final.id, updatedAt: final.updated_at }
    : undefined;
}

type Session = Parameters<GiftRepository["list"]>[0]["transaction"];

/**
 * The subject of every gift or debt: a person this workspace still owns. The
 * actor's own standing is `ActorRevalidation`'s question, asked by
 * `createGiftManagement` before any of these run.
 */
async function personStatus(command: {
  readonly personId: string;
  readonly transaction: Session;
  readonly workspaceId: string;
  readonly lock?: boolean;
}): Promise<"active" | "archived" | "not-found"> {
  const row = await schemaDatabaseFromSession(command.transaction)
    .selectFrom("crm.people as person")
    .select((eb) => eb("person.archived_at", "is not", null).as("archived"))
    .where("person.id", "=", command.personId)
    .where("person.workspace_id", "=", command.workspaceId)
    .where("person.deleted_at", "is", null)
    .$if(command.lock === true, (query) => query.forUpdate("person"))
    .executeTakeFirst();
  return row ? (row.archived ? "archived" : "active") : "not-found";
}

/** Whether the intended recipient is a live person of the same workspace. */
async function recipientExists(command: {
  readonly recipientPersonId: string;
  readonly transaction: Session;
  readonly workspaceId: string;
}): Promise<boolean> {
  const row = await schemaDatabaseFromSession(command.transaction)
    .selectFrom("crm.people as recipient")
    .select((eb) => eb.lit(1).as("found"))
    .where("recipient.id", "=", command.recipientPersonId)
    .where("recipient.workspace_id", "=", command.workspaceId)
    .where("recipient.deleted_at", "is", null)
    .executeTakeFirst();
  return row !== undefined;
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
    if (
      command.recipientPersonId !== undefined &&
      !await recipientExists({
        recipientPersonId: command.recipientPersonId,
        transaction: command.transaction,
        workspaceId: command.workspaceId,
      })
    ) {
      return { status: "not-found" };
    }
    const row = await schemaDatabaseFromSession(command.transaction)
      .with("inserted", (database) =>
        database.insertInto("crm.gifts").values({
          amount: command.amount ?? null,
          comment: command.comment ?? null,
          created_at: command.occurredAt,
          currency_code: command.currencyCode ?? null,
          event_at: command.eventAt ?? null,
          id: command.id,
          name: command.name,
          person_id: command.personId,
          recipient_person_id: command.recipientPersonId ?? null,
          status: command.status,
          updated_at: command.occurredAt,
          url: command.url ?? null,
          workspace_id: command.workspaceId,
        }).returningAll())
      .selectFrom("inserted as gift")
      .select(giftColumns)
      .$narrowType<GiftVocabulary>()
      .executeTakeFirst();
    return row
      ? { gift: gift(row), status: "created" }
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
    const row = await schemaDatabaseFromSession(command.transaction)
      .with("inserted", (database) =>
        database.insertInto("crm.debts").values({
          amount: command.amount,
          created_at: command.occurredAt,
          currency_code: command.currencyCode ?? null,
          direction: command.direction,
          id: command.id,
          person_id: command.personId,
          reason: command.reason ?? null,
          settled_at: command.settledAt ?? null,
          status: command.status,
          updated_at: command.occurredAt,
          workspace_id: command.workspaceId,
        }).returningAll())
      .selectFrom("inserted as debt")
      .select(debtColumns)
      .$narrowType<DebtVocabulary>()
      .executeTakeFirst();
    return row
      ? { debt: debt(row), status: "created" }
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
    const row = await schemaDatabaseFromSession(command.transaction)
      .selectFrom("crm.gifts as gift")
      .select(giftColumns)
      .$narrowType<GiftVocabulary>()
      .where("gift.workspace_id", "=", command.workspaceId)
      .where("gift.person_id", "=", command.personId)
      .where("gift.id", "=", command.id)
      .forUpdate("gift")
      .executeTakeFirst();
    return row ? { gift: gift(row), status: "found" } : { status: "not-found" };
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
    const row = await schemaDatabaseFromSession(command.transaction)
      .selectFrom("crm.debts as debt")
      .select(debtColumns)
      .$narrowType<DebtVocabulary>()
      .where("debt.workspace_id", "=", command.workspaceId)
      .where("debt.person_id", "=", command.personId)
      .where("debt.id", "=", command.id)
      .forUpdate("debt")
      .executeTakeFirst();
    return row ? { debt: debt(row), status: "found" } : { status: "not-found" };
  }

  async list(
    command: Parameters<GiftRepository["list"]>[0],
  ): Promise<Awaited<ReturnType<GiftRepository["list"]>>> {
    if (await personStatus(command) === "not-found") {
      return { status: "not-found" };
    }
    const database = schemaDatabaseFromSession(command.transaction);
    // Where each page resumes is written out rather than as a row comparison
    // because the order mixes directions: newer rows first, and ties broken
    // by an ascending identifier.
    let giftQuery = database.selectFrom("crm.gifts as gift")
      .select(giftColumns)
      .$narrowType<GiftVocabulary>()
      .where("gift.workspace_id", "=", command.workspaceId)
      .where("gift.person_id", "=", command.personId);
    const giftAfter = command.giftAfter;
    if (giftAfter) {
      giftQuery = giftQuery.where((eb) =>
        eb.or([
          eb("gift.updated_at", "<", anchorInstant(giftAfter)),
          eb.and([
            eb("gift.updated_at", "=", anchorInstant(giftAfter)),
            eb("gift.id", ">", giftAfter.id),
          ]),
        ])
      );
    }
    const gifts = await giftQuery
      .orderBy("gift.updated_at", "desc")
      .orderBy("gift.id")
      .limit(command.limit + 1)
      .execute();
    let debtQuery = database.selectFrom("crm.debts as debt")
      .select(debtColumns)
      .$narrowType<DebtVocabulary>()
      .where("debt.workspace_id", "=", command.workspaceId)
      .where("debt.person_id", "=", command.personId);
    const debtAfter = command.debtAfter;
    if (debtAfter) {
      debtQuery = debtQuery.where((eb) =>
        eb.or([
          eb("debt.updated_at", "<", anchorInstant(debtAfter)),
          eb.and([
            eb("debt.updated_at", "=", anchorInstant(debtAfter)),
            eb("debt.id", ">", debtAfter.id),
          ]),
        ])
      );
    }
    const debts = await debtQuery
      .orderBy("debt.updated_at", "desc")
      .orderBy("debt.id")
      .limit(command.limit + 1)
      .execute();
    const giftPage = gifts.slice(0, command.limit);
    const debtPage = debts.slice(0, command.limit);
    return {
      debts: debtPage.map(debt),
      gifts: giftPage.map(gift),
      ...pickDefined({
        nextDebt: anchorOf(debts, debtPage, command.limit),
        nextGift: anchorOf(gifts, giftPage, command.limit),
      }),
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
    const row = await schemaDatabaseFromSession(command.transaction)
      .with("updated", (database) =>
        database.updateTable("crm.gifts")
          .set({ status: command.status, updated_at: command.occurredAt })
          .where("id", "=", command.id)
          .where("workspace_id", "=", command.workspaceId)
          .where("person_id", "=", command.personId)
          .returningAll())
      .selectFrom("updated as gift")
      .select(giftColumns)
      .$narrowType<GiftVocabulary>()
      .executeTakeFirst();
    return row ? { gift: gift(row), status: "saved" } : { status: "not-found" };
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
    const row = await schemaDatabaseFromSession(command.transaction)
      .with("updated", (database) =>
        database.updateTable("crm.debts")
          .set({
            settled_at: command.settledAt ?? null,
            status: command.status,
            updated_at: command.occurredAt,
          })
          .where("id", "=", command.id)
          .where("workspace_id", "=", command.workspaceId)
          .where("person_id", "=", command.personId)
          .returningAll())
      .selectFrom("updated as debt")
      .select(debtColumns)
      .$narrowType<DebtVocabulary>()
      .executeTakeFirst();
    return row ? { debt: debt(row), status: "saved" } : { status: "not-found" };
  }
}
