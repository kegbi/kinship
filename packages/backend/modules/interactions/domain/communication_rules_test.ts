import { assert, assertEquals } from "../../../testing/assert.ts";
import { deterministicId } from "../../../shared-kernel/ids.ts";
import {
  callRecord,
  canonicalEmotionIds,
  canonicalMessages,
  compareMessageValues,
  conversationRecord,
  deriveCommunicationId,
  derivedMessages,
  matchesStored,
  orderMessages,
  type RecordCommunicationInput,
  type StoredCall,
  type StoredConversation,
  validateCommunication,
} from "./communication_rules.ts";

const workspaceId = "10000000-0000-4000-8000-000000000003";
const requestId = "20000000-0000-4000-8000-0000000000ab";
const personId = "30000000-0000-4000-8000-000000000001";
const channelTypeId = "40000000-0000-4000-8000-000000000001";
const contactMethodId = "40000000-0000-4000-8000-000000000002";
const emotionA = "50000000-0000-4000-8000-000000000001";
const emotionB = "50000000-0000-4000-8000-000000000002";
const memberId = "60000000-0000-4000-8000-000000000001";
const callId = "b9de0b70-067d-8cd0-b4c4-2258ca31d1a1";
const conversationId = "7ff47532-184e-806a-83d5-b8599d4239a2";

function callInput(
  overrides: Partial<Extract<RecordCommunicationInput, { kind: "call" }>> = {},
): RecordCommunicationInput {
  return {
    calledAt: "2026-03-04T10:00:00.000Z",
    contactWasCaller: true,
    kind: "call",
    personId,
    requestId,
    ...overrides,
  };
}

function conversationInput(
  overrides: Partial<
    Extract<RecordCommunicationInput, { kind: "conversation" }>
  > = {},
): RecordCommunicationInput {
  return {
    channelTypeId,
    happenedAt: "2026-03-04T10:00:00.000Z",
    kind: "conversation",
    personId,
    requestId,
    ...overrides,
  };
}

Deno.test("[MCP-R3] a call and a conversation name a person whose identifier was derived", async () => {
  // The people module's derivation of a person created with a `requestId`.
  const derived = await deterministicId("kinship.people.external-id.v1", [
    workspaceId,
    requestId,
  ]);
  assert(derived[14] === "8", "the person identifier is a derived one");
  assertEquals(validateCommunication(callInput({ personId: derived })), {});
  assertEquals(
    validateCommunication(
      conversationInput({ personId: derived.toUpperCase() }),
    ),
    {},
  );
  assertEquals(
    validateCommunication(callInput({ personId: "not-a-uuid" })),
    { personId: "Choose one person from this workspace." },
  );
});

function storedCall(overrides: Partial<StoredCall> = {}): StoredCall {
  return {
    calledAt: "2026-03-04T10:00:00.000Z",
    contactWasCaller: true,
    createdAt: "2026-03-04T10:05:00.000000Z",
    createdByMemberId: memberId,
    emotionIds: [],
    id: callId,
    kind: "call",
    personId,
    ...overrides,
  };
}

function storedConversation(
  overrides: Partial<StoredConversation> = {},
): StoredConversation {
  return {
    channelTypeId,
    createdAt: "2026-03-04T10:05:00.000000Z",
    happenedAt: "2026-03-04T10:00:00.000Z",
    id: conversationId,
    kind: "conversation",
    messages: [],
    personId,
    ...overrides,
  };
}

Deno.test("[GAP-017] the identifiers a communication request derives are fixed for all time", async () => {
  assertEquals(
    await deriveCommunicationId("call", workspaceId, requestId),
    "b9de0b70-067d-8cd0-b4c4-2258ca31d1a1",
    "the call derivation is a replay contract and may never move",
  );
  assertEquals(
    await deriveCommunicationId("conversation", workspaceId, requestId),
    "7ff47532-184e-806a-83d5-b8599d4239a2",
    "the conversation derivation is a replay contract and may never move",
  );
  assertEquals(
    await deriveCommunicationId("message-0", workspaceId, requestId),
    "04aa2cb8-dcf8-8cfb-b95c-69838e8dfb75",
    "each message's derivation is a replay contract too",
  );
  assertEquals(
    await deriveCommunicationId("message-1", workspaceId, requestId),
    "96d4c1a4-db79-83b3-aded-174c3dd4f4ea",
  );
  assertEquals(
    await deriveCommunicationId(
      "call",
      workspaceId.toUpperCase(),
      requestId.toUpperCase(),
    ),
    "b9de0b70-067d-8cd0-b4c4-2258ca31d1a1",
    "a client that re-sends the request in another case lands on its own row",
  );
});

