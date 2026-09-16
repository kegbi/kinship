import {
  createPeopleDirectory,
  type PeopleDirectoryPersonRecord,
  type PeopleDirectoryRepository,
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

function record(index: number): PeopleDirectoryPersonRecord {
  const id = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  return {
    cursor: { id, primary: `person-${index}`, secondary: "family" },
    familyName: "Family",
    givenName: `Person ${index}`,
    id,
    isPartial: false,
    isStarred: index === 1,
    lifecycle: "active",
    tagCount: 0,
    tags: [],
  };
}

Deno.test("PEOPLE-002 directory never emits more than the fixed person tag preview", async () => {
  const tags = Array.from({ length: 8 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
    name: `Tag ${index + 1}`,
  }));
  const directory = createPeopleDirectory({
    actors: { revalidate: () => Promise.resolve("active" as const) },
    transaction: { run: (work) => work({ opaque: undefined }) },
    repository: {
      list: () =>
        Promise.resolve({
          people: [{ ...record(1), tagCount: tags.length, tags }],
          status: "ready",
        }),
    },
  });

  const result = await directory.list(actor, {});
  assert(result.status === "ready", "directory is ready");
  assert(
    result.people[0]?.tags.length === 5 &&
      result.people[0]?.tagCount === tags.length,
    "tag preview is capped without losing the exact total",
  );
});

Deno.test("PEOPLE-002 directory normalizes criteria and emits a bounded opaque cursor", async () => {
  const calls: Parameters<PeopleDirectoryRepository["list"]>[0][] = [];
  const repository: PeopleDirectoryRepository = {
    list(command) {
      calls.push(command);
      return Promise.resolve({
        people: [record(1), record(2), record(3)],
        status: "ready",
      });
    },
  };
  const directory = createPeopleDirectory({
    actors: { revalidate: () => Promise.resolve("active" as const) },
    transaction: { run: (work) => work({ opaque: undefined }) },
    repository,
  });

  const first = await directory.list(actor, {
    excludePersonId: record(9).id,
    lifecycle: "active",
    limit: 2,
    search: "  Ada  ",
    sort: "family-name",
  });
  assert(first.status === "ready", "first directory page is ready");
  assert(first.people.length === 2 && first.nextCursor, "page is bounded");
  assert(
    calls[0]?.workspaceId === actor.workspaceId &&
      calls[0]?.search === "Ada" && calls[0]?.limit === 2 &&
      calls[0]?.excludePersonId === record(9).id,
    "normalized criteria and actor reach the repository",
  );

  await directory.list(actor, {
    cursor: first.nextCursor,
    excludePersonId: record(9).id,
    lifecycle: "active",
    limit: 2,
    search: "Ada",
    sort: "family-name",
  });
  assert(
    calls[1]?.after?.id === record(2).id &&
      calls[1]?.after?.primary === "person-2",
    "opaque cursor resumes after the final emitted person",
  );
  const mismatchedExclude = await directory.list(actor, {
    cursor: first.nextCursor,
    excludePersonId: record(8).id,
    lifecycle: "active",
    limit: 2,
    search: "Ada",
    sort: "family-name",
  });
  assert(
    mismatchedExclude.status === "stale-cursor" && calls.length === 2,
    "exclude-person criteria is bound into the opaque cursor",
  );
});

Deno.test("PEOPLE-002 directory rejects malformed, mismatched, and stale cursors", async () => {
  let calls = 0;
  const repository: PeopleDirectoryRepository = {
    list() {
      calls += 1;
      return Promise.resolve({ status: "stale-cursor" });
    },
  };
  const directory = createPeopleDirectory({
    actors: { revalidate: () => Promise.resolve("active" as const) },
    transaction: { run: (work) => work({ opaque: undefined }) },
    repository,
  });
  const malformed = await directory.list(actor, { cursor: "not-a-cursor" });
  assert(malformed.status === "stale-cursor", "malformed cursor is stale");
  assert(calls === 0, "malformed cursor does not query persistence");

  const source = createPeopleDirectory({
    actors: { revalidate: () => Promise.resolve("active" as const) },
    transaction: { run: (work) => work({ opaque: undefined }) },
    repository: {
      list: () =>
        Promise.resolve({
          people: [record(1), record(2)],
          status: "ready",
        }),
    },
  });
  const page = await source.list(actor, { limit: 1, search: "Ada" });
  assert(page.status === "ready" && page.nextCursor, "source cursor exists");
  const mismatched = await directory.list(actor, {
    cursor: page.nextCursor,
    limit: 1,
    search: "Grace",
  });
  assert(mismatched.status === "stale-cursor", "criteria mismatch is stale");
  assert(calls === 0, "mismatched cursor does not query persistence");

  const stale = await directory.list(actor, {
    cursor: page.nextCursor,
    limit: 1,
    search: "Ada",
  });
  assert(
    stale.status === "stale-cursor" && Number(calls) === 1,
    "adapter stale state propagates",
  );
});

