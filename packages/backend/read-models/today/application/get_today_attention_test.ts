import {
  createTodayAttention,
  type TodayAttentionItem,
  type TodayAttentionRepository,
  todayAttentionWindow,
} from "../public.ts";
import { assert } from "../../../testing/assert.ts";
import * as fixtures from "../../../testing/fixtures.ts";
import { fixedClock } from "../../../testing/fakes.ts";

const actor = fixtures.actor();

Deno.test("TODAY-001 groups actual event dates instead of advance notification dates", async () => {
  const items: TodayAttentionItem[] = [
    {
      id: "november",
      kind: "important-date",
      title: "November birthday",
      occursOn: "2026-11-22",
      dueAt: "2026-10-23T09:00:00Z",
    },
    {
      id: "october",
      kind: "important-date",
      title: "October birthday",
      occursOn: "2026-10-28",
      dueAt: "2026-10-21T09:00:00Z",
    },
    {
      id: "today",
      kind: "life-event",
      title: "Today event",
      occursOn: "2026-10-19",
      dueAt: "2026-10-12T09:00:00Z",
    },
  ];
  const read = async (now: string) =>
    await createTodayAttention({
      actors: { revalidate: () => Promise.resolve("active" as const) },
      transaction: { run: (work) => work({ opaque: undefined }) },
      clock: fixedClock(now),
      repository: {
        getSnapshot: () =>
          Promise.resolve({
            items,
            status: "ready",
            timezone: "Europe/Belgrade",
          }),
      },
    }).get(actor);
  const october = await read("2026-10-18T22:30:00Z");
  assert(
    october.status === "ready" && october.attention.today[0]?.id === "today" &&
      october.attention.nextSevenDays.length === 0 &&
      october.upcoming.length === 1 && october.upcoming[0]?.id === "october",
    "October 19 must show October 28 only in Upcoming and exclude November 22",
  );
  const seventh = await read("2026-10-21T12:00:00Z");
  assert(
    seventh.status === "ready" &&
      seventh.attention.nextSevenDays[0]?.id === "october",
    "October 28 enters Next seven days on October 21 regardless of delivery",
  );
});

Deno.test("TODAY-001 groups and bounds attention in the member timezone", async () => {
  let query: Parameters<TodayAttentionRepository["getSnapshot"]>[0] | undefined;
  const projection = createTodayAttention({
    actors: { revalidate: () => Promise.resolve("active" as const) },
    transaction: { run: (work) => work({ opaque: undefined }) },
    clock: fixedClock("2026-03-29T00:30:00.000Z"),
    repository: {
      getSnapshot(command) {
        query = command;
        return Promise.resolve({
          items: [{
            dueAt: "2026-03-28T22:59:00.000Z",
            id: "00000000-0000-4000-8000-000000000901",
            kind: "task",
            title: "Overdue task",
          }, {
            channel: "in_app",
            dueAt: "2026-03-29T21:59:00.000Z",
            id: "00000000-0000-4000-8000-000000000902",
            kind: "reminder",
            occursOn: "2026-03-29",
            reminderStatus: "pending",
            title: "Today reminder",
          }, {
            dueAt: "2026-03-29T21:58:00.000Z",
            id: "00000000-0000-4000-8000-000000000904",
            kind: "important-date",
            occursOn: "2026-03-29",
            title: "Today important date",
          }, {
            dueAt: "2026-03-29T21:58:30.000Z",
            id: "00000000-0000-4000-8000-000000000905",
            kind: "life-event",
            occursOn: "2026-03-29",
            title: "Today life event",
          }, {
            dueAt: "2026-04-07T22:00:00.000Z",
            id: "00000000-0000-4000-8000-000000000903",
            kind: "cadence",
            person: {
              archived: false,
              id: "00000000-0000-4000-8000-000000000100",
              name: "Ada",
            },
            title: "Reconnect with Ada",
          }],
          status: "ready",
          timezone: "Europe/Belgrade",
        });
      },
    },
  });

  const result = await projection.get(actor);
  assert(result.status === "ready", "attention projection was forbidden");
  assert(
    query?.now.toISOString() === "2026-03-29T00:30:00.000Z" &&
      todayAttentionWindow(query.now, "Europe/Belgrade").todayStart
          .toISOString() === "2026-03-28T23:00:00.000Z" &&
      todayAttentionWindow(query.now, "Europe/Belgrade").tomorrowStart
          .toISOString() === "2026-03-29T22:00:00.000Z",
    "DST-local day boundaries were not preserved",
  );
  assert(
    query.perAttentionGroupLimit === 20 && query.upcomingLimit === 30,
    "attention or upcoming query was not hard bounded",
  );
  assert(
    result.attention.overdue[0]?.title === "Overdue task" &&
      result.attention.today[0]?.title === "Today important date" &&
      result.attention.today[1]?.title === "Today life event" &&
      result.attention.today[2]?.title === "Today reminder" &&
      result.upcoming[0]?.title === "Reconnect with Ada",
    "attention groups did not use local calendar boundaries",
  );
});

