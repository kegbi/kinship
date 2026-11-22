import {
  createInteractionChanges,
  type InteractionChangeAudit,
  type InteractionChangeAuditCommand,
  type InteractionChangeRepository,
  type StoredRecord,
} from "../public.ts";
import { assert, assertEquals } from "../../../testing/assert.ts";
import { fixedClock } from "../../../testing/fakes.ts";

const actor = {
  memberId: "00000000-0000-4000-8000-0000000000a2",
  role: "member" as const,
  userId: "00000000-0000-4000-8000-0000000000a1",
  workspaceId: "00000000-0000-4000-8000-0000000000a3",
};
const ada = "00000000-0000-4000-8000-0000000001ab";
const grace = "00000000-0000-4000-8000-0000000001cd";
const lin = "00000000-0000-4000-8000-0000000001ef";
const typeId = "00000000-0000-4000-8000-0000000002ab";
const emotionId = "00000000-0000-4000-8000-0000000003ab";
const channelTypeId = "00000000-0000-4000-8000-0000000004ab";
const otherChannelId = "00000000-0000-4000-8000-0000000004cd";
const contactMethodId = "00000000-0000-4000-8000-0000000005ab";
const noteId = "00000000-0000-8000-8000-000000000a01";
const activityId = "00000000-0000-8000-8000-000000000a02";
const callId = "00000000-0000-8000-8000-000000000a03";
const conversationId = "00000000-0000-8000-8000-000000000a04";
const revision = "2026-08-17T12:00:00.000000Z";
const now = "2026-08-17T12:30:00.000Z";
/** The revision a write at `now` leaves, as the schema renders it. */
const savedRevision = "2026-08-17T12:30:00.000000Z";

function seed(): StoredRecord[] {
  return [
    {
      body: "Reference",
      createdAt: revision,
      id: noteId,
      isFavorited: false,
      kind: "note",
      personId: ada,
      updatedAt: revision,
    },
    {
      createdAt: revision,
      emotionIds: [],
      happenedAt: "2026-08-16T18:15:00.000Z",
      id: activityId,
      kind: "activity",
      participantIds: [ada, grace],
      summary: "Dinner",
      updatedAt: revision,
    },
    {
      calledAt: "2026-08-16T18:15:00.000Z",
      contactWasCaller: true,
      createdAt: revision,
      emotionIds: [],
      id: callId,
      kind: "call",
      personId: ada,
      updatedAt: revision,
    },
    {
      channelTypeId,
      contactMethodId,
      createdAt: revision,
      happenedAt: "2026-08-16T18:15:00.000Z",
      id: conversationId,
      kind: "conversation",
      messages: [],
      personId: ada,
      updatedAt: revision,
    },
  ];
}