Deno.test("PEOPLE-002 directory preserves forbidden without disclosure", async () => {
  const directory = createPeopleDirectory({
    actors: { revalidate: () => Promise.resolve("active" as const) },
    transaction: { run: (work) => work({ opaque: undefined }) },
    repository: { list: () => Promise.resolve({ status: "forbidden" }) },
  });
  const result = await directory.list(actor, {});
  assert(result.status === "forbidden", "authorization denial is explicit");
});

Deno.test("PEOPLE-006 directory hydrates one selected active tenant person outside the page", async () => {
  const selectedId = "00000000-0000-4000-8000-000000000099";
  const selected = {
    cursor: { id: selectedId, primary: "charles", secondary: "babbage" },
    familyName: "Babbage",
    givenName: "Charles",
    id: selectedId,
    isPartial: false,
    isStarred: false,
    lifecycle: "active" as const,
    tagCount: 0,
    tags: [],
  };
  const directory = createPeopleDirectory({
    actors: { revalidate: () => Promise.resolve("active" as const) },
    transaction: { run: (work) => work({ opaque: undefined }) },
    repository: {
      findSelected: ({ personId }) =>
        Promise.resolve(personId === selectedId ? selected : undefined),
      list: () => Promise.resolve({ people: [], status: "ready" }),
    },
  });

  const result = await directory.list(actor, { selectedPersonId: selectedId });
  assert(result.status === "ready", "selected lookup is ready");
  assert(
    result.selected?.id === selectedId &&
      result.selected.givenName === "Charles",
    "selected descriptor is returned outside the bounded page",
  );
  const self = await directory.list(actor, {
    excludePersonId: selectedId,
    selectedPersonId: selectedId,
  });
  assert(
    self.status === "ready" && self.selected === undefined,
    "the profile subject is concealed from selected introducer hydration",
  );
});

Deno.test("PEOPLE-006 selected hydration is bound to the requested lifecycle", async () => {
  const selectedId = "00000000-0000-4000-8000-000000000098";
  const lifecycles: string[] = [];
  const directory = createPeopleDirectory({
    actors: { revalidate: () => Promise.resolve("active" as const) },
    transaction: { run: (work) => work({ opaque: undefined }) },
    repository: {
      findSelected: ({ lifecycle, personId }) => {
        lifecycles.push(lifecycle);
        return Promise.resolve(
          personId === selectedId && lifecycle === "archived"
            ? {
              cursor: {
                id: selectedId,
                primary: "harriet",
                secondary: "tubman",
              },
              familyName: "Tubman",
              givenName: "Harriet",
              id: selectedId,
              isPartial: false,
              isStarred: false,
              lifecycle: "archived" as const,
              tagCount: 0,
              tags: [],
            }
            : undefined,
        );
      },
      list: () => Promise.resolve({ people: [], status: "ready" }),
    },
  });

  const active = await directory.list(actor, { selectedPersonId: selectedId });
  assert(
    active.status === "ready" && active.selected === undefined,
    "active remains the default selected lifecycle",
  );
  const archived = await directory.list(actor, {
    lifecycle: "archived",
    selectedPersonId: selectedId,
  });
  assert(
    archived.status === "ready" &&
      archived.selected?.id === selectedId &&
      archived.selected.lifecycle === "archived",
    "explicit archived selected descriptor is returned",
  );
  assert(
    lifecycles.join(",") === "active,archived",
    "selected hydration receives normalized lifecycle criteria",
  );
});
