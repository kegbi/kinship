import {
  createPersonProfile,
  createPersonRail,
  PERSON_RAIL_FACT_SECTIONS,
  type PersonProfileRepository,
  type PersonRailSources,
} from "../public.ts";
import { assert, assertEquals } from "../../../testing/assert.ts";
import * as fixtures from "../../../testing/fixtures.ts";

const actor = fixtures.actor();
const personId = fixtures.personId();
const updatedAt = "2026-08-15T08:00:00.000Z";

const factPage = (section: string) => ({
  options: [],
  personUpdatedAt: updatedAt,
  records: [{ id: `${section}-record`, section }],
  status: "ready" as const,
});
const relationshipPage = { relationships: [], status: "ready" as const };
const typePage = { options: [], selected: [], status: "ready" as const };
const datePage = { dates: [], status: "archived" as const };
const reminderPage = { cadences: [], reminders: [], status: "ready" as const };

interface Recorded {
  readonly calls: string[];
  readonly actors: unknown[];
  inFlight: number;
  maxInFlight: number;
}

/**
 * Sources answering `answers` by section; an answer that is an `Error` is
 * thrown. Each read records its arguments and how many reads overlapped.
 */
function sources(
  answers: Readonly<Record<string, unknown>> = {},
): { readonly recorded: Recorded; readonly sources: PersonRailSources } {
  const recorded: Recorded = {
    actors: [],
    calls: [],
    inFlight: 0,
    maxInFlight: 0,
  };
  const read = async (
    key: string,
    fallback: unknown,
    received: unknown,
    ...args: unknown[]
  ) => {
    recorded.actors.push(received);
    recorded.calls.push([key, ...args.map((arg) => JSON.stringify(arg))].join(
      " ",
    ));
    recorded.inFlight += 1;
    recorded.maxInFlight = Math.max(recorded.maxInFlight, recorded.inFlight);
    await Promise.resolve();
    recorded.inFlight -= 1;
    const answer = key in answers ? answers[key] : fallback;
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return {
    recorded,
    sources: {
      facts: {
        list: (
          received: unknown,
          person: string,
          section: string,
          ...rest: unknown[]
        ) => read(section, factPage(section), received, person, ...rest),
      },
      importantDates: {
        list: (received: unknown, person: string) =>
          read("important-dates", datePage, received, person),
      },
      relationships: {
        list: (received: unknown, person: string, input: unknown) =>
          read("relationships", relationshipPage, received, person, input),
        listTypes: (received: unknown, ...rest: unknown[]) =>
          read("relationship-types", typePage, received, ...rest),
      },
      reminders: {
        listPerson: (received: unknown, person: string, input: unknown) =>
          read("reminders", reminderPage, received, person, input),
      },
    } as unknown as PersonRailSources,
  };
}

Deno.test("AUD-Q3 the rail reads each section's first page from its owning module, one at a time", async () => {
  const { recorded, sources: railSources } = sources();
  const rail = await createPersonRail(railSources)(actor, personId);

  const person = JSON.stringify(personId);
  assertEquals(recorded.calls, [
    ...PERSON_RAIL_FACT_SECTIONS.map((section) => `${section} ${person}`),
    `relationships ${person} {"limit":20}`,
    "relationship-types",
    `important-dates ${person}`,
    `reminders ${person} {"limit":20}`,
  ], "every first page is asked as its own endpoint asks it");
  assert(
    recorded.actors.every((received) => received === actor),
    "every module receives the request's own actor",
  );
  assert(recorded.maxInFlight === 1, "the reads never overlap");
  for (const section of PERSON_RAIL_FACT_SECTIONS) {
    assertEquals(rail[section], {
      status: "ready",
      value: factPage(section),
    }, `${section} is ready`);
  }
  assertEquals(rail.relationships, {
    status: "ready",
    value: { list: relationshipPage, types: typePage },
  }, "relationships come with their types");
  assertEquals(
    rail["important-dates"],
    { status: "ready", value: datePage },
    "an archived person's dates are still shown",
  );
  assertEquals(
    rail.reminders,
    { status: "ready", value: reminderPage },
    "reminders are ready",
  );
});

Deno.test("AUD-Q3 REL-127 a failing or refusing module affects only its own rail section", async () => {
  const { recorded, sources: railSources } = sources({
    addresses: { status: "not-found" },
    "contact-methods": new Error("connection reset"),
    "first-meeting": { status: "stale-cursor" },
    "important-dates": { status: "forbidden" },
    pets: { ...factPage("pets"), records: [], status: "hidden" },
    relationships: { relationships: [], status: "hidden" },
    reminders: { status: "validation-error" },
    tags: { status: "forbidden" },
    work: { ...factPage("work"), records: [], status: "hidden" },
  });
  const rail = await createPersonRail(railSources)(actor, personId);

  assertEquals(rail["contact-methods"], { status: "unavailable" }, "thrown");
  assertEquals(rail.addresses, { status: "unavailable" }, "not found");
  assertEquals(rail["first-meeting"], { status: "unavailable" }, "stale");
  assertEquals(rail.tags, { status: "forbidden" }, "a refused actor");
  assertEquals(rail.work, { status: "hidden" }, "a hidden module");
  assertEquals(rail.pets, { status: "hidden" }, "another hidden module");
  assertEquals(rail.relationships, { status: "hidden" }, "hidden edges");
  assert(
    !recorded.calls.includes("relationship-types"),
    "a hidden relationship list reads no vocabulary",
  );
  assertEquals(rail["important-dates"], { status: "forbidden" }, "refused");
  assertEquals(rail.reminders, { status: "unavailable" }, "invalid");
  assertEquals(rail["food-preferences"], {
    status: "ready",
    value: factPage("food-preferences"),
  }, "the sections beside them still answer");
});

Deno.test("REL-127 refused reminders are forbidden, never hidden", async () => {
  const { sources: railSources } = sources({
    reminders: { status: "forbidden" },
  });
  const rail = await createPersonRail(railSources)(actor, personId);
  assertEquals(rail.reminders, { status: "forbidden" }, "refused reminders");
  assertEquals(rail.pets.status, "ready", "the sections beside them answer");
});

Deno.test("AUD-Q3 relationships answer only when both their list and their types do", async () => {
  const cases = [
    [{ status: "forbidden" }, typePage, "forbidden"],
    [{ status: "not-found" }, typePage, "unavailable"],
    [relationshipPage, { status: "forbidden" }, "forbidden"],
    [
      relationshipPage,
      { options: [], selected: [], status: "hidden" },
      "hidden",
    ],
    [relationshipPage, { status: "stale-cursor" }, "unavailable"],
    [relationshipPage, new Error("types failed"), "unavailable"],
  ] as const;
  for (const [list, types, expected] of cases) {
    const { sources: railSources } = sources({
      "relationship-types": types,
      relationships: list,
    });
    const rail = await createPersonRail(railSources)(actor, personId);
    assertEquals(
      rail.relationships.status,
      expected,
      `${JSON.stringify(list)} with ${
        types instanceof Error ? "a failure" : JSON.stringify(types)
      }`,
    );
  }
});

const profileRepository = (
  status: "forbidden" | "not-found" | "ready",
  received: unknown[],
): PersonProfileRepository => ({
  get(command) {
    received.push(command);
    if (status !== "ready") return Promise.resolve({ status });
    return Promise.resolve({
      dueInformation: { openTaskCount: 0 },
      person: {
        givenName: "Ada",
        id: personId,
        isDeceased: false,
        isPartial: false,
        isSelf: false,
        isStarred: false,
        tagCount: 0,
        tags: [],
        updatedAt,
      },
      status: "ready",
      summary: {
        primaryContactMethods: [],
        relationshipCounts: [],
        sectionCounts: [],
      },
    });
  },
  listLifeEvents: () =>
    Promise.resolve({ events: [], status: "ready", types: [] }),
  listTimeline: () => Promise.resolve({ items: [], status: "ready" }),
});

const profileWith = (
  status: "forbidden" | "not-found" | "ready",
  rail?: PersonRailSources,
  revalidated: "active" | "revoked" = "active",
) => {
  const received: unknown[] = [];
  const profile = createPersonProfile({
    actors: { revalidate: () => Promise.resolve(revalidated) },
    ...(rail ? { rail } : {}),
    repository: profileRepository(status, received),
    transaction: { run: (work) => work({ opaque: undefined }) },
  });
  return { profile, received };
};

Deno.test("AUD-Q3 a person read with the rail carries the summary and composes the rail", async () => {
  const { recorded, sources: railSources } = sources();
  const { profile, received } = profileWith("ready", railSources);

  const result = await profile.get(actor, personId, { includeRail: true });

  assert(result.status === "ready", "the person is ready");
  assert(
    (received[0] as { readonly includeSummary?: boolean }).includeSummary ===
      true,
    "the rail implies the summary",
  );
  assert(result.summary !== undefined, "the summary is answered");
  assert(result.rail?.tags.status === "ready", "the rail is answered");
  assert(recorded.calls.length === 11, "each rail read ran once");

  const plain = await profile.get(actor, personId, { includeSummary: true });
  assert(
    plain.status === "ready" && plain.rail === undefined,
    "a summary read composes no rail",
  );
  assert(recorded.calls.length === 11, "a summary read reads no rail");
});

Deno.test("AUD-Q3 the rail is composed only for a person the actor may read", async () => {
  for (const status of ["forbidden", "not-found"] as const) {
    const { recorded, sources: railSources } = sources();
    const { profile } = profileWith(status, railSources);
    const result = await profile.get(actor, personId, { includeRail: true });
    assert(result.status === status, `${status} is answered as such`);
    assert(recorded.calls.length === 0, `${status} reads no rail section`);
  }
  const { recorded, sources: railSources } = sources();
  const { profile, received } = profileWith("ready", railSources, "revoked");
  const refused = await profile.get(
    { ...actor },
    personId,
    { includeRail: true },
  );
  assert(refused.status === "forbidden", "a revoked actor is refused");
  assert(
    received.length === 0 && recorded.calls.length === 0,
    "a revoked actor reads neither the person nor the rail",
  );
});

Deno.test("AUD-Q3 a composition without the module reads answers every rail section unavailable", async () => {
  const { profile } = profileWith("ready");
  const result = await profile.get(actor, personId, { includeRail: true });
  assert(result.status === "ready" && result.rail, "the rail is answered");
  assertEquals(
    Object.values(result.rail).map((section) => section.status),
    Array(10).fill("unavailable"),
    "no section claims to be ready or hidden",
  );
});
