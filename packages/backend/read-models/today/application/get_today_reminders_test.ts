import {
  createTodayReminders,
  type TodayRemindersRepository,
} from "./get_today_reminders.ts";
import { assert } from "../../../testing/assert.ts";
import * as fixtures from "../../../testing/fixtures.ts";

const actor = fixtures.actor();

Deno.test("PLANNING-002 Today reminder projection uses the bounded current instant", async () => {
  let received: Parameters<TodayRemindersRepository["get"]>[0] | undefined;
  const now = new Date("2026-08-18T12:00:00.000Z");
  const today = createTodayReminders({
    actors: { revalidate: () => Promise.resolve("active" as const) },
    transaction: { run: (work) => work({ opaque: undefined }) },
    clock: { now: () => now },
    repository: {
      get(command) {
        received = command;
        return Promise.resolve({
          cadences: [],
          reminders: [{
            attemptCount: 4,
            deliverAt: now.toISOString(),
            id: "00000000-0000-4000-8000-000000000900",
            person: {
              archived: false,
              id: "00000000-0000-4000-8000-000000000100",
              name: "Ada",
            },
            status: "manual_attention" as const,
            title: "Call Ada",
          }],
          status: "ready" as const,
          timezone: "Europe/Belgrade",
        });
      },
    },
  });
  const result = await today.get(actor);
  assert(received?.now === now, "Today did not forward its clock instant");
  assert(
    result.status === "ready" &&
      result.reminders[0]?.status === "manual_attention",
    "Today lost the user-visible manual-attention state",
  );
});
