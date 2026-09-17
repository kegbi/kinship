import { assertEquals } from "../../../testing/assert.ts";
import {
  type CreateReminderInput,
  MAXIMUM_TITLE_LENGTH,
  OCCURRENCE_WINDOW,
  occurrenceCount,
  REMINDER_ID_NAMESPACE,
  type ReminderDefinitionRecord,
  reminderMatchesCreate,
  validateCreateReminder,
} from "./reminder_rules.ts";

const personId = "10000000-0000-4000-8000-000000000001";
const requestId = "10000000-0000-4000-8000-000000000002";

function proposal(
  overrides: Partial<CreateReminderInput> = {},
): CreateReminderInput {
  return {
    anchorOn: "2026-05-04",
    personId,
    recurrenceInterval: 1,
    recurrenceUnit: "year",
    requestId,
    sendTime: "09:00",
    title: "  Call Ada  ",
    ...overrides,
  };
}

function stored(
  overrides: Partial<ReminderDefinitionRecord> = {},
): ReminderDefinitionRecord {
  return {
    anchorOn: "2026-05-04",
    createdAt: "2026-01-01T00:00:00.000000Z",
    id: "10000000-0000-4000-8000-000000000003",
    isActive: true,
    personId,
    recurrenceInterval: 1,
    recurrenceUnit: "year",
    sendTime: "09:00:00",
    title: "Call Ada",
    updatedAt: "2026-01-01T00:00:00.000000Z",
    ...overrides,
  };
}

Deno.test("[GAP-016] a well-formed reminder proposal is canonicalized, not merely accepted", () => {
  assertEquals(REMINDER_ID_NAMESPACE, "kinship.planning.reminder-id.v1");
  assertEquals(MAXIMUM_TITLE_LENGTH, 500);
  assertEquals(validateCreateReminder(proposal()), {
    errors: {},
    sendTime: "09:00:00",
    title: "Call Ada",
  });
  assertEquals(
    validateCreateReminder(proposal({ title: "x".repeat(500) })).errors,
    {},
    "a title of exactly the maximum length is accepted",
  );
});

Deno.test("[GAP-016] a reminder proposal names every field it rejects", () => {
  assertEquals(
    validateCreateReminder(proposal({
      anchorOn: "not-a-date",
      personId: "nobody",
      recurrenceInterval: 0,
      requestId: "nothing",
      sendTime: "25:00",
      title: "   ",
    })),
    {
      errors: {
        title: "Add a title of at most 500 characters.",
        personId: "Choose a person from this workspace.",
        requestId: "Use a canonical request identifier.",
        anchorOn: "Choose a calendar date.",
        sendTime: "Choose a local delivery time.",
        recurrenceInterval: "Choose an interval from 1 to 100.",
      },
    },
  );
  assertEquals(
    validateCreateReminder(proposal({ title: "x".repeat(501) })).errors.title,
    "Add a title of at most 500 characters.",
  );
  assertEquals(
    validateCreateReminder(proposal({ recurrenceInterval: 101 })).errors
      .recurrenceInterval,
    "Choose an interval from 1 to 100.",
  );
});

Deno.test("[GAP-016] a date that is shaped right but does not exist is refused", () => {
  assertEquals(
    validateCreateReminder(proposal({ anchorOn: "2026-02-30" })).errors
      .anchorOn,
    "Choose a valid calendar date.",
  );
  assertEquals(
    validateCreateReminder(proposal({ anchorOn: "2026-13-01" })).errors
      .anchorOn,
    "Choose a valid calendar date.",
  );
  assertEquals(
    validateCreateReminder(proposal({ anchorOn: "2028-02-29" })).errors,
    {},
    "a leap day that exists is a calendar date",
  );
});

Deno.test("[GAP-016] a replayed request matches only the reminder it asked for", () => {
  const input = proposal({ personId: personId.toUpperCase() });
  const checked = validateCreateReminder(input);
  assertEquals(
    reminderMatchesCreate(stored(), input, checked),
    true,
    "the person identifier is compared case-folded",
  );
  for (
    const different of [
      stored({ title: "Call Grace" }),
      stored({ anchorOn: "2026-05-05" }),
      stored({ sendTime: "10:00:00" }),
      stored({ recurrenceUnit: "month" }),
      stored({ recurrenceInterval: 2 }),
      stored({ personId: "10000000-0000-4000-8000-000000000009" }),
    ]
  ) {
    assertEquals(
      reminderMatchesCreate(different, input, checked),
      false,
      "a differing reminder is a conflict, not a replay",
    );
  }
});

Deno.test("[GAP-016] a one-off reminder mints one occurrence and a repeating one a window", () => {
  assertEquals(OCCURRENCE_WINDOW, 8);
  assertEquals(occurrenceCount("none"), 1);
  for (const unit of ["day", "week", "month", "year"] as const) {
    assertEquals(occurrenceCount(unit), OCCURRENCE_WINDOW);
  }
});
