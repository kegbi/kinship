import { assert, assertEquals } from "../../../testing/assert.ts";
import {
  DEFAULT_RELATIONSHIP_TYPE_VOCABULARY,
  RegistrationError,
  VERIFICATION_WINDOW_MS,
  VerificationDeliveryError,
  verificationExpiry,
  WORKSPACE_LOCK_SEEDS_IN_USE,
} from "./registration_rules.ts";

Deno.test("[GAP-018] a verification link works for a day", () => {
  assertEquals(VERIFICATION_WINDOW_MS, 86_400_000);
  assertEquals(
    verificationExpiry(new Date("2026-03-01T10:00:00.000Z")).toISOString(),
    "2026-03-02T10:00:00.000Z",
  );
});

Deno.test("[GAP-018] every workspace starts with the same vocabulary, in order", () => {
  const { types, version } = DEFAULT_RELATIONSHIP_TYPE_VOCABULARY;
  assertEquals(version, 1);
  assertEquals(
    WORKSPACE_LOCK_SEEDS_IN_USE.includes(version),
    false,
    "the version seeds the provisioning lock and must not share a seed",
  );
  assertEquals(types.length, 26);
  assertEquals(types[0], {
    forwardLabel: "partner",
    reverseLabel: "partner",
    sortOrder: 0,
  });
  assertEquals(types[7], {
    forwardLabel: "parent",
    reverseLabel: "child",
    sortOrder: 7,
  });
  assertEquals(types[25], {
    forwardLabel: "protege",
    reverseLabel: "mentor",
    sortOrder: 25,
  });
  assertEquals(
    types.map((type, index) => type.sortOrder === index).every(Boolean),
    true,
    "the display order is the position, so the two cannot drift",
  );
  assertEquals(
    types.filter((type) => type.forwardLabel === type.reverseLabel).length,
    10,
    "ten of them are their own inverse",
  );
  for (const type of types) {
    const inverse = types.find((candidate) =>
      candidate.forwardLabel === type.reverseLabel
    );
    assert(
      inverse !== undefined,
      `${type.reverseLabel} is a label in its own right`,
    );
    assertEquals(
      inverse.reverseLabel,
      type.forwardLabel,
      `${type.forwardLabel} and ${type.reverseLabel} invert each other`,
    );
  }
});

Deno.test("[AUD-A1] a failed registration has one code, and no duplicate-address variant", () => {
  const failed = new RegistrationError();
  assertEquals(failed.code, "registration_failed");
  assertEquals(failed.name, "RegistrationError");
  assertEquals(failed.message, "Registration could not be completed.");
  assert(failed instanceof Error, "it is an error");
});

Deno.test("[GAP-018] a registration that committed but could not be delivered is a third thing", () => {
  const delivery = new VerificationDeliveryError();
  assertEquals(delivery.code, "verification_delivery_failed");
  assertEquals(delivery.name, "VerificationDeliveryError");
  assertEquals(
    delivery.message,
    "Verification delivery failed after registration committed.",
  );
  assertEquals(
    delivery instanceof RegistrationError,
    false,
    "the account exists, so it must not look like a failed registration",
  );
});
