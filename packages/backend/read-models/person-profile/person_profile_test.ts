import {
  createPersonProfile,
  PERSON_PROFILE_SECTION_IDS,
  type PersonProfileIdentity,
  type PersonProfileRepository,
  type PersonTimelineItem,
} from "./public.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const actor = {
  memberId: "00000000-0000-4000-8000-000000000002",
  role: "member" as const,
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000003",
};
const personId = "00000000-0000-4000-8000-000000000100";
const listLifeEvents: PersonProfileRepository["listLifeEvents"] = () =>
  Promise.resolve({ events: [], status: "ready" });
const listTimeline: PersonProfileRepository["listTimeline"] = () =>
  Promise.resolve({ items: [], status: "ready" });

Deno.test("[PEOPLE-004] profile implementations require a lifecycle version", () => {
  // @ts-expect-error updatedAt is required at the public read-model boundary.
  const incomplete: PersonProfileIdentity = {
    givenName: "Ada",
    id: personId,
    isDeceased: false,
    isPartial: false,
    isSelf: false,
    isStarred: false,
    tagCount: 0,
    tags: [],
  };
  assert(
    incomplete.updatedAt === undefined,
    "invalid fixture stays compile-only",
  );
});

Deno.test("[APP-003C] person profile composes orientation through one read-only query", async () => {
  let received: unknown;
  const repository: PersonProfileRepository = {
    get(command) {
      received = command;
      return Promise.resolve({
        dueInformation: {
          nextReminderAt: "2026-08-20T09:00:00.000Z",
          openTaskCount: 2,
          stayInTouchAt: "2026-08-21T09:00:00.000Z",
        },
        person: {
          description: "Mathematician and correspondent.",
          familyName: "Lovelace",
          gender: "Woman",
          givenName: "Ada",
          id: personId,
          isDeceased: true,
          isPartial: false,
          isSelf: false,
          isStarred: true,
          tagCount: 1,
          tags: [{
            id: "00000000-0000-4000-8000-000000000200",
            name: "Friend",
          }],
          updatedAt: "2026-08-15T08:00:00.000Z",
        },
        status: "ready",
      });
    },
    listLifeEvents,
    listTimeline,
  };
  const profile = createPersonProfile({
    actors: { revalidate: () => Promise.resolve("active" as const) },
    transaction: { run: (work) => work({ opaque: undefined }) },
    repository,
  });

  const result = await profile.get(actor, personId);

  assert(result.status === "ready", "profile is ready");
  assert(
    result.person.description === "Mathematician and correspondent." &&
      result.person.tags[0]?.name === "Friend" &&
      result.person.isStarred && result.person.isDeceased,
    "orientation fields remain intact",
  );
  assert(
    result.dueInformation.status === "ready" &&
      result.dueInformation.openTaskCount === 2 &&
      result.dueInformation.detail.includes("next reminder"),
    "the delivered planning projection is composed with orientation",
  );
  assert(
    (received as { readonly workspaceId?: string; readonly personId?: string })
          .workspaceId === actor.workspaceId &&
      (received as { readonly personId?: string }).personId === personId &&
      !("includeSummary" in (received as object)),
    "the active-workspace actor and canonical person ID reach the query",
  );
});

Deno.test("[APP-003C] person profile preserves archived, missing, and forbidden states", async () => {
  const statuses = ["archived", "not-found", "forbidden"] as const;
  for (const status of statuses) {
    const profile = createPersonProfile({
      actors: { revalidate: () => Promise.resolve("active" as const) },
      transaction: { run: (work) => work({ opaque: undefined }) },
      repository: {
        get: () =>
          Promise.resolve(
            status === "archived"
              ? {
                dueInformation: { openTaskCount: 0 },
                person: {
                  givenName: "Harriet",
                  id: personId,
                  isDeceased: false,
                  isPartial: false,
                  isSelf: false,
                  isStarred: false,
                  tagCount: 0,
                  tags: [],
                  updatedAt: "2026-08-15T08:00:00.000Z",
                },
                status,
              }
              : { status },
          ),
        listLifeEvents,
        listTimeline,
      },
    });
    const result = await profile.get(actor, personId);
    assert(result.status === status, `${status} remains distinguishable`);
  }
});

Deno.test("PEOPLE-006 hidden tag projection discloses no retained assignments", async () => {
  const profile = createPersonProfile({
    actors: { revalidate: () => Promise.resolve("active" as const) },
    transaction: { run: (work) => work({ opaque: undefined }) },
    repository: {
      get: () =>
        Promise.resolve({
          dueInformation: { openTaskCount: 0 },
          person: {
            givenName: "Ada",
            id: personId,
            isDeceased: false,
            isPartial: false,
            isSelf: false,
            isStarred: false,
            profileSections: [{ id: "tags", status: "hidden" }],
            tagCount: 2,
            tags: [
              { id: crypto.randomUUID(), name: "Private" },
              { id: crypto.randomUUID(), name: "Retained" },
            ],
            updatedAt: "2026-08-15T08:00:00.000Z",
          },
          status: "ready" as const,
        }),
      listLifeEvents,
      listTimeline,
    },
  });

  const result = await profile.get(actor, personId);
  assert(result.status === "ready", "profile remains available");
  assert(
    result.person.tagCount === 0 && result.person.tags.length === 0,
    "hidden module strips tag count and descriptors at composition",
  );
});

