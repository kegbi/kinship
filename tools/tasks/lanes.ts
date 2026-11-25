/**
 * Running database suites side by side.
 *
 * A PostgreSQL suite spends most of its time waiting on the server, so one
 * suite at a time leaves a machine mostly idle. A lane is a share of the
 * suites with a disposable PostgreSQL project of its own: lanes share no
 * database, so their suites need no isolation beyond what one run already
 * gives them, and inside a lane the suites still run one after another.
 */

/**
 * How many lanes run at once. Each one keeps a database and a Deno process
 * busy, so a third one on two cores only takes time from the other two.
 */
export const MAX_LANES = Math.min(
  3,
  Math.max(2, navigator.hardwareConcurrency),
);

/** The suites that hold a read to a time, which other lanes would take. */
const RUN_ALONE: ReadonlySet<string> = new Set([
  "tests/integration/people_directory_capacity_postgres_test.ts",
]);

/** Suites that share one database, and whether nothing may run beside them. */
export interface Lane {
  readonly alone: boolean;
  readonly suites: readonly string[];
}

/** A set's lanes: those that run side by side, then what must run alone. */
export function planLanes(
  suites: readonly string[],
  weight: (suite: string) => number,
): Lane[] {
  const alone = suites.filter((suite) => RUN_ALONE.has(suite));
  const together = suites.filter((suite) => !RUN_ALONE.has(suite));
  return [
    ...lanesOf(together, laneCount(together.length), weight)
      .map((lane) => ({ alone: false, suites: lane })),
    ...(alone.length > 0 ? [{ alone: true, suites: alone }] : []),
  ];
}

/**
 * The suites that make starting one more database worth its time. A shorter
 * list, which a `--module` run usually is, stays in one lane.
 */
const SUITES_PER_LANE = 20;

/** The suites that run far longer than their size says, and how many times. */
const SLOWER_THAN_THEIR_SIZE: Readonly<Record<string, number>> = {
  // Both apply whole schemas, again and again.
  "tests/integration/migrations_postgres_test.ts": 10,
  "tests/integration/registration_postgres_test.ts": 3,
};

/**
 * What a suite weighs in a lane. Its size stands in for how long it runs; a
 * suite outside `tests/integration` opens no database, so it weighs little.
 */
export function suiteWeight(suite: string, size: number): number {
  return suite.startsWith("tests/integration/")
    ? size * (SLOWER_THAN_THEIR_SIZE[suite] ?? 1)
    : size / 20;
}

/** How many lanes a list of suites is split over. */
export function laneCount(suites: number): number {
  return Math.min(
    MAX_LANES,
    Math.max(1, Math.floor(suites / SUITES_PER_LANE)),
  );
}

/**
 * Splits suites over at most `count` lanes, heaviest first onto the lane with
 * the least so far. Every suite lands in exactly one lane, each lane keeps the
 * declared order, and no lane is empty.
 */
export function lanesOf(
  suites: readonly string[],
  count: number,
  weight: (suite: string) => number,
): string[][] {
  const lanes = Array.from({ length: count }, () => ({
    suites: new Set<string>(),
    weight: 0,
  }));
  for (const suite of [...suites].sort((a, b) => weight(b) - weight(a))) {
    const lightest = lanes.reduce((least, lane) =>
      lane.weight < least.weight ? lane : least
    );
    lightest.suites.add(suite);
    lightest.weight += weight(suite);
  }
  return lanes
    .map((lane) => suites.filter((suite) => lane.suites.has(suite)))
    .filter((lane) => lane.length > 0);
}

/** Runs the jobs that may share the machine, then the others one by one. */
export async function runLanes(
  jobs: readonly {
    readonly alone: boolean;
    readonly run: () => Promise<void>;
  }[],
): Promise<void> {
  await runPool(
    jobs.filter((job) => !job.alone).map((job) => job.run),
    MAX_LANES,
  );
  await runPool(jobs.filter((job) => job.alone).map((job) => job.run), 1);
}

/**
 * Runs the jobs in order, at most `limit` at once. After a failure no further
 * job starts, and the running ones finish, so each still removes what it
 * started.
 */
export async function runPool(
  jobs: readonly (() => Promise<void>)[],
  limit: number,
): Promise<void> {
  const errors: unknown[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (errors.length === 0) {
      const job = jobs[next];
      if (!job) return;
      next += 1;
      try {
        await job();
      } catch (error) {
        errors.push(error);
      }
    }
  };
  await Promise.all(Array.from({ length: limit }, worker));
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(
      errors,
      errors.map((error) =>
        error instanceof Error ? error.message : String(error)
      ).join("\n"),
    );
  }
}
