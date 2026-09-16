import type { Clock } from "../../../shared-kernel/clock.ts";
import type { Failure } from "../../../shared-kernel/result.ts";
import { runOrUnavailable } from "../../../shared-kernel/transaction.ts";
import {
  boundedText,
  currencyCode as canonicalCurrency,
  instant,
  moneyAmount,
} from "../../../shared-kernel/validation.ts";
import type { PeopleActor, PeopleTransaction } from "../../people/public.ts";
import type { GiftAttachmentBoundary } from "../../files/public.ts";
import type {
  ActorRevalidation,
  WorkspaceCurrencyBoundary,
} from "../../workspaces/public.ts";

export type GiftStatus = "archived" | "given" | "idea" | "planned" | "received";
export type DebtStatus = "cancelled" | "open" | "settled";
export type DebtDirection = "i_owe" | "they_owe";

export interface GiftRecord {
  readonly amount?: string;
  readonly attachmentFileId?: string;
  readonly comment?: string;
  readonly createdAt: string;
  readonly currencyCode?: string;
  readonly eventAt?: string;
  readonly id: string;
  readonly name: string;
  readonly personId: string;
  readonly recipientPersonId?: string;
  readonly status: GiftStatus;
  readonly updatedAt: string;
  readonly url?: string;
}

export type StoredGift = GiftRecord;

export interface DebtRecord {
  readonly amount: string;
  readonly createdAt: string;
  readonly currencyCode?: string;
  readonly direction: DebtDirection;
  readonly id: string;
  readonly personId: string;
  readonly reason?: string;
  readonly settledAt?: string;
  readonly status: DebtStatus;
  readonly updatedAt: string;
}

export type StoredDebt = DebtRecord;