Deno.test("[GAP-017] messages are ordered by time, then direction, then content", () => {
  const earlier = {
    content: "Hello",
    direction: "inbound" as const,
    writtenAt: "2026-03-04T10:00:00.000Z",
  };
  assertEquals(compareMessageValues(earlier, earlier), 0);
  assertEquals(
    compareMessageValues(earlier, {
      ...earlier,
      writtenAt: "2026-03-04T11:00:00.000Z",
    }),
    -1,
  );
  assertEquals(
    compareMessageValues(
      { ...earlier, writtenAt: "2026-03-04T11:00:00.000Z" },
      earlier,
    ),
    1,
  );
  assertEquals(
    compareMessageValues(earlier, { ...earlier, direction: "outbound" }),
    -1,
    "inbound sorts before outbound at the same instant",
  );
  assertEquals(
    compareMessageValues(earlier, { ...earlier, content: "Zebra" }),
    -1,
    "content breaks a tie the direction did not",
  );
});

Deno.test("[GAP-017] the identifier is the last tiebreak, so the order is total", () => {
  const shared = {
    content: "Hello",
    direction: "inbound" as const,
    writtenAt: "2026-03-04T10:00:00.000Z",
  };
  assertEquals(
    orderMessages([
      { ...shared, id: "b" },
      { ...shared, id: "a" },
      { ...shared, content: "Bye", id: "c" },
    ]).map((message) => message.id),
    ["c", "a", "b"],
  );
  assertEquals(orderMessages([]), [], "nothing to order is still an order");
});

Deno.test("[GAP-017] a request's messages are trimmed, in UTC, and in canonical order", () => {
  assertEquals(
    canonicalMessages([
      {
        content: "  second  ",
        direction: "outbound",
        writtenAt: "2026-03-04T12:00:00+01:00",
      },
      {
        content: "first",
        direction: "inbound",
        writtenAt: "2026-03-04T10:00:00.000Z",
      },
    ]),
    [
      {
        content: "first",
        direction: "inbound",
        writtenAt: "2026-03-04T10:00:00.000Z",
      },
      {
        content: "second",
        direction: "outbound",
        writtenAt: "2026-03-04T11:00:00.000Z",
      },
    ],
  );
});

Deno.test("[GAP-017] each message takes the identifier its canonical position derives", async () => {
  const messages = await derivedMessages(
    [
      {
        content: "second",
        direction: "outbound",
        writtenAt: "2026-03-04T11:00:00.000Z",
      },
      {
        content: "first",
        direction: "inbound",
        writtenAt: "2026-03-04T10:00:00.000Z",
      },
    ],
    workspaceId,
    requestId,
  );
  assertEquals(messages, [
    {
      content: "first",
      direction: "inbound",
      id: "04aa2cb8-dcf8-8cfb-b95c-69838e8dfb75",
      writtenAt: "2026-03-04T10:00:00.000Z",
    },
    {
      content: "second",
      direction: "outbound",
      id: "96d4c1a4-db79-83b3-aded-174c3dd4f4ea",
      writtenAt: "2026-03-04T11:00:00.000Z",
    },
  ]);
  assertEquals(
    await derivedMessages([], workspaceId, requestId),
    [],
    "a conversation may carry no messages at all",
  );
});

Deno.test("[GAP-017] a call's emotions are deduplicated, lower-cased, and sorted", () => {
  assertEquals(canonicalEmotionIds(undefined), []);
  assertEquals(
    canonicalEmotionIds([emotionB.toUpperCase(), emotionA, emotionB]),
    [emotionA, emotionB],
  );
});

