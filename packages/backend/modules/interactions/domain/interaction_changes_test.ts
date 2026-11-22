import {
  changedFields,
  type CheckedInteractionChange,
  occurrenceOf,
  participantsOf,
  validateInteractionChange,
  validateInteractionRemoval,
} from "./interaction_changes.ts";
import { assert, assertEquals } from "../../../testing/assert.ts";
import type { StoredCommunication } from "./communication_rules.ts";
import type { StoredInteraction } from "./interaction_rules.ts";

const id = "00000000-0000-8000-8000-0000000000aa";
const ada = "00000000-0000-4000-8000-0000000001AB";
const grace = "00000000-0000-4000-8000-0000000001cd";
const typeId = "00000000-0000-4000-8000-0000000002ab";
const emotionId = "00000000-0000-4000-8000-0000000003ab";
const revision = "2026-08-17T12:30:00.123456Z";

function checked(
  result: ReturnType<typeof validateInteractionChange>,
): CheckedInteractionChange {
  if ("errors" in result) {
    throw new Error(`unexpected errors ${JSON.stringify(result.errors)}`);
  }
  return result;
}

function errors(
  result:
    | ReturnType<typeof validateInteractionChange>
    | ReturnType<typeof validateInteractionRemoval>,
): Readonly<Record<string, string>> {
  assert("errors" in result, "the input was refused");
  return (result as { errors: Record<string, string> }).errors;
}

Deno.test("[MCP-D1] a change names a canonical record, a revision, and at least one field", () => {
  assertEquals(
    Object.keys(errors(
      validateInteractionChange("not-an-id", {
        expectedUpdatedAt: "yesterday",
        kind: "note",
      }),
    )).sort(),
    ["change", "expectedUpdatedAt", "interactionId"],
  );
  const note = checked(
    validateInteractionChange(id.toUpperCase(), {
      expectedUpdatedAt: "2026-08-17T14:30:00.123456+02:00",
      isFavorited: true,
      kind: "note",
    }),
  );
  assertEquals(note.id, id, "the record id is canonical");
  assertEquals(note.expectedUpdatedAt, revision, "the revision is canonical");
  assertEquals(note.change, { isFavorited: true, kind: "note" });
  assertEquals(
    errors(
      validateInteractionChange(id, {
        expectedUpdatedAt: "2026-08-17T12:30:00.1234567Z",
        body: "x",
        kind: "note",
      }),
    ).expectedUpdatedAt,
    "Refresh this interaction before saving.",
    "an over-precise revision is refused rather than truncated",
  );
});

Deno.test("[MCP-D1] a note edit applies the create bounds to its body", () => {
  assertEquals(
    checked(validateInteractionChange(id, {
      body: "  Reference  ",
      expectedUpdatedAt: revision,
      kind: "note",
    })).change,
    { body: "Reference", kind: "note" },
  );
  for (const body of ["   ", "x".repeat(10_001)]) {
    assert(
      errors(validateInteractionChange(id, {
        body,
        expectedUpdatedAt: revision,
        kind: "note",
      })).body !== undefined,
      `body ${body.length} refused`,
    );
  }
});

