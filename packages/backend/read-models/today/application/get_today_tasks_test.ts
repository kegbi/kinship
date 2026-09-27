import { createTodayTasks } from "./get_today_tasks.ts";
import { assert } from "../../../testing/assert.ts";
import { fixedClock } from "../../../testing/fakes.ts";

Deno.test("PLANNING-001 Today requests a bounded thirty-day read-only task projection", async () => {
  let received:
    | { readonly dueBefore: Date; readonly limit: number }
    | undefined;
  const today = createTodayTasks({
    actors: { revalidate: () => Promise.resolve("active" as const) },
    transaction: { run: (work) => work({ opaque: undefined }) },
    clock: fixedClock("2026-08-18T10:00:00.000Z"),
    repository: {
      getDueTasks: (command) => {
        received = command;
        return Promise.resolve({ items: [], status: "ready" });
      },
    },
  });
  const result = await today.getDueTasks({
    memberId: "00000000-0000-4000-8000-000000000002",
    role: "member",
    userId: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000003",
  });
  assert(result.status === "ready", "Today task projection failed");
  assert(received?.limit === 20, "Today task projection was not bounded");
  assert(
    received?.dueBefore.toISOString() === "2026-09-17T10:00:00.000Z",
    "Today task horizon was not thirty UTC days",
  );
});
