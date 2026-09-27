import {
  createPersonProfile,
  type PersonProfileRepository,
  type PersonTimelineItem,
} from "../public.ts";
import { assert } from "../../../testing/assert.ts";
import * as fixtures from "../../../testing/fixtures.ts";

const actor = fixtures.actor();
const personId = fixtures.personId();
const listLifeEvents: PersonProfileRepository["listLifeEvents"] = () =>
  Promise.resolve({ events: [], status: "ready", types: [] });

Deno.test("[UXD-002C2A] person timeline bounds filters and round-trips its opaque cursor", async () => {
  const timestamps = {
    created: "2026-08-20T08:30:00.000000Z",
    happened: "2026-08-22T10:00:00.000000Z",
    partial: "1843-12-01T00:00:00.000000Z",
  };
  const items: readonly PersonTimelineItem[] = [
    {
      datePrecision: "full",
      id: "00000000-0000-4000-8000-000000000301",
      kind: "life-event",
      occurredAt: timestamps.happened,
      title: "Timestamped event",
    },
    {
      calendarDate: { year: 1843, month: 12 },
      datePrecision: "year_month",
      id: "00000000-0000-4000-8000-000000000302",
      kind: "life-event",
      occurredAt: timestamps.partial,
      title: "Partial event",
    },
    {
      datePrecision: "unknown",
      id: "00000000-0000-4000-8000-000000000303",
      kind: "life-event",
      occurredAt: timestamps.created,
      title: "Undated event",
    },
  ];
  const commands: Parameters<PersonProfileRepository["listTimeline"]>[0][] = [];
  const profile = createPersonProfile({
    actors: { revalidate: () => Promise.resolve("active" as const) },
    transaction: { run: (work) => work({ opaque: undefined }) },
    repository: {
      get: () => Promise.resolve({ status: "not-found" }),
      listLifeEvents,
      listTimeline(command) {
        commands.push(command);
        return Promise.resolve({
          items,
          next: {
            id: "00000000-0000-4000-8000-000000000303",
            timestamp: timestamps.created,
          },
          status: "ready",
        });
      },
    },
  });

  const first = await profile.listTimeline(actor, personId, {
    kind: "life-event",
    limit: 500,
  });
  assert(
    first.status === "ready" && first.items === items &&
      Boolean(first.nextCursor),
    "the lean projection and continuation are returned unchanged",
  );
  assert(
    commands[0]?.kind === "life-event" && commands[0]?.limit === 50,
    "kind filtering reaches the repository and the upper limit is clamped",
  );
  assert(
    first.status === "ready" &&
      first.items.map((item) => item.datePrecision).join(",") ===
        "full,year_month,unknown" &&
      first.items.map((item) => item.occurredAt).join(",") ===
        `${timestamps.happened},${timestamps.partial},${timestamps.created}`,
    "timestamped, component-built, and recorded-date life events retain their precisions",
  );
  assert(
    first.status === "ready" && first.items[1]?.calendarDate?.year === 1843 &&
      first.items[1]?.calendarDate?.day === undefined,
    "APR-009 application boundary preserves optional calendar components",
  );
  if (first.status !== "ready" || !first.nextCursor) return;

  const second = await profile.listTimeline(actor, personId, {
    cursor: first.nextCursor,
    kind: "life-event",
    limit: 0,
  });
  assert(
    second.status === "ready" && commands[1]?.limit === 1 &&
      commands[1]?.after?.id ===
        "00000000-0000-4000-8000-000000000303" &&
      commands[1]?.after?.timestamp === timestamps.created,
    "a valid cursor decodes byte-for-byte and the lower limit is clamped",
  );
});

Deno.test("[UXD-002C2A] person timeline rejects every stale cursor shape before querying", async () => {
  let calls = 0;
  const profile = createPersonProfile({
    actors: { revalidate: () => Promise.resolve("active" as const) },
    transaction: { run: (work) => work({ opaque: undefined }) },
    repository: {
      get: () => Promise.resolve({ status: "not-found" }),
      listLifeEvents,
      listTimeline: () => {
        calls += 1;
        return Promise.resolve({ items: [], status: "ready" });
      },
    },
  });
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_")
      .replaceAll("=", "");
  const valid = {
    id: "00000000-0000-4000-8000-000000000303",
    kind: "note",
    personId,
    timestamp: "2026-08-20T08:30:00.000000Z",
    version: 1,
    workspaceId: actor.workspaceId,
  };
  const stale = [
    "not-base64-json",
    encode({ ...valid, version: 2 }),
    encode({ ...valid, workspaceId: crypto.randomUUID() }),
    encode({ ...valid, personId: crypto.randomUUID() }),
    encode({ ...valid, kind: "call" }),
    encode({ ...valid, id: "not-a-uuid" }),
    encode({ ...valid, timestamp: "not-a-timestamp" }),
  ];
  for (const cursor of stale) {
    const result = await profile.listTimeline(actor, personId, {
      cursor,
      kind: "note",
    });
    assert(result.status === "stale-cursor", "invalid cursor was accepted");
  }
  assert(calls === 0, "stale cursors never reach the repository");

  const repositoryStale = createPersonProfile({
    actors: { revalidate: () => Promise.resolve("active" as const) },
    transaction: { run: (work) => work({ opaque: undefined }) },
    repository: {
      get: () => Promise.resolve({ status: "not-found" }),
      listLifeEvents,
      listTimeline: () => Promise.resolve({ status: "stale-cursor" }),
    },
  });
  const result = await repositoryStale.listTimeline(actor, personId);
  assert(
    result.status === "stale-cursor",
    "a deleted or newly hidden cursor anchor remains explicitly stale",
  );
});
