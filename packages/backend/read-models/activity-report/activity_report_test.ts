import {
  type ActivityReportRepository,
  createActivityReport,
} from "./public.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("INTERACTION-001 activity report scopes one person and bounds its page", async () => {
  let calls = 0;
  let received: Parameters<ActivityReportRepository["list"]>[0] | undefined;
  const report = createActivityReport({
    repository: {
      list(command) {
        calls += 1;
        received = command;
        return Promise.resolve({
          items: [],
          next: {
            id: "00000000-0000-4000-8000-000000000900",
            timestamp: "2026-08-17T12:30:00.000Z",
          },
          person: { id: command.personId, name: "Ada" },
          status: "ready",
        });
      },
    },
  });
  const actor = {
    memberId: crypto.randomUUID(),
    role: "member" as const,
    userId: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
  };
  const personId = crypto.randomUUID();
  const result = await report.list(actor, personId, {
    kind: "activity",
    limit: 500,
    year: 2026,
  });
  assert(result.status === "ready", "report was not returned");
  assert(
    received?.workspaceId === actor.workspaceId &&
      received.personId === personId && received.kind === "activity" &&
      received.limit === 50 &&
      received.year === 2026,
    "actor, person, year, or bounded limit was lost",
  );
  assert(
    result.status === "ready" && Boolean(result.nextCursor),
    "repository continuation was not exposed as an opaque cursor",
  );
  if (result.status !== "ready" || !result.nextCursor) return;
  const cursorBody = JSON.parse(atob(
    result.nextCursor.replaceAll("-", "+").replaceAll("_", "/"),
  ));
  const tamperedCursor = btoa(JSON.stringify({
    ...cursorBody,
    id: "not-a-uuid",
  })).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  const tampered = await report.list(actor, personId, {
    cursor: tamperedCursor,
    kind: "activity",
    year: 2026,
  });
  assert(
    tampered.status === "stale-cursor" && calls === 1,
    "UUID-tampered cursor reached the repository",
  );
  const second = await report.list(actor, personId, {
    cursor: result.nextCursor,
    kind: "activity",
    limit: 20,
    year: 2026,
  });
  assert(
    second.status === "ready" && received?.after?.id ===
        "00000000-0000-4000-8000-000000000900",
    "valid continuation did not reach the repository",
  );
  const mismatched = await report.list(actor, crypto.randomUUID(), {
    cursor: result.nextCursor,
    kind: "activity",
    year: 2026,
  });
  assert(
    mismatched.status === "stale-cursor",
    "person-bound cursor was accepted in another context",
  );
  const mismatchedKind = await report.list(actor, personId, {
    cursor: result.nextCursor,
    kind: "note",
    year: 2026,
  });
  assert(
    mismatchedKind.status === "stale-cursor",
    "kind-bound cursor was accepted in another projection",
  );
});

Deno.test("INTERACTION-001 activity report continues after a workspace-derived interaction id", async () => {
  const timestamp = "2026-08-17T12:30:00.000Z";
  const note = (index: number) => ({
    body: `Paged note ${String(index).padStart(2, "0")}`,
    createdAt: timestamp,
    id: `00000000-0000-8000-8000-${String(index).padStart(12, "0")}`,
    isFavorited: false,
    kind: "note" as const,
    participants: [{
      id: "00000000-0000-4000-8000-000000000101",
      name: "Ada",
    }] as const,
  });
  const firstPage = Array.from({ length: 20 }, (_, index) => note(20 - index));
  let calls = 0;
  const report = createActivityReport({
    repository: {
      list(command) {
        calls += 1;
        return Promise.resolve({
          items: command.after ? [note(0)] : firstPage,
          ...(command.after ? {} : { next: { id: note(1).id, timestamp } }),
          person: { id: command.personId, name: "Ada" },
          status: "ready" as const,
        });
      },
    },
  });
  const actor = {
    memberId: crypto.randomUUID(),
    role: "member" as const,
    userId: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
  };
  const personId = crypto.randomUUID();
  const first = await report.list(actor, personId, { limit: 20 });
  assert(
    first.status === "ready" && first.items.length === 20 &&
      Boolean(first.nextCursor),
    "first bounded page did not expose its continuation",
  );
  if (first.status !== "ready" || !first.nextCursor) return;
  const second = await report.list(actor, personId, {
    cursor: first.nextCursor,
    limit: 20,
  });
  const older = second.status === "ready" ? second.items[0] : undefined;
  assert(
    second.status === "ready" && second.items.length === 1 &&
      older?.kind === "note" && older.body === "Paged note 00" && calls === 2,
    "workspace-derived cursor did not append the older page",
  );
});
