/**
 * Gift and debt tools: gifts, debts, recurring debts, and settlements. One
 * read grant covers all of it, because it is all financial information; one
 * write grant covers every change, deletes included. Every change after a
 * create needs an id and a revision only the read grant answers.
 */

import {
  changeDebtStatus,
  changeGiftStatus,
  createDebt,
  createGift,
  createRecurringDebt,
  deleteDebt,
  deleteGift,
  deleteRecurringDebt,
  listDebtSettlements,
  listPersonGiftsAndDebts,
  updateDebt,
  updateGift,
  updateRecurringDebt,
} from "../routes/gifts.ts";
import { type AgentTool, defineTool } from "./define.ts";

const MONEY =
  'amount is a decimal string (for example "12.50") and currencyCode a three-letter code the workspace supports, listed by list_gifts_and_debts.';

const ARCHIVED = "An archived person's gifts and debts are read-only.";

const PHOTO =
  "A settlement may carry a reason and settlementPhotoFileId, the id of an available JPEG, PNG, or WebP photo of the same person.";

/** Where every gift and debt change reads its ids and revision. */
const GIFT_READ =
  "Ids and updatedAt come from list_gifts_and_debts or the last write; list_gifts_and_debts requires gifts:read, and a token without it cannot obtain them.";

/** The retry key every gift and debt create takes, and what it answers. */
const retry = (record: string) =>
  `Pass your own requestId and reuse it when you retry: the same requestId and payload return the ${record} the first call wrote, a different payload or person under it is refused as a conflict (gift_request_conflict), and once that ${record} was deleted it is refused (gift_request_deleted) rather than recorded again.`;

/** The optional revision a status move or a rule change checks. */
const optionalRevision = (record: string) =>
  `Send expectedUpdatedAt, the ${record}'s updatedAt, to refuse the change as a conflict (gift_stale) when it changed since; left out, the change applies to whatever the ${record} is now.`;

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
      `Records a gift on a person's profile — an idea, a plan, or one given or received — and returns it with its id. ${MONEY} The amount is optional. recipientPersonId optionally names another person of the workspace who receives it; attachmentFileId optionally names an available file of the workspace that is not an avatar, from list_files (files:read). ${
        retry("gift")
      } ${ARCHIVED}`,
    route: createGift,
    minted: { requestId: "uuid" },
  }),
  defineTool({
    name: "set_gift_status",
    title: "Change a gift's status",
    description:
      `Moves a gift along its statuses: an idea may become planned, given, or received; a planned gift may be given or received; any gift may be archived, and archived is final — it cannot be moved again. A move that is not allowed is refused as a conflict; asking for the status it already has answers unchanged. ${
        optionalRevision("gift")
      } ${GIFT_READ} ${ARCHIVED}`,
    route: changeGiftStatus,
    annotations: { destructiveHint: true, idempotentHint: true },
  }),
  defineTool({
    name: "create_debt",
    title: "Record a debt",
    description:
      `Records money the person owes you (direction they_owe) or you owe them (i_owe), with a status, an optional reason, and returns it with its id. ${MONEY} ${PHOTO} ${
        retry("debt")
      } ${ARCHIVED}`,
    route: createDebt,
    minted: { requestId: "uuid" },
  }),
  defineTool({
    name: "set_debt_status",
    title: "Settle, reopen, or cancel a debt",
    description:
      `Moves a debt between open, settled, and cancelled: an open debt may be settled or cancelled, a settled debt may reopen, and cancelled is final. Settling adds an entry to the debt's permanent settlement history. ${PHOTO} Asking for the status it already has answers unchanged. ${
        optionalRevision("debt")
      } A refused move records no settlement. ${GIFT_READ} ${ARCHIVED}`,
    route: changeDebtStatus,
    annotations: { destructiveHint: true, idempotentHint: true },
  }),
  defineTool({
    name: "delete_debt",
    title: "Delete a debt",
    description:
      `Permanently deletes one debt together with its whole settlement history; nothing can restore it. A debt a recurring debt charged leaves the recurring rule and its other charges in place. There is no revision check. ${GIFT_READ} ${ARCHIVED}`,
    route: deleteDebt,
  }),
  defineTool({
    name: "create_recurring_debt",
    title: "Create a recurring debt",
    description:
      `Creates a rule that charges the person the same debt every intervalMonths months on dayOfMonth, from startsOn until the optional endsOn. Every period already due is charged at once, one open debt per period. ${MONEY} ${
        retry("rule")
      } A replay charges nothing again. ${ARCHIVED}`,
    route: createRecurringDebt,
    minted: { requestId: "uuid" },
  }),
  defineTool({
    name: "update_recurring_debt",
    title: "Update, pause, or resume a recurring debt",
    description:
      `Changes a recurring debt's terms, or pauses (active false) or resumes (active true) it. A period already charged is never charged again, resuming skips the periods that passed while paused, and a change that leaves due periods uncharged charges them at once. Send null to clear endsOn or reason, and change at least one field besides expectedUpdatedAt. ${
        optionalRevision("rule")
      } ${GIFT_READ} ${ARCHIVED}`,
    route: updateRecurringDebt,
  }),
  defineTool({
    name: "delete_recurring_debt",
    title: "Delete a recurring debt",
    description:
      `Permanently deletes a recurring debt so it charges nothing more. The debts it already charged stay, each to be settled or cancelled on its own. There is no revision check. ${GIFT_READ} ${ARCHIVED}`,
    route: deleteRecurringDebt,
  }),
  defineTool({
    name: "update_gift",
    title: "Edit a gift",
    description:
      `Edits a gift's name, amount with currencyCode (sent together), eventAt, comment, url, recipientPersonId, or attachmentFileId; set_gift_status moves its status. A field left out keeps its value and null clears an optional one; name cannot be cleared, and at least one field is required. ${MONEY} An attachment replaces the gift's attachment and null removes it; the previous file stays in the person's files. expectedUpdatedAt is required, and a gift changed since is refused as a conflict (gift_stale). ${GIFT_READ} Any member may edit any gift. ${ARCHIVED}`,
    route: updateGift,
  }),
  defineTool({
    name: "delete_gift",
    title: "Delete a gift",
    description:
      `Permanently deletes one gift; nothing restores it, and replaying the create_gift call that made it is refused as a conflict (gift_request_deleted). expectedUpdatedAt is required, and a gift changed since is refused as a conflict (gift_stale). An attached file is not deleted: only its link to the gift goes, and the file stays in the person's files. To keep a gift out of the way instead, archive it with set_gift_status. ${GIFT_READ} ${ARCHIVED}`,
    route: deleteGift,
  }),
  defineTool({
    name: "update_debt",
    title: "Edit a debt",
    description:
      `Edits a debt's amount, currencyCode, direction, or reason; set_debt_status moves its status. A field left out keeps its value, reason null clears it, and at least one field is required. ${MONEY} Amount, currency, and direction change only while the debt is open and has never been settled: once settled, even if reopened, they are refused (debt_values_locked) while its reason stays editable, and a cancelled debt refuses every edit. Editing a recurring charge changes neither its rule nor the other charges. expectedUpdatedAt is required, and a debt changed since is refused as a conflict (gift_stale). ${GIFT_READ} ${ARCHIVED}`,
    route: updateDebt,
  }),
];
