import type { Clock, Instant } from "./clock.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("[GAP-006] a clock is an injected now(), never ambient time", () => {
  const pinned = new Date("2026-09-16T10:00:00.000Z");
  const clock: Clock = { now: () => pinned };
  assert(
    clock.now().toISOString() === "2026-09-16T10:00:00.000Z",
    "an injected clock decides what now means",
  );

  let ticks = 0;
  const advancing: Clock = {
    now: () => new Date(pinned.getTime() + (ticks += 1_000)),
  };
  assert(
    advancing.now().getTime() < advancing.now().getTime(),
    "a test clock may advance between reads",
  );
});

Deno.test("[GAP-006] an instant is the stored revision string", () => {
  const revision: Instant = "2026-09-16T10:00:00.123456Z";
  assert(
    Number.isFinite(Date.parse(revision)),
    "an instant is a parseable point in time",
  );
});
