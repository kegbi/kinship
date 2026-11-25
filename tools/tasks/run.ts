/**
 * The repository task runner.
 *
 * `deno.json` keeps one stable verb per gate; each verb delegates here and this
 * module composes the concrete command from `tools/tasks/manifest.ts`. Adding a
 * module or a suite means editing the manifest, never a task string.
 *
 * Usage:
 *   deno run ... tools/tasks/run.ts <verb> [--module=<id>] [extra arguments]
 *
 * `coverage` takes `--except=<id>`, which leaves one module's set to another
 * run of the verb. `unit` and `integration` take `--uncovered`, which leaves out every suite
 * `coverage` runs. CI runs `coverage` beside them, so it needs no suite twice.
 *
 * Verbs: all, unit, integration, contract, coverage, architecture, check,
 * build, ops, schema-types.
 */

import { withDisposablePostgres } from "../postgres_gate.ts";
import {
  type Lane,
  MAX_LANES,
  planLanes,
  runLanes,
  runPool,
  suiteWeight,
} from "./lanes.ts";
import {
  ARCHITECTURE_CHECKER,
  ARCHITECTURE_PERMISSIONS,
  COVERAGE_AGGREGATE,
  type CoverageSet,
  coveredSuites,
  DEFAULT_COVERAGE_THRESHOLD,
  expandGlobPattern,
  INTEGRATION_PERMISSIONS,
  isGlob,
  listRepositoryTestFiles,
  MODULES,
  OPERATOR_SCRIPTS,
  permissionFlags,
  type Permissions,
  PRODUCTION_ENTRYPOINTS,
  type TaskModule,
  TEST_AGGREGATE,
  type TestSet,
  TOOL_ENTRYPOINTS,
} from "./manifest.ts";

const ROOT = new URL("../../", import.meta.url);

/** The on-demand suite the `build` verb runs over the output it built. */
const WEB_BUILD_OUTPUT = "web-build";

class TaskFailure extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
  }
}

/** Copies a child's output line by line, each line behind its lane's name. */
async function copyLines(
  source: ReadableStream<Uint8Array>,
  lane: string,
): Promise<void> {
  let rest = "";
  for await (const chunk of source.pipeThrough(new TextDecoderStream())) {
    const lines = (rest + chunk).split("\n");
    rest = lines.pop() ?? "";
    for (const line of lines) console.log(`[${lane}] ${line}`);
  }
  if (rest.length > 0) console.log(`[${lane}] ${rest}`);
}

/**
 * Runs one command. With a `lane`, which a command running beside others has,
 * its output is copied behind that name so the two stay readable.
 */
