import { assertEquals } from "../../../testing/assert.ts";
import {
  hashImpact,
  lifecycleConfirmation,
  mergeImpact,
  type WorkspaceLifecycleCounts,
  type WorkspaceLifecycleSnapshot,
} from "./workspace_lifecycle_rules.ts";

const COUNTS: WorkspaceLifecycleCounts = {
  activities: 0,
  auditEvents: 0,
  calls: 0,
  debts: 0,
  exports: 0,
  files: 0,
  imports: 0,
  integrations: 0,
  journalPosts: 0,
  gifts: 0,
  lifeEvents: 0,
  members: 1,
  people: 0,
  messages: 0,
  notes: 0,
  operations: 0,
  relationships: 0,
  reminders: 0,
  tasks: 0,
};

const SNAPSHOT: WorkspaceLifecycleSnapshot = {
  activeSessionCount: 2,
  counts: COUNTS,
  impactToken: "base-revision",
  objectKeys: ["b/2", "a/1"],
  workspaceName: "Ada's workspace",
};

Deno.test("[GAP-018] the phrase names the workspace, so typing it is a decision", () => {
  assertEquals(
    lifecycleConfirmation("delete", "Ada's workspace"),
    "DELETE Ada's workspace",
  );
  assertEquals(
    lifecycleConfirmation("reset", "Ada's workspace"),
    "RESET Ada's workspace",
  );
});

Deno.test("[GAP-018] the impact digest is pinned to a fixed vector", async () => {
  assertEquals(
    await hashImpact({ a: 1, b: "two" }),
    "f15bfc93d70801047473922f67fed863ecc7f82f0677ebb7122923aee81e0f97",
  );
});

Deno.test("[GAP-018] the merged impact is stable however the contributions arrive", async () => {
  const merged = await mergeImpact(SNAPSHOT, [
    { counts: { people: 3 }, objectKeys: ["c/3", "a/1"], revision: "r1" },
    { counts: { files: 2 }, revision: "r2" },
  ]);
  assertEquals(merged.counts.people, 3);
  assertEquals(merged.counts.files, 2);
  assertEquals(merged.counts.members, 1, "the workspace keeps its own counts");
  assertEquals(
    merged.objectKeys,
    ["a/1", "b/2", "c/3"],
    "keys are de-duplicated and sorted",
  );
  assertEquals(merged.workspaceName, SNAPSHOT.workspaceName);
  assertEquals(merged.activeSessionCount, 2);
  assertEquals(
    merged.impactToken,
    await hashImpact({
      base: "base-revision",
      contributions: ["r1", "r2"],
      counts: merged.counts,
      objectKeys: merged.objectKeys,
    }),
    "the token covers the base, each revision, the counts, and the keys",
  );
});

Deno.test("[GAP-018] anything the page showed changing changes the token", async () => {
  const base = await mergeImpact(SNAPSHOT, [
    { counts: { people: 3 }, revision: "r1" },
  ]);
  const unchanged = await mergeImpact(SNAPSHOT, [
    { counts: { people: 3 }, revision: "r1" },
  ]);
  assertEquals(base.impactToken, unchanged.impactToken);

  for (
    const [reason, token] of [
      [
        "another revision",
        (await mergeImpact(SNAPSHOT, [{
          counts: { people: 3 },
          revision: "r2",
        }]))
          .impactToken,
      ],
      [
        "another count",
        (await mergeImpact(SNAPSHOT, [{
          counts: { people: 4 },
          revision: "r1",
        }]))
          .impactToken,
      ],
      [
        "another object",
        (await mergeImpact(SNAPSHOT, [
          { counts: { people: 3 }, objectKeys: ["z/9"], revision: "r1" },
        ])).impactToken,
      ],
      [
        "another base",
        (await mergeImpact({ ...SNAPSHOT, impactToken: "moved" }, [
          { counts: { people: 3 }, revision: "r1" },
        ])).impactToken,
      ],
    ] as const
  ) {
    assertEquals(
      token === base.impactToken,
      false,
      `${reason} makes the token stale`,
    );
  }
});
