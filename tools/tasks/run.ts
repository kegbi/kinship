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
 * Verbs: all, unit, integration, contract, coverage, architecture, check,
 * build, ops.
 */

import { withDisposablePostgres } from "../postgres_gate.ts";
import {
  ARCHITECTURE_CHECKER,
  ARCHITECTURE_PERMISSIONS,
  COVERAGE_AGGREGATE,
  type CoverageSet,
  DEFAULT_COVERAGE_THRESHOLD,
  expandGlobPattern,
  INTEGRATION_PERMISSIONS,
  isGlob,
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

class TaskFailure extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
  }
}

async function execute(
  executable: string,
  args: readonly string[],
  environment: Readonly<Record<string, string>> = {},
): Promise<void> {
  const label = `${executable} ${args.join(" ")}`;
  console.log(`\n> ${label}\n`);
  const result = await new Deno.Command(executable, {
    args: [...args],
    cwd: ROOT,
    env: { ...environment },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  if (!result.success) {
    throw new TaskFailure(result.code || 1, `${label} exited ${result.code}`);
  }
}

function deno(
  args: readonly string[],
  environment: Readonly<Record<string, string>> = {},
): Promise<void> {
  return execute("deno", args, {
    DENO_NO_PACKAGE_JSON: "1",
    ...environment,
  });
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

async function runUnitSet(
  module: TaskModule,
  environment: Readonly<Record<string, string>> = {},
): Promise<void> {
  const set = module.unit;
  if (!set) return;
  if (set.runner === "vitest") {
    await pnpm(["exec", "vitest", "run"]);
    return;
  }
  const tests = await resolveTests(set);
  await deno(
    ["test", ...permissionFlags(set.permissions), ...tests],
    environment,
  );
}

async function runUnit(requested: string | undefined): Promise<void> {
  for (const module of selection(requested, TEST_AGGREGATE)) {
    if (!module.unit) {
      if (requested === undefined) continue;
      throw new TaskFailure(1, `Module ${module.id} declares no unit suite.`);
    }
    if (module.onDemand && requested === undefined) continue;
    await runUnitSet(module);
  }
}

async function runIntegration(requested: string | undefined): Promise<void> {
  const modules = requested === undefined
    ? MODULES.filter((module) => module.integration?.length)
    : [moduleOrFail(requested)];
  const suites = modules.flatMap((module) => module.integration ?? []);
  if (suites.length === 0) {
    throw new TaskFailure(
      1,
      `No integration suite is declared for ${requested ?? "the repository"}.`,
    );
  }
  await withDisposablePostgres((environment) =>
    deno(
      ["test", ...permissionFlags(INTEGRATION_PERMISSIONS), ...suites],
      environment,
    )
  );
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

/** The `deno test` arguments that collect raw coverage for one set. */
export async function coverageCollectionArguments(
  set: CoverageSet,
): Promise<string[]> {
  return [
    "test",
    "--clean",
    `--coverage=.coverage/${set.directory}`,
    "--coverage-raw-data-only",
    ...permissionFlags(set.permissions),
    ...await resolveTests(set),
  ];
}

/** The `deno coverage` arguments that enforce one set's threshold. */
export function coverageReportArguments(set: CoverageSet): string[] {
  return [
    "coverage",
    ...set.include.map((path) => `--include=${path}`),
    `--threshold=${set.threshold ?? DEFAULT_COVERAGE_THRESHOLD}`,
    `.coverage/${set.directory}`,
  ];
}

async function runCoverageSet(
  set: CoverageSet,
  environment: Readonly<Record<string, string>> = {},
): Promise<void> {
  if (set.runner === "vitest") {
    await pnpm(["exec", "vitest", "run", "--coverage"]);
    return;
  }
  await deno(await coverageCollectionArguments(set), environment);
  await deno(coverageReportArguments(set));
}

async function runCoverage(requested: string | undefined): Promise<void> {
  for (const module of selection(requested, COVERAGE_AGGREGATE)) {
    const set = module.coverage;
    if (!set) {
      if (requested === undefined) continue;
      throw new TaskFailure(
        1,
        `Module ${module.id} declares no coverage suite.`,
      );
    }
    if (set.postgres) {
      await withDisposablePostgres((environment) =>
        runCoverageSet(set, environment)
      );
      continue;
    }
    await runCoverageSet(set);
  }
}

function contractsCheck(): Promise<void> {
  return deno([
    "run",
    "--allow-read=packages/contracts",
    "tools/contracts/generate.ts",
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
  await deno(["check", ...await checkTargets()]);
  await pnpm(["exec", "astro", "check", "--root", "apps/web"]);
}

async function runBuild(): Promise<void> {
  await contractsCheck();
  await deno(["check", ...buildTargets()]);
  await pnpm(["exec", "astro", "build", "--root", "apps/web"]);
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

function requestedModule(args: readonly string[]): string | undefined {
  const flag = args.find((argument) => argument.startsWith("--module="));
  return flag?.slice("--module=".length);
}

async function main(): Promise<void> {
  const [verb, ...rest] = Deno.args;
  const requested = requestedModule(rest);
  switch (verb) {
    case "all":
      return await runAll();
    case "unit":
      return await runUnit(requested);
    case "integration":
      return await runIntegration(requested);
    case "contract":
      return await runContract(requested);
    case "coverage":
      return await runCoverage(requested);
    case "architecture":
      return await runArchitecture();
    case "check":
      return await runCheck();
    case "build":
      return await runBuild();
    case "ops":
      return await runOperator(rest);
    default:
      throw new TaskFailure(
        1,
        `Unknown verb ${
          verb ?? "(none)"
        }. Use all, unit, integration, contract, coverage, architecture, check, build, or ops.`,
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
