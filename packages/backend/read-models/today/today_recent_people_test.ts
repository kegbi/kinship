import {
  createTodayRecentPeople,
  type TodayRecentPeopleRepository,
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

Deno.test("TODAY-001 recent people is an explicit bounded read-only projection", async () => {
  let receivedLimit = 0;
  const repository: TodayRecentPeopleRepository = {
    list(command) {
      receivedLimit = command.limit;
      return Promise.resolve({
        people: [{
          archived: true,
          id: "00000000-0000-4000-8000-000000000100",
          name: "Ada Lovelace",
        }],
        status: "ready",
      });
    },
  };
  const result = await createTodayRecentPeople({ repository }).get(actor);
  assert(result.status === "ready", "recent people was forbidden");
  assert(receivedLimit === 8, "recent people was not hard bounded to eight");
  assert(
    result.people[0]?.archived === true &&
      result.people[0]?.name === "Ada Lovelace",
    "archived recent person was not retained",
  );
});

Deno.test("TODAY-001 recent people preserves forbidden and empty states", async () => {
  for (
    const result of [
      { status: "forbidden" as const },
      { people: [], status: "ready" as const },
    ]
  ) {
    const actual = await createTodayRecentPeople({
      repository: { list: () => Promise.resolve(result) },
    }).get(actor);
    assert(actual.status === result.status, "projection status changed");
    if (actual.status === "ready") {
      assert(actual.people.length === 0, "empty projection invented a person");
    }
  }
});