Deno.test("[UXD-013] person summary reuses due dates and counts every profile section", async () => {
  let received: unknown;
  const profile = createPersonProfile({
    actors: { revalidate: () => Promise.resolve("active" as const) },
    transaction: { run: (work) => work({ opaque: undefined }) },
    repository: {
      get(command) {
        received = command;
        return Promise.resolve({
          dueInformation: {
            nextReminderAt: "2026-08-20T09:00:00.000Z",
            openTaskCount: 3,
            stayInTouchAt: "2026-08-21T09:00:00.000Z",
          },
          person: {
            givenName: "Ada",
            id: personId,
            isDeceased: false,
            isPartial: false,
            isSelf: false,
            isStarred: false,
            profileSections: PERSON_PROFILE_SECTION_IDS.map((id) => ({
              id,
              status: "ready" as const,
            })),
            tagCount: 0,
            tags: [],
            updatedAt: "2026-08-15T08:00:00.000Z",
          },
          status: "ready",
          summary: {
            primaryContactMethods: [
              {
                href: "mailto:ada@example.test",
                id: crypto.randomUUID(),
                kind: "email",
                label: "Email",
                value: "ada@example.test",
              },
              {
                href: "tel:+381111111",
                id: crypto.randomUUID(),
                kind: "phone",
                label: "Phone",
                value: "+381111111",
              },
              {
                id: crypto.randomUUID(),
                kind: "social",
                label: "Social",
                value: "@ada",
              },
              {
                id: crypto.randomUUID(),
                kind: "custom",
                label: "Other",
                value: "fourth",
              },
            ],
            relationshipCounts: [{
              count: 2,
              label: "friend",
              relationshipTypeId: crypto.randomUUID(),
            }],
            sectionCounts: [
              { count: 2, id: "activities" },
              { count: 12, id: "notes" },
              { count: 3, id: "tasks" },
            ],
          },
        });
      },
      listLifeEvents,
      listTimeline,
    },
  });

  const result = await profile.get(actor, personId, { includeSummary: true });

  assert(result.status === "ready" && result.summary, "summary is ready");
  assert(
    (received as { readonly includeSummary?: boolean }).includeSummary ===
        true && result.summary.sectionCounts.length ===
        PERSON_PROFILE_SECTION_IDS.length,
    "one summary command fills every stable section ID",
  );
  const notes = result.summary.sectionCounts.find((entry) =>
    entry.id === "notes"
  );
  const calls = result.summary.sectionCounts.find((entry) =>
    entry.id === "calls"
  );
  assert(
    notes?.status === "ready" && notes.count === 12 &&
      calls?.status === "ready" && calls.count === 0,
    "recorded and empty ready sections have distinct correct counts",
  );
  assert(
    result.summary.primaryContactMethods.length === 3 &&
      result.summary.relationshipCounts[0]?.count === 2 &&
      result.summary.nextReminderAt ===
        result.dueInformation.nextReminderAt &&
      result.summary.stayInTouchAt === result.dueInformation.stayInTouchAt,
    "contact previews are bounded and due dates reuse the delivered projection",
  );
});

Deno.test("[UXD-013] hidden summary sections disclose neither counts nor retained previews", async () => {
  const profile = createPersonProfile({
    actors: { revalidate: () => Promise.resolve("active" as const) },
    transaction: { run: (work) => work({ opaque: undefined }) },
    repository: {
      get: () =>
        Promise.resolve({
          dueInformation: { openTaskCount: 0 },
          person: {
            givenName: "Ada",
            id: personId,
            isDeceased: false,
            isPartial: false,
            isSelf: false,
            isStarred: false,
            profileSections: [
              { id: "contact-methods", status: "hidden" },
              { id: "notes", status: "hidden" },
              { id: "relationships", status: "hidden" },
            ],
            tagCount: 0,
            tags: [],
            updatedAt: "2026-08-15T08:00:00.000Z",
          },
          status: "ready",
          summary: {
            primaryContactMethods: [{
              href: "mailto:retained@example.test",
              id: crypto.randomUUID(),
              kind: "email",
              label: "Email",
              value: "retained@example.test",
            }],
            relationshipCounts: [{
              count: 4,
              label: "friend",
              relationshipTypeId: crypto.randomUUID(),
            }],
            sectionCounts: [{ count: 7, id: "notes" }],
          },
        }),
      listLifeEvents,
      listTimeline,
    },
  });

  const result = await profile.get(actor, personId, { includeSummary: true });
  assert(result.status === "ready" && result.summary, "summary is ready");
  const hiddenNotes = result.summary.sectionCounts.find((entry) =>
    entry.id === "notes"
  );
  assert(
    hiddenNotes?.status === "hidden" && !("count" in hiddenNotes),
    "a hidden section has no count rather than a misleading zero",
  );
  assert(
    result.summary.primaryContactMethods.length === 0 &&
      result.summary.relationshipCounts.length === 0,
    "hidden summary modules do not disclose retained preview data",
  );
});

Deno.test("[PEOPLE-003] person life events use the read-only profile boundary", async () => {
  let received: unknown;
  const profile = createPersonProfile({
    actors: { revalidate: () => Promise.resolve("active" as const) },
    transaction: { run: (work) => work({ opaque: undefined }) },
    repository: {
      get: () => Promise.resolve({ status: "not-found" }),
      listLifeEvents(command) {
        received = command;
        return Promise.resolve({
          events: [{
            date: { month: 12, precision: "year_month", year: 1843 },
            id: crypto.randomUUID(),
            name: "Published Notes",
          }],
          status: "ready",
        });
      },
      listTimeline,
    },
  });

  const result = await profile.listLifeEvents(actor, personId);

  assert(
    result.status === "ready" && result.events[0]?.name === "Published Notes",
    "life-event history remains available without a new write path",
  );
  assert(
    (received as { readonly workspaceId?: string }).workspaceId ===
        actor.workspaceId &&
      (received as { readonly personId?: string }).personId === personId,
    "life-event reads preserve the active-workspace actor",
  );
});

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