export interface GiftRepository {
  createGift(
    command: PeopleActor & {
      readonly amount?: string;
      readonly comment?: string;
      readonly currencyCode?: string;
      readonly eventAt?: string;
      readonly id: string;
      readonly name: string;
      readonly occurredAt: Date;
      readonly personId: string;
      readonly recipientPersonId?: string;
      readonly status: GiftStatus;
      readonly transaction: PeopleTransaction;
      readonly url?: string;
    },
  ): Promise<
    | { readonly gift: StoredGift; readonly status: "created" }
    | Failure<"archived-write-rejected" | "not-found">
  >;
  createDebt(
    command: PeopleActor & {
      readonly amount: string;
      readonly currencyCode?: string;
      readonly direction: DebtDirection;
      readonly id: string;
      readonly occurredAt: Date;
      readonly personId: string;
      readonly reason?: string;
      readonly settledAt?: Date;
      readonly status: DebtStatus;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<
    | { readonly debt: StoredDebt; readonly status: "created" }
    | Failure<"archived-write-rejected" | "not-found">
  >;
  findGift(
    command: PeopleActor & {
      readonly id: string;
      readonly personId: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<
    | { readonly gift: StoredGift; readonly status: "found" }
    | Failure<"archived-write-rejected" | "not-found">
  >;
  findDebt(
    command: PeopleActor & {
      readonly id: string;
      readonly personId: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<
    | { readonly debt: StoredDebt; readonly status: "found" }
    | Failure<"archived-write-rejected" | "not-found">
  >;
  list(
    command: PeopleActor & {
      readonly personId: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<
    | {
      readonly debts: readonly StoredDebt[];
      readonly gifts: readonly StoredGift[];
      readonly status: "ready";
    }
    | Failure<"forbidden" | "not-found">
  >;
  saveGift(
    command: PeopleActor & {
      readonly id: string;
      readonly occurredAt: Date;
      readonly personId: string;
      readonly status: GiftStatus;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<
    | { readonly gift: StoredGift; readonly status: "saved" }
    | Failure<"archived-write-rejected" | "not-found">
  >;
  saveDebt(
    command: PeopleActor & {
      readonly id: string;
      readonly occurredAt: Date;
      readonly personId: string;
      readonly settledAt?: Date;
      readonly status: DebtStatus;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<
    | { readonly debt: StoredDebt; readonly status: "saved" }
    | Failure<"archived-write-rejected" | "not-found">
  >;
}

export interface GiftAudit {
  record(command: {
    readonly action: "changed" | "created";
    readonly actor: PeopleActor;
    readonly occurredAt: Date;
    readonly record: StoredDebt | StoredGift;
    readonly recordType: "debt" | "gift";
    readonly transaction: PeopleTransaction;
  }): Promise<string>;
}

export interface GiftManagementDependencies {
  readonly actors: ActorRevalidation;
  readonly attachments: GiftAttachmentBoundary;
  readonly audit: GiftAudit;
  readonly clock: Clock;
  readonly currencies: WorkspaceCurrencyBoundary;
  readonly ids: { next(): string };
  readonly repository: GiftRepository;
  readonly transaction: {
    run<T>(work: (transaction: PeopleTransaction) => Promise<T>): Promise<T>;
  };
}

export interface CreateGiftInput {
  readonly amount?: string;
  readonly attachmentFileId?: string;
  readonly comment?: string;
  readonly currencyCode?: string;
  readonly eventAt?: string;
  readonly name: string;
  readonly recipientPersonId?: string;
  readonly status: GiftStatus;
  readonly url?: string;
}

export interface CreateDebtInput {
  readonly amount: string;
  readonly currencyCode: string;
  readonly direction: DebtDirection;
  readonly reason?: string;
  readonly status: DebtStatus;
}

/**
 * Every failure a gift or debt mutation reports. A rejected amount, currency,
 * or event time names no field, so this module's `validation-error` is the
 * bare one rather than the kernel's payload-carrying `ValidationFailure`.
 */
type GiftMutationFailure = Failure<
  "archived-write-rejected" | "forbidden" | "not-found" | "unavailable",
  "invalid-transition" | "validation-error"
>;

/** The failure an attachment boundary reports, carried out of a transaction. */
type AttachmentFailureStatus = Failure<"forbidden" | "not-found">["status"];

class AttachmentFailure extends Error {
  constructor(readonly status: AttachmentFailureStatus) {
    super(status);
  }
}

const giftTransitions: Readonly<Record<GiftStatus, ReadonlySet<GiftStatus>>> = {
  archived: new Set(),
  given: new Set(["archived"]),
  idea: new Set(["archived", "given", "planned", "received"]),
  planned: new Set(["archived", "given", "received"]),
  received: new Set(["archived"]),
};
const debtTransitions: Readonly<Record<DebtStatus, ReadonlySet<DebtStatus>>> = {
  cancelled: new Set(),
  open: new Set(["cancelled", "settled"]),
  settled: new Set(),
};

/** An amount the money columns hold and a debt total can still sum. */
function money(value: string | undefined): string | undefined {
  const amount = moneyAmount(value);
  return amount !== undefined && Number(amount) <= 9_999_999_999_999_999
    ? amount
    : undefined;
}

function hydrateGifts(
  gifts: readonly StoredGift[],
  links: readonly { readonly fileId: string; readonly giftId: string }[],
): readonly StoredGift[] {
  const byGift = new Map(links.map((link) => [link.giftId, link.fileId]));
  return gifts.map((gift) => {
    const attachmentFileId = byGift.get(gift.id);
    return attachmentFileId ? { ...gift, attachmentFileId } : gift;
  });
}

export function createGiftManagement(dependencies: GiftManagementDependencies) {
  /**
   * The actor's standing, asked first inside the caller's transaction. Write
   * paths lock the actor's rows; the list keeps its lock-free concurrency.
   */
  const active = async (
    actor: PeopleActor,
    transaction: PeopleTransaction,
    lock: boolean,
  ): Promise<boolean> =>
    await dependencies.actors.revalidate({ ...actor, lock, transaction }) ===
      "active";

  return {
    createGift: async (
      actor: PeopleActor,
      personId: string,
      input: CreateGiftInput,
    ): Promise<
      | { readonly gift: GiftRecord; readonly status: "created" }
      | GiftMutationFailure
    > => {
      const name = boundedText(input.name, 500);
      const amount = money(input.amount);
      const currencyCode = canonicalCurrency(input.currencyCode);
      const eventAt = instant(input.eventAt);
      if (
        !name || (input.amount !== undefined && !amount) ||
        (input.currencyCode !== undefined && !currencyCode) ||
        (input.eventAt !== undefined && !eventAt) ||
        (amount !== undefined && currencyCode === undefined)
      ) return { status: "validation-error" };
      const occurredAt = dependencies.clock.now();
      try {
        return await dependencies.transaction.run(async (transaction) => {
          if (!await active(actor, transaction, true)) {
            return { status: "forbidden" as const };
          }
          if (input.attachmentFileId) {
            const valid = await dependencies.attachments.validateForGift({
              ...actor,
              fileId: input.attachmentFileId,
              transaction,
            });
            if (valid.status !== "ready") return valid;
          }
          if (
            currencyCode &&
            !await dependencies.currencies.isSupported({
              code: currencyCode,
              transaction,
            })
          ) return { status: "validation-error" as const };
          const created = await dependencies.repository.createGift({
            ...actor,
            ...(amount ? { amount } : {}),
            ...(boundedText(input.comment, 10_000)
              ? { comment: boundedText(input.comment, 10_000)! }
              : {}),
            ...(currencyCode ? { currencyCode } : {}),
            ...(eventAt ? { eventAt } : {}),
            id: dependencies.ids.next(),
            name,
            occurredAt,
            personId,
            ...(input.recipientPersonId
              ? { recipientPersonId: input.recipientPersonId }
              : {}),
            status: input.status,
            transaction,
            ...(boundedText(input.url, 2_000)
              ? { url: boundedText(input.url, 2_000)! }
              : {}),
          });
          if (created.status !== "created") return created;
          let representedGift = created.gift;
          if (input.attachmentFileId) {
            const attached = await dependencies.attachments.attachToGift({
              ...actor,
              fileId: input.attachmentFileId,
              giftId: created.gift.id,
              transaction,
            });
            if (attached.status !== "attached") {
              throw new AttachmentFailure(attached.status);
            }
            const representation = await dependencies.attachments.listForGifts(
              {
                ...actor,
                giftIds: [created.gift.id],
                transaction,
              },
            );
            if (representation.status !== "ready") {
              throw new AttachmentFailure("forbidden");
            }
            const [hydrated] = hydrateGifts(
              [created.gift],
              representation.links,
            );
            if (!hydrated?.attachmentFileId) {
              throw new AttachmentFailure("not-found");
            }
            representedGift = hydrated;
          }
          await dependencies.audit.record({
            action: "created",
            actor,
            occurredAt,
            record: representedGift,
            recordType: "gift",
            transaction,
          });
          return { gift: representedGift, status: "created" as const };
        });
      } catch (error) {
        if (error instanceof AttachmentFailure) {
          return { status: error.status };
        }
        return { status: "unavailable" };
      }
    },

    createDebt: async (
      actor: PeopleActor,
      personId: string,
      input: CreateDebtInput,
    ): Promise<
      | { readonly debt: DebtRecord; readonly status: "created" }
      | GiftMutationFailure
    > => {
      const amount = money(input.amount);
      const currencyCode = canonicalCurrency(input.currencyCode);
      if (!amount || !currencyCode) {
        return { status: "validation-error" };
      }
      const occurredAt = dependencies.clock.now();
      return await runOrUnavailable(
        dependencies.transaction,
        async (transaction) => {
          if (!await active(actor, transaction, true)) {
            return { status: "forbidden" as const };
          }
          if (
            !await dependencies.currencies.isSupported({
              code: currencyCode,
              transaction,
            })
          ) return { status: "validation-error" as const };
          const created = await dependencies.repository.createDebt({
            ...actor,
            amount,
            currencyCode,
            direction: input.direction,
            id: dependencies.ids.next(),
            occurredAt,
            personId,
            ...(boundedText(input.reason, 10_000)
              ? { reason: boundedText(input.reason, 10_000)! }
              : {}),
            ...(input.status === "settled" ? { settledAt: occurredAt } : {}),
            status: input.status,
            transaction,
          });
          if (created.status !== "created") return created;
          await dependencies.audit.record({
            action: "created",
            actor,
            occurredAt,
            record: created.debt,
            recordType: "debt",
            transaction,
          });
          return created;
        },
      );
    },

    changeGiftStatus: async (
      actor: PeopleActor,
      personId: string,
      id: string,
      status: GiftStatus,
    ) => {
      const occurredAt = dependencies.clock.now();
      try {
        return await dependencies.transaction.run(async (transaction) => {
          if (!await active(actor, transaction, true)) {
            return { status: "forbidden" as const };
          }
          const found = await dependencies.repository.findGift({
            ...actor,
            id,
            personId,
            transaction,
          });
          if (found.status !== "found") return found;
          if (found.gift.status === status) {
            return { gift: found.gift, status: "unchanged" as const };
          }
          if (!giftTransitions[found.gift.status].has(status)) {
            return { status: "invalid-transition" as const };
          }
          const saved = await dependencies.repository.saveGift({
            ...actor,
            id,
            occurredAt,
            personId,
            status,
            transaction,
          });
          if (saved.status !== "saved") return saved;
          const attachments = await dependencies.attachments.listForGifts({
            ...actor,
            giftIds: [saved.gift.id],
            transaction,
          });
          if (attachments.status !== "ready") {
            throw new AttachmentFailure("forbidden");
          }
          const [representedGift] = hydrateGifts(
            [saved.gift],
            attachments.links,
          );
          if (!representedGift) throw new Error("Saved gift missing.");
          await dependencies.audit.record({
            action: "changed",
            actor,
            occurredAt,
            record: representedGift,
            recordType: "gift",
            transaction,
          });
          return { gift: representedGift, status: "saved" as const };
        });
      } catch (error) {
        if (error instanceof AttachmentFailure) {
          return { status: error.status };
        }
        return { status: "unavailable" as const };
      }
    },

    changeDebtStatus: async (
      actor: PeopleActor,
      personId: string,
      id: string,
      status: DebtStatus,
    ) => {
      const occurredAt = dependencies.clock.now();
      return await runOrUnavailable(
        dependencies.transaction,
        async (transaction) => {
          if (!await active(actor, transaction, true)) {
            return { status: "forbidden" as const };
          }
          const found = await dependencies.repository.findDebt({
            ...actor,
            id,
            personId,
            transaction,
          });
          if (found.status !== "found") return found;
          if (found.debt.status === status) {
            return { debt: found.debt, status: "unchanged" as const };
          }
          if (!debtTransitions[found.debt.status].has(status)) {
            return { status: "invalid-transition" as const };
          }
          const saved = await dependencies.repository.saveDebt({
            ...actor,
            id,
            occurredAt,
            personId,
            ...(status === "settled" ? { settledAt: occurredAt } : {}),
            status,
            transaction,
          });
          if (saved.status !== "saved") return saved;
          await dependencies.audit.record({
            action: "changed",
            actor,
            occurredAt,
            record: saved.debt,
            recordType: "debt",
            transaction,
          });
          return saved;
        },
      );
    },

    list: async (actor: PeopleActor, personId: string) => {
      return await runOrUnavailable(
        dependencies.transaction,
        async (transaction) => {
          if (!await active(actor, transaction, false)) {
            return { status: "forbidden" as const };
          }
          const records = await dependencies.repository.list({
            ...actor,
            personId,
            transaction,
          });
          if (records.status !== "ready") return records;
          const [attachments, supportedCurrencyCodes] = await Promise.all([
            dependencies.attachments.listForGifts({
              ...actor,
              giftIds: records.gifts.map((gift) => gift.id),
              transaction,
            }),
            dependencies.currencies.listSupported({ transaction }),
          ]);
          if (attachments.status !== "ready") return attachments;
          return {
            debts: records.debts,
            gifts: hydrateGifts(records.gifts, attachments.links),
            status: "ready" as const,
            supportedCurrencyCodes,
          };
        },
      );
    },
  };
}

export type GiftManagement = ReturnType<typeof createGiftManagement>;