Deno.test("[MCP-D1] an activity edit canonicalises lists, clears nullable fields, and keeps the create bounds", () => {
  const activity = checked(validateInteractionChange(id, {
    activityTypeId: null,
    description: null,
    emotionIds: [emotionId, emotionId.toUpperCase()],
    expectedUpdatedAt: revision,
    happenedAt: "2026-08-16T20:15:00+02:00",
    kind: "activity",
    participantIds: [grace, ada, ada],
    summary: " Dinner ",
  }));
  assertEquals(activity.change, {
    activityTypeId: null,
    description: null,
    emotionIds: [emotionId],
    happenedAt: new Date("2026-08-16T18:15:00.000Z"),
    kind: "activity",
    participantIds: [ada.toLowerCase(), grace].sort(),
    summary: "Dinner",
  });
  assertEquals(
    checked(validateInteractionChange(id, {
      activityTypeId: typeId.toUpperCase(),
      description: " Long talk ",
      emotionIds: [],
      expectedUpdatedAt: revision,
      kind: "activity",
    })).change,
    {
      activityTypeId: typeId,
      description: "Long talk",
      emotionIds: [],
      kind: "activity",
    },
  );
  assertEquals(
    Object.keys(errors(validateInteractionChange(id, {
      activityTypeId: "type",
      description: "x".repeat(10_001),
      emotionIds: Array.from(
        { length: 21 },
        (_, index) =>
          `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      ),
      expectedUpdatedAt: revision,
      happenedAt: "soon",
      kind: "activity",
      participantIds: [],
      summary: "x".repeat(501),
    }))).sort(),
    [
      "activityTypeId",
      "description",
      "emotionIds",
      "happenedAt",
      "participantIds",
      "summary",
    ],
  );
  assert(
    errors(validateInteractionChange(id, {
      expectedUpdatedAt: revision,
      kind: "activity",
      participantIds: Array.from(
        { length: 51 },
        (_, index) =>
          `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      ),
    })).participantIds !== undefined,
    "more than 50 participants refused",
  );
  assert(
    errors(validateInteractionChange(id, {
      emotionIds: ["joy"],
      expectedUpdatedAt: revision,
      kind: "activity",
    })).emotionIds !== undefined,
    "a non-canonical emotion refused",
  );
});

Deno.test("[MCP-R3] an activity edit may name a person whose identifier was derived", () => {
  // `id` is itself a derived (version 8) identifier, as a person a DAV sync
  // or a retry-safe create made would carry.
  const derived = "8e5213b9-8cee-8024-8aed-45319d1b7d1b";
  assertEquals(
    checked(validateInteractionChange(id, {
      expectedUpdatedAt: revision,
      kind: "activity",
      participantIds: [ada, derived.toUpperCase()],
    })).change,
    {
      kind: "activity",
      participantIds: [ada.toLowerCase(), derived].sort(),
    },
  );
  assertEquals(
    Object.keys(errors(validateInteractionChange(id, {
      expectedUpdatedAt: revision,
      kind: "activity",
      participantIds: [ada, "00000000-0000-9000-8000-000000000001"],
    }))),
    ["participantIds"],
  );
});

Deno.test("[MCP-D1] a call edit keeps its bounds and may clear its content", () => {
  assertEquals(
    checked(validateInteractionChange(id, {
      calledAt: "2026-08-16T18:15:00Z",
      contactWasCaller: false,
      content: null,
      emotionIds: [emotionId],
      expectedUpdatedAt: revision,
      kind: "call",
    })).change,
    {
      calledAt: new Date("2026-08-16T18:15:00Z"),
      contactWasCaller: false,
      content: null,
      emotionIds: [emotionId],
      kind: "call",
    },
  );
  assertEquals(
    checked(validateInteractionChange(id, {
      content: " Plans ",
      expectedUpdatedAt: revision,
      kind: "call",
    })).change,
    { content: "Plans", kind: "call" },
  );
  assertEquals(
    Object.keys(errors(validateInteractionChange(id, {
      calledAt: "later",
      content: " ",
      emotionIds: ["x"],
      expectedUpdatedAt: revision,
      kind: "call",
    }))).sort(),
    ["calledAt", "content", "emotionIds"],
  );
});

Deno.test("[MCP-D1] a conversation edit replaces its canonical messages within the create bounds", () => {
  const conversation = checked(validateInteractionChange(id, {
    channelTypeId: typeId.toUpperCase(),
    contactMethodId: null,
    expectedUpdatedAt: revision,
    happenedAt: "2026-08-16T18:15:00Z",
    kind: "conversation",
    messages: [
      {
        content: " Later ",
        direction: "inbound",
        writtenAt: "2026-08-16T19:00:00Z",
      },
      {
        content: "Hello",
        direction: "outbound",
        writtenAt: "2026-08-16T18:15:00Z",
      },
    ],
    title: null,
  }));
  assertEquals(conversation.change, {
    channelTypeId: typeId,
    contactMethodId: null,
    happenedAt: new Date("2026-08-16T18:15:00Z"),
    kind: "conversation",
    messages: [
      {
        content: "Hello",
        direction: "outbound",
        writtenAt: "2026-08-16T18:15:00.000Z",
      },
      {
        content: "Later",
        direction: "inbound",
        writtenAt: "2026-08-16T19:00:00.000Z",
      },
    ],
    title: null,
  });
  assertEquals(
    checked(validateInteractionChange(id, {
      contactMethodId: typeId,
      expectedUpdatedAt: revision,
      kind: "conversation",
      messages: [],
      title: " Plans ",
    })).change,
    {
      contactMethodId: typeId,
      kind: "conversation",
      messages: [],
      title: "Plans",
    },
  );
  assertEquals(
    Object.keys(errors(validateInteractionChange(id, {
      channelTypeId: "email",
      contactMethodId: "phone",
      expectedUpdatedAt: revision,
      happenedAt: "never",
      kind: "conversation",
      messages: [{ content: " ", direction: "inbound", writtenAt: "x" }],
      title: "x".repeat(501),
    }))).sort(),
    ["channelTypeId", "contactMethodId", "happenedAt", "messages", "title"],
  );
  assert(
    errors(validateInteractionChange(id, {
      expectedUpdatedAt: revision,
      kind: "conversation",
      messages: Array.from({ length: 51 }, () => ({
        content: "Hi",
        direction: "inbound" as const,
        writtenAt: "2026-08-16T18:15:00Z",
      })),
    })).messages !== undefined,
    "more than 50 messages refused",
  );
});

Deno.test("[MCP-D1] a removal names a canonical record and revision", () => {
  assertEquals(validateInteractionRemoval(id.toUpperCase(), revision), {
    expectedUpdatedAt: revision,
    id,
  });
  assertEquals(
    Object.keys(errors(validateInteractionRemoval("x", "y"))).sort(),
    ["expectedUpdatedAt", "interactionId"],
  );
});

Deno.test("[MCP-D1] the changed fields, people, and occurrence follow what was supplied", () => {
  const activity: StoredInteraction = {
    createdAt: revision,
    emotionIds: [],
    happenedAt: "2026-08-16T18:15:00.000Z",
    id,
    kind: "activity",
    participantIds: [ada.toLowerCase()],
    summary: "Dinner",
  };
  const note: StoredInteraction = {
    body: "Reference",
    createdAt: revision,
    id,
    isFavorited: false,
    kind: "note",
    personId: grace,
  };
  const call: StoredCommunication = {
    calledAt: "2026-08-15T18:15:00.000Z",
    contactWasCaller: true,
    createdAt: revision,
    emotionIds: [],
    id,
    kind: "call",
    personId: grace,
  };
  const conversation: StoredCommunication = {
    createdAt: revision,
    happenedAt: "2026-08-14T18:15:00.000Z",
    id,
    kind: "conversation",
    messages: [],
    personId: grace,
  };
  const moved = checked(validateInteractionChange(id, {
    expectedUpdatedAt: revision,
    happenedAt: "2026-08-20T10:00:00Z",
    kind: "activity",
    participantIds: [grace],
    summary: "Lunch",
  })).change;
  assertEquals(changedFields(moved), [
    "happenedAt",
    "participantIds",
    "summary",
  ]);
  assertEquals(occurrenceOf(activity, moved), "2026-08-20T10:00:00.000Z");
  const unchanged = { kind: "activity", summary: "Lunch" } as const;
  assertEquals(participantsOf(activity), [ada.toLowerCase()]);
  assertEquals(occurrenceOf(activity, unchanged), activity.happenedAt);
  assertEquals(participantsOf(note), [grace]);
  assertEquals(occurrenceOf(note, { body: "x", kind: "note" }), undefined);
  assertEquals(
    occurrenceOf(call, {
      calledAt: new Date("2026-08-21T00:00:00Z"),
      kind: "call",
    }),
    "2026-08-21T00:00:00.000Z",
  );
  assertEquals(occurrenceOf(call, { kind: "call" }), call.calledAt);
  assertEquals(
    occurrenceOf(conversation, { kind: "conversation", title: null }),
    conversation.happenedAt,
  );
  assertEquals(participantsOf(conversation), [grace]);
});
