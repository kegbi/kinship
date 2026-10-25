import {
  createWorkspaceSearch,
  SEARCH_LIMIT_DEFAULT,
  SEARCH_LIMIT_MAXIMUM,
  SEARCH_SNIPPET_LENGTH,
  type SearchRecords,
  type SearchRepository,
  searchSnippet,
} from "../public.ts";
import { assert, assertEquals } from "../../../testing/assert.ts";
import * as fixtures from "../../../testing/fixtures.ts";

const actor = fixtures.actor();
const personId = "00000000-0000-4000-8000-000000000001";
const itemId = "00000000-0000-4000-8000-000000000002";

const EMPTY: SearchRecords = {
  activities: [],
  journalPosts: [],
  notes: [],
  people: [],
  tasks: [],
};

/** A repository answering both statements from one set of records. */
function answering(
  found: SearchRecords,
  seen: Parameters<SearchRepository["searchPeople"]>[0][] = [],
): SearchRepository {
  const { people, ...text } = found;
  return {
    searchPeople: (command) => {
      seen.push(command);
      return Promise.resolve({ people, status: "ready" });
    },
    searchText: () => Promise.resolve({ ...text, status: "ready" }),
  };
}

function search(
  repository: SearchRepository,
  revalidated: "active" | "revoked" = "active",
) {
  return createWorkspaceSearch({
    actors: { revalidate: () => Promise.resolve(revalidated) },
    repository,
    transaction: { run: (work) => work({ opaque: undefined }) },
  });
}

Deno.test("[SEARCH-001] search answers the five groups in their fixed order with deep links", async () => {
  const person = { archived: false, id: personId, name: "Ada Lovelace" };
  const result = await search(answering({
    activities: [{
      id: "activity-1",
      person,
      text: "Walk by the river",
      title: "Walk",
    }],
    journalPosts: [{
      id: "post-1",
      journalItemId: itemId,
      text: "A river day",
    }],
    notes: [{
      id: "note-1",
      person,
      text: "Loves the river",
    }],
    people: [{
      avatar: { backgroundColor: "#123456" },
      familyName: "Lovelace",
      givenName: "Ada",
      id: personId,
    }],
    tasks: [
      {
        id: "task-1",
        person,
        sectionShown: true,
        text: "Book the river cruise",
        title: "Cruise",
      },
      {
        id: "task-2",
        person,
        sectionShown: false,
        text: "River cleanup",
        title: "Cleanup",
      },
      { id: "task-3", sectionShown: true, text: "River", title: "River" },
    ],
  })).search(actor, { query: "  river ", limit: 3 });

  assert(result.status === "ready", "search is ready");
  assertEquals(result.query, "river");
  assertEquals(result.groups.map((group) => group.kind), [
    "people",
    "notes",
    "activities",
    "journal-posts",
    "tasks",
  ]);
  const [people, notes, activities, posts, tasks] = result.groups;
  assertEquals(people.results, [{
    avatar: { backgroundColor: "#123456" },
    familyName: "Lovelace",
    givenName: "Ada",
    id: personId,
    href: `/app/people/${personId}`,
    kind: "person",
  }]);
  assertEquals(notes.results[0], {
    href: `/app/people/${personId}?section=notes`,
    id: "note-1",
    kind: "note",
    person,
    snippet: "Loves the river",
  });
  assertEquals(
    activities.results[0]?.href,
    `/app/people/${personId}?section=activities`,
  );
  assertEquals(activities.results[0]?.title, "Walk");
  assertEquals(posts.results[0], {
    href: `/app/journal/${itemId}`,
    id: "post-1",
    kind: "journal-post",
    snippet: "A river day",
  });
  assertEquals(tasks.results.map((task) => task.href), [
    `/app/people/${personId}?section=tasks`,
    "/app/tasks",
    "/app/tasks",
  ]);
  assertEquals(tasks.results[1]?.person, person);
});

Deno.test("[SEARCH-001] search bounds the limit and the query before the repository", async () => {
  const seen: Parameters<SearchRepository["searchPeople"]>[0][] = [];
  const repository = answering(EMPTY, seen);
  await search(repository).search(actor, { query: "ada" });
  await search(repository).search(actor, { query: "ada", limit: 500 });
  await search(repository).search(actor, { query: "ada", limit: -3 });
  await search(repository).search(actor, {
    query: `  ${"x".repeat(250)}  `,
    limit: Number.NaN,
  });
  assertEquals(seen.map((command) => command.limit), [
    SEARCH_LIMIT_DEFAULT,
    SEARCH_LIMIT_MAXIMUM,
    1,
    SEARCH_LIMIT_DEFAULT,
  ]);
  assertEquals(seen[3]?.query.length, 200);
  assertEquals(seen[0]?.workspaceId, actor.workspaceId);
  assertEquals(seen[0]?.sort, "given-name");
  await search(repository).search(actor, {
    query: '"Ada" -Byron or lovelace',
    sort: "family-name",
  });
  assertEquals(seen[4]?.sort, "family-name");
  assertEquals(seen[4]?.terms, ["ada", "lovelace"]);
});

