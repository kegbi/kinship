import { type AuditHistoryRepository, createAuditHistory } from "../public.ts";
import { assert } from "../../../testing/assert.ts";

const actor = (role: "admin" | "member" | "owner") => ({
  memberId: crypto.randomUUID(),
  role,
  userId: crypto.randomUUID(),
  workspaceId: crypto.randomUUID(),
});
const cursorKeyset = {
  activeVersion: 1,
  keys: new Map([[1, new Uint8Array(32).fill(0x31)]]),
};

function forgeCursorAnchor(cursor: string): string {
  const parts = cursor.split(".");
  const bodyIndex = parts.length === 4 ? 2 : 0;
  const encoded = parts[bodyIndex]!;
  const padded = encoded.replaceAll("-", "+").replaceAll("_", "/") +
    "=".repeat((4 - encoded.length % 4) % 4);
  const body = JSON.parse(atob(padded)) as Record<string, unknown>;
  body.id = "00000000-0000-4000-8000-000000000903";
  body.timestamp = "2026-08-17T10:00:00.000Z";
  parts[bodyIndex] = btoa(JSON.stringify(body)).replaceAll("+", "-")
    .replaceAll("/", "_").replaceAll("=", "");
  return parts.join(".");
}

Deno.test("GOVERNANCE-002 audit access is separate, bounded, and redacted", async () => {
  let calls = 0;
  let received: Parameters<AuditHistoryRepository["list"]>[0] | undefined;
  const repository: AuditHistoryRepository = {
    list(command) {
      calls += 1;
      received = command;
      return Promise.resolve({
        items: [{
          action: "people.person-date-updated",
          actor: { id: command.memberId, name: "Workspace owner" },
          id: "00000000-0000-4000-8000-000000000901",
          occurredAt: "2026-08-17T12:30:00.000Z",
          payload: {
            action: "update",
            from: {
              isYearApproximate: false,
              password: "nested-password",
              precision: "full",
              status: "Bearer secret-token",
            },
            password: "never-return-this",
            recoveryCode: "nor-this",
            section: {
              password: "nested-section-password",
              status: "Bearer nested-secret-token",
            },
          },
          subject: { id: command.userId, type: "user" },
        }],
        next: {
          id: "00000000-0000-4000-8000-000000000901",
          timestamp: "2026-08-17T12:30:00.000Z",
        },
        status: "ready",
      });
    },
  };
  const history = createAuditHistory({ cursorKeyset, repository });
  const ordinary = actor("member");
  const forbidden = await history.list(ordinary, { limit: 20 });
  assert(
    forbidden.status === "forbidden" && calls === 0,
    "ordinary people.read access reached audit storage",
  );

  const administrator = actor("admin");
  const personId = crypto.randomUUID();
  const result = await history.list(administrator, {
    action: "people.person-date-updated",
    actorMemberId: administrator.memberId,
    from: "2026-08-01T00:00:00.000Z",
    limit: 500,
    personId,
    to: "2026-09-01T00:00:00.000Z",
  });
  assert(result.status === "ready", "authorized audit history was unavailable");
  assert(
    received?.workspaceId === administrator.workspaceId &&
      received.personId === personId && received.limit === 50,
    "active workspace, person scope, or bounded page was lost",
  );
  if (result.status !== "ready") return;
  const serialized = JSON.stringify(result);
  assert(
    result.items[0]?.details.action === "update" &&
      result.items[0]?.redacted === true &&
      serialized.includes('"precision":"full"') &&
      !serialized.includes("never-return-this") &&
      !serialized.includes("secret-token") &&
      !serialized.includes("nor-this") &&
      !serialized.includes("password") &&
      !serialized.includes("recoveryCode") &&
      !serialized.includes('"status":"Bearer'),
    "audit payload was not conservatively redacted",
  );
  assert(Boolean(result.nextCursor), "bounded result omitted continuation");
});

