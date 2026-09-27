import {
  createPeopleDuplicates,
  PEOPLE_DUPLICATE_GROUP_LIMIT,
  PEOPLE_DUPLICATE_PAIR_LIMIT,
  type PeopleDuplicatePairRecord,
  type PeopleDuplicatesRepository,
} from "../public.ts";
import { assertEquals } from "../../../testing/assert.ts";
import * as fixtures from "../../../testing/fixtures.ts";

const actor = fixtures.actor();

function pair(index: number): PeopleDuplicatePairRecord {
  const person = (ordinal: number) => ({
    givenName: "Ada",
    id: fixtures.uuid(ordinal),
    updatedAt: "2026-09-27T10:00:00.000000Z",
  });
  return {
    people: [person(index * 2), person(index * 2 + 1)],
    reasons: ["email", "name"],
  };
}

function subject(
  pairs: readonly PeopleDuplicatePairRecord[],
  standing: "active" | "revoked" = "active",
) {
  const calls: Parameters<PeopleDuplicatesRepository["listPairs"]>[0][] = [];
  const duplicates = createPeopleDuplicates({
    actors: { revalidate: () => Promise.resolve(standing) },
    repository: {
      listPairs: (command) => {
        calls.push(command);
        return Promise.resolve(pairs);
      },
    },
    transaction: { run: (work) => work({ opaque: undefined }) },
  });
  return { calls, duplicates };
}

Deno.test("[PEOPLE-008] the duplicate review asks for one pair more than it shows", async () => {
  const pairs = Array.from(
    { length: PEOPLE_DUPLICATE_PAIR_LIMIT + 1 },
    (_, index) => pair(index + 1),
  );
  const { calls, duplicates } = subject(pairs);
  assertEquals(PEOPLE_DUPLICATE_GROUP_LIMIT, 5);
  const result = await duplicates.list(actor);
  assertEquals(result.status, "ready");
  if (result.status !== "ready") return;
  assertEquals(result.pairs.length, PEOPLE_DUPLICATE_PAIR_LIMIT);
  assertEquals(result.truncated, true);
  assertEquals(calls, [{
    groupLimit: PEOPLE_DUPLICATE_GROUP_LIMIT,
    limit: PEOPLE_DUPLICATE_PAIR_LIMIT + 1,
    workspaceId: actor.workspaceId,
  }]);
});

Deno.test("[PEOPLE-008] a short list is complete and a revoked member reads nothing", async () => {
  const ready = await subject([pair(1)]).duplicates.list(actor);
  assertEquals(ready, { pairs: [pair(1)], status: "ready", truncated: false });
  const revoked = subject([pair(1)], "revoked");
  assertEquals(await revoked.duplicates.list(actor), { status: "forbidden" });
  assertEquals(revoked.calls, []);
});