Deno.test("[SEARCH-001] search hands the repository the name forms and fold it was given", async () => {
  const seen: Parameters<SearchRepository["searchPeople"]>[0][] = [];
  const repository = answering(EMPTY, seen);
  await search(repository).search(actor, {
    nameFold: [["е", "e"], ["y", "i"]],
    nameForms: ["udutf", "elena"],
    query: "удутф",
  });
  await search(repository).search(actor, { query: "ada" });
  assertEquals(seen[0]?.nameForms, ["udutf", "elena"]);
  assertEquals(seen[0]?.nameFold, [["е", "e"], ["y", "i"]]);
  assertEquals(seen[0]?.query, "удутф");
  // A caller naming no forms matches the name as typed alone.
  assertEquals(seen[1]?.nameForms, []);
  assertEquals(seen[1]?.nameFold, []);
});

Deno.test("[SEARCH-001] a blank query reads nothing and a revoked member is refused", async () => {
  const repository: SearchRepository = {
    searchPeople: () => Promise.reject(new Error("must not search")),
    searchText: () => Promise.reject(new Error("must not search")),
  };
  const blank = await search(repository).search(actor, { query: "   " });
  assert(blank.status === "ready", "a blank query is an empty answer");
  assertEquals(blank.groups.map((group) => group.results.length), [
    0,
    0,
    0,
    0,
    0,
  ]);
  const refused = await search(repository, "revoked").search(actor, {
    query: "ada",
  });
  assertEquals(refused.status, "forbidden");
});

Deno.test("[SEARCH-001] snippets are plain text cut around the first match", () => {
  assertEquals(
    searchSnippet("  Loves\n\tthe   river  ", "river"),
    "Loves the river",
  );
  const long = `${"a".repeat(300)} river ${"b".repeat(300)}`;
  const snippet = searchSnippet(long, "RIVER");
  assert(snippet.startsWith("…") && snippet.endsWith("…"), "both ends cut");
  assert(snippet.includes("river"), "the match stays in the snippet");
  assert(
    snippet.length <= SEARCH_SNIPPET_LENGTH + 2,
    `snippet is bounded: ${snippet.length}`,
  );
  const unmatched = searchSnippet(`${"c".repeat(400)}`, "zebra");
  assert(
    !unmatched.startsWith("…") && unmatched.endsWith("…"),
    "no match starts at the beginning",
  );
  const tail = searchSnippet(`${"d".repeat(400)} end`, "end");
  assert(tail.endsWith("end") && tail.startsWith("…"), "a late match ends it");
  assertEquals(
    searchSnippet("<b>bold</b>\u0000 & more", "bold"),
    "<b>bold</b> & more",
  );
  assertEquals(
    searchSnippet("quoted words", '"quoted" -other'),
    "quoted words",
  );
});

Deno.test("[SEARCH-001] a failed or timed-out text statement still answers people", async () => {
  const people = [{ givenName: "Ada", id: personId }];
  for (
    const searchText of [
      () => Promise.resolve({ status: "timed-out" as const }),
      () => Promise.reject(new Error("database down")),
    ]
  ) {
    const result = await search({
      searchPeople: () => Promise.resolve({ people, status: "ready" }),
      searchText,
    }).search(actor, { query: "ada" });
    assert(result.status === "ready", "people still answer");
    assertEquals(result.groups[0].results.map((person) => person.id), [
      personId,
    ]);
    assertEquals(
      result.groups.slice(1).map((group) => [
        group.kind,
        group.results.length,
        "unavailable" in group ? group.unavailable : undefined,
      ]),
      [
        ["notes", 0, true],
        ["activities", 0, true],
        ["journal-posts", 0, true],
        ["tasks", 0, true],
      ],
    );
  }
  const timedOut = await search({
    searchPeople: () => Promise.resolve({ status: "timed-out" }),
    searchText: () => Promise.reject(new Error("must not search text")),
  }).search(actor, { query: "ada" });
  assertEquals(timedOut.status, "unavailable");
});

Deno.test("[SEARCH-001] snippets slice code points and find matches past case folding", () => {
  const emoji = "😀".repeat(200) + " river " + "😀".repeat(200);
  const cut = searchSnippet(emoji, "river");
  assert(cut.includes("river"), `the match stays: ${cut}`);
  assert(
    !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(cut),
    "no lone high surrogate",
  );
  assert(
    !/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(cut),
    "no lone low surrogate",
  );
  assert(
    Array.from(cut).length <= SEARCH_SNIPPET_LENGTH + 2,
    `bounded in code points: ${Array.from(cut).length}`,
  );
  // "İ" lowercases to two UTF-16 units, which shifted every later index.
  const dotted = `${"İ".repeat(300)} target ${"x".repeat(300)}`;
  const found = searchSnippet(dotted, "target");
  assert(found.includes("target"), `İ drift hid the match: ${found}`);
  const early = searchSnippet(`${"İ".repeat(20)}target${"y".repeat(300)}`, "İ");
  assert(early.startsWith("İ"), `a folded term matches: ${early}`);
});
