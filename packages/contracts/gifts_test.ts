import * as client from "./generated/auth-client.ts";
import document from "./openapi/openapi.json" with { type: "json" };
import { debtStatusInput } from "./schemas/gifts.ts";

Deno.test("[GIFTS-001] settlement accepts optional reason and photo only when settling", () => {
  assert(
    debtStatusInput.safeParse({
      status: "settled",
      settlementReason: "Paid by bank transfer",
      settlementPhotoFileId: "10000000-0000-4000-8000-000000000006",
    }).success,
    "settlement reason and photo are accepted",
  );
  assert(
    !debtStatusInput.safeParse({
      status: "open",
      settlementReason: "not a settlement",
    }).success,
    "non-settlement cannot carry settlement metadata",
  );
});

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("[GIFTS-001] generated contract exposes gifts and debts", () => {
  const generated = client as Record<string, unknown>;
  for (
    const operation of [
      "listPersonGifts",
      "createGift",
      "changeGiftStatus",
      "createDebt",
      "changeDebtStatus",
      "deleteDebt",
      "createRecurringDebt",
      "updateRecurringDebt",
      "deleteRecurringDebt",
    ]
  ) {
    assert(
      typeof generated[operation] === "function",
      `${operation} generated`,
    );
  }
  assert(
    document.components.schemas.GiftDebtList,
    "gift/debt list schema generated",
  );
  assert(
    document.components.schemas.RecurringDebt &&
      document.components.schemas.GiftDebtList.required.includes(
        "recurringDebts",
      ) &&
      document.components.schemas.GiftDebtList.required.includes(
        "defaultCurrencyCode",
      ),
    "the list carries the recurring debts and the default currency",
  );
});
