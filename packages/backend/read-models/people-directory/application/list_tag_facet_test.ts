import {
  createPeopleTagFacet,
  PEOPLE_TAG_FACET_LIMIT,
  type PeopleTagFacetRepository,
} from "../public.ts";
import { assertEquals } from "../../../testing/assert.ts";
import * as fixtures from "../../../testing/fixtures.ts";

const actor = fixtures.actor();

const tag = (index: number, count: number) => ({
  count,
  id: fixtures.uuid(100 + index),
  name: `Tag ${index}`,
});

function facet(
  options: {
    readonly revalidation?: "active" | "revoked";
    readonly tags?: readonly ReturnType<typeof tag>[];
  } = {},
) {
  const calls: Parameters<PeopleTagFacetRepository["listTagFacet"]>[0][] = [];
  const subject = createPeopleTagFacet({
    actors: {
      revalidate: () => Promise.resolve(options.revalidation ?? "active"),
    },
    transaction: { run: (work) => work({ opaque: undefined }) },
    repository: {
      listTagFacet(command) {
        calls.push(command);
        return Promise.resolve(options.tags ?? []);
      },
    },
  });
  return { calls, subject };
}

Deno.test("[PEOPLE-010] the tag facet answers the top tags with person counts", async () => {
  const { calls, subject } = facet({ tags: [tag(1, 4), tag(2, 1)] });
  assertEquals(await subject.list(actor, { lifecycle: "archived" }), {
    lifecycle: "archived",
    status: "ready",
    tags: [tag(1, 4), tag(2, 1)],
    truncated: false,
  });
  assertEquals(calls[0]?.lifecycle, "archived");
  assertEquals(calls[0]?.workspaceId, actor.workspaceId);
  assertEquals(
    calls[0]?.limit,
    PEOPLE_TAG_FACET_LIMIT + 1,
    "one more than shown is read to know whether there are more",
  );
});

Deno.test("[PEOPLE-010] the tag facet is bounded and says when it is", async () => {
  const tags = Array.from(
    { length: PEOPLE_TAG_FACET_LIMIT + 1 },
    (_, index) => tag(index, 50 - index),
  );
  const result = await facet({ tags }).subject.list(actor, {
    lifecycle: "active",
  });
  assertEquals(result.status, "ready");
  if (result.status !== "ready") return;
  assertEquals(result.tags.length, PEOPLE_TAG_FACET_LIMIT);
  assertEquals(result.truncated, true);
});

Deno.test("[PEOPLE-010] a revoked member reads no tag facet", async () => {
  const { calls, subject } = facet({ revalidation: "revoked" });
  assertEquals(await subject.list(actor, { lifecycle: "active" }), {
    status: "forbidden",
  });
  assertEquals(calls, []);
});
