import {
  laneCount,
  lanesOf,
  MAX_LANES,
  planLanes,
  runLanes,
  runPool,
  suiteWeight,
} from "./lanes.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("lanes hold every suite exactly once, in the order it was declared", () => {
  const suites = ["a", "b", "c", "d", "e", "f"];
  const lanes = lanesOf(suites, 3, () => 1);
  assert(lanes.length === 3, "the requested lanes are used");
  assert(
    lanes.flat().sort().join() === suites.join(),
    "a suite is dropped or runs twice",
  );
  for (const lane of lanes) {
    assert(lane.join() === [...lane].sort().join(), "a lane keeps the order");
  }
});

Deno.test("the heaviest suite gets a lane the others do not add to", () => {
  const weights: Record<string, number> = { big: 90, w: 30, x: 30, y: 30 };
  const lanes = lanesOf(["w", "x", "big", "y"], 2, (suite) => weights[suite]!);
  assert(
    JSON.stringify(lanes.map((lane) => lane.join()).sort()) ===
      JSON.stringify(["big", "w,x,y"]),
    `the lanes are unbalanced: ${JSON.stringify(lanes)}`,
  );
});

Deno.test("a suite that opens no database barely weighs on a lane", () => {
  const unit = suiteWeight("apps/api/app_test.ts", 40_000);
  const database = suiteWeight("tests/integration/a_postgres_test.ts", 40_000);
  const migrations = suiteWeight(
    "tests/integration/migrations_postgres_test.ts",
    40_000,
  );
  assert(unit * 10 < database, "a unit suite counts like a database suite");
  assert(database < migrations, "the slowest suite counts like any other");
});

Deno.test("no lane is empty", () => {
  assert(lanesOf(["a"], 3, () => 1).length === 1, "one suite needs one lane");
  assert(lanesOf([], 3, () => 1).length === 0, "nothing needs no lane");
});

Deno.test("a short suite list is not worth a second database", () => {
  assert(laneCount(0) === 1 && laneCount(39) === 1, "a short list runs alone");
  assert(laneCount(40) === 2, "each lane is worth its own database");
  assert(laneCount(1_000) === MAX_LANES, "the lanes are capped");
});

Deno.test("a timed suite gets a lane of its own, and every suite one lane", () => {
  const timed = "tests/integration/people_directory_capacity_postgres_test.ts";
  const suites = ["a", timed, "b"];
  const lanes = planLanes(suites, () => 1);
  assert(
    lanes.flatMap((lane) => lane.suites).sort().join() ===
      [...suites].sort().join(),
    "a suite is dropped or runs twice",
  );
  const alone = lanes.filter((lane) => lane.alone);
  assert(
    alone.length === 1 && alone[0]!.suites.join() === timed,
    `the timed suite shares its lane: ${JSON.stringify(lanes)}`,
  );
  assert(
    planLanes(["a"], () => 1).every((lane) => !lane.alone),
    "an untimed suite runs alone",
  );
});

Deno.test("a lane that runs alone starts after every other lane has finished", async () => {
  let running = 0;
  const events: string[] = [];
  const job = (name: string, alone: boolean) => ({
    alone,
    run: async () => {
      running += 1;
      if (alone) events.push(`${name} beside ${running - 1}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
    },
  });
  await runLanes([
    job("first", true),
    job("a", false),
    job("second", true),
    job("b", false),
  ]);
  assert(
    events.join() === "first beside 0,second beside 0",
    `a timed lane shared the machine: ${events}`,
  );
});

Deno.test("the pool runs at most its limit at once and finishes every job", async () => {
  let running = 0;
  let peak = 0;
  const done: number[] = [];
  await runPool(
    Array.from({ length: 7 }, (_, index) => async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      done.push(index);
    }),
    3,
  );
  assert(peak === 3, `the pool ran ${peak} jobs at once`);
  assert(done.length === 7, "a job never ran");
});

Deno.test("a failed job stops new ones, and the running ones still clean up", async () => {
  const events: string[] = [];
  let failure: unknown;
  try {
    await runPool([
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        events.push("cleaned up");
      },
      () => Promise.reject(new Error("suite failed")),
      () => {
        events.push("started late");
        return Promise.resolve();
      },
    ], 2);
  } catch (error) {
    failure = error;
  }
  assert(
    failure instanceof Error && failure.message === "suite failed",
    "the failure is reported as it was thrown",
  );
  assert(
    events.join() === "cleaned up",
    `a job started after a failure, or one was abandoned: ${events}`,
  );
});

Deno.test("several failures are reported together", async () => {
  let failure: unknown;
  try {
    await runPool([
      () => Promise.reject(new Error("first")),
      () => Promise.reject(new Error("second")),
    ], 2);
  } catch (error) {
    failure = error;
  }
  assert(
    failure instanceof AggregateError && failure.errors.length === 2,
    "a second failure is lost",
  );
});
