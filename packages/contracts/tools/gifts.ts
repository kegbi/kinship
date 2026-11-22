/**
 * Gift and debt tools: gifts, debts, recurring debts, and settlements. One
 * read grant covers all of it, because it is all financial information; one
 * write grant covers every change.
 */

import {
  changeDebtStatus,
  changeGiftStatus,
  createDebt,
  createGift,
  createRecurringDebt,
  deleteDebt,
  deleteRecurringDebt,
  listDebtSettlements,
  listPersonGiftsAndDebts,
  updateRecurringDebt,
} from "../routes/gifts.ts";
import { type AgentTool, defineTool } from "./define.ts";

const MONEY =
  'amount is a decimal string (for example "12.50") and currencyCode a three-letter code the workspace supports, listed by list_gifts_and_debts.';

const ARCHIVED = "An archived person's gifts and debts are read-only.";

const PHOTO =
  "A settlement may carry a reason and settlementPhotoFileId, the id of an available JPEG, PNG, or WebP photo of the same person.";

export const GIFT_TOOLS: readonly AgentTool[] = [
  defineTool({
    name: "list_gifts_and_debts",
    title: "List a person's gifts and debts",
    description:
      "Lists one person's gifts, debts, and recurring debts with their ids, statuses, and amounts (decimal strings with a three-letter currency code), and the default and supported currencies for new ones. Gifts and debts page independently: pass nextGiftCursor back as giftCursor and nextDebtCursor as debtCursor. An archived person's records stay readable.",
    route: listPersonGiftsAndDebts,
  }),
  defineTool({
    name: "list_debt_settlements",
    title: "List a debt's settlements",
    description:
      "Lists one debt's settlement history, newest first: when it was settled, the optional reason, and the optional settlement photo's file id and name with whether it is still available. debtId comes from list_gifts_and_debts; pages with limit and nextCursor.",
    route: listDebtSettlements,
  }),
  defineTool({
    name: "create_gift",
    title: "Record a gift",
    description:
      `Records a gift on a person's profile — an idea, a plan, or one given or received — and returns it with its id. ${MONEY} The amount is optional. recipientPersonId optionally names another person of the workspace who receives it; attachmentFileId optionally names an available file of the workspace. There is no retry key, so repeating it records a second gift. ${ARCHIVED}`,
    route: createGift,
  }),
  defineTool({
    name: "set_gift_status",
    title: "Change a gift's status",
    description:
      `Moves a gift along its statuses: an idea may become planned, given, or received; a planned gift may be given or received; any gift may be archived, and archived is final — it cannot be moved again. A move that is not allowed is refused as a conflict; asking for the status it already has answers unchanged. giftId comes from list_gifts_and_debts. ${ARCHIVED}`,
    route: changeGiftStatus,
    annotations: { destructiveHint: true, idempotentHint: true },
  }),
  defineTool({
    name: "create_debt",
    title: "Record a debt",
    description:
      `Records money the person owes you (direction they_owe) or you owe them (i_owe), with a status, an optional reason, and returns it with its id. ${MONEY} ${PHOTO} There is no retry key, so repeating it records a second debt. ${ARCHIVED}`,
    route: createDebt,
  }),
  defineTool({
    name: "set_debt_status",
    title: "Settle, reopen, or cancel a debt",
    description:
      `Moves a debt between open, settled, and cancelled: an open debt may be settled or cancelled, a settled debt may reopen, and cancelled is final. Settling adds an entry to the debt's permanent settlement history. ${PHOTO} Asking for the status it already has answers unchanged. debtId comes from list_gifts_and_debts. ${ARCHIVED}`,
    route: changeDebtStatus,
    annotations: { destructiveHint: true, idempotentHint: true },
  }),
  defineTool({
    name: "delete_debt",
    title: "Delete a debt",
    description:
      `Permanently deletes one debt together with its whole settlement history; nothing can restore it. A debt a recurring debt charged leaves the recurring rule and its other charges in place. debtId comes from list_gifts_and_debts. ${ARCHIVED}`,
    route: deleteDebt,
  }),
  defineTool({
    name: "create_recurring_debt",
    title: "Create a recurring debt",
    description:
      `Creates a rule that charges the person the same debt every intervalMonths months on dayOfMonth, from startsOn until the optional endsOn. Every period already due is charged at once, one open debt per period. ${MONEY} There is no retry key: repeating it creates a second rule and charges its due periods again. ${ARCHIVED}`,
    route: createRecurringDebt,
  }),
  defineTool({
    name: "update_recurring_debt",
    title: "Update, pause, or resume a recurring debt",
    description:
      `Changes a recurring debt's terms, or pauses (active false) or resumes (active true) it; recurringDebtId comes from list_gifts_and_debts. A period already charged is never charged again, resuming skips the periods that passed while paused, and a change that leaves due periods uncharged charges them at once. Send null to clear endsOn or reason. There is no revision check. ${ARCHIVED}`,
    route: updateRecurringDebt,
  }),
  defineTool({
    name: "delete_recurring_debt",
    title: "Delete a recurring debt",
    description:
      `Permanently deletes a recurring debt so it charges nothing more. The debts it already charged stay, each to be settled or cancelled on its own. recurringDebtId comes from list_gifts_and_debts. ${ARCHIVED}`,
    route: deleteRecurringDebt,
  }),
];