Deno.test("TODAY-001 stops before querying data for an unauthorized actor", async () => {
  let queried = false;
  const result = await createTodayAttention({
    actors: { revalidate: () => Promise.resolve("active" as const) },
    transaction: { run: (work) => work({ opaque: undefined }) },
    clock: { now: () => new Date() },
    repository: {
      getSnapshot: () => {
        queried = true;
        return Promise.resolve({ status: "forbidden" });
      },
    },
  }).get(actor);
  assert(
    result.status === "forbidden" && queried,
    "unauthorized Today snapshot did not fail closed",
  );
});

Deno.test("TODAY-001 uses kind for stable bounded ties and deterministic deduplication", async () => {
  const task = (
    id: string,
    dueAt: string,
  ) => ({ dueAt, id, kind: "task", title: "Same title" } as const);
  const pair = (id: string, dueAt: string): TodayAttentionItem[] => [
    task(id, dueAt),
    {
      ...task(id, dueAt),
      kind: "reminder",
      channel: "in_app",
      occursOn: dueAt.slice(0, 10),
      reminderStatus: "pending",
    },
  ];
  const [attentionTieId, upcomingTieId] = [
    "00000000-0000-4000-8000-000000000998",
    "00000000-0000-4000-8000-000000000999",
  ];
  const fillers = (length: number, dueAt: string) =>
    Array.from({ length }, () => task(crypto.randomUUID(), dueAt));
  let items: TodayAttentionItem[] = [
    task("00000000-0000-4000-8000-000000000997", "2026-08-17T09:00:00.000Z"),
    task("00000000-0000-4000-8000-000000000997", "2026-08-16T09:00:00.000Z"),
    ...fillers(19, "2026-08-19T08:00:00.000Z"),
    ...pair(attentionTieId, "2026-08-20T08:00:00.000Z"),
    ...fillers(29, "2026-08-27T08:00:00.000Z"),
    ...pair(upcomingTieId, "2026-08-28T08:00:00.000Z"),
  ];
  const projection = createTodayAttention({
    actors: { revalidate: () => Promise.resolve("active" as const) },
    transaction: { run: (work) => work({ opaque: undefined }) },
    clock: fixedClock("2026-08-18T12:00:00.000Z"),
    repository: {
      getSnapshot: () =>
        Promise.resolve({ items, status: "ready", timezone: "UTC" }),
    },
  });
  const forward = await projection.get(actor);
  items = [...items].reverse();
  const reversed = await projection.get(actor);
  assert(
    forward.status === "ready" && reversed.status === "ready",
    "tie projection was forbidden",
  );
  const keys = (values: readonly TodayAttentionItem[]) =>
    values.map((item) => `${item.kind}:${item.id}`);
  const attention = keys(forward.attention.nextSevenDays);
  const upcoming = keys(forward.upcoming);
  assert(
    attention.length === 20 && upcoming.length === 30 &&
      attention.join() === keys(reversed.attention.nextSevenDays).join() &&
      upcoming.join() === keys(reversed.upcoming).join() &&
      attention.includes(`reminder:${attentionTieId}`) &&
      upcoming.includes(`reminder:${upcomingTieId}`) &&
      forward.attention.overdue[0]?.dueAt === "2026-08-16T09:00:00.000Z",
    "cross-kind cutoff tie was unstable, duplicated, or lost",
  );
});
