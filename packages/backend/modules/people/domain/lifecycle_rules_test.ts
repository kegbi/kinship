import { assertEquals } from "../../../testing/assert.ts";
import {
  deletionConfirmation,
  deletionDecision,
  editDecision,
  genderChoice,
  normalizeEditPersonInput,
  type PersonLifecycleRecord,
  type PersonLifecycleState,
  transitionDecision,
  transitionState,
  validateEditPersonInput,
} from "./lifecycle_rules.ts";

const revision = "2026-08-15T08:00:00.000Z";

function person(
  lifecycle: PersonLifecycleState,
  overrides: Partial<PersonLifecycleRecord> = {},
): PersonLifecycleRecord {
  return {
    familyName: "Lovelace",
    givenName: "Ada",
    id: "00000000-0000-4000-8000-000000000001",
    isDeceased: false,
    isPartial: false,
    lifecycle,
    updatedAt: revision,
    ...overrides,
  };
}

Deno.test("[GAP-015] an edit is normalized without touching its revision", () => {
  assertEquals(
    normalizeEditPersonInput({
      expectedUpdatedAt: "  2026-08-15T08:00:00.000Z  ",
      familyName: " Lovelace ",
      givenName: "  Ada ",
      isPartial: false,
      middleName: "  ",
      nickname: " Addy ",
    }),
    {
      expectedUpdatedAt: "  2026-08-15T08:00:00.000Z  ",
      familyName: "Lovelace",
      givenName: "Ada",
      isPartial: false,
      nickname: "Addy",
    },
    "the revision is compared exactly as it was received",
  );
  assertEquals(
    normalizeEditPersonInput({
      expectedUpdatedAt: revision,
      familyName: "   ",
      givenName: "Ada",
      isPartial: true,
      middleName: " Augusta ",
      nickname: "  ",
    }),
    {
      expectedUpdatedAt: revision,
      givenName: "Ada",
      isPartial: true,
      middleName: "Augusta",
    },
  );
});

Deno.test("[GAP-015] an edit needs a name, an honest partial flag, and a revision", () => {
  assertEquals(
    validateEditPersonInput({
      expectedUpdatedAt: revision,
      givenName: "",
      isPartial: true,
    }),
    { givenName: "Enter a given name, family name, or nickname." },
  );
  assertEquals(
    validateEditPersonInput({
      expectedUpdatedAt: revision,
      givenName: "",
      isPartial: false,
      nickname: "Addy",
    }),
    {
      isPartial: "Mark the person as partial when their given name is unknown.",
    },
  );
  assertEquals(
    validateEditPersonInput({
      expectedUpdatedAt: "not a time",
      givenName: "Ada",
      isPartial: false,
    }),
    { expectedUpdatedAt: "Refresh this person before saving." },
  );
  assertEquals(
    validateEditPersonInput({
      expectedUpdatedAt: revision,
      givenName: "Ada",
      isPartial: false,
    }),
    {},
  );
});

Deno.test("[GAP-015] only an active person at the expected revision may be edited", () => {
  assertEquals(editDecision(person("deleted"), revision), {
    status: "not-found",
  });
  assertEquals(editDecision(person("archived"), revision), {
    status: "archived-write-rejected",
  });
  assertEquals(editDecision(person("active"), "2026-08-15T09:00:00.000Z"), {
    status: "stale",
  });
  assertEquals(editDecision(person("active"), revision), {
    status: "proceed",
  });
});

Deno.test("[GAP-015] asking for the state a person is already in changes nothing", () => {
  assertEquals(
    transitionDecision("archive", person("archived"), "any"),
    { status: "unchanged" },
    "an already-archived person needs no fresh revision",
  );
  assertEquals(
    transitionDecision("restore", person("active"), "any"),
    { status: "unchanged" },
  );
  assertEquals(transitionState("archive"), "archived");
  assertEquals(transitionState("restore"), "restored");
});

Deno.test("[GAP-015] a real transition is refused on a deleted or stale person", () => {
  assertEquals(transitionDecision("archive", person("deleted"), revision), {
    status: "not-found",
  });
  assertEquals(transitionDecision("restore", person("deleted"), revision), {
    status: "not-found",
  });
  assertEquals(
    transitionDecision("archive", person("active"), "2026-08-15T09:00:00.000Z"),
    { status: "stale" },
  );
  assertEquals(transitionDecision("archive", person("active"), revision), {
    status: "proceed",
  });
  assertEquals(transitionDecision("restore", person("archived"), revision), {
    status: "proceed",
  });
});