function harness(options: {
  readonly actorStatus?: "active" | "revoked";
  readonly archived?: readonly string[];
  readonly contactTypeId?: string;
  readonly hidden?: boolean;
  readonly missingVocabulary?: boolean;
  readonly saveMatches?: boolean;
  readonly visible?: readonly string[];
} = {}) {
  const records = new Map(seed().map((record) => [record.id, record]));
  const audits: InteractionChangeAuditCommand[] = [];
  const published: unknown[] = [];
  const saved: unknown[] = [];
  const visible = new Set(options.visible ?? [ada, grace, lin]);
  const archived = new Set(options.archived ?? []);
  let transactions = 0;
  const scopes: unknown[] = [];
  const repository: InteractionChangeRepository = {
    find: ({ id, kind, workspaceId }) => {
      const record = records.get(id);
      return Promise.resolve(
        record?.kind === kind && workspaceId === actor.workspaceId
          ? record
          : undefined,
      );
    },
    save: (command) => {
      saved.push(command.change);
      const current = records.get(command.id)!;
      if (
        options.saveMatches === false ||
        current.updatedAt !== command.expectedUpdatedAt
      ) return Promise.resolve(false);
      const { kind: _kind, ...fields } = command.change;
      const next: Record<string, unknown> = { ...current };
      for (const [key, value] of Object.entries(fields)) {
        if (value === null) delete next[key];
        else if (value instanceof Date) next[key] = value.toISOString();
        else next[key] = value;
      }
      if (command.change.kind === "conversation" && command.change.messages) {
        next.messages = command.change.messages.map((message, index) => ({
          ...message,
          id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        }));
      }
      records.set(command.id, {
        ...next,
        updatedAt: command.occurredAt.toISOString().replace("Z", "000Z"),
      } as unknown as StoredRecord);
      return Promise.resolve(true);
    },
    remove: ({ expectedUpdatedAt, id }) => {
      if (
        options.saveMatches === false ||
        records.get(id)?.updatedAt !== expectedUpdatedAt
      ) return Promise.resolve(false);
      records.delete(id);
      return Promise.resolve(true);
    },
  };
  const audit: InteractionChangeAudit = {
    record: (command) => {
      audits.push(command);
      return Promise.resolve("00000000-0000-4000-8000-000000000900");
    },
    assertPostcondition: ({ auditId }) => {
      assert(auditId === "00000000-0000-4000-8000-000000000900", "audit id");
      return Promise.resolve();
    },
  };
  const option = (id: string) => ({ id, name: `Option ${id.slice(-3)}` });
  const vocabulary = (
    command: { readonly activityTypeId?: string; channelTypeId?: string },
    emotionIds: readonly string[],
  ) =>
    options.hidden
      ? { status: "hidden" as const }
      : options.missingVocabulary
      ? { status: "not-found" as const }
      : {
        ...(command.activityTypeId
          ? { activityType: option(command.activityTypeId) }
          : {}),
        ...(command.channelTypeId
          ? { channelType: option(command.channelTypeId) }
          : {}),
        emotions: emotionIds.map(option),
        status: "ready" as const,
      };
  const changes = createInteractionChanges({
    actors: {
      revalidate: () => Promise.resolve(options.actorStatus ?? "active"),
    },
    audit,
    clock: fixedClock(now),
    people: {
      describeContactMethods: ({ contactMethodIds }) =>
        Promise.resolve(contactMethodIds.map((id) => ({
          id,
          typeId: options.contactTypeId ?? channelTypeId,
          value: "ada@example.test",
        }))),
      inspect: ({ personIds }) =>
        Promise.resolve(
          personIds.some((id) => !visible.has(id))
            ? { status: "not-found" as const }
            : personIds.some((id) => archived.has(id))
            ? { status: "archived" as const }
            : { status: "ready" as const },
        ),
      inspectContactMethod: ({ contactMethodId: id }) =>
        Promise.resolve(
          id === contactMethodId
            ? {
              contactMethod: {
                id,
                typeId: options.contactTypeId ?? channelTypeId,
                value: "ada@example.test",
              },
              status: "ready" as const,
            }
            : { status: "not-found" as const },
        ),
      summarize: ({ personIds }) =>
        Promise.resolve(
          personIds.filter((id) => visible.has(id)).map((id) => ({
            archived: archived.has(id),
            id,
            name: id === ada ? "Ada" : id === grace ? "Grace" : "Lin",
          })),
        ),
    },
    publisher: {
      interactionRecorded: (event) => {
        published.push({
          happenedAt: event.happenedAt,
          personIds: event.personIds,
        });
        return Promise.resolve();
      },
    },
    repository,
    transaction: {
      run: async (work, scope) => {
        transactions += 1;
        scopes.push(scope?.workspaceId);
        return await work({ opaque: "transaction" });
      },
    },
    workspace: {
      communicationOptions: () => Promise.reject(new Error("unused")),
      describe: (command) =>
        Promise.resolve({
          ...(command.activityTypeId
            ? { activityType: option(command.activityTypeId) }
            : {}),
          emotions: command.emotionIds.map(option),
        }),
      describeCommunication: (command) =>
        Promise.resolve({
          ...(command.channelTypeId
            ? { channelType: option(command.channelTypeId) }
            : {}),
          emotions: command.emotionIds.map(option),
        }),
      describeCommunicationReferences: () =>
        Promise.reject(new Error("unused")),
      inspect: (command) =>
        Promise.resolve(vocabulary(command, command.emotionIds)),
      inspectCommunication: (command) =>
        Promise.resolve(vocabulary(command, command.emotionIds)),
      options: () => Promise.reject(new Error("unused")),
    },
  });
  return {
    audits,
    changes,
    published,
    records,
    saved,
    scopes,
    transactions: () => transactions,
  };
}

