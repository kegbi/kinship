import {
  createPersonProfile,
  type PersonProfileIdentity,
  type PersonProfileRepository,
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
  };
  const profile = createPersonProfile({ repository });

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
      (received as { readonly personId?: string }).personId === personId,
    "the active-workspace actor and canonical person ID reach the query",
  );
});

Deno.test("[APP-003C] person profile preserves archived, missing, and forbidden states", async () => {
  const statuses = ["archived", "not-found", "forbidden"] as const;
  for (const status of statuses) {
    const profile = createPersonProfile({
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
      },
    });
    const result = await profile.get(actor, personId);
    assert(result.status === status, `${status} remains distinguishable`);
  }
});

Deno.test("PEOPLE-006 hidden tag projection discloses no retained assignments", async () => {
  const profile = createPersonProfile({
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
    },
  });

  const result = await profile.get(actor, personId);
  assert(result.status === "ready", "profile remains available");
  assert(
    result.person.tagCount === 0 && result.person.tags.length === 0,
    "hidden module strips tag count and descriptors at composition",
  );
});

Deno.test("[PEOPLE-003] person life events use the read-only profile boundary", async () => {
  let received: unknown;
  const profile = createPersonProfile({
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
