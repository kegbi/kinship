import {
  createPeopleTagOptions,
  PEOPLE_TAG_OPTION_PAGE_SIZE,
  type PeopleTagOptionRecord,
  type PeopleTagOptionsRepository,
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

function option(index: number): PeopleTagOptionRecord {
  const id = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  const name = `Tag ${String(index).padStart(2, "0")}`;
  return { cursor: { id, primary: name.toLowerCase() }, id, name };
}

Deno.test("PEOPLE-002 tag options normalize search and emit fixed opaque pages", async () => {
  const calls: Parameters<PeopleTagOptionsRepository["listTagOptions"]>[0][] =
    [];
  const repository: PeopleTagOptionsRepository = {
    listTagOptions(command) {
      calls.push(command);
      return Promise.resolve({
        options: Array.from(
          { length: PEOPLE_TAG_OPTION_PAGE_SIZE + 1 },
          (_, index) => option(index + 1),
        ),
        selected: option(30),
        status: "ready",
      });
    },
  };
  const tags = createPeopleTagOptions({ repository });
  const first = await tags.list(actor, {
    search: "  TAG   ",
    selectedTagId: option(30).id,
  });
  assert(first.status === "ready", "tag option page is ready");
  assert(
    first.options.length === PEOPLE_TAG_OPTION_PAGE_SIZE && first.nextCursor &&
      first.selected?.id === option(30).id,
    "tag option response is fixed-size with one separate selected descriptor",
  );
  assert(
    calls[0]?.search === "tag" &&
      calls[0]?.limit === PEOPLE_TAG_OPTION_PAGE_SIZE &&
      calls[0]?.workspaceId === actor.workspaceId,
    "normalized criteria and actor reach persistence",
  );

  await tags.list(actor, { cursor: first.nextCursor, search: "tag" });
  assert(
    calls[1]?.after?.id === option(PEOPLE_TAG_OPTION_PAGE_SIZE).id,
    "opaque tag cursor resumes after the final emitted option",
  );
});

Deno.test("PEOPLE-002 tag options reject malformed or mismatched input before persistence", async () => {
  let calls = 0;
  const repository: PeopleTagOptionsRepository = {
    listTagOptions: () => {
      calls += 1;
      return Promise.resolve({ status: "forbidden" });
    },
  };
  const tags = createPeopleTagOptions({ repository });
  assert(
    (await tags.list(actor, { cursor: "not-a-cursor" })).status ===
      "invalid-input",
    "malformed cursor is invalid",
  );
  assert(
    (await tags.list(actor, { selectedTagId: "not-a-uuid" })).status ===
      "invalid-input",
    "malformed selected tag is invalid",
  );

  const source = createPeopleTagOptions({
    repository: {
      listTagOptions: () =>
        Promise.resolve({
          options: Array.from(
            { length: PEOPLE_TAG_OPTION_PAGE_SIZE + 1 },
            (_, index) => option(index + 1),
          ),
          status: "ready",
        }),
    },
  });
  const page = await source.list(actor, { search: "tag" });
  assert(page.status === "ready" && page.nextCursor, "source cursor exists");
  assert(
    (await tags.list(actor, {
          cursor: page.nextCursor,
          search: "other",
        })).status === "invalid-input" && calls === 0,
    "search-bound cursor cannot be reused for another refinement",
  );

  assert(
    (await tags.list(actor, {})).status === "forbidden" &&
      Number(calls) === 1,
    "authorization denial propagates without options",
  );
});
