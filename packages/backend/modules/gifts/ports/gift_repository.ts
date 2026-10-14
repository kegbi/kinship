/**
 * How the module stores gifts and debts.
 *
 * Both halves of the table pair read the same way — `find` before a change,
 * `list` for a person's page — and write the same way: `create` inserts,
 * `save` moves a status the rules already allowed. Neither save decides
 * anything; `domain/gift_rules.ts` has already said whether the move is legal
 * by the time one is called.
 *
 * `archived-write-rejected` appears on every write because a person may be
 * archived between the actor's standing being established and the row being
 * touched, and an archived person's gifts are read-only.
 */

import type { Failure } from "../../../shared-kernel/result.ts";
import type { GiftPageAnchor } from "../domain/cursors.ts";
import type {
  DebtDirection,
  DebtStatus,
  GiftStatus,
  StoredDebt,
  StoredGift,
} from "../domain/gift_rules.ts";
import type { GiftActor, GiftTransaction } from "./context.ts";

export interface GiftRepository {
  deleteDebt(
    command: GiftActor & {
      readonly id: string;
      readonly personId: string;
      readonly transaction: GiftTransaction;
    },
  ): Promise<
    | { readonly debt: StoredDebt; readonly status: "deleted" }
    | Failure<"archived-write-rejected" | "not-found">
  >;
  createGift(
    command: GiftActor & {
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
      readonly transaction: GiftTransaction;
      readonly url?: string;
    },
  ): Promise<
    | { readonly gift: StoredGift; readonly status: "created" }
    | Failure<"archived-write-rejected" | "not-found">
  >;
  createDebt(
    command: GiftActor & {
      readonly amount: string;
      readonly currencyCode?: string;
      readonly direction: DebtDirection;
      readonly id: string;
      readonly occurredAt: Date;
      readonly personId: string;
      readonly reason?: string;
      readonly settledAt?: Date;
      readonly status: DebtStatus;
      readonly transaction: GiftTransaction;
    },
  ): Promise<
    | { readonly debt: StoredDebt; readonly status: "created" }
    | Failure<"archived-write-rejected" | "not-found">
  >;
  findGift(
    command: GiftActor & {
      readonly id: string;
      readonly personId: string;
      readonly transaction: GiftTransaction;
    },
  ): Promise<
    | { readonly gift: StoredGift; readonly status: "found" }
    | Failure<"archived-write-rejected" | "not-found">
  >;
  findDebt(
    command: GiftActor & {
      readonly id: string;
      readonly personId: string;
      readonly transaction: GiftTransaction;
    },
  ): Promise<
    | { readonly debt: StoredDebt; readonly status: "found" }
    | Failure<"archived-write-rejected" | "not-found">
  >;
  /**
   * One page of each collection.
   *
   * Both halves are asked for `limit` rows and told where they resume, and
   * each answers with the anchor of the page after it when one exists — so
   * "is there more" costs the same query rather than a second count.
   */
  list(
    command: GiftActor & {
      readonly debtAfter?: GiftPageAnchor;
      readonly giftAfter?: GiftPageAnchor;
      readonly limit: number;
      readonly personId: string;
      readonly transaction: GiftTransaction;
    },
  ): Promise<
    | {
      readonly debts: readonly StoredDebt[];
      readonly gifts: readonly StoredGift[];
      readonly nextDebt?: GiftPageAnchor;
      readonly nextGift?: GiftPageAnchor;
      readonly status: "ready";
    }
    | Failure<"forbidden" | "not-found">
  >;
  saveGift(
    command: GiftActor & {
      readonly id: string;
      readonly occurredAt: Date;
      readonly personId: string;
      readonly status: GiftStatus;
      readonly transaction: GiftTransaction;
    },
  ): Promise<
    | { readonly gift: StoredGift; readonly status: "saved" }
    | Failure<"archived-write-rejected" | "not-found">
  >;
  saveDebt(
    command: GiftActor & {
      readonly id: string;
      readonly occurredAt: Date;
      readonly personId: string;
      readonly settledAt?: Date;
      readonly status: DebtStatus;
      readonly transaction: GiftTransaction;
    },
  ): Promise<
    | { readonly debt: StoredDebt; readonly status: "saved" }
    | Failure<"archived-write-rejected" | "not-found">
  >;
}
