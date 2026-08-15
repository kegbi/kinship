import { createPersonProfile, type PersonProfileRepository } from "./public.ts";

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

Deno.test("[APP-003C] person profile composes orientation through one read-only query", async () => {
  let received: unknown;
  const repository: PersonProfileRepository = {
    get(command) {
      received = command;
      return Promise.resolve({
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
        },
        status: "ready",
      });
    },
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
    result.dueInformation.status === "unavailable" &&
      result.dueInformation.detail.includes("planning"),
    "the not-yet-delivered due projection is explicit",
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
                person: {
                  givenName: "Harriet",
                  id: personId,
                  isDeceased: false,
                  isPartial: false,
                  isSelf: false,
                  isStarred: false,
                  tagCount: 0,
                  tags: [],
                },
                status,
              }
              : { status },
          ),
      },
    });
    const result = await profile.get(actor, personId);
    assert(result.status === status, `${status} remains distinguishable`);
  }
});
