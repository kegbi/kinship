import { assert, assertEquals, assertThrows } from "../../../testing/assert.ts";
import {
  deliveryWindow,
  IdentityConflictError,
  PASSWORD_RESET_DELIVERY_WINDOW,
  PASSWORD_RESET_WINDOW_MS,
  passwordResetExpiry,
} from "./identity_rules.ts";

Deno.test("[GAP-018] a conflict is an error with a name a caller can match on", () => {
  const error = new IdentityConflictError();
  assert(error instanceof Error, "it is an error");
  assertEquals(error.name, "IdentityConflictError");
  assertEquals(error.message, "Identity already exists.");
});

Deno.test("[GAP-018] a reset link works for an hour", () => {
  assertEquals(PASSWORD_RESET_WINDOW_MS, 3_600_000);
  assertEquals(
    passwordResetExpiry(new Date("2026-03-01T10:00:00.000Z")).toISOString(),
    "2026-03-01T11:00:00.000Z",
  );
});

Deno.test("[GAP-018] the constant-time answer window defaults and is bounded", () => {
  assertEquals(PASSWORD_RESET_DELIVERY_WINDOW, {
    default: 1_500,
    minimum: 100,
    maximum: 5_000,
  });
  assertEquals(deliveryWindow(undefined), 1_500);
  assertEquals(deliveryWindow(100), 100);
  assertEquals(deliveryWindow(5_000), 5_000);
});

Deno.test("[GAP-018] a window that would leak whether an address is registered refuses to start", () => {
  for (
    const value of [0, 99, 5_001, Number.NaN, Number.POSITIVE_INFINITY, -1]
  ) {
    const thrown = assertThrows(
      () => deliveryWindow(value),
      `a window of ${value} must be refused`,
    );
    assertEquals(
      thrown instanceof Error ? thrown.message : String(thrown),
      "Password recovery delivery window must be 100-5000ms.",
    );
  }
});
