import { assertEquals } from "../../../testing/assert.ts";
import {
  isSection,
  normalizedMutation,
  PERSONALIZATION_SECTIONS,
  type PersonalizationMutation,
  type PersonalizationSection,
} from "./personalization_rules.ts";

/** A mutation written the way a caller might, including wrongly. */
function mutation(value: Record<string, unknown>): PersonalizationMutation {
  return value as unknown as PersonalizationMutation;
}

function normalized(
  section: PersonalizationSection,
  value: Record<string, unknown>,
): PersonalizationMutation | undefined {
  return normalizedMutation(section, mutation(value));
}

Deno.test("[GAP-018] eleven sections, and nothing else is one", () => {
  assertEquals(PERSONALIZATION_SECTIONS.length, 11);
  for (const section of PERSONALIZATION_SECTIONS) {
    assertEquals(isSection(section), true, section);
  }
  assertEquals(isSection("people"), false);
  assertEquals(isSection(""), false);
});

Deno.test("[GAP-018] a fixed vocabulary takes no creations and no deletions", () => {
  for (const section of ["emotion-options", "pet-categories"] as const) {
    assertEquals(
      normalized(section, {
        action: "delete",
        expectedUpdatedAt: "2026-03-01T10:00:00.000Z",
        id: "e1",
      }),
      undefined,
      `${section} cannot be deleted from`,
    );
    assertEquals(
      normalized(section, { action: "create", name: "New", sortOrder: 1 }),
      undefined,
      `${section} cannot be added to`,
    );
    assertEquals(
      normalized(section, {
        action: "update",
        expectedUpdatedAt: "2026-03-01T10:00:00.000Z",
        id: "e1",
        name: "New",
      }),
      undefined,
      `${section} cannot be changed`,
    );
  }
});

Deno.test("[GAP-018] a delete carries the entry, the version, and at most a replacement", () => {
  const request = {
    action: "delete" as const,
    expectedUpdatedAt: "2026-03-01T10:00:00.000Z",
    id: "t1",
  };
  assertEquals(normalized("tags", request), request);
  assertEquals(
    normalized("tags", { ...request, replacementId: "t2" }),
    { ...request, replacementId: "t2" },
  );
  assertEquals(
    normalized("tags", { ...request, name: "New" }),
    undefined,
    "a delete does not also rename",
  );
});

Deno.test("[GAP-018] a position has to be one a list has", () => {
  const base = { action: "create" as const, name: "New" };
  assertEquals(
    normalized("profile-modules", { ...base, sortOrder: 0 })?.action,
    "create",
  );
  assertEquals(
    normalized("profile-modules", { ...base, sortOrder: 10_000 })?.action,
    "create",
  );
  for (const sortOrder of [-1, 1.5, 10_001, Number.NaN, "3"]) {
    assertEquals(
      normalized("profile-modules", { ...base, sortOrder }),
      undefined,
      `a position of ${sortOrder} is refused`,
    );
  }
  assertEquals(
    normalized("profile-modules", base),
    undefined,
    "a creation has to say where it goes",
  );
  assertEquals(
    normalized("profile-modules", {
      action: "update",
      expectedUpdatedAt: "v",
      id: "p1",
      sortOrder: -1,
    }),
    undefined,
  );
});

Deno.test("[GAP-018] an unordered section is created at the front or not at all", () => {
  for (const section of ["contact-labels", "tags"] as const) {
    assertEquals(
      normalized(section, { action: "create", name: "New", sortOrder: 0 }),
      { action: "create", name: "New", sortOrder: 0 },
    );
    assertEquals(
      normalized(section, { action: "create", name: "New", sortOrder: 1 }),
      undefined,
      `${section} has no order to choose`,
    );
  }
});

Deno.test("[GAP-018] a creation may only carry the fields its section has", () => {
  assertEquals(
    normalized("reminder-rules", {
      action: "create",
      daysBefore: 7,
      sortOrder: 1,
    }),
    { action: "create", daysBefore: 7, sortOrder: 1 },
  );
  assertEquals(
    normalized("reminder-rules", {
      action: "create",
      name: "Week before",
      sortOrder: 1,
    }),
    undefined,
    "a reminder rule is a number of days, not a name",
  );
  assertEquals(
    normalized("reminder-rules", { action: "create", sortOrder: 1 }),
    undefined,
    "and it has to say how many",
  );
  assertEquals(
    normalized("relationship-types", {
      action: "create",
      forwardLabel: "  mentor  ",
      reverseLabel: "  protege  ",
      sortOrder: 2,
    }),
    {
      action: "create",
      forwardLabel: "mentor",
      reverseLabel: "protege",
      sortOrder: 2,
    },
  );
  assertEquals(
    normalized("relationship-types", {
      action: "create",
      name: "mentor",
      sortOrder: 2,
    }),
    undefined,
  );
  assertEquals(
    normalized("relationship-types", {
      action: "create",
      forwardLabel: "mentor",
      sortOrder: 2,
    }),
    undefined,
    "a reciprocal pair needs both sides",
  );
  assertEquals(
    normalized("gender-options", {
      action: "create",
      daysBefore: 1,
      name: "New",
      sortOrder: 1,
    }),
    undefined,
  );
});

