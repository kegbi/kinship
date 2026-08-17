import {
  createInteractionManagement,
  type InteractionAudit,
  type InteractionRepository,
  type InteractionWorkspaceBoundary,
  type StoredInteraction,
} from "./public.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function directDependencies(target: string): Promise<readonly string[]> {
  const output = await new Deno.Command(Deno.execPath(), {
    args: ["info", "--json", target],
    env: { DENO_NO_PACKAGE_JSON: "1" },
  }).output();
  assert(output.success, "interaction boundary dependency graph is readable");
  const graph = JSON.parse(new TextDecoder().decode(output.stdout)) as {
    readonly modules: readonly {
      readonly dependencies?: readonly {
        readonly code?: { readonly specifier: string };
        readonly type?: { readonly specifier: string };
      }[];
      readonly specifier: string;
    }[];
  };
  return graph.modules.find((module) => module.specifier === target)
    ?.dependencies?.map((dependency) =>
      dependency.code?.specifier ?? dependency.type?.specifier ?? ""
    ) ?? [];
}

Deno.test("workspaces interaction boundary owns its actor and transaction types", async () => {
  const boundary = new URL(
    "../workspaces/application/interaction_workspace_boundary.ts",
    import.meta.url,
  ).href;
  const dependencies = await directDependencies(boundary);
  assert(
    !dependencies.some((dependency) => dependency.includes("/modules/people/")),
    "workspaces interaction boundary imports the people module",
  );
});

const actor = {
  memberId: "00000000-0000-4000-8000-0000000000a2",
  role: "member" as const,
  userId: "00000000-0000-4000-8000-0000000000a1",
  workspaceId: "00000000-0000-4000-8000-0000000000a3",
};
const ada = "00000000-0000-4000-8000-0000000001ab";
const grace = "00000000-0000-4000-8000-0000000001cd";
const activityTypeId = "00000000-0000-4000-8000-0000000002ab";
const emotionId = "00000000-0000-4000-8000-0000000003ab";
const requestId = "00000000-0000-4000-8000-0000000008ab";

function harness(overrides: {
  readonly authorizationStatuses?: readonly ("forbidden" | "ready")[];
  readonly peopleStatus?: "archived" | "not-found" | "ready";
  readonly workspaceStatus?: "forbidden" | "hidden" | "not-found" | "ready";
} = {}) {
  const calls: string[] = [];
  const requests = new Map<
    string,
    StoredInteraction
  >();
  let committed = false;
  let findRequests = 0;
  const repository: InteractionRepository = {
    lockRequest() {
      return Promise.resolve();
    },
    findRequest(command) {
      findRequests += 1;
      const existing = requests.get(command.id);
      if (!existing) return Promise.resolve({ status: "absent" as const });
      return Promise.resolve({ interaction: existing, status: "found" });
    },
    createActivity(command) {
      calls.push(`activity:${command.participantIds.join(",")}`);
      const record = {
        activityType: "Shared meal",
        createdAt: command.occurredAt.toISOString(),
        ...(command.description ? { description: command.description } : {}),
        emotions: [{ id: emotionId, name: "Joy" }],
        happenedAt: command.happenedAt.toISOString(),
        id: command.id,
        kind: "activity",
        participants: command.participants,
        summary: command.summary,
      } as const;
      requests.set(command.id, {
        ...(command.activityType
          ? { activityTypeId: command.activityType.id }
          : {}),
        createdAt: command.occurredAt.toISOString(),
        createdByMemberId: command.memberId,
        ...(command.description ? { description: command.description } : {}),
        emotionIds: command.emotions.map((entry) => entry.id),
        happenedAt: command.happenedAt.toISOString(),
        id: command.id,
        kind: "activity",
        participantIds: command.participantIds,
        summary: command.summary,
      });
      return Promise.resolve(record);
    },
    createNote(command) {
      calls.push(`note:${command.personId}`);
      const record = {
        body: command.body,
        createdAt: command.occurredAt.toISOString(),
        id: command.id,
        isFavorited: command.isFavorited,
        kind: "note",
        person: command.person,
      } as const;
      requests.set(command.id, {
        body: command.body,
        createdAt: command.occurredAt.toISOString(),
        createdByMemberId: command.memberId,
        id: command.id,
        isFavorited: command.isFavorited,
        kind: "note",
        personId: command.personId,
      });
      return Promise.resolve(record);
    },
    assertPostcondition() {
      calls.push("repository-postcondition");
      return Promise.resolve();
    },
  };
  const audit: InteractionAudit = {
    record(command) {
      calls.push(`audit:${command.record.kind}`);
      return Promise.resolve("00000000-0000-4000-8000-000000000900");
    },
    assertPostcondition() {
      calls.push("audit-postcondition");
      return Promise.resolve();
    },
  };
  let authorizationCall = 0;
  const workspace: InteractionWorkspaceBoundary & {
    authorize(): Promise<{ readonly status: "forbidden" | "ready" }>;
  } = {
    authorize() {
      calls.push("authorize");
      const statuses = overrides.authorizationStatuses ?? ["ready"];
      const status =
        statuses[Math.min(authorizationCall, statuses.length - 1)]!;
      authorizationCall += 1;
      return Promise.resolve({ status });
    },
    describe() {
      return Promise.resolve({
        activityType: { id: activityTypeId, name: "Shared meal" },
        emotions: [{ id: emotionId, name: "Joy" }],
      });
    },
    inspect() {
      return Promise.resolve(
        overrides.workspaceStatus === "ready" || !overrides.workspaceStatus
          ? {
            activityType: { id: activityTypeId, name: "Shared meal" },
            emotions: [{ id: emotionId, name: "Joy" }],
            status: "ready" as const,
          }
          : { status: overrides.workspaceStatus },
      );
    },
    options() {
      return Promise.resolve({
        activityTypes: [],
        availability: { activity: true, note: true },
        emotions: [],
        status: "ready" as const,
      });
    },
  };
  const management = createInteractionManagement({
    audit,
    clock: { now: () => new Date("2026-08-17T12:30:00.000Z") },
    people: {
      inspect: () =>
        Promise.resolve({ status: overrides.peopleStatus ?? "ready" }),
      summarize: ({ personIds }) =>
        Promise.resolve(personIds.map((id) => ({
          archived: false,
          id,
          name: id === ada ? "Ada Lovelace" : "Grace Hopper",
        }))),
    },
    repository,
    transaction: {
      async run(work) {
        const result = await work({ opaque: "transaction" });
        committed = true;
        return result;
      },
    },
    workspace,
  });
  return {
    calls,
    committed: () => committed,
    findRequests: () => findRequests,
    management,
  };
}