async function execute(
  executable: string,
  args: readonly string[],
  environment: Readonly<Record<string, string>> = {},
  lane?: string,
): Promise<void> {
  const label = `${executable} ${args.join(" ")}`;
  console.log(`\n> ${lane === undefined ? "" : `[${lane}] `}${label}\n`);
  const options = { args: [...args], cwd: ROOT, env: { ...environment } };
  let status: Deno.CommandStatus;
  if (lane === undefined) {
    status = await new Deno.Command(executable, {
      ...options,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    }).spawn().status;
  } else {
    const child = new Deno.Command(executable, {
      ...options,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    [status] = await Promise.all([
      child.status,
      copyLines(child.stdout, lane),
      copyLines(child.stderr, lane),
    ]);
  }
  if (!status.success) {
    throw new TaskFailure(status.code || 1, `${label} exited ${status.code}`);
  }
}

function deno(
  args: readonly string[],
  environment: Readonly<Record<string, string>> = {},
  lane?: string,
): Promise<void> {
  return execute(
    "deno",
    args,
    { DENO_NO_PACKAGE_JSON: "1", ...environment },
    lane,
  );
}

/** A set's suites split over database lanes, balanced by what they weigh. */
async function postgresLanes(suites: readonly string[]): Promise<Lane[]> {
  const weights = new Map<string, number>();
  for (const suite of suites) {
    const { size } = await Deno.stat(new URL(suite, ROOT));
    weights.set(suite, suiteWeight(suite, size));
  }
  return planLanes(suites, (suite) => weights.get(suite) ?? 0);
}

function pnpm(args: readonly string[]): Promise<void> {
  return execute("pnpm", args);
}

async function resolveTests(set: TestSet): Promise<string[]> {
  const resolved: string[] = [];
  for (const pattern of set.tests) {
    if (!isGlob(pattern)) {
      resolved.push(pattern);
      continue;
    }
    resolved.push(...await expandGlobPattern(pattern, ROOT));
  }
  return resolved;
}

function moduleOrFail(id: string): TaskModule {
  const module = MODULES.find((candidate) => candidate.id === id);
  if (!module) {
    throw new TaskFailure(
      1,
      `Unknown module ${id}. Known modules: ${
        MODULES.map((candidate) => candidate.id).join(", ")
      }`,
    );
  }
  return module;
}

/** Selects modules for a verb: one requested module, or the declared order. */
function selection(requested: string | undefined, order: readonly string[]) {
  if (requested !== undefined) return [moduleOrFail(requested)];
  return order.map(moduleOrFail);
}

/** The suites a verb leaves out, because a coverage set runs them. */
type LeftOut = ReadonlySet<string>;

/** What `--uncovered` leaves out; nothing without it. */
async function leftOut(args: readonly string[]): Promise<LeftOut> {
  return args.includes("--uncovered")
    ? coveredSuites(await listRepositoryTestFiles(ROOT))
    : new Set();
}

async function runUnitSet(
  module: TaskModule,
  skipped: LeftOut = new Set(),
): Promise<void> {
  const set = module.unit;
  if (!set) return;
  const tests = (await resolveTests(set)).filter((test) => !skipped.has(test));
  if (tests.length === 0) return;
  if (set.runner === "vitest") {
    await pnpm(["exec", "vitest", "run"]);
    return;
  }
  await denoOver(["test", ...permissionFlags(set.permissions)], tests);
}

async function runUnit(
  requested: string | undefined,
  skipped: LeftOut = new Set(),
): Promise<void> {
  for (const module of selection(requested, TEST_AGGREGATE)) {
    if (!module.unit) {
      if (requested === undefined) continue;
      throw new TaskFailure(1, `Module ${module.id} declares no unit suite.`);
    }
    if (module.onDemand && requested === undefined) continue;
    await runUnitSet(module, skipped);
  }
}

/** The generated Kysely types, beside the platform adapter that uses them. */
const DATABASE_TYPES_DIRECTORY = "packages/backend/platform/postgres/generated";

/**
 * Derives the generated Kysely types from `environment.DATABASE_URL`, a
 * database the gate has just migrated, or with `check` compares them
 * byte-for-byte with the committed file and fails on any difference.
 */
export function databaseTypesArguments(check: boolean): string[] {
  return [
    "run",
    // The generator's dependencies read their colour and TypeScript switches
    // from the environment as they load, as `contracts:check`'s do.
    "--allow-env",
    "--allow-net=127.0.0.1",
    `--allow-read=${DATABASE_TYPES_DIRECTORY}`,
    ...(check ? [] : [`--allow-write=${DATABASE_TYPES_DIRECTORY}`]),
    "tools/schema/database_types.ts",
    ...(check ? ["--check"] : []),
  ];
}

async function runSchemaTypes(check: boolean): Promise<void> {
  await withDisposablePostgres((environment) =>
    deno(databaseTypesArguments(check), environment)
  );
}

async function runIntegration(
  requested: string | undefined,
  skipped: LeftOut = new Set(),
): Promise<void> {
  const modules = requested === undefined
    ? MODULES.filter((module) => module.integration?.length)
    : [moduleOrFail(requested)];
  const suites = modules.flatMap((module) => module.integration ?? [])
    .filter((suite) => !skipped.has(suite));
  if (suites.length === 0) {
    throw new TaskFailure(
      1,
      `No integration suite is declared for ${requested ?? "the repository"}.`,
    );
  }
  const lanes = await postgresLanes(suites);
  await runLanes(lanes.map((lane, index) => ({
    alone: lane.alone,
    run: () =>
      withDisposablePostgres(async (environment) => {
        const name = lanes.length === 1 ? undefined : `lane ${index + 1}`;
        // A freshly migrated database is the canonical DDL, so the committed
        // types must match it before any suite of that lane writes a row.
        // Every lane migrates the same DDL; one comparison is enough.
        if (index === 0) {
          await deno(databaseTypesArguments(true), environment, name);
        }
        await deno(
          ["test", ...permissionFlags(INTEGRATION_PERMISSIONS), ...lane.suites],
          environment,
          name,
        );
      }),
  })));
}

async function runContract(requested: string | undefined): Promise<void> {
  const modules = requested === undefined
    ? MODULES.filter((module) => module.contract?.length)
    : [moduleOrFail(requested)];
  for (const module of modules) {
    const suites = module.contract ?? [];
    if (suites.length === 0) continue;
    await deno([
      "test",
      ...permissionFlags(module.unit?.permissions),
      ...suites,
    ]);
  }
  await contractsCheck();
}

/** Where one lane of a set writes its raw coverage. */
function coverageDirectory(set: CoverageSet, lane: number): string {
  return `.coverage/${set.directory}${lane === 0 ? "" : `-lane-${lane + 1}`}`;
}

/** The `deno test` arguments that collect raw coverage for one lane. */
export function coverageCollectionArguments(
  set: CoverageSet,
  suites: readonly string[],
  lane = 0,
): string[] {
  return [
    "test",
    "--clean",
    `--coverage=${coverageDirectory(set, lane)}`,
    "--coverage-raw-data-only",
    ...permissionFlags(set.permissions),
    ...suites,
  ];
}

/** Every directory the lanes of one set write. */
export function coverageDirectories(set: CoverageSet, lanes = 1): string[] {
  return Array.from(
    { length: lanes },
    (_, lane) => coverageDirectory(set, lane),
  );
}

/**
 * The `deno coverage` arguments that enforce one set's threshold. They read
 * every lane the set ran in, and those of the sets it reuses, so the report is
 * the set's whole coverage.
 */
export function coverageReportArguments(
  set: CoverageSet,
  directories: readonly string[] = coverageDirectories(set),
): string[] {
  return [
    "coverage",
    ...set.include.map((path) => `--include=${path}`),
    ...(set.exclude ?? []).map((pattern) => `--exclude=${pattern}`),
    `--threshold=${set.threshold ?? DEFAULT_COVERAGE_THRESHOLD}`,
    ...directories,
  ];
}

/**
 * Collects every set first, the lanes of all sets side by side, and then
 * reports each set over everything it collected or reuses.
 */
async function runCoverage(
  requested: string | undefined,
  excepted?: string,
): Promise<void> {
  if (excepted !== undefined) moduleOrFail(excepted);
  const reported = selection(requested, COVERAGE_AGGREGATE)
    .filter((module) => module.id !== excepted);
  if (requested !== undefined && !reported[0]?.coverage) {
    throw new TaskFailure(1, `Module ${requested} declares no coverage suite.`);
  }
  // One requested module collects the sets it reuses as well.
  const collected = new Set(
    reported.flatMap((module) => [
      module,
      ...(module.coverage?.reuses ?? []).map(moduleOrFail),
    ]),
  );

  const collect: { alone: boolean; run: () => Promise<void> }[] = [];
  const directories = new Map<string, string[]>();
  for (const module of collected) {
    const set = module.coverage;
    if (!set || set.runner === "vitest") continue;
    const suites = await resolveTests(set);
    const lanes = set.postgres
      ? await postgresLanes(suites)
      : [{ alone: false, suites }];
    directories.set(module.id, coverageDirectories(set, lanes.length));
    lanes.forEach((lane, index) => {
      const name = lanes.length === 1 ? module.id : `${module.id} ${index + 1}`;
      const run = (environment: Readonly<Record<string, string>> = {}) =>
        deno(
          coverageCollectionArguments(set, lane.suites, index),
          environment,
          name,
        );
      collect.push({
        alone: lane.alone,
        run: () => set.postgres ? withDisposablePostgres(run) : run(),
      });
    });
  }
  await runLanes(collect);

  const report = reported.flatMap(({ id, coverage: set }) => {
    if (!set || set.runner === "vitest") return [];
    const read = [id, ...(set.reuses ?? [])]
      .flatMap((module) => directories.get(module) ?? []);
    return [() => deno(coverageReportArguments(set, read), {}, id)];
  });
  await runPool(report, MAX_LANES);

  // Vitest spreads over every core by itself, so it runs alone.
  if (reported.some((module) => module.coverage?.runner === "vitest")) {
    await pnpm(["exec", "vitest", "run", "--coverage"]);
  }
}

function contractsCheck(): Promise<void> {
  // `openapi-typescript` reads its own configuration from the working
  // directory and asks `process.env` for its colour settings, so the generator
  // runs with the read and environment authority its dependencies need. It
  // still writes nothing in `--check` mode.
  return deno([
    "run",
    "--allow-env",
    "--allow-read",
    "tools/contracts/build.ts",
    "--check",
  ]);
}

async function runAll(): Promise<void> {
  await runUnit(undefined);
  await runIntegration(undefined);
  await contractsCheck();
}

/** Every module the `deno check` gate compiles, tests included. */
export async function checkTargets(): Promise<string[]> {
  const targets = new Set<string>([
    ...PRODUCTION_ENTRYPOINTS,
    ...TOOL_ENTRYPOINTS,
  ]);
  for (const module of MODULES) {
    for (const set of [module.unit, module.coverage]) {
      if (!set || set.runner === "vitest") continue;
      for (const test of await resolveTests(set)) targets.add(test);
    }
    for (const suite of module.integration ?? []) targets.add(suite);
  }
  return [...targets].sort();
}

/**
 * The longest argument list one spawned `deno` command carries (REL-105). On
 * a Windows host whose `deno` is a version-manager shim, the shim refuses a
 * command line beyond roughly 8,000 characters, far below the operating
 * system's own limit, so the check gate and the largest unit set could not
 * run there at all.
 */
export const COMMAND_LINE_CHARACTERS = 7_000;

/**
 * A file list split, in order, so that each batch fits one command line
 * together with the `fixed` arguments every batch repeats. Every file lands
 * in exactly one batch; one too long for the budget gets a batch of its own
 * rather than being dropped.
 */
export function argumentBatches(
  fixed: readonly string[],
  files: readonly string[],
  limit: number = COMMAND_LINE_CHARACTERS,
): string[][] {
  const budget = limit - fixed.join(" ").length;
  const batches: string[][] = [];
  let length = 0;
  for (const file of files) {
    const current = batches.at(-1);
    if (current && length + 1 + file.length <= budget) {
      current.push(file);
      length += 1 + file.length;
    } else {
      batches.push([file]);
      length = file.length;
    }
  }
  return batches;
}

/** Runs one `deno` subcommand over a file list, in as few commands as fit. */
async function denoOver(
  fixed: readonly string[],
  files: readonly string[],
  environment: Readonly<Record<string, string>> = {},
): Promise<void> {
  for (const batch of argumentBatches(fixed, files)) {
    await deno([...fixed, ...batch], environment);
  }
}

/** Every module the `build` gate compiles before it emits artifacts. */
export function buildTargets(): readonly string[] {
  return [...PRODUCTION_ENTRYPOINTS];
}

/** The module-boundary gate: cheap text analysis, so it runs first. */
function runArchitecture(): Promise<void> {
  return deno([
    "run",
    ...permissionFlags(ARCHITECTURE_PERMISSIONS),
    ARCHITECTURE_CHECKER,
  ]);
}

async function runCheck(): Promise<void> {
  await runArchitecture();
  await denoOver(["check"], await checkTargets());
  await pnpm(["exec", "astro", "check", "--root", "apps/web"]);
}

async function runBuild(): Promise<void> {
  await contractsCheck();
  await deno(["check", ...buildTargets()]);
  await pnpm(["exec", "astro", "build", "--root", "apps/web"]);
  // What the build ships: no React on public pages, and the islands' bytes.
  await runUnitSet(moduleOrFail(WEB_BUILD_OUTPUT));
}

async function runOperator(args: readonly string[]): Promise<void> {
  const [id, ...forwarded] = args;
  const script = OPERATOR_SCRIPTS.find((candidate) => candidate.id === id);
  if (!script) {
    throw new TaskFailure(
      1,
      `Unknown operator script ${id ?? "(none)"}. Known scripts: ${
        OPERATOR_SCRIPTS.map((candidate) => candidate.id).join(", ")
      }`,
    );
  }
  const permissions: Permissions = script.permissions;
  await deno([
    "run",
    ...permissionFlags(permissions),
    script.script,
    ...forwarded,
  ]);
}

function flagValue(args: readonly string[], name: string): string | undefined {
  const flag = args.find((argument) => argument.startsWith(`${name}=`));
  return flag?.slice(name.length + 1);
}

async function main(): Promise<void> {
  const [verb, ...rest] = Deno.args;
  const requested = flagValue(rest, "--module");
  switch (verb) {
    case "all":
      return await runAll();
    case "unit":
      return await runUnit(requested, await leftOut(rest));
    case "integration":
      return await runIntegration(requested, await leftOut(rest));
    case "contract":
      return await runContract(requested);
    case "coverage":
      return await runCoverage(
        requested,
        flagValue(rest, "--except"),
      );
    case "architecture":
      return await runArchitecture();
    case "check":
      return await runCheck();
    case "build":
      return await runBuild();
    case "ops":
      return await runOperator(rest);
    case "schema-types":
      return await runSchemaTypes(rest.includes("--check"));
    default:
      throw new TaskFailure(
        1,
        `Unknown verb ${
          verb ?? "(none)"
        }. Use all, unit, integration, contract, coverage, architecture, check, build, ops, or schema-types.`,
      );
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(`\n${error instanceof Error ? error.message : error}`);
    Deno.exit(error instanceof TaskFailure ? error.code : 1);
  }
}