Deno.test("[GAP-018] an update has to name something its section can change", () => {
  const version = { expectedUpdatedAt: "2026-03-01T10:00:00.000Z", id: "x1" };
  assertEquals(
    normalized("profile-modules", {
      action: "update",
      ...version,
      isActive: false,
    }),
    { action: "update", ...version, isActive: false },
  );
  assertEquals(
    normalized("profile-modules", { action: "update", ...version }),
    undefined,
    "an update that changes nothing did nothing",
  );
  assertEquals(
    normalized("profile-modules", {
      action: "update",
      ...version,
      isDefault: true,
    }),
    undefined,
    "profile modules have no default",
  );
  assertEquals(
    normalized("contact-labels", {
      action: "update",
      ...version,
      sortOrder: 0,
    }),
    undefined,
    "an unordered section cannot be reordered",
  );
  assertEquals(
    normalized("reminder-rules", {
      action: "update",
      ...version,
      daysBefore: 30,
    }),
    { action: "update", ...version, daysBefore: 30 },
  );
  assertEquals(
    normalized("life-event-types", {
      action: "update",
      ...version,
      name: " Moved ",
    }),
    { action: "update", ...version, name: "Moved" },
  );
  assertEquals(
    normalized("activity-types", {
      action: "update",
      ...version,
      sortOrder: 4,
    }),
    { action: "update", ...version, sortOrder: 4 },
  );
  assertEquals(
    normalized("contact-method-types", {
      action: "update",
      ...version,
      isActive: true,
    }),
    { action: "update", ...version, isActive: true },
  );
  assertEquals(
    normalized("tags", { action: "update", ...version, name: "Mates" }),
    { action: "update", ...version, name: "Mates" },
  );
});

Deno.test("[GAP-018] a default may be set and never cleared", () => {
  const version = { expectedUpdatedAt: "v", id: "g1" };
  assertEquals(
    normalized("gender-options", {
      action: "update",
      ...version,
      isDefault: true,
    }),
    { action: "update", ...version, isDefault: true },
  );
  assertEquals(
    normalized("gender-options", {
      action: "update",
      ...version,
      isDefault: false,
    }),
    undefined,
    "the section always has a default",
  );
});

Deno.test("[GAP-018] a reciprocal pair is renamed on both sides or on neither", () => {
  const version = { expectedUpdatedAt: "v", id: "r1" };
  assertEquals(
    normalized("relationship-types", {
      action: "update",
      ...version,
      forwardLabel: " boss ",
      reverseLabel: " subordinate ",
    }),
    {
      action: "update",
      ...version,
      forwardLabel: "boss",
      reverseLabel: "subordinate",
    },
  );
  assertEquals(
    normalized("relationship-types", {
      action: "update",
      ...version,
      forwardLabel: "boss",
    }),
    undefined,
    "half a rename reads wrongly from one side",
  );
  assertEquals(
    normalized("relationship-types", {
      action: "update",
      ...version,
      reverseLabel: "subordinate",
    }),
    undefined,
  );
  assertEquals(
    normalized("relationship-types", {
      action: "update",
      ...version,
      isActive: false,
    }),
    { action: "update", ...version, isActive: false },
    "disabling one needs no labels at all",
  );
  assertEquals(
    normalized("relationship-types", {
      action: "update",
      ...version,
      forwardLabel: "  ",
      reverseLabel: "subordinate",
    }),
    undefined,
  );
  assertEquals(
    normalized("relationship-types", {
      action: "create",
      forwardLabel: "x".repeat(201),
      reverseLabel: "y",
      sortOrder: 0,
    }),
    undefined,
  );
  assertEquals(
    normalized("relationship-types", {
      action: "create",
      forwardLabel: "x",
      reverseLabel: "y".repeat(201),
      sortOrder: 0,
    }),
    undefined,
  );
});

Deno.test("[GAP-018] a reminder rule looks at most ten years ahead", () => {
  const version = { expectedUpdatedAt: "v", id: "r1" };
  assertEquals(
    normalized("reminder-rules", {
      action: "create",
      daysBefore: 3_650,
      sortOrder: 0,
    })?.action,
    "create",
  );
  for (const daysBefore of [-1, 1.5, 3_651]) {
    assertEquals(
      normalized("reminder-rules", {
        action: "update",
        ...version,
        daysBefore,
      }),
      undefined,
      `${daysBefore} days is refused`,
    );
  }
  assertEquals(
    normalized("reminder-rules", {
      action: "update",
      ...version,
      daysBefore: 0,
    }),
    { action: "update", ...version, daysBefore: 0 },
    "on the day itself is a rule",
  );
});

Deno.test("[GAP-018] a name is trimmed, required on creation, and bounded", () => {
  assertEquals(
    normalized("gender-options", {
      action: "create",
      name: "  Nonbinary  ",
      sortOrder: 1,
    }),
    { action: "create", name: "Nonbinary", sortOrder: 1 },
  );
  assertEquals(
    normalized("gender-options", {
      action: "create",
      name: "   ",
      sortOrder: 1,
    }),
    undefined,
  );
  assertEquals(
    normalized("gender-options", {
      action: "create",
      name: "x".repeat(201),
      sortOrder: 1,
    }),
    undefined,
  );
  const version = { expectedUpdatedAt: "v", id: "g1" };
  assertEquals(
    normalized("gender-options", { action: "update", ...version, name: "  " }),
    undefined,
    "a rename to nothing is not a rename",
  );
  assertEquals(
    normalized("gender-options", {
      action: "update",
      ...version,
      name: "x".repeat(201),
    }),
    undefined,
  );
  assertEquals(
    normalized("gender-options", {
      action: "update",
      ...version,
      isActive: false,
    }),
    { action: "update", ...version, isActive: false },
    "an update with no name at all keeps the name it has",
  );
});
