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
  const directory = createPeopleDirectory({ repository });

  const first = await directory.list(actor, {
    lifecycle: "active",
    limit: 2,
    search: "  Ada  ",
    sort: "family-name",
  });
  assert(first.status === "ready", "first directory page is ready");
  assert(first.people.length === 2 && first.nextCursor, "page is bounded");
  assert(
    calls[0]?.workspaceId === actor.workspaceId &&
      calls[0]?.search === "Ada" && calls[0]?.limit === 2,
    "normalized criteria and actor reach the repository",
  );

  await directory.list(actor, {
    cursor: first.nextCursor,
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
});

Deno.test("PEOPLE-002 directory rejects malformed, mismatched, and stale cursors", async () => {
  let calls = 0;
  const repository: PeopleDirectoryRepository = {
    list() {
      calls += 1;
      return Promise.resolve({ status: "stale-cursor" });
    },
  };
  const directory = createPeopleDirectory({ repository });
  const malformed = await directory.list(actor, { cursor: "not-a-cursor" });
  assert(malformed.status === "stale-cursor", "malformed cursor is stale");
  assert(calls === 0, "malformed cursor does not query persistence");

  const source = createPeopleDirectory({
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
    repository: { list: () => Promise.resolve({ status: "forbidden" }) },
  });
  const result = await directory.list(actor, {});
  assert(result.status === "forbidden", "authorization denial is explicit");
});
