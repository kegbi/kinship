import {
  keepsRecordedInstant,
  LIFE_EVENT_NAME_MAX,
  LIFE_EVENT_NOTE_MAX,
  normalizeLifeEvent,
  validateLifeEvent,
} from "./life_event_rules.ts";
import { assert } from "../../../testing/assert.ts";

const TYPE_ID = "7d0b0a3e-8f1c-4c4b-9c55-0d9e3c1f2a10";

Deno.test("[JOURNAL-002] a life event keeps only trimmed text and the components it names", () => {
  const value = normalizeLifeEvent({
    month: 6,
    name: "  Moved to Lisbon  ",
    note: "   ",
    precision: "year_month",
    year: 2019,
  });
  assert(
    JSON.stringify(value) ===
      JSON.stringify({
        month: 6,
        name: "Moved to Lisbon",
        precision: "year_month",
        year: 2019,
      }),
    `the normalized event was ${JSON.stringify(value)}`,
  );
  const typed = normalizeLifeEvent({
    note: " Graduated with honours ",
    precision: "unknown",
    typeId: TYPE_ID.toUpperCase(),
  });
  assert(
    typed.typeId === TYPE_ID && typed.note === "Graduated with honours" &&
      typed.name === undefined,
    "a type identifier is canonical and a note is trimmed",
  );
  assert(
    normalizeLifeEvent({ day: 4, name: "Born", precision: "day" }).day === 4,
    "a day the precision names is kept",
  );
  const unparsable = normalizeLifeEvent({
    precision: "unknown",
    typeId: " not-a-type ",
  });
  assert(
    unparsable.typeId === "not-a-type" &&
      validateLifeEvent(unparsable).typeId ===
        "Choose a life-event type from this workspace.",
    "a type that is not an identifier is kept as written and refused",
  );
});

Deno.test("[JOURNAL-002] a life event needs a name or a type and a date its precision describes", () => {
  assert(
    Object.keys(validateLifeEvent({ name: "Born", precision: "unknown" }))
      .length === 0,
    "a named event with an unknown date is valid",
  );
  assert(
    Object.keys(
      validateLifeEvent({
        day: 29,
        month: 2,
        precision: "full",
        typeId: TYPE_ID,
        year: 2024,
      }),
    ).length === 0,
    "a typed event on a real date is valid",
  );
  const unnamed = validateLifeEvent({ precision: "unknown" });
  assert(
    unnamed.name === "Enter a name or choose a type.",
    "an event with neither a name nor a type is refused",
  );
  const contradicted = validateLifeEvent({
    month: 2,
    name: "Moved",
    precision: "year",
  });
  assert(
    contradicted.year === "Enter year for year precision." &&
      contradicted.month === "Remove month; it contradicts year precision.",
    "the shared partial-date rule names each contradiction",
  );
  assert(
    validateLifeEvent({
      day: 30,
      month: 2,
      name: "Impossible",
      precision: "month_day",
    }).day === "Enter a real calendar date.",
    "February 30th is refused",
  );
  const long = validateLifeEvent({
    name: "n".repeat(LIFE_EVENT_NAME_MAX + 1),
    note: "x".repeat(LIFE_EVENT_NOTE_MAX + 1),
    precision: "unknown",
  });
  assert(
    long.name === `Use ${LIFE_EVENT_NAME_MAX} characters or fewer.` &&
      long.note === "Use 10,000 characters or fewer.",
    "over-long text is refused field by field",
  );
  assert(
    validateLifeEvent({ precision: "unknown", typeId: "not-a-type" }).typeId ===
      "Choose a life-event type from this workspace.",
    "a type that is not an identifier is refused",
  );
});

Deno.test("[JOURNAL-002] a recorded instant survives only an edit that keeps its date", () => {
  const before = {
    day: 4,
    happenedAt: "1990-03-04T10:15:00.000Z",
    month: 3,
    precision: "full" as const,
    year: 1990,
  };
  assert(
    keepsRecordedInstant(before, {
      day: 4,
      month: 3,
      name: "Renamed",
      precision: "full",
      year: 1990,
    }),
    "renaming the event keeps the instant it was recorded at",
  );
  assert(
    !keepsRecordedInstant(before, {
      day: 5,
      month: 3,
      precision: "full",
      year: 1990,
    }),
    "moving the event to another day drops the instant",
  );
  assert(
    !keepsRecordedInstant(before, { precision: "year", year: 1990 }),
    "changing the precision drops the instant",
  );
  assert(
    !keepsRecordedInstant(
      { precision: "year", year: 1990 },
      { precision: "year", year: 1990 },
    ),
    "an event recorded without an instant gains none",
  );
});
