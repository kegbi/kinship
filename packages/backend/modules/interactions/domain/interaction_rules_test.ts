import { assert, assertEquals } from "../../../testing/assert.ts";
import {
  canonicalUuid,
  type CheckedInteraction,
  deriveInteractionId,
  expectedInteraction,
  isClientUuid,
  matchesExpected,
  type RecordInteractionInput,
  replayedActivity,
  replayedNote,
  type StoredActivity,
  type StoredNote,
  validateInteraction,
} from "./interaction_rules.ts";

const workspaceId = "10000000-0000-4000-8000-000000000003";
const requestId = "20000000-0000-4000-8000-0000000000ab";
const personA = "30000000-0000-4000-8000-000000000001";
const personB = "30000000-0000-4000-8000-000000000002";
const activityTypeId = "40000000-0000-4000-8000-000000000001";
const emotionA = "50000000-0000-4000-8000-000000000001";
const emotionB = "50000000-0000-4000-8000-000000000002";
const interactionId = "8e5213b9-8cee-8024-8aed-45319d1b7d1b";
const memberId = "60000000-0000-4000-8000-000000000001";

function activityInput(
  overrides: Partial<Extract<RecordInteractionInput, { kind: "activity" }>> =
    {},
): RecordInteractionInput {
  return {
    happenedAt: "2026-03-04T10:00:00.000Z",
    kind: "activity",
    participantIds: [personA],
    requestId,
    summary: "Coffee",
    ...overrides,
  };
}

function noteInput(
  overrides: Partial<Extract<RecordInteractionInput, { kind: "note" }>> = {},
): RecordInteractionInput {
  return {
    body: "Remembered the birthday",
    kind: "note",
    personId: personA,
    requestId,
    ...overrides,
  };
}

function checked(overrides: Partial<CheckedInteraction> = {}) {
  const validated = validateInteraction(activityInput());
  assert(!("errors" in validated), "the baseline activity input is valid");
  return { ...validated, ...overrides };
}

function storedActivity(
  overrides: Partial<StoredActivity> = {},
): StoredActivity {
  return {
    createdAt: "2026-03-04T10:05:00.000000Z",
    createdByMemberId: memberId,
    emotionIds: [],
    happenedAt: "2026-03-04T10:00:00.000Z",
    id: interactionId,
    kind: "activity",
    participantIds: [personA],
    summary: "Coffee",
    ...overrides,
  };
}

function storedNote(overrides: Partial<StoredNote> = {}): StoredNote {
  return {
    body: "Remembered the birthday",
    createdAt: "2026-03-04T10:05:00.000000Z",
    createdByMemberId: memberId,
    id: interactionId,
    isFavorited: false,
    kind: "note",
    personId: personA,
    ...overrides,
  };
}

Deno.test("[GAP-017] the aggregate identifier a request derives is fixed for all time", async () => {
  assertEquals(
    await deriveInteractionId(workspaceId, requestId),
    "8e5213b9-8cee-8024-8aed-45319d1b7d1b",
    "the derivation is a replay contract and may never move",
  );
  assertEquals(
    await deriveInteractionId(
      workspaceId.toUpperCase(),
      requestId.toUpperCase(),
    ),
    "8e5213b9-8cee-8024-8aed-45319d1b7d1b",
    "a client that re-sends the request in another case lands on its own row",
  );
  assert(
    await deriveInteractionId(workspaceId, personA) !==
      await deriveInteractionId(workspaceId, requestId),
    "two requests in one workspace derive two identifiers",
  );
  assert(
    await deriveInteractionId(personA, requestId) !==
      await deriveInteractionId(workspaceId, requestId),
    "one request in two workspaces derives two identifiers",
  );
});

Deno.test("[GAP-017] a derived identifier is not an identifier a client may name", () => {
  assert(isClientUuid(requestId), "a version 4 identifier is a client's");
  assert(
    !isClientUuid(interactionId),
    "the version 8 identifier this module derives is refused as an input",
  );
  assert(!isClientUuid("not-a-uuid"), "nonsense is refused");
  assert(
    isClientUuid(requestId.toUpperCase()),
    "case is a spelling, not a difference",
  );
  assertEquals(canonicalUuid(requestId.toUpperCase()), requestId);
});