Deno.test("[MCP-D1] a note edit changes its body and favourite at the expected revision", async () => {
  const subject = harness();
  const result = await subject.changes.changeInteraction(actor, noteId, {
    body: " Updated reference ",
    expectedUpdatedAt: revision,
    isFavorited: true,
    kind: "note",
  });
  assertEquals(result, {
    record: {
      body: "Updated reference",
      createdAt: revision,
      id: noteId,
      isFavorited: true,
      kind: "note",
      person: { id: ada, name: "Ada" },
      updatedAt: savedRevision,
    },
    status: "saved",
  });
  assertEquals(subject.audits.map(({ transaction: _, ...audit }) => audit), [{
    action: "update",
    actor,
    fields: ["body", "isFavorited"],
    kind: "note",
    occurredAt: new Date(now),
    participantIds: [ada],
    subjectId: noteId,
  }]);
  assertEquals(subject.published, [], "a note advances no cadence");
});

Deno.test("[MCP-D1] an edit refuses a stale revision, a missing record, and a revoked actor", async () => {
  const subject = harness();
  assertEquals(
    await subject.changes.changeInteraction(actor, noteId, {
      body: "Late",
      expectedUpdatedAt: "2026-08-17T11:00:00Z",
      kind: "note",
    }),
    { status: "stale" },
  );
  for (
    const [id, kind] of [
      [activityId, "note"],
      ["00000000-0000-8000-8000-000000000fff", "note"],
    ] as const
  ) {
    assertEquals(
      await subject.changes.changeInteraction(actor, id, {
        body: "Elsewhere",
        expectedUpdatedAt: revision,
        kind,
      }),
      { status: "not-found" },
      `${id} as ${kind}`,
    );
  }
  const foreign = "00000000-0000-4000-8000-0000000000ff";
  assertEquals(
    await subject.changes.changeInteraction(
      { ...actor, workspaceId: foreign },
      noteId,
      { body: "Foreign", expectedUpdatedAt: revision, kind: "note" },
    ),
    { status: "not-found" },
    "another workspace finds nothing",
  );
  assertEquals(subject.scopes.at(-1), foreign, "scoped to the actor");
  assertEquals(subject.saved, [], "nothing was written");
  assertEquals(subject.audits, [], "nothing was audited");
  const revoked = harness({ actorStatus: "revoked" });
  assertEquals(
    await revoked.changes.changeInteraction(actor, noteId, {
      body: "Revoked",
      expectedUpdatedAt: revision,
      kind: "note",
    }),
    { status: "forbidden" },
  );
  const invalid = await revoked.changes.changeInteraction(actor, "x", {
    expectedUpdatedAt: revision,
    kind: "note",
  });
  assert(invalid.status === "validation-error", "validated first");
  assertEquals(revoked.transactions(), 1, "invalid input opens nothing");
  const raced = harness({ saveMatches: false });
  assertEquals(
    await raced.changes.changeInteraction(actor, callId, {
      content: "Raced",
      expectedUpdatedAt: revision,
      kind: "call",
    }),
    { status: "stale" },
    "a write that matched no row is stale",
  );
  assertEquals(raced.audits, []);
});