Deno.test("[GAP-017] a retried call is the same request only when the member and every field agree", () => {
  const input = callInput({
    content: "  Caught up  ",
    emotionIds: [emotionB, emotionA],
  });
  const stored = storedCall({
    content: "Caught up",
    emotionIds: [emotionA, emotionB],
  });
  assert(matchesStored(stored, input, memberId), "the retry matches");
  assert(
    !matchesStored(stored, input, personId),
    "another member's row is never this request",
  );
  assert(
    !matchesStored(storedCall({ content: "Caught up" }), input, memberId),
    "a row without the emotions is a different request",
  );
  assert(
    !matchesStored(
      storedCall({
        content: "Caught up",
        contactWasCaller: false,
        emotionIds: [emotionA, emotionB],
      }),
      input,
      memberId,
    ),
    "who called is part of the request",
  );
  assert(
    !matchesStored(
      storedCall({ emotionIds: [emotionA, emotionB] }),
      input,
      memberId,
    ),
    "the details are part of the request",
  );
  assert(
    !matchesStored(
      storedCall({
        calledAt: "2026-03-04T11:00:00.000Z",
        content: "Caught up",
        emotionIds: [emotionA, emotionB],
      }),
      input,
      memberId,
    ),
    "the time is part of the request",
  );
  assert(
    !matchesStored(storedConversation(), input, memberId),
    "a conversation is never a call",
  );
  assert(
    !matchesStored(
      storedCall({ personId: channelTypeId }),
      input,
      memberId,
    ),
    "a call about somebody else is a different request",
  );
});

Deno.test("[GAP-017] a retried conversation compares its canonical messages", () => {
  const messages = [
    {
      content: "first",
      direction: "inbound" as const,
      writtenAt: "2026-03-04T10:00:00.000Z",
    },
    {
      content: "second",
      direction: "outbound" as const,
      writtenAt: "2026-03-04T11:00:00.000Z",
    },
  ];
  const input = conversationInput({
    contactMethodId,
    messages: [messages[1]!, messages[0]!],
    title: "Plans",
  });
  const stored = storedConversation({
    contactMethodId,
    messages: messages.map((message, index) => ({
      ...message,
      id: `0000000${index}-0000-4000-8000-000000000000`,
    })),
    title: "Plans",
  });
  assert(
    matchesStored(stored, input, memberId),
    "the order the client sent them in is not part of the request",
  );
  assert(
    !matchesStored(
      storedConversation({ contactMethodId, title: "Plans" }),
      input,
      memberId,
    ),
    "a row with no messages is a different request",
  );
  assert(
    !matchesStored(
      { ...stored, messages: [stored.messages[0]!] },
      input,
      memberId,
    ),
    "a row with fewer messages is a different request",
  );
  assert(
    !matchesStored(
      {
        ...stored,
        messages: [
          { ...stored.messages[0]!, content: "changed" },
          stored.messages[1]!,
        ],
      },
      input,
      memberId,
    ),
    "a changed message is a different request",
  );
  assert(
    !matchesStored({ ...stored, title: "Other" }, input, memberId),
    "the title is part of the request",
  );
  assert(
    !matchesStored(
      storedConversation({ messages: stored.messages, title: "Plans" }),
      input,
      memberId,
    ),
    "the contact method is part of the request",
  );
  assert(
    !matchesStored(
      { ...stored, channelTypeId: contactMethodId },
      input,
      memberId,
    ),
    "the channel is part of the request",
  );
  assert(
    !matchesStored(
      { ...stored, happenedAt: "2026-03-04T12:00:00.000Z" },
      input,
      memberId,
    ),
    "the time is part of the request",
  );
  assert(
    !matchesStored(
      storedCall(),
      conversationInput({ contactMethodId, title: "Plans" }),
      memberId,
    ),
    "a call is never a conversation",
  );
  assert(
    matchesStored(
      storedConversation(),
      conversationInput(),
      memberId,
    ),
    "a bare conversation with no contact method matches its own request",
  );
});