Deno.test("GOVERNANCE-002 preserves only action-positioned current writer details", async () => {
  const id = (suffix: number) =>
    `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
  const personId = id(100);
  const memberId = id(2);
  const relationshipTypeId = id(200);
  const cases: readonly {
    readonly action: string;
    readonly payload: Readonly<Record<string, unknown>>;
  }[] = [
    { action: "authentication.succeeded", payload: {} },
    {
      action: "interactions.communication-created",
      payload: { kind: "call", personId },
    },
    {
      action: "people.person-date-updated",
      payload: {
        action: "update",
        from: { isYearApproximate: true, precision: "year" },
        to: null,
      },
    },
    {
      action: "interactions.interaction-or-note-created",
      payload: { kind: "activity", participantIds: [personId] },
    },
    { action: "workspace.member-joined", payload: {} },
    { action: "people.person-created", payload: { isPartial: false } },
    {
      action: "people.person-archived",
      payload: { from: "active", to: "archived" },
    },
    {
      action: "people.person-profile-fact-updated",
      payload: { action: "save", section: "food-preferences" },
    },
    { action: "workspace.created", payload: {} },
    {
      action: "relationships.relationship-changed",
      payload: {
        action: "create",
        fromPersonId: personId,
        relationshipTypeId,
        toPersonId: id(101),
      },
    },
    {
      action: "planning.task-created-or-state-changed",
      payload: { action: "completed", status: "completed" },
    },
    { action: "member.profile-updated", payload: {} },
    { action: "member.preferences-updated", payload: {} },
    { action: "identity.session-revoked", payload: { current: true } },
    { action: "workspace.configuration-changed", payload: {} },
    {
      action: "workspace-personalization-updated",
      payload: { action: "create", section: "tags" },
    },
    {
      action: "workspace.member-updated",
      payload: { role: "admin", status: "suspended" },
    },
  ];
  const repository: AuditHistoryRepository = {
    list() {
      return Promise.resolve({
        items: cases.map((entry, index) => ({
          action: entry.action,
          actor: { id: memberId, name: "Workspace member" },
          id: id(900 + index),
          occurredAt: "2026-08-17T12:30:00.000Z",
          payload: entry.payload,
          subject: {},
        })),
        status: "ready" as const,
      });
    },
  };

  const result = await createAuditHistory({ cursorKeyset, repository }).list(
    { ...actor("owner"), memberId },
    { limit: 50 },
  );
  assert(result.status === "ready", "writer audit history was unavailable");
  if (result.status !== "ready") return;
  for (const [index, entry] of cases.entries()) {
    const item = result.items[index];
    assert(
      item?.redacted === false &&
        JSON.stringify(item.details) === JSON.stringify(entry.payload),
      `safe ${entry.action} payload was not preserved: ${JSON.stringify(item)}`,
    );
  }

  const discriminatingRepository: AuditHistoryRepository = {
    list() {
      return Promise.resolve({
        items: [
          {
            action: "member.profile-updated",
            actor: { name: "Workspace member" },
            id: id(997),
            occurredAt: "2026-08-17T12:30:00.000Z",
            payload: {
              action: "save",
              current: "Bearer secret-token",
              role: "admin",
            },
            subject: {},
          },
          {
            action: "people.person-date-updated",
            actor: { name: "Workspace member" },
            id: id(998),
            occurredAt: "2026-08-17T12:30:00.000Z",
            payload: { from: "active" },
            subject: {},
          },
          {
            action: "relationships.relationship-changed",
            actor: { name: "Workspace member" },
            id: id(999),
            occurredAt: "2026-08-17T12:30:00.000Z",
            payload: { personId },
            subject: {},
          },
          {
            action: "workspace-personalization-updated",
            actor: { name: "Workspace member" },
            id: id(1000),
            occurredAt: "2026-08-17T12:30:00.000Z",
            payload: { action: "save", section: "addresses" },
            subject: {},
          },
        ],
        status: "ready" as const,
      });
    },
  };
  const rejected = await createAuditHistory({
    cursorKeyset,
    repository: discriminatingRepository,
  }).list(actor("owner"), { limit: 20 });
  assert(rejected.status === "ready", "discrimination fixture unavailable");
  if (rejected.status !== "ready") return;
  assert(
    rejected.items.every((item) =>
      item.redacted && Object.keys(item.details).length === 0
    ) &&
      !JSON.stringify(rejected).includes("secret-token"),
    "safe field names escaped their writer action positions",
  );
});

Deno.test("GOVERNANCE-002 cursor is immutable and bound to every filter", async () => {
  const owner = actor("owner");
  const personId = crypto.randomUUID();
  let calls = 0;
  const callCount = () => calls;
  let after: { readonly id: string; readonly timestamp: string } | undefined;
  const repository: AuditHistoryRepository = {
    list(command) {
      calls += 1;
      after = command.after;
      return Promise.resolve({
        items: [],
        ...(command.after ? {} : {
          next: {
            id: "00000000-0000-4000-8000-000000000902",
            timestamp: "2026-08-17T11:00:00.000Z",
          },
        }),
        status: "ready" as const,
      });
    },
  };
  const history = createAuditHistory({ cursorKeyset, repository });
  const filters = {
    action: "people.person-updated",
    actorMemberId: owner.memberId,
    from: "2026-08-01T00:00:00.000Z",
    personId,
    to: "2026-09-01T00:00:00.000Z",
  } as const;
  const first = await history.list(owner, filters);
  assert(
    first.status === "ready" && Boolean(first.nextCursor),
    "first audit page omitted its cursor",
  );
  if (first.status !== "ready" || !first.nextCursor) return;
  const second = await history.list(owner, {
    ...filters,
    cursor: first.nextCursor,
  });
  assert(
    second.status === "ready" &&
      after?.id === "00000000-0000-4000-8000-000000000902" && callCount() === 2,
    "valid cursor did not continue the append-oriented order",
  );
  const mismatch = await history.list(owner, {
    ...filters,
    action: "people.person-created",
    cursor: first.nextCursor,
  });
  assert(
    mismatch.status === "stale-cursor" && callCount() === 2,
    "mismatched cursor reached audit storage",
  );
  const forgedAnchor = await history.list(owner, {
    ...filters,
    cursor: forgeCursorAnchor(first.nextCursor),
  });
  assert(
    forgedAnchor.status === "stale-cursor" && callCount() === 2,
    "re-encoded valid anchor bypassed cursor authenticity",
  );
  const tampered = await history.list(owner, {
    ...filters,
    cursor: `${first.nextCursor}tampered`,
  });
  assert(
    tampered.status === "stale-cursor" && callCount() === 2,
    "tampered cursor reached audit storage",
  );
  const rotated = createAuditHistory({
    cursorKeyset: {
      activeVersion: 2,
      keys: new Map([
        [1, cursorKeyset.keys.get(1)!],
        [2, new Uint8Array(32).fill(0x32)],
      ]),
    },
    repository,
  });
  const retained = await rotated.list(owner, {
    ...filters,
    cursor: first.nextCursor,
  });
  assert(
    retained.status === "ready" && callCount() === 3,
    "retained cursor key did not survive rotation",
  );
  const retired = await createAuditHistory({
    cursorKeyset: {
      activeVersion: 2,
      keys: new Map([[2, new Uint8Array(32).fill(0x32)]]),
    },
    repository,
  }).list(owner, { ...filters, cursor: first.nextCursor });
  assert(
    retired.status === "stale-cursor" && callCount() === 3,
    "retired cursor key reached audit storage",
  );
});

Deno.test("[GAP-039] the request correlation in a payload is dropped, not shown or flagged", async () => {
  const requestId = "3f2a9c0d8e7b6a5f4e3d2c1b0a9f8e7d";
  const repository: AuditHistoryRepository = {
    list(command) {
      return Promise.resolve({
        items: [{
          action: "people.person-created",
          actor: { id: command.memberId, name: "Workspace owner" },
          id: "00000000-0000-4000-8000-000000000911",
          occurredAt: "2026-09-26T10:00:00.000Z",
          payload: { isPartial: false, requestId },
          subject: { type: "person" },
        }],
        status: "ready",
      });
    },
  };

  const result = await createAuditHistory({ cursorKeyset, repository }).list(
    actor("owner"),
    { limit: 20 },
  );

  assert(result.status === "ready", "audit history was unavailable");
  if (result.status !== "ready") return;
  assert(
    result.items[0]?.redacted === false &&
      JSON.stringify(result.items[0]?.details) ===
        JSON.stringify({ isPartial: false }) &&
      !JSON.stringify(result).includes(requestId),
    `operational correlation leaked into or flagged the history: ${
      JSON.stringify(result)
    }`,
  );
});
