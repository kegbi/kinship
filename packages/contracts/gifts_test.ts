import * as client from "./generated/auth-client.ts";
import document from "./openapi/openapi.json" with { type: "json" };

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