Deno.test("[GAP-017] a note needs a body, a person, and a request identifier", () => {
  assertEquals(validateInteraction(noteInput()), {
    body: "Remembered the birthday",
    emotionIds: [],
    participantIds: [personA],
    requestId,
  });
  assertEquals(
    validateInteraction(noteInput({ body: "   " })),
    { errors: { body: "Write a note of at most 10,000 characters." } },
  );
  assertEquals(
    validateInteraction(noteInput({ body: "x".repeat(10_001) })),
    { errors: { body: "Write a note of at most 10,000 characters." } },
  );
  assertEquals(
    validateInteraction(noteInput({ personId: "nobody" })),
    { errors: { personId: "Choose one person from this workspace." } },
  );
  assertEquals(
    validateInteraction(noteInput({ requestId: "again" })),
    { errors: { requestId: "Use a canonical request identifier." } },
  );
});

Deno.test("[GAP-017] a note keeps its trimmed body and the person as its participant", () => {
  assertEquals(
    validateInteraction(
      noteInput({ body: "  spaced  ", personId: personA.toUpperCase() }),
    ),
    {
      body: "spaced",
      emotionIds: [],
      participantIds: [personA],
      requestId,
    },
  );
});

Deno.test("[GAP-017] an activity canonicalises its people, emotions, and type", () => {
  const validated = validateInteraction(activityInput({
    activityTypeId: activityTypeId.toUpperCase(),
    description: "  Long chat  ",
    emotionIds: [emotionB, emotionA, emotionB],
    participantIds: [personB, personA, personB],
    summary: "  Coffee  ",
  }));
  assert(!("errors" in validated), "the input is valid");
  assertEquals(validated, {
    activityTypeId,
    description: "Long chat",
    emotionIds: [emotionA, emotionB],
    happenedAt: new Date("2026-03-04T10:00:00.000Z"),
    participantIds: [personA, personB],
    requestId,
    summary: "Coffee",
  });
});

Deno.test("[GAP-017] an activity names every field it got wrong at once", () => {
  assertEquals(
    validateInteraction(activityInput({
      activityTypeId: "type",
      description: "   ",
      emotionIds: ["feeling"],
      happenedAt: "sometime",
      participantIds: [],
      summary: "   ",
    })),
    {
      errors: {
        summary: "Add a summary of at most 500 characters.",
        description: "Details must be at most 10,000 characters.",
        happenedAt: "Choose a valid occurrence time.",
        participantIds: "Choose between 1 and 50 valid people.",
        emotionIds: "Choose at most 20 active emotions.",
        activityTypeId: "Choose an active activity type.",
      },
    },
  );
});

Deno.test("[GAP-017] an activity bounds its lists and its text", () => {
  const many = (count: number, offset: number) =>
    Array.from(
      { length: count },
      (_, index) =>
        `30000000-0000-4000-8000-${String(index + offset).padStart(12, "0")}`,
    );
  assertEquals(
    "errors" in validateInteraction(
      activityInput({ participantIds: many(50, 100) }),
    ),
    false,
    "fifty people are still a gathering",
  );
  assertEquals(
    validateInteraction(activityInput({ participantIds: many(51, 100) })),
    { errors: { participantIds: "Choose between 1 and 50 valid people." } },
  );
  assertEquals(
    validateInteraction(activityInput({ emotionIds: many(21, 200) })),
    { errors: { emotionIds: "Choose at most 20 active emotions." } },
  );
  assertEquals(
    validateInteraction(activityInput({ summary: "x".repeat(501) })),
    { errors: { summary: "Add a summary of at most 500 characters." } },
  );
  assertEquals(
    validateInteraction(
      activityInput({ description: "x".repeat(10_001) }),
    ),
    { errors: { description: "Details must be at most 10,000 characters." } },
  );
});

Deno.test("[GAP-017] the evidence a replay must match is the request's own", () => {
  assertEquals(
    expectedInteraction(activityInput(), checked()),
    {
      emotionIds: [],
      happenedAt: new Date("2026-03-04T10:00:00.000Z"),
      kind: "activity",
      participantIds: [personA],
      summary: "Coffee",
    },
  );
  assertEquals(
    expectedInteraction(
      activityInput({ activityTypeId, description: "Long chat" }),
      checked({ activityTypeId, description: "Long chat" }),
    ),
    {
      activityTypeId,
      description: "Long chat",
      emotionIds: [],
      happenedAt: new Date("2026-03-04T10:00:00.000Z"),
      kind: "activity",
      participantIds: [personA],
      summary: "Coffee",
    },
  );
  assertEquals(
    expectedInteraction(noteInput(), {
      body: "Remembered the birthday",
      emotionIds: [],
      participantIds: [personA],
      requestId,
    }),
    {
      body: "Remembered the birthday",
      isFavorited: false,
      kind: "note",
      personId: personA,
    },
  );
  assertEquals(
    expectedInteraction(noteInput({ isFavorited: true }), {
      body: "Remembered the birthday",
      emotionIds: [],
      participantIds: [personA],
      requestId,
    }),
    {
      body: "Remembered the birthday",
      isFavorited: true,
      kind: "note",
      personId: personA,
    },
    "a favourited note expects a favourited row",
  );
});