Deno.test("[MCP-D1] an activity edit revalidates vocabulary and people and re-advances the cadence", async () => {
  const subject = harness();
  const result = await subject.changes.changeInteraction(actor, activityId, {
    activityTypeId: typeId,
    description: "Long talk",
    emotionIds: [emotionId],
    expectedUpdatedAt: revision,
    happenedAt: "2026-08-17T09:00:00Z",
    kind: "activity",
    participantIds: [lin, ada],
    summary: "Lunch",
  });
  assertEquals(result, {
    record: {
      activityType: "Option 2ab",
      createdAt: revision,
      description: "Long talk",
      emotions: [{ id: emotionId, name: "Option 3ab" }],
      happenedAt: "2026-08-17T09:00:00.000Z",
      id: activityId,
      kind: "activity",
      participants: [{ id: ada, name: "Ada" }, { id: lin, name: "Lin" }],
      summary: "Lunch",
      updatedAt: savedRevision,
    },
    status: "saved",
  });
  assertEquals(subject.published, [{
    happenedAt: "2026-08-17T09:00:00.000Z",
    personIds: [ada, lin],
  }]);
  assertEquals(subject.audits[0]?.participantIds, [ada, lin]);
  const cleared = await subject.changes.changeInteraction(actor, activityId, {
    activityTypeId: null,
    description: null,
    expectedUpdatedAt: savedRevision,
    kind: "activity",
  });
  assert(
    cleared.status === "saved" && cleared.record.kind === "activity" &&
      cleared.record.activityType === undefined &&
      cleared.record.description === undefined,
    "explicit null clears the type and the details",
  );
  assertEquals(subject.published.length, 1, "no occurrence change, no event");

  for (
    const [label, options, input, status] of [
      ["unknown participant", { visible: [ada, grace] }, {
        participantIds: [lin],
      }, "not-found"],
      ["archived new participant", { archived: [lin] }, {
        participantIds: [lin],
      }, "archived-write-rejected"],
      ["archived current participant", { archived: [grace] }, {
        summary: "Still",
      }, "archived-write-rejected"],
      ["inactive vocabulary", { missingVocabulary: true }, {
        activityTypeId: typeId,
      }, "not-found"],
      ["hidden section", { hidden: true }, { summary: "Hidden" }, "hidden"],
      ["no visible participant", { visible: [lin] }, {
        summary: "Gone",
      }, "not-found"],
    ] as const
  ) {
    const refused = harness(options);
    assertEquals(
      await refused.changes.changeInteraction(actor, activityId, {
        expectedUpdatedAt: revision,
        kind: "activity",
        ...input,
      }),
      { status },
      label,
    );
    assertEquals(refused.saved, [], `${label} wrote nothing`);
  }
});

Deno.test("[MCP-D1] a call edit re-advances the cadence when its time moves", async () => {
  const subject = harness();
  const result = await subject.changes.changeInteraction(actor, callId, {
    calledAt: "2026-08-17T10:00:00Z",
    contactWasCaller: false,
    content: "Plans",
    emotionIds: [emotionId],
    expectedUpdatedAt: revision,
    kind: "call",
  });
  assert(
    result.status === "saved" && result.record.kind === "call" &&
      result.record.content === "Plans" &&
      result.record.contactWasCaller === false &&
      result.record.updatedAt === savedRevision,
    `call saved: ${JSON.stringify(result)}`,
  );
  assertEquals(subject.published, [{
    happenedAt: "2026-08-17T10:00:00.000Z",
    personIds: [ada],
  }]);
  assertEquals(
    await harness({ archived: [ada] }).changes.changeInteraction(
      actor,
      callId,
      {
        content: "Archived",
        expectedUpdatedAt: revision,
        kind: "call",
      },
    ),
    { status: "archived-write-rejected" },
  );
  assertEquals(
    await harness({ visible: [grace] }).changes.changeInteraction(
      actor,
      callId,
      {
        content: "Gone",
        expectedUpdatedAt: revision,
        kind: "call",
      },
    ),
    { status: "not-found" },
    "a call whose person is gone is not found",
  );
  assertEquals(
    await harness({ missingVocabulary: true }).changes.changeInteraction(
      actor,
      callId,
      {
        emotionIds: [emotionId],
        expectedUpdatedAt: revision,
        kind: "call",
      },
    ),
    { status: "not-found" },
  );
});