Deno.test("INTERACTION-001 atomically records a multi-person activity and exact audit effect", async () => {
  const { calls, committed, management } = harness();
  const result = await management.record(actor, {
    activityTypeId,
    description: "Caught up over lunch.",
    emotionIds: [emotionId],
    happenedAt: "2026-08-16T18:15:00.000Z",
    kind: "activity",
    participantIds: [grace, ada, grace],
    requestId,
    summary: "Dinner together",
  });

  assert(result.status === "created", "activity was not created");
  assert(result.record.kind === "activity", "wrong interaction kind");
  assert(
    result.record.participants.map((participant) => participant.name).join(
      ",",
    ) ===
      "Ada Lovelace,Grace Hopper",
    "participants were not normalized and hydrated",
  );
  assert(committed(), "transaction did not commit");
  assert(
    calls.join("|") ===
      `authorize|activity:${ada},${grace}|audit:activity|repository-postcondition|audit-postcondition`,
    "write, audit, and postconditions were not one ordered transaction",
  );
});

Deno.test("INTERACTION-001 records a favorited note and rejects cross-workspace or archived participants", async () => {
  const note = await harness().management.record(actor, {
    body: "Prefers quiet morning meetings.",
    isFavorited: true,
    kind: "note",
    personId: ada,
    requestId,
  });
  assert(
    note.status === "created" && note.record.kind === "note" &&
      note.record.isFavorited,
    "favorited note was not persisted",
  );

  for (const status of ["not-found", "archived"] as const) {
    const result = await harness({ peopleStatus: status }).management.record(
      actor,
      {
        happenedAt: "2026-08-16T18:15:00.000Z",
        kind: "activity",
        participantIds: [ada, grace],
        requestId,
        summary: "Hidden interaction",
      },
    );
    assert(
      result.status ===
        (status === "archived" ? "archived-write-rejected" : "not-found"),
      `${status} participant was not concealed/rejected`,
    );
  }
});

Deno.test("INTERACTION-001 validates bounded content before opening a transaction", async () => {
  const { committed, management } = harness();
  const result = await management.record(actor, {
    emotionIds: Array.from({ length: 21 }, () => emotionId),
    happenedAt: "not-an-instant",
    kind: "activity",
    participantIds: [],
    requestId,
    summary: " ",
  });
  assert(result.status === "validation-error", "invalid input was accepted");
  assert(!committed(), "invalid input opened a transaction");
  assert(
    Object.keys(result.errors).sort().join(",") ===
      "emotionIds,happenedAt,participantIds,summary",
    "validation did not identify every invalid boundary",
  );
});

