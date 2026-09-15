import {
  COVERAGE_AGGREGATE,
  expandTests,
  includeMatches,
  isGlob,
  listProductionFiles,
  listRepositoryTestFiles,
  MODULES,
  type TaskModule,
  TEST_AGGREGATE,
} from "./manifest.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const ROOT = new URL("../../", import.meta.url);

/** The maximum stable verb vocabulary `deno.json` may expose. */
// GAP-005 raised the budget from 25 to 26 for `check:architecture`.
const TASK_BUDGET = 26;

async function repositoryTests(): Promise<string[]> {
  return await listRepositoryTestFiles(ROOT);
}

function unitTests(module: TaskModule, files: readonly string[]): string[] {
  return module.unit ? expandTests(module.unit.tests, files) : [];
}

function everyDeclaredTest(
  module: TaskModule,
  files: readonly string[],
): string[] {
  return [
    ...unitTests(module, files),
    ...(module.integration ?? []),
    ...(module.coverage ? expandTests(module.coverage.tests, files) : []),
  ];
}

Deno.test("[GAP-003] every test module is reachable from root test", async () => {
  const files = await repositoryTests();
  const reachable = new Set<string>();
  for (const id of TEST_AGGREGATE) {
    const module = MODULES.find((candidate) => candidate.id === id);
    assert(module, `root test names the unknown module ${id}`);
    for (const test of unitTests(module, files)) reachable.add(test);
    for (const test of module.integration ?? []) reachable.add(test);
  }

  const documented = new Map<string, string>();
  for (const module of MODULES) {
    if (!module.onDemand) continue;
    assert(
      module.onDemand.reason.length > 20,
      `on-demand module ${module.id} must document why it stays outside root test`,
    );
    for (const test of unitTests(module, files)) {
      documented.set(test, module.id);
    }
  }

  const orphans = files.filter((file) =>
    !reachable.has(file) && !documented.has(file)
  );
  assert(
    orphans.length === 0,
    `these test modules run in no gate: ${orphans.join(", ")}`,
  );
});

Deno.test("[GAP-003] no test module has two unit homes", async () => {
  const files = await repositoryTests();
  const homes = new Map<string, string[]>();
  for (const module of MODULES) {
    for (const test of unitTests(module, files)) {
      homes.set(test, [...(homes.get(test) ?? []), module.id]);
    }
  }
  const duplicated = [...homes]
    .filter(([, owners]) => owners.length > 1)
    .map(([test, owners]) => `${test} (${owners.join(", ")})`);
  assert(
    duplicated.length === 0,
    `unit sets must not run the same module twice: ${duplicated.join("; ")}`,
  );
});

Deno.test("[GAP-003] every production module is inside a coverage include", async () => {
  const production = await listProductionFiles(ROOT);
  const includes = MODULES.flatMap((module) => module.coverage?.include ?? []);
  assert(includes.length > 0, "the manifest declares coverage includes");
  const unmeasured = production.filter((file) =>
    !includes.some((include) => includeMatches(include, file))
  );
  assert(
    unmeasured.length === 0,
    `these production modules are in no coverage include: ${
      unmeasured.join(", ")
    }`,
  );
});

Deno.test("[GAP-003] aggregates reach every declared set exactly once", () => {
  for (const module of MODULES) {
    const aggregated = TEST_AGGREGATE.filter((id) => id === module.id).length;
    const covered = COVERAGE_AGGREGATE.filter((id) => id === module.id).length;
    if (module.onDemand) {
      assert(
        aggregated === 0 && covered === 0,
        `on-demand module ${module.id} must stay out of the aggregate gates`,
      );
      continue;
    }
    if (module.unit) {
      assert(
        aggregated === 1,
        `root test must run the ${module.id} unit set exactly once, not ${aggregated} times`,
      );
    }
    if (module.coverage) {
      assert(
        covered === 1,
        `root coverage must run the ${module.id} coverage set exactly once, not ${covered} times`,
      );
    }
  }
  for (const id of COVERAGE_AGGREGATE) {
    const module = MODULES.find((candidate) => candidate.id === id);
    assert(
      module?.coverage,
      `root coverage names ${id}, which measures nothing`,
    );
  }
});

Deno.test("[GAP-003] every integration file belongs to exactly one module", async () => {
  const files = (await repositoryTests()).filter((file) =>
    file.startsWith("tests/integration/")
  );
  const owners = new Map<string, string[]>();
  for (const module of MODULES) {
    for (const test of module.integration ?? []) {
      owners.set(test, [...(owners.get(test) ?? []), module.id]);
      assert(
        test.startsWith("tests/integration/"),
        `${module.id} claims ${test}, which is not an integration suite`,
      );
    }
  }
  const missing = files.filter((file) => !owners.has(file));
  assert(
    missing.length === 0,
    `these integration suites have no owning module: ${missing.join(", ")}`,
  );
  const shared = [...owners]
    .filter(([, ids]) => ids.length > 1)
    .map(([test, ids]) => `${test} (${ids.join(", ")})`);
  assert(
    shared.length === 0,
    `integration suites must have one owner: ${shared.join("; ")}`,
  );
});

Deno.test("[GAP-003] the contract verb is a view over unit sets", async () => {
  const files = await repositoryTests();
  for (const module of MODULES) {
    const declared = new Set(unitTests(module, files));
    for (const test of module.contract ?? []) {
      assert(
        declared.has(test),
        `${module.id} exposes ${test} as a contract suite without a unit home`,
      );
    }
  }
});