Deno.test("[GAP-017] a call request names the fields it got wrong", () => {
  assertEquals(validateCommunication(callInput()), {});
  assertEquals(
    validateCommunication(callInput({
      calledAt: "sometime",
      content: "x".repeat(10_001),
      emotionIds: ["feeling"],
      personId: "nobody",
      requestId: "again",
    })),
    {
      requestId: "Use a canonical request identifier.",
      personId: "Choose one person from this workspace.",
      happenedAt: "Choose a valid occurrence time.",
      content: "Details must be at most 10,000 characters.",
      emotionIds: "Choose at most 20 active emotions.",
    },
  );
  assertEquals(
    validateCommunication(callInput({
      emotionIds: Array.from(
        { length: 21 },
        (_, index) =>
          `50000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      ),
    })),
    { emotionIds: "Choose at most 20 active emotions." },
  );
});

Deno.test("[GAP-017] a conversation request names the fields it got wrong", () => {
  assertEquals(validateCommunication(conversationInput()), {});
  assertEquals(
    validateCommunication(conversationInput({
      channelTypeId: "channel",
      contactMethodId: "method",
      happenedAt: "sometime",
      title: "x".repeat(501),
    })),
    {
      happenedAt: "Choose a valid occurrence time.",
      channelTypeId: "Choose an active channel.",
      contactMethodId: "Choose a contact method for this person.",
      title: "Title must be at most 500 characters.",
    },
  );
  assertEquals(
    validateCommunication(conversationInput({
      messages: Array.from({ length: 51 }, () => ({
        content: "Hello",
        direction: "inbound" as const,
        writtenAt: "2026-03-04T10:00:00.000Z",
      })),
    })),
    { messages: "Record at most 50 messages." },
  );
  assertEquals(
    validateCommunication(conversationInput({
      messages: [{
        content: "   ",
        direction: "inbound",
        writtenAt: "2026-03-04T10:00:00.000Z",
      }],
    })),
    { messages: "Each message needs bounded content and a valid time." },
  );
  assertEquals(
    validateCommunication(conversationInput({
      messages: [{
        content: "Hello",
        direction: "inbound",
        writtenAt: "sometime",
      }],
    })),
    { messages: "Each message needs bounded content and a valid time." },
  );
});

Deno.test("[GAP-017] a call reads with its person and the emotions the workspace resolved", () => {
  assertEquals(
    callRecord(
      storedCall({ content: "Caught up", emotionIds: [emotionA] }),
      { id: personId, name: "Ada" },
      [{ id: emotionA, name: "Happy" }],
    ),
    {
      calledAt: "2026-03-04T10:00:00.000Z",
      contactWasCaller: true,
      content: "Caught up",
      createdAt: "2026-03-04T10:05:00.000000Z",
      emotions: [{ id: emotionA, name: "Happy" }],
      id: callId,
      kind: "call",
      person: { id: personId, name: "Ada" },
    },
  );
  assertEquals(
    callRecord(storedCall(), { id: personId, name: "Ada" }, []).content,
    undefined,
    "a call with no details names none",
  );
});

Deno.test("[GAP-017] a conversation reads in canonical order and names only what resolved", () => {
  const stored = storedConversation({
    messages: [
      {
        content: "second",
        direction: "outbound",
        id: "00000002-0000-4000-8000-000000000000",
        writtenAt: "2026-03-04T11:00:00.000Z",
      },
      {
        content: "first",
        direction: "inbound",
        id: "00000001-0000-4000-8000-000000000000",
        writtenAt: "2026-03-04T10:00:00.000Z",
      },
    ],
    title: "Plans",
  });
  assertEquals(
    conversationRecord(
      stored,
      { id: personId, name: "Ada" },
      { id: channelTypeId, name: "Email" },
      { id: contactMethodId, value: "ada@example.test" },
    ),
    {
      channelType: { id: channelTypeId, name: "Email" },
      contactMethod: { id: contactMethodId, value: "ada@example.test" },
      createdAt: "2026-03-04T10:05:00.000000Z",
      happenedAt: "2026-03-04T10:00:00.000Z",
      id: conversationId,
      kind: "conversation",
      messages: [
        {
          content: "first",
          direction: "inbound",
          id: "00000001-0000-4000-8000-000000000000",
          writtenAt: "2026-03-04T10:00:00.000Z",
        },
        {
          content: "second",
          direction: "outbound",
          id: "00000002-0000-4000-8000-000000000000",
          writtenAt: "2026-03-04T11:00:00.000Z",
        },
      ],
      person: { id: personId, name: "Ada" },
      title: "Plans",
    },
  );
  assertEquals(
    conversationRecord(
      storedConversation(),
      { id: personId, name: "Ada" },
      undefined,
      undefined,
    ),
    {
      createdAt: "2026-03-04T10:05:00.000000Z",
      happenedAt: "2026-03-04T10:00:00.000Z",
      id: conversationId,
      kind: "conversation",
      messages: [],
      person: { id: personId, name: "Ada" },
    },
    "a channel or a contact method that no longer resolves is left out",
  );
});