Deno.test("INTERACTION-001 uses the client request id for an atomic replay and rejects a mismatched replay", async () => {
  const current = harness();
  const input = {
    body: "Stable reference",
    isFavorited: true,
    kind: "note" as const,
    personId: ada,
    requestId,
  };
  const first = await current.management.record(actor, input);
  const replay = await current.management.record(actor, input);
  const mismatch = await current.management.record(actor, {
    ...input,
    body: "Different payload",
  });
  assert(
    first.status === "created" && replay.status === "created",
    "identical retry was not replayed",
  );
  assert(
    first.record.id === replay.record.id,
    "identical retry did not preserve the aggregate id",
  );
  assert(
    mismatch.status === "idempotency-conflict",
    "mismatched retry did not conflict",
  );
  assert(
    current.calls.filter((call) => call === "audit:note").length === 1,
    "retry duplicated the audit effect",
  );
});

Deno.test("INTERACTION-001 canonicalizes accepted UUIDs before replay comparison and persistence", async () => {
  const current = harness();
  const activityInput = {
    activityTypeId,
    emotionIds: [emotionId, emotionId.toUpperCase()],
    happenedAt: "2026-08-16T18:15:00.000Z",
    kind: "activity" as const,
    participantIds: [grace, ada.toUpperCase(), ada],
    requestId,
    summary: "Case-stable activity",
  };
  const createdActivity = await current.management.record(actor, activityInput);
  const replayedActivity = await current.management.record(
    {
      ...actor,
      memberId: actor.memberId.toUpperCase(),
      userId: actor.userId.toUpperCase(),
      workspaceId: actor.workspaceId.toUpperCase(),
    },
    {
      ...activityInput,
      activityTypeId: activityTypeId.toUpperCase(),
      emotionIds: [emotionId.toUpperCase()],
      participantIds: [ada.toUpperCase(), grace.toUpperCase()],
      requestId: requestId.toUpperCase(),
    },
  );
  assert(
    createdActivity.status === "created" &&
      replayedActivity.status === "created" &&
      JSON.stringify(createdActivity) === JSON.stringify(replayedActivity),
    "uppercase activity retry did not return the original response",
  );
  assert(
    current.calls.filter((call) => call.startsWith("activity:")).join() ===
        `activity:${ada},${grace}` &&
      current.calls.filter((call) => call === "audit:activity").length === 1,
    "mixed-case activity UUIDs were not deduplicated before persistence",
  );

  const noteRequestId = "00000000-0000-4000-8000-0000000009ab";
  const noteInput = {
    body: "Case-stable note",
    isFavorited: true,
    kind: "note" as const,
    personId: ada,
    requestId: noteRequestId,
  };
  const createdNote = await current.management.record(actor, noteInput);
  const replayedNote = await current.management.record(actor, {
    ...noteInput,
    personId: ada.toUpperCase(),
    requestId: noteRequestId.toUpperCase(),
  });
  const mismatch = await current.management.record(actor, {
    ...noteInput,
    body: "Different payload",
    personId: ada.toUpperCase(),
    requestId: noteRequestId.toUpperCase(),
  });
  assert(
    createdNote.status === "created" && replayedNote.status === "created" &&
      JSON.stringify(createdNote) === JSON.stringify(replayedNote),
    "uppercase note retry did not return the original response",
  );
  assert(
    mismatch.status === "idempotency-conflict" &&
      current.calls.filter((call) => call === "audit:note").length === 1,
    "canonical note replay changed mismatch or audit behavior",
  );
});

Deno.test("INTERACTION-001 derives workspace-scoped aggregate ids from client request ids", async () => {
  const first = await harness().management.record(actor, {
    body: "Workspace-local request",
    kind: "note",
    personId: ada,
    requestId,
  });
  const second = await harness().management.record(
    {
      ...actor,
      workspaceId: "00000000-0000-4000-8000-000000000004",
    },
    {
      body: "Workspace-local request",
      kind: "note",
      personId: ada,
      requestId,
    },
  );
  assert(
    first.status === "created" && second.status === "created" &&
      first.record.id !== requestId && second.record.id !== requestId &&
      first.record.id !== second.record.id,
    "client request id was not mapped to distinct workspace aggregate ids",
  );
});

Deno.test("INTERACTION-001 reauthorizes inside the transaction before replay lookup", async () => {
  const current = harness({ authorizationStatuses: ["ready", "forbidden"] });
  const input = {
    body: "Authority-sensitive replay",
    kind: "note" as const,
    personId: ada,
    requestId,
  };
  const created = await current.management.record(actor, input);
  assert(created.status === "created", "authorized write was not created");
  const authorizedLookups = current.findRequests();
  current.calls.length = 0;
  const replay = await current.management.record(actor, input);
  assert(replay.status === "forbidden", "revoked replay was disclosed");
  assert(
    current.calls.join("|") === "authorize" &&
      current.findRequests() === authorizedLookups,
    "repository replay lookup ran before transaction-scoped authorization",
  );
});
