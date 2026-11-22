import {
  createPeopleDirectory,
  type PeopleDirectoryPersonRecord,
  type PeopleDirectoryRepository,
} from "../public.ts";
import { assert, assertEquals } from "../../../testing/assert.ts";
import * as fixtures from "../../../testing/fixtures.ts";

const actor = fixtures.actor();

function record(index: number): PeopleDirectoryPersonRecord {
  const id = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  return {
    cursor: {
      id,
      primary: `person-${index}`,
      secondary: "family",
      starred: index === 1,
    },
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
  assert(
    calls[0]?.nameForms.length === 0 && calls[0]?.nameFold.length === 0,
    "a caller naming no forms matches the name as typed alone",
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
    cursor: {
      id: selectedId,
      primary: "charles",
      secondary: "babbage",
      starred: false,
    },
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
                starred: false,
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

Deno.test("[PEOPLE-007] a directory row carries the person's avatar record", async () => {
  const fileId = fixtures.uuid(700);
  const directory = createPeopleDirectory({
    actors: { revalidate: () => Promise.resolve("active" as const) },
    transaction: { run: (work) => work({ opaque: undefined }) },
    repository: {
      findSelected: () =>
        Promise.resolve({
          ...record(9),
          avatar: { backgroundColor: "#abcdef" },
        }),
      list: () =>
        Promise.resolve({
          people: [{ ...record(1), avatar: { fileId } }, record(2)],
          status: "ready",
        }),
    },
  });
  const result = await directory.list(actor, {
    selectedPersonId: record(9).id,
  });
  assert(result.status === "ready", "directory is ready");
  assert(result.people[0]?.avatar?.fileId === fileId, "the image is named");
  assert(!("avatar" in result.people[1]!), "no record, no avatar member");
  assert(
    result.selected?.avatar?.backgroundColor === "#abcdef",
    "the selected person keeps their colour",
  );
});

Deno.test("[PEOPLE-010] every sort, the starred filter, and starred-first travel in the cursor", async () => {
  const calls: Parameters<PeopleDirectoryRepository["list"]>[0][] = [];
  const directory = createPeopleDirectory({
    actors: { revalidate: () => Promise.resolve("active" as const) },
    transaction: { run: (work) => work({ opaque: undefined }) },
    repository: {
      list(command) {
        calls.push(command);
        return Promise.resolve({
          people: [
            { ...record(1), cursor: { ...record(1).cursor, starred: true } },
            { ...record(2), cursor: { ...record(2).cursor, starred: false } },
          ],
          status: "ready",
        });
      },
    },
  });
  for (
    const sort of [
      "given-name",
      "family-name",
      "recently-added",
      "last-contacted",
      "recently-updated",
    ] as const
  ) {
    for (const starred of [false, true]) {
      for (const starredFirst of [false, true]) {
        calls.length = 0;
        const input = { limit: 1, sort, starred, starredFirst };
        const first = await directory.list(actor, input);
        assert(
          first.status === "ready" && first.nextCursor,
          `${sort} pages with a cursor`,
        );
        assert(
          calls[0]?.sort === sort && calls[0]?.starred === starred &&
            calls[0]?.starredFirst === starredFirst,
          `${sort} criteria reach the repository`,
        );
        const next = await directory.list(actor, {
          ...input,
          cursor: first.nextCursor,
        });
        assert(next.status === "ready", `${sort} continues`);
        assert(
          calls[1]?.after?.id === record(1).id &&
            calls[1]?.after?.starred === true,
          `${sort} resumes after the last person, starred state included`,
        );
        for (
          const changed of [
            { ...input, starred: !starred },
            { ...input, starredFirst: !starredFirst },
            {
              ...input,
              sort: sort === "last-contacted"
                ? "recently-updated" as const
                : "last-contacted" as const,
            },
          ]
        ) {
          const refused = await directory.list(actor, {
            ...changed,
            cursor: first.nextCursor,
          });
          assert(
            refused.status === "stale-cursor",
            `${sort} refuses a cursor made for other criteria`,
          );
        }
      }
    }
  }
});

Deno.test("[PEOPLE-010] a cursor from before the starred criteria is stale", async () => {
  let calls = 0;
  const directory = createPeopleDirectory({
    actors: { revalidate: () => Promise.resolve("active" as const) },
    transaction: { run: (work) => work({ opaque: undefined }) },
    repository: {
      list() {
        calls += 1;
        return Promise.resolve({ people: [], status: "ready" });
      },
    },
  });
  const legacy = btoa(JSON.stringify({
    excludePersonId: null,
    id: record(1).id,
    lifecycle: "active",
    primary: "person-1",
    search: "",
    secondary: "family",
    sort: "given-name",
    tagId: null,
    version: 1,
  })).replaceAll("=", "");
  const result = await directory.list(actor, { cursor: legacy });
  assert(result.status === "stale-cursor", "a version 1 cursor is stale");
  assert(calls === 0, "a stale cursor queries nothing");
});

Deno.test("SEARCH-001 directory hands the repository a search's name forms and fold", async () => {
  const calls: Parameters<PeopleDirectoryRepository["list"]>[0][] = [];
  const directory = createPeopleDirectory({
    actors: { revalidate: () => Promise.resolve("active" as const) },
    transaction: { run: (work) => work({ opaque: undefined }) },
    repository: {
      list(command) {
        calls.push(command);
        return Promise.resolve({ people: [], status: "ready" });
      },
    },
  });
  await directory.list(actor, {
    nameFold: [["е", "e"]],
    nameForms: ["udutf", "elena"],
    search: "удутф",
  });
  // Without a search there is no name to match, whatever forms arrive.
  await directory.list(actor, { nameFold: [["е", "e"]], nameForms: ["x"] });
  assertEquals(calls[0]?.nameForms, ["udutf", "elena"]);
  assertEquals(calls[0]?.nameFold, [["е", "e"]]);
  assertEquals(calls[1]?.nameForms, []);
  assertEquals(calls[1]?.nameFold, []);
});

Deno.test("[MCP-R3] the directory pages past, excludes, filters by, and selects people whose identifiers were derived", async () => {
  // DAV-synced people and people created with a `requestId` carry the
  // version 8 identifier `deterministicId` derives; a page ending on one
  // used to emit a cursor the next request refused as stale.
  const derived = (suffix: string) => `8e5213b9-8cee-8024-8aed-${suffix}`;
  const lastOnPage = derived("000000000001");
  const excluded = derived("000000000002");
  const tagId = derived("000000000003");
  const selectedId = derived("000000000004");
  const people = [record(1), { ...record(2), id: lastOnPage }, record(3)]
    .map((entry) => ({ ...entry, cursor: { ...entry.cursor, id: entry.id } }));
  const calls: Parameters<PeopleDirectoryRepository["list"]>[0][] = [];
  const directory = createPeopleDirectory({
    actors: { revalidate: () => Promise.resolve("active" as const) },
    transaction: { run: (work) => work({ opaque: undefined }) },
    repository: {
      findSelected: ({ personId }) =>
        Promise.resolve(
          personId === selectedId
            ? {
              ...record(4),
              cursor: { ...record(4).cursor, id: selectedId },
              id: selectedId,
            }
            : undefined,
        ),
      list(command) {
        calls.push(command);
        return Promise.resolve({ people, status: "ready" });
      },
    },
  });
  const criteria = { excludePersonId: excluded, limit: 2, tagId };
  const first = await directory.list(actor, {
    ...criteria,
    selectedPersonId: selectedId,
  });
  assert(first.status === "ready" && first.nextCursor, "the page has more");
  assertEquals(first.selected?.id, selectedId);
  const second = await directory.list(actor, {
    ...criteria,
    cursor: first.nextCursor,
  });
  assertEquals(second.status, "ready", "the cursor is not refused");
  assertEquals(calls[1]?.after?.id, lastOnPage);
  assertEquals(calls[1]?.excludePersonId, excluded);
  assertEquals(calls[1]?.tagId, tagId);
});