Deno.test("[MCP-D1] a conversation edit keeps its contact method on its channel and replaces its messages", async () => {
  const subject = harness();
  const result = await subject.changes.changeInteraction(
    actor,
    conversationId,
    {
      expectedUpdatedAt: revision,
      kind: "conversation",
      messages: [{
        content: "Hello",
        direction: "outbound",
        writtenAt: "2026-08-16T18:15:00Z",
      }],
      title: "Plans",
    },
  );
  assert(
    result.status === "saved" && result.record.kind === "conversation" &&
      result.record.title === "Plans" &&
      result.record.contactMethod?.id === contactMethodId &&
      result.record.messages.map((message) => message.content).join() ===
        "Hello",
    `conversation saved: ${JSON.stringify(result)}`,
  );
  assertEquals(subject.published, [], "the time did not move");
  for (
    const [label, input] of [
      ["channel without its contact method", {
        channelTypeId: otherChannelId,
      }],
      ["unknown contact method", {
        contactMethodId: "00000000-0000-4000-8000-0000000005ff",
      }],
    ] as const
  ) {
    const refused = harness();
    assertEquals(
      await refused.changes.changeInteraction(actor, conversationId, {
        expectedUpdatedAt: revision,
        kind: "conversation",
        ...input,
      }),
      { status: "not-found" },
      label,
    );
    assertEquals(refused.saved, [], `${label} wrote nothing`);
  }
  const moved = harness();
  const rechanneled = await moved.changes.changeInteraction(
    actor,
    conversationId,
    {
      channelTypeId: otherChannelId,
      contactMethodId: null,
      expectedUpdatedAt: revision,
      kind: "conversation",
    },
  );
  assert(
    rechanneled.status === "saved" &&
      rechanneled.record.kind === "conversation" &&
      rechanneled.record.channelType?.id === otherChannelId &&
      rechanneled.record.contactMethod === undefined,
    "a channel change that clears the contact method is saved",
  );
  assertEquals(
    (await harness({ contactTypeId: otherChannelId }).changes.changeInteraction(
      actor,
      conversationId,
      {
        channelTypeId: otherChannelId,
        expectedUpdatedAt: revision,
        kind: "conversation",
      },
    )).status,
    "saved",
    "a channel the stored contact method belongs to is accepted",
  );
});

Deno.test("[MCP-D1] a removal deletes at the expected revision and audits without content", async () => {
  for (
    const [id, kind] of [
      [noteId, "note"],
      [activityId, "activity"],
      [callId, "call"],
      [conversationId, "conversation"],
    ] as const
  ) {
    const subject = harness();
    assertEquals(
      await subject.changes.removeInteraction(actor, kind, id, revision),
      { id, kind, status: "deleted" },
      kind,
    );
    assert(!subject.records.has(id), `${kind} removed`);
    assertEquals(
      subject.audits.map(({ action, fields, kind, participantIds }) => ({
        action,
        fields,
        kind,
        participantIds,
      })),
      [{
        action: "delete",
        fields: [],
        kind,
        participantIds: kind === "activity" ? [ada, grace] : [ada],
      }],
    );
    assertEquals(subject.published, [], "a removal advances no cadence");
  }
  const subject = harness();
  assertEquals(
    await subject.changes.removeInteraction(
      actor,
      "call",
      callId,
      "2026-08-17T11:00:00Z",
    ),
    { status: "stale" },
  );
  assertEquals(
    await subject.changes.removeInteraction(actor, "note", callId, revision),
    { status: "not-found" },
  );
  assertEquals(
    await harness({ archived: [ada] }).changes.removeInteraction(
      actor,
      "note",
      noteId,
      revision,
    ),
    { status: "archived-write-rejected" },
  );
  assertEquals(
    await harness({ hidden: true }).changes.removeInteraction(
      actor,
      "activity",
      activityId,
      revision,
    ),
    { status: "hidden" },
  );
  assertEquals(
    await harness({ actorStatus: "revoked" }).changes.removeInteraction(
      actor,
      "note",
      noteId,
      revision,
    ),
    { status: "forbidden" },
  );
  assertEquals(
    await harness({ saveMatches: false }).changes.removeInteraction(
      actor,
      "conversation",
      conversationId,
      revision,
    ),
    { status: "stale" },
  );
  const invalid = await subject.changes.removeInteraction(
    actor,
    "note",
    "x",
    "y",
  );
  assert(invalid.status === "validation-error", "removal validated first");
  assert(subject.records.has(callId), "nothing was removed");
  assertEquals(subject.audits, []);
});