Deno.test("[GAP-015] deletion names the person it is about to delete", () => {
  assertEquals(deletionConfirmation(person("active")), "DELETE Ada Lovelace");
  assertEquals(
    deletionConfirmation({
      givenName: "",
      id: "00000000-0000-4000-8000-000000000002",
      isDeceased: false,
      isPartial: true,
      lifecycle: "active",
      nickname: "Addy",
      updatedAt: revision,
    }),
    "DELETE Addy",
  );
});

Deno.test("[GAP-015] deletion is confirmed by phrase, then by revision", () => {
  assertEquals(
    deletionDecision(person("deleted"), {
      confirmation: "anything",
      expectedUpdatedAt: "anything",
    }),
    { status: "already-deleted" },
  );
  assertEquals(
    deletionDecision(person("active"), {
      confirmation: "DELETE Ada",
      expectedUpdatedAt: revision,
    }),
    { status: "confirmation-required" },
  );
  assertEquals(
    deletionDecision(person("active"), {
      confirmation: "DELETE Ada Lovelace",
      expectedUpdatedAt: "2026-08-15T09:00:00.000Z",
    }),
    { status: "stale" },
    "the phrase is checked before the revision",
  );
  assertEquals(
    deletionDecision(person("archived"), {
      confirmation: "DELETE Ada Lovelace",
      expectedUpdatedAt: revision,
    }),
    { status: "proceed" },
    "an archived person can still be deleted",
  );
});

Deno.test("[GAP-047] an edit keeps what it leaves out and clears what it empties", () => {
  assertEquals(
    normalizeEditPersonInput({
      expectedUpdatedAt: revision,
      givenName: "Ada",
      isPartial: false,
    }),
    { expectedUpdatedAt: revision, givenName: "Ada", isPartial: false },
    "an edit naming no description, gender, or deceased state keeps them",
  );
  assertEquals(
    normalizeEditPersonInput({
      description: "  Mathematician  ",
      expectedUpdatedAt: revision,
      genderOptionId: " 00000000-0000-4000-8000-000000000301 ",
      givenName: "Ada",
      isDeceased: true,
      isPartial: false,
    }),
    {
      description: "Mathematician",
      expectedUpdatedAt: revision,
      genderOptionId: "00000000-0000-4000-8000-000000000301",
      givenName: "Ada",
      isDeceased: true,
      isPartial: false,
    },
  );
  assertEquals(
    normalizeEditPersonInput({
      description: "   ",
      expectedUpdatedAt: revision,
      genderOptionId: "",
      givenName: "Ada",
      isDeceased: false,
      isPartial: false,
    }),
    {
      description: "",
      expectedUpdatedAt: revision,
      genderOptionId: "",
      givenName: "Ada",
      isDeceased: false,
      isPartial: false,
    },
    "empty text is kept as the request to clear the value",
  );
});

Deno.test("[GAP-047] an edit bounds the description and names a real option", () => {
  assertEquals(
    validateEditPersonInput({
      description: "x".repeat(2001),
      expectedUpdatedAt: revision,
      givenName: "Ada",
      isPartial: false,
    }),
    { description: "Keep the description to 2,000 characters or fewer." },
  );
  assertEquals(
    validateEditPersonInput({
      expectedUpdatedAt: revision,
      genderOptionId: "not-an-option",
      givenName: "Ada",
      isPartial: false,
    }),
    { genderOptionId: "Choose a gender option from this workspace." },
  );
  assertEquals(
    validateEditPersonInput({
      description: "x".repeat(2000),
      expectedUpdatedAt: revision,
      genderOptionId: "",
      givenName: "Ada",
      isPartial: false,
    }),
    {},
  );
});

Deno.test("[GAP-047] a gender choice must be current unless it is unchanged", () => {
  const current = person("active", {
    genderOptionId: "00000000-0000-4000-8000-000000000301",
  });
  assertEquals(genderChoice(current, undefined, undefined), { status: "keep" });
  assertEquals(genderChoice(current, "", undefined), { status: "clear" });
  assertEquals(
    genderChoice(current, "00000000-0000-4000-8000-000000000301", undefined),
    { status: "keep" },
    "keeping an option that has since been archived is allowed",
  );
  const requested = "00000000-0000-4000-8000-000000000302";
  assertEquals(genderChoice(current, requested, undefined), {
    status: "inspect",
  });
  assertEquals(genderChoice(current, requested, { status: "not-found" }), {
    errors: { genderOptionId: "Choose a gender option from this workspace." },
    status: "validation-error",
  });
  assertEquals(
    genderChoice(current, requested, { archived: true, status: "ready" }),
    {
      errors: {
        genderOptionId:
          "That gender option was archived. Choose a current option.",
      },
      status: "validation-error",
    },
  );
  assertEquals(
    genderChoice(current, requested, { archived: false, status: "ready" }),
    { status: "set" },
  );
});