Deno.test("[GAP-017] a retry is the same request only when every field agrees", () => {
  const expected = expectedInteraction(
    activityInput({
      activityTypeId,
      description: "Long chat",
      emotionIds: [emotionA],
    }),
    checked({
      activityTypeId,
      description: "Long chat",
      emotionIds: [emotionA],
    }),
  );
  const stored = storedActivity({
    activityTypeId,
    description: "Long chat",
    emotionIds: [emotionA],
    happenedAt: new Date("2026-03-04T10:00:00.000Z").toISOString(),
  });
  assert(matchesExpected(stored, expected, memberId), "the retry matches");
  assert(
    !matchesExpected(stored, expected, personB),
    "another member's row is never this request",
  );
  for (
    const [name, difference] of [
      ["description", { description: "Short chat" }],
      ["happenedAt", { happenedAt: "2026-03-04T11:00:00.000Z" }],
      ["summary", { summary: "Tea" }],
      ["participantIds", { participantIds: [personA, personB] }],
      ["emotionIds", { emotionIds: [emotionA, emotionB] }],
    ] as readonly [string, Partial<StoredActivity>][]
  ) {
    assert(
      !matchesExpected({ ...stored, ...difference }, expected, memberId),
      `a differing ${name} is a different request`,
    );
  }
  assert(
    !matchesExpected(
      storedActivity({
        description: "Long chat",
        emotionIds: [emotionA],
        happenedAt: new Date("2026-03-04T10:00:00.000Z").toISOString(),
      }),
      expected,
      memberId,
    ),
    "a row with no activity type is not a request that named one",
  );
  assert(
    !matchesExpected(storedNote(), expected, memberId),
    "a note is never an activity",
  );
});

Deno.test("[GAP-017] a stored note is the same request when body, person, and favourite agree", () => {
  const expected = expectedInteraction(noteInput({ isFavorited: true }), {
    body: "Remembered the birthday",
    emotionIds: [],
    participantIds: [personA],
    requestId,
  });
  assert(
    matchesExpected(storedNote({ isFavorited: true }), expected, memberId),
    "the retry matches",
  );
  assert(
    !matchesExpected(storedNote(), expected, memberId),
    "a note that was not favourited is a different request",
  );
  assert(
    !matchesExpected(
      storedNote({ isFavorited: true, personId: personB }),
      expected,
      memberId,
    ),
    "a note about somebody else is a different request",
  );
  assert(
    !matchesExpected(
      storedNote({ body: "Something else", isFavorited: true }),
      expected,
      memberId,
    ),
    "a different body is a different request",
  );
});

Deno.test("[GAP-017] a replayed activity reads with the names the caller just resolved", () => {
  assertEquals(
    replayedActivity(
      storedActivity({ description: "Long chat", emotionIds: [emotionA] }),
      interactionId,
      {
        activityType: { id: activityTypeId, name: "Coffee" },
        emotions: [{ id: emotionA, name: "Happy" }],
      },
      [{ id: personA, name: "Ada" }],
    ),
    {
      activityType: "Coffee",
      createdAt: "2026-03-04T10:05:00.000000Z",
      description: "Long chat",
      emotions: [{ id: emotionA, name: "Happy" }],
      happenedAt: "2026-03-04T10:00:00.000Z",
      id: interactionId,
      kind: "activity",
      participants: [{ id: personA, name: "Ada" }],
      summary: "Coffee",
    },
  );
  assertEquals(
    replayedActivity(
      storedActivity(),
      interactionId,
      { emotions: [] },
      [{ id: personA, name: "Ada" }],
    ),
    {
      createdAt: "2026-03-04T10:05:00.000000Z",
      emotions: [],
      happenedAt: "2026-03-04T10:00:00.000Z",
      id: interactionId,
      kind: "activity",
      participants: [{ id: personA, name: "Ada" }],
      summary: "Coffee",
    },
    "an activity with no type and no details names neither",
  );
});

Deno.test("[GAP-017] a replayed note reads against the person it was written about", () => {
  assertEquals(
    replayedNote(storedNote({ isFavorited: true }), interactionId, {
      id: personA,
      name: "Ada",
    }),
    {
      body: "Remembered the birthday",
      createdAt: "2026-03-04T10:05:00.000000Z",
      id: interactionId,
      isFavorited: true,
      kind: "note",
      person: { id: personA, name: "Ada" },
    },
  );
});