Deno.test("[GAP-003] every declared test pattern matches a real module", async () => {
  const files = await repositoryTests();
  for (const module of MODULES) {
    for (const set of [module.unit, module.coverage]) {
      if (!set) continue;
      for (const pattern of set.tests) {
        const matches = isGlob(pattern)
          ? expandTests([pattern], files)
          : files.filter((file) => file === pattern);
        assert(
          matches.length > 0,
          `${module.id} declares ${pattern}, which matches no test module`,
        );
      }
    }
  }
});

Deno.test("[GAP-003] every declared test module exists", async () => {
  const files = new Set(await repositoryTests());
  const missing: string[] = [];
  for (const module of MODULES) {
    for (const test of everyDeclaredTest(module, [...files])) {
      if (!files.has(test)) missing.push(`${module.id}: ${test}`);
    }
  }
  assert(
    missing.length === 0,
    `the manifest names test modules that do not exist: ${missing.join(", ")}`,
  );
});

Deno.test(
  "[GAP-001] every unit set loading a worker module grants the worker runtime environment",
  async () => {
    const files = await repositoryTests();
    const compose = await Deno.readTextFile(new URL("compose.yaml", ROOT));
    const service = compose.slice(
      compose.indexOf("\n  worker:"),
      compose.indexOf("\n  web:"),
    );
    const required =
      /--allow-env=([A-Z0-9_,]+)/.exec(service)?.[1]?.split(",") ?? [];
    assert(
      required.includes("READABLE_STREAM"),
      "worker runtime authority must declare its environment names",
    );

    for (const module of MODULES) {
      const set = module.unit;
      if (!set) continue;
      const loadsWorker = expandTests(set.tests, files).some((test) =>
        test.startsWith("apps/worker/")
      );
      if (!loadsWorker) continue;
      const granted = set.permissions?.env;
      assert(
        granted !== undefined,
        `${module.id} loads a worker module and must grant environment access`,
      );
      if (granted === "all") continue;
      for (const name of required) {
        assert(
          granted.includes(name),
          `${module.id} loads a worker module and must permit ${name}`,
        );
      }
    }
  },
);

Deno.test("[GAP-003] deno.json keeps a small verb vocabulary over the manifest", async () => {
  const config = JSON.parse(
    await Deno.readTextFile(new URL("deno.json", ROOT)),
  ) as { readonly tasks?: Readonly<Record<string, string>> };
  const tasks = config.tasks ?? {};
  const names = Object.keys(tasks);
  assert(
    names.length <= TASK_BUDGET,
    `deno.json declares ${names.length} tasks; the budget is ${TASK_BUDGET}`,
  );
  for (
    const [name, verb] of [
      ["test", "all"],
      ["test:unit", "unit"],
      ["test:integration", "integration"],
      ["test:contract", "contract"],
      ["test:coverage", "coverage"],
      ["check", "check"],
      ["check:architecture", "architecture"],
      ["build", "build"],
    ] as const
  ) {
    const body = tasks[name] ?? "";
    assert(
      body.includes("tools/tasks/run.ts") && body.trimEnd().endsWith(verb),
      `deno task ${name} must delegate to the manifest runner verb ${verb}`,
    );
  }
  for (const module of MODULES) {
    if (!module.onDemand?.task) continue;
    assert(
      module.onDemand.task in tasks,
      `on-demand module ${module.id} names the missing task ${module.onDemand.task}`,
    );
  }
});

Deno.test("[GAP-003] machine-consumed operator commands name declared tasks", async () => {
  const config = JSON.parse(
    await Deno.readTextFile(new URL("deno.json", ROOT)),
  ) as { readonly tasks?: Readonly<Record<string, string>> };
  const declared = new Set(Object.keys(config.tasks ?? {}));
  const profile = await Deno.readTextFile(
    new URL("docs/planning/private-production-profile.json", ROOT),
  );
  const commands: { readonly name: string; readonly path: string }[] = [];
  const collect = (value: unknown, path: string): void => {
    if (typeof value === "string") {
      for (const match of value.matchAll(/deno task ([^\s"]+)/g)) {
        commands.push({ name: match[1] ?? "", path });
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) => collect(entry, `${path}[${index}]`));
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, entry] of Object.entries(value)) {
        collect(entry, path ? `${path}.${key}` : key);
      }
    }
  };
  collect(JSON.parse(profile), "");
  assert(
    commands.length > 0,
    "the private-production profile must name its operator commands",
  );
  const unknown = commands
    .filter(({ name }) => !declared.has(name))
    .map(({ name, path }) => `${path} names deno task ${name}`);
  assert(
    unknown.length === 0,
    `the private-production profile names undeclared tasks: ${
      unknown.join("; ")
    }`,
  );
});

Deno.test("[GAP-003] the frontend coverage include matches the vitest configuration", async () => {
  const configuration = await Deno.readTextFile(
    new URL("vitest.config.ts", ROOT),
  );
  const web = MODULES.find((module) => module.id === "web");
  assert(web?.coverage, "the web module declares a coverage set");
  for (const include of web.coverage.include) {
    assert(
      configuration.includes(`"${include}"`),
      `vitest must measure ${include}`,
    );
  }
});
