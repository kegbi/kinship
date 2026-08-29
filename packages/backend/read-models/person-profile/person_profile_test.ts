import {
  createPersonProfile,
  PERSON_PROFILE_SECTION_IDS,
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
      (received as { readonly personId?: string }).personId === personId &&
      !("includeSummary" in (received as object)),
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

Deno.test("[UXD-013] person summary reuses due dates and counts every profile section", async () => {
  let received: unknown;
  const profile = createPersonProfile({
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
