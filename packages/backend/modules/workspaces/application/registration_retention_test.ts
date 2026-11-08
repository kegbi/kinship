import { assertEquals } from "../../../testing/assert.ts";
import { fixedClock } from "../../../testing/fakes.ts";
import type { RegistrationTransaction } from "../ports/context.ts";
import { createStaleRegistrationPurge } from "./registration_retention.ts";

interface Pending {
  readonly email: string;
  readonly userId: string;
}

function purgeOver(pending: readonly Pending[], held: ReadonlySet<string>) {
  const effects: string[] = [];
  const transaction: RegistrationTransaction = { opaque: "tx" };
  const purge = createStaleRegistrationPurge({
    batch: { maximumBatches: 5, size: 2 },
    clock: fixedClock("2026-11-08T12:00:00.000Z"),
    identity: {
      listStalePendingUsers(command) {
        effects.push(
          `list:${
            command.afterUserId ?? "-"
          }:${command.createdBefore.toISOString()}`,
        );
        return Promise.resolve(
          pending.filter((user) =>
            command.afterUserId === undefined ||
            user.userId > command.afterUserId
          ).slice(0, command.limit),
        );
      },
      discardPendingUsers(command) {
        effects.push(`discard:${command.userIds.join("+")}`);
        return Promise.resolve(command.userIds.length);
      },
    },
    repository: {
      heldPendingRegistrations(command) {
        effects.push(`held:${command.users.length}`);
        return Promise.resolve(held);
      },
      deletePendingWorkspaces(command) {
        effects.push(`workspaces:${command.userIds.join("+")}`);
        return Promise.resolve();
      },
    },
    transaction: {
      async run(work) {
        effects.push("begin");
        const result = await work(transaction);
        effects.push("commit");
        return result;
      },
    },
  });
  return { effects, purge };
}

const user = (id: string): Pending => ({
  email: `${id}@example.test`,
  userId: id,
});

Deno.test("[AUD-A2] stale registrations are walked in id order, and the held ones passed over", async () => {
  const { effects, purge } = purgeOver(
    [user("a"), user("b"), user("c")],
    new Set(["b"]),
  );
  assertEquals(await purge.purge(), 2);
  assertEquals(effects, [
    "begin",
    "list:-:2026-11-01T12:00:00.000Z",
    "held:2",
    "workspaces:a",
    "discard:a",
    "commit",
    "begin",
    "list:b:2026-11-01T12:00:00.000Z",
    "held:1",
    "workspaces:c",
    "discard:c",
    "commit",
  ]);
});

Deno.test("[AUD-A2] a batch of only held registrations deletes nothing, and nothing stale ends the run", async () => {
  const { effects, purge } = purgeOver(
    [user("a"), user("b")],
    new Set(["a", "b"]),
  );
  assertEquals(await purge.purge(), 0);
  assertEquals(effects, [
    "begin",
    "list:-:2026-11-01T12:00:00.000Z",
    "held:2",
    "discard:",
    "commit",
    "begin",
    "list:b:2026-11-01T12:00:00.000Z",
    "held:0",
    "discard:",
    "commit",
  ]);
});

Deno.test("[AUD-A2] a run stops at its batch cap", async () => {
  const many = Array.from(
    { length: 20 },
    (_, index) => user(String(index).padStart(2, "0")),
  );
  const { effects, purge } = purgeOver(many, new Set());
  assertEquals(await purge.purge(), 10);
  assertEquals(effects.filter((effect) => effect === "commit").length, 5);
});
