/**
 * The delivery pipeline contract.
 *
 * Until GAP-004 the repository had no CI workflow and no Git hooks: every gate
 * ran by hand. `.github/workflows/ci.yml` and `lefthook.yml` are now the two
 * machine-consumed definitions of those gates, and neither can be executed
 * here — there is no Actions runner, and installing hooks would write the
 * shared `.git`. This suite is their executable consumer instead: it parses
 * both documents and proves that the required jobs and hook stages exist, that
 * the job graph is acyclic, that dependency installation stays frozen, and
 * that every command they name resolves to a declared `deno.json` task, a
 * declared dependency binary, or a file that exists.
 */

const ROOT = new URL("../", import.meta.url);
const WORKFLOW_PATH = ".github/workflows/ci.yml";
const HOOKS_PATH = "lefthook.yml";

/** Gate jobs the pipeline must expose, with the tasks each one owns. */
const REQUIRED_JOBS = [
  {
    id: "static",
    tasks: [
      "fmt:check",
      "lint",
      "check",
      "check:architecture",
      "contracts:check",
      "test:contract",
      "deps:audit",
      "deps:audit:gate",
    ],
  },
  { id: "unit", tasks: ["test:unit", "test:coverage"] },
  { id: "integration", tasks: ["test:integration"] },
  { id: "schema", tasks: ["test:schema"] },
  { id: "e2e-chromium", tasks: ["test:e2e"] },
  { id: "e2e-all-browsers", tasks: ["test:e2e"] },
  { id: "images", tasks: [] },
] as const;

/** Dependency binaries the pipeline and the hooks may invoke through pnpm. */
const PNPM_BINARIES: Readonly<Record<string, string>> = {
  astro: "astro",
  eslint: "eslint",
  lefthook: "lefthook",
  playwright: "@playwright/test",
  vitest: "vitest",
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// --- A YAML subset reader ------------------------------------------------
//
// The repository has no YAML dependency, and these two documents only use
// block mappings, block sequences, quoted and plain scalars, simple flow
// sequences, and literal block scalars. Reading that subset here keeps the
// contract executable without adding a parser dependency for two files.

type YamlValue = string | readonly YamlValue[] | {
  readonly [key: string]: YamlValue;
};

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function isSkippable(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length === 0 || trimmed.startsWith("#");
}

function stripComment(text: string): string {
  let quote: string | undefined;
  for (let index = 0; index < text.length; index += 1) {
    const character = text.charAt(index);
    if (quote !== undefined) {
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (
      character === "#" && (index === 0 || /\s/.test(text.charAt(index - 1)))
    ) {
      return text.slice(0, index);
    }
  }
  return text;
}

function scalar(raw: string): string {
  const text = stripComment(raw).trim();
  if (text.length >= 2) {
    const first = text.charAt(0);
    if ((first === '"' || first === "'") && text.endsWith(first)) {
      return text.slice(1, -1);
    }
  }
  return text;
}

function flowSequence(text: string): readonly YamlValue[] {
  const inner = text.slice(1, -1).trim();
  if (inner.length === 0) return [];
  return inner.split(",").map((entry) => scalar(entry));
}

class YamlReader {
  private index = 0;

  constructor(private readonly lines: string[]) {}

  private next(): number {
    let cursor = this.index;
    while (
      cursor < this.lines.length && isSkippable(this.lines[cursor] ?? "")
    ) {
      cursor += 1;
    }
    return cursor;
  }

  /** Reads the block that starts at `indent`, mapping or sequence. */
  block(indent: number): YamlValue {
    const cursor = this.next();
    const line = this.lines[cursor];
    if (line === undefined || indentOf(line) < indent) return "";
    return line.trimStart().startsWith("-")
      ? this.sequence(indent)
      : this.mapping(indent);
  }

  private sequence(indent: number): readonly YamlValue[] {
    const items: YamlValue[] = [];
    while (true) {
      const cursor = this.next();
      const line = this.lines[cursor];
      if (line === undefined || indentOf(line) !== indent) break;
      if (!line.trimStart().startsWith("-")) break;
      this.index = cursor;
      const body = line.slice(indent + 1);
      if (body.trim().length === 0) {
        this.index = cursor + 1;
        items.push(this.block(this.nestedIndent(indent)));
        continue;
      }
      const itemIndent = indent + 1 + (body.length - body.trimStart().length);
      this.lines[cursor] = " ".repeat(itemIndent) + body.trimStart();
      items.push(
        body.includes(": ") || body.trimEnd().endsWith(":")
          ? this.mapping(itemIndent)
          : this.scalarItem(itemIndent),
      );
    }
    return items;
  }

  private scalarItem(indent: number): string {
    const line = this.lines[this.index] ?? "";
    this.index += 1;
    return scalar(line.slice(indent));
  }

  private nestedIndent(indent: number): number {
    const cursor = this.next();
    const line = this.lines[cursor];
    return line === undefined ? indent + 2 : indentOf(line);
  }

  private mapping(indent: number): { readonly [key: string]: YamlValue } {
    const entries: Record<string, YamlValue> = {};
    while (true) {
      const cursor = this.next();
      const line = this.lines[cursor];
      if (line === undefined || indentOf(line) !== indent) break;
      if (line.trimStart().startsWith("-")) break;
      const text = line.slice(indent);
      const separator = text.indexOf(":");
      assert(separator > 0, `Unreadable YAML mapping entry: ${line}`);
      const key = scalar(text.slice(0, separator));
      const rest = text.slice(separator + 1).trim();
      this.index = cursor + 1;
      if (rest.startsWith("|") || rest.startsWith(">")) {
        entries[key] = this.blockScalar(indent, rest.startsWith(">"));
        continue;
      }
      if (rest.startsWith("[") && rest.endsWith("]")) {
        entries[key] = flowSequence(rest);
        continue;
      }
      if (stripComment(rest).trim().length > 0) {
        entries[key] = scalar(rest);
        continue;
      }
      const cursorAfter = this.next();
      const following = this.lines[cursorAfter];
      if (following === undefined) {
        entries[key] = "";
        continue;
      }
      const followingIndent = indentOf(following);
      if (followingIndent > indent) {
        entries[key] = this.block(followingIndent);
        continue;
      }
      if (
        followingIndent === indent && following.trimStart().startsWith("-")
      ) {
        entries[key] = this.sequence(indent);
        continue;
      }
      entries[key] = "";
    }
    return entries;
  }

  private blockScalar(indent: number, folded: boolean): string {
    const collected: string[] = [];
    while (this.index < this.lines.length) {
      const line = this.lines[this.index] ?? "";
      if (line.trim().length > 0 && indentOf(line) <= indent) break;
      collected.push(line);
      this.index += 1;
    }
    const bodyIndent = Math.min(
      ...collected
        .filter((line) => line.trim().length > 0)
        .map((line) => indentOf(line)),
    );
    const body = collected.map((line) => line.slice(bodyIndent));
    while (body.length > 0 && (body[body.length - 1] ?? "").trim() === "") {
      body.pop();
    }
    return body.join(folded ? " " : "\n");
  }
}

function parseYaml(text: string): YamlValue {
  return new YamlReader(text.replace(/\r\n/g, "\n").split("\n")).block(0);
}

// --- Document access -----------------------------------------------------

function asMap(
  value: YamlValue | undefined,
  what: string,
): { readonly [key: string]: YamlValue } {
  assert(
    typeof value === "object" && value !== null && !Array.isArray(value),
    `${what} must be a mapping`,
  );
  return value as { readonly [key: string]: YamlValue };
}

function asList(
  value: YamlValue | undefined,
  what: string,
): readonly YamlValue[] {
  assert(Array.isArray(value), `${what} must be a sequence`);
  return value as readonly YamlValue[];
}

function asText(value: YamlValue | undefined): string {
  return typeof value === "string" ? value : "";
}

async function readOrExplain(path: string, why: string): Promise<string> {
  try {
    return await Deno.readTextFile(new URL(path, ROOT));
  } catch (error) {
    assert(
      !(error instanceof Deno.errors.NotFound),
      `${path} is missing: ${why}`,
    );
    throw error;
  }
}

async function workflow(): Promise<{ readonly [key: string]: YamlValue }> {
  return asMap(
    parseYaml(
      await readOrExplain(
        WORKFLOW_PATH,
        "CI must run the repository gates instead of leaving them to hand runs",
      ),
    ),
    WORKFLOW_PATH,
  );
}

async function hooks(): Promise<{ readonly [key: string]: YamlValue }> {
  return asMap(
    parseYaml(
      await readOrExplain(
        HOOKS_PATH,
        "Lefthook must run the fast gates on commit and push",
      ),
    ),
    HOOKS_PATH,
  );
}

async function declaredTasks(): Promise<Readonly<Record<string, string>>> {
  const config = JSON.parse(
    await Deno.readTextFile(new URL("deno.json", ROOT)),
  ) as { readonly tasks?: Readonly<Record<string, string>> };
  return config.tasks ?? {};
}

async function devDependencies(): Promise<Readonly<Record<string, string>>> {
  const manifest = JSON.parse(
    await Deno.readTextFile(new URL("package.json", ROOT)),
  ) as { readonly devDependencies?: Readonly<Record<string, string>> };
  return manifest.devDependencies ?? {};
}

function jobs(
  document: { readonly [key: string]: YamlValue },
): { readonly [key: string]: YamlValue } {
  return asMap(document["jobs"], `${WORKFLOW_PATH} jobs`);
}

function jobOrFail(
  document: { readonly [key: string]: YamlValue },
  id: string,
): { readonly [key: string]: YamlValue } {
  const declared = jobs(document);
  const job = declared[id];
  assert(job !== undefined, `${WORKFLOW_PATH} must declare the ${id} job`);
  return asMap(job, `${WORKFLOW_PATH} job ${id}`);
}

/** Every shell line a job runs, in step order. */
function jobCommands(
  job: { readonly [key: string]: YamlValue },
  id: string,
): readonly string[] {
  return asList(job["steps"], `${WORKFLOW_PATH} job ${id} steps`)
    .flatMap((step) => asText(asMap(step, `${WORKFLOW_PATH} step`)["run"]))
    .flatMap((run) => run.split("\n"))
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function workflowCommands(
  document: { readonly [key: string]: YamlValue },
): readonly string[] {
  return Object.entries(jobs(document)).flatMap(([id, job]) =>
    jobCommands(asMap(job, `${WORKFLOW_PATH} job ${id}`), id)
  );
}

function hookStage(
  document: { readonly [key: string]: YamlValue },
  stage: string,
): readonly { readonly name: string; readonly run: string }[] {
  const declared = document[stage];
  assert(
    declared !== undefined,
    `${HOOKS_PATH} must declare the ${stage} hook`,
  );
  const entries = asMap(declared, `${HOOKS_PATH} ${stage}`)["jobs"];
  return asList(entries, `${HOOKS_PATH} ${stage} jobs`).map((entry) => {
    const job = asMap(entry, `${HOOKS_PATH} ${stage} job`);
    return { name: asText(job["name"]), run: asText(job["run"]) };
  });
}

function taskNames(commands: readonly string[]): readonly string[] {
  return commands.flatMap((command) =>
    [...command.matchAll(/deno task ([^\s]+)/g)].map((match) => match[1] ?? "")
  );
}

// --- The contract --------------------------------------------------------

Deno.test("[GAP-004] CI runs every repository gate on the right events", async () => {
  const document = await workflow();
  const triggers = asMap(document["on"], `${WORKFLOW_PATH} triggers`);
  assert(
    "pull_request" in triggers,
    "CI must run on pull requests, where the gates protect the branch",
  );
  assert(
    asList(
      asMap(triggers["push"], `${WORKFLOW_PATH} push trigger`)["branches"],
      `${WORKFLOW_PATH} push branches`,
    ).includes("main"),
    "CI must run on pushes to main",
  );
  assert(
    asList(triggers["schedule"], `${WORKFLOW_PATH} schedule`).length > 0,
    "the nightly run must be scheduled",
  );

  for (const required of REQUIRED_JOBS) {
    const job = jobOrFail(document, required.id);
    const named = new Set(taskNames(jobCommands(job, required.id)));
    for (const task of required.tasks) {
      assert(
        named.has(task),
        `the ${required.id} job must run deno task ${task}`,
      );
    }
  }

  // The advisories docs/architecture/quality-gates.md lists stay visible: the
  // full report still runs, and the gate fails on high and critical ones.
  const gates = jobCommands(jobOrFail(document, "static"), "static");
  assert(
    gates.some((command) => /deno task deps:audit\s*$/.test(command)),
    "the static job must print the complete advisory report",
  );
  assert(
    gates.some((command) => command === "deno task deps:audit:gate"),
    "the static job must fail on high and critical advisories",
  );
  const tasks = await declaredTasks();
  assert(
    tasks["deps:audit"] === "DENO_NO_PACKAGE_JSON=1 deno audit",
    "the full advisory report must remain unfiltered",
  );
  assert(
    tasks["deps:audit:gate"] ===
      "DENO_NO_PACKAGE_JSON=1 deno run --allow-run=deno tools/dependency_audit_gate.ts",
    "the audit gate must run the repository's exception-free gate",
  );

  const chromium = jobCommands(
    jobOrFail(document, "e2e-chromium"),
    "e2e-chromium",
  );
  assert(
    chromium.some((command) => command.includes("test:e2e --project=chromium")),
    "the pull-request E2E job must run the Chromium project only",
  );
  const everyBrowser = jobCommands(
    jobOrFail(document, "e2e-all-browsers"),
    "e2e-all-browsers",
  );
  assert(
    everyBrowser.some((command) =>
      /deno task test:e2e(\s|$)/.test(command) && !command.includes("--project")
    ),
    "the all-browser E2E job must run the whole Playwright matrix",
  );

  for (const id of ["e2e-all-browsers", "images"] as const) {
    const condition = asText(jobOrFail(document, id)[`if`]);
    assert(
      condition.includes("push") && condition.includes("schedule"),
      `the ${id} job must be reserved for main and the nightly run`,
    );
    assert(
      !condition.includes("pull_request"),
      `the ${id} job must not run on every pull request`,
    );
  }

  const images = jobCommands(jobOrFail(document, "images"), "images");
  for (
    const [dockerfile, target] of [
      ["Dockerfile.api", ""],
      ["Dockerfile.web", "web"],
      ["Dockerfile.web", "gateway"],
    ] as const
  ) {
    assert(
      images.some((command) =>
        command.includes("docker build") &&
        command.includes(`--file ${dockerfile} `) &&
        (target === "" || command.includes(`--target ${target} `))
      ),
      `the images job must build ${dockerfile} ${target}`.trim(),
    );
    await Deno.stat(new URL(dockerfile, ROOT));
  }
});

Deno.test("[GAP-041] the images run the Node runtime .tool-versions pins", async () => {
  const [versions, dockerfile] = await Promise.all([
    Deno.readTextFile(new URL(".tool-versions", ROOT)),
    Deno.readTextFile(new URL("Dockerfile.web", ROOT)),
  ]);
  const expected = /^nodejs (\S+)$/m.exec(versions)?.[1];
  assert(expected !== undefined, ".tool-versions must pin the Node runtime");
  const bases = [...dockerfile.matchAll(/^FROM (node:\S+)/gm)].map((match) =>
    match[1] ?? ""
  );
  assert(bases.length > 0, "the web Dockerfile must build on a Node image");
  for (const base of bases) {
    assert(
      new RegExp(
        `^node:${
          expected.replaceAll(".", "\\.")
        }-bookworm-slim@sha256:[0-9a-f]{64}$`,
      ).test(base),
      `${base} must be Node ${expected} pinned by digest, as .tool-versions pins`,
    );
  }
});

Deno.test("[GAP-004] every command the pipeline names resolves", async () => {
  const [document, hookDocument, tasks, dependencies] = await Promise.all([
    workflow(),
    hooks(),
    declaredTasks(),
    devDependencies(),
  ]);
  const commands = [
    ...workflowCommands(document),
    ...["pre-commit", "pre-push"].flatMap((stage) =>
      hookStage(hookDocument, stage).flatMap((job) => job.run.split("\n"))
    ),
  ];
  assert(commands.length > 0, "the pipeline must name commands");

  const unknownTasks = taskNames(commands).filter((name) => !(name in tasks));
  assert(
    unknownTasks.length === 0,
    `the pipeline names undeclared deno tasks: ${unknownTasks.join(", ")}`,
  );

  const binaries = commands.flatMap((command) =>
    [...command.matchAll(
      /(?:pnpm (?:exec|dlx)|node_modules\/\.bin\/)\s?([^\s]+)/g,
    )]
      .map((match) => match[1] ?? "")
  );
  for (const binary of binaries) {
    const owner = PNPM_BINARIES[binary];
    assert(
      owner !== undefined,
      `the pipeline runs the unknown binary ${binary}`,
    );
    assert(
      owner in dependencies,
      `${binary} needs the declared dev dependency ${owner}`,
    );
  }

  for (
    const step of Object.values(jobs(document)).flatMap((job) =>
      asList(asMap(job, "job")["steps"], "steps")
    )
  ) {
    const uses = asText(asMap(step, "step")["uses"]);
    if (uses.length === 0) continue;
    assert(
      /@(v\d+|[0-9a-f]{40})$/.test(uses),
      `the action ${uses} must be pinned to a released major version`,
    );
  }
});

Deno.test("[GAP-004] the job graph names declared jobs and stays acyclic", async () => {
  const declared = jobs(await workflow());
  const edges = new Map<string, readonly string[]>();
  for (const [id, job] of Object.entries(declared)) {
    const needs = asMap(job, `job ${id}`)["needs"];
    const parents = needs === undefined
      ? []
      : typeof needs === "string"
      ? [needs]
      : asList(needs, `job ${id} needs`).map((entry) => asText(entry));
    for (const parent of parents) {
      assert(parent in declared, `job ${id} needs the unknown job ${parent}`);
    }
    edges.set(id, parents);
  }

  const state = new Map<string, "visiting" | "done">();
  const visit = (id: string, path: readonly string[]): void => {
    if (state.get(id) === "done") return;
    assert(
      state.get(id) !== "visiting",
      `the job graph has a cycle: ${[...path, id].join(" -> ")}`,
    );
    state.set(id, "visiting");
    for (const parent of edges.get(id) ?? []) visit(parent, [...path, id]);
    state.set(id, "done");
  };
  for (const id of edges.keys()) visit(id, []);
});

Deno.test("[GAP-004] the pipeline installs dependencies from frozen lockfiles", async () => {
  const [document, hookDocument, tasks] = await Promise.all([
    workflow(),
    hooks(),
    declaredTasks(),
  ]);
  assert(
    (tasks["deps:deno"] ?? "").includes("--frozen"),
    "deps:deno must install from the frozen Deno lockfile",
  );
  assert(
    (tasks["deps:node"] ?? "").includes("--frozen-lockfile"),
    "deps:node must install from the frozen pnpm lockfile",
  );

  const commands = [
    ...workflowCommands(document),
    ...["pre-commit", "pre-push"].flatMap((stage) =>
      hookStage(hookDocument, stage).flatMap((job) => job.run.split("\n"))
    ),
  ];
  const unfrozen = commands.filter((command) =>
    /^(pnpm (add|install|update)|deno (install|add|outdated))\b/.test(command)
  );
  assert(
    unfrozen.length === 0,
    `dependency installation must go through the frozen tasks: ${
      unfrozen.join("; ")
    }`,
  );

  for (const id of ["static", "unit", "integration", "schema"] as const) {
    const commandsForJob = jobCommands(jobOrFail(document, id), id);
    const installs = taskNames(commandsForJob).filter((name) =>
      name.startsWith("deps:")
    );
    assert(
      installs.includes("deps:deno"),
      `the ${id} job must bootstrap Deno dependencies from the lockfile`,
    );
  }
});

Deno.test("release-age exemption is limited to the approved security patch", async () => {
  const settings = asMap(
    parseYaml(await Deno.readTextFile(new URL("pnpm-workspace.yaml", ROOT))),
    "pnpm-workspace.yaml",
  );
  assert(settings["minimumReleaseAge"] === "4320", "keep the 72-hour hold");
  assert(
    settings["minimumReleaseAgeStrict"] === "true" &&
      settings["minimumReleaseAgeIgnoreMissingTime"] === "false" &&
      settings["trustLockfile"] === "false",
    "keep the strict release-age checks",
  );
  const excluded = asList(settings["minimumReleaseAgeExclude"], "exemptions");
  assert(
    excluded.length === 1 && excluded[0] === "http-cache-semantics@4.3.0",
    "only the approved exact patch may bypass release age",
  );
});

Deno.test("[GAP-004] the workflow pins the toolchain the repository declares", async () => {
  const [document, versions] = await Promise.all([
    workflow(),
    Deno.readTextFile(new URL(".tool-versions", ROOT)),
  ]);
  const expected = /^deno (\S+)$/m.exec(versions)?.[1];
  assert(expected !== undefined, ".tool-versions must pin the Deno runtime");

  let pins = 0;
  for (const [id, job] of Object.entries(jobs(document))) {
    for (const step of asList(asMap(job, `job ${id}`)["steps"], "steps")) {
      const entry = asMap(step, "step");
      if (!asText(entry["uses"]).startsWith("denoland/setup-deno")) continue;
      const pinned = asText(
        asMap(entry["with"], `job ${id} setup-deno inputs`)["deno-version"],
      );
      assert(
        pinned === expected,
        `job ${id} installs Deno ${pinned}; .tool-versions pins ${expected}`,
      );
      pins += 1;
    }
    for (const step of asList(asMap(job, `job ${id}`)["steps"], "steps")) {
      const entry = asMap(step, "step");
      if (!asText(entry["uses"]).startsWith("actions/setup-node")) continue;
      assert(
        asText(
          asMap(entry["with"], `job ${id} setup-node inputs`)[
            "node-version-file"
          ],
        ) === ".tool-versions",
        `job ${id} must read the Node version from .tool-versions`,
      );
    }
  }
  assert(pins > 0, "every CI job must install the pinned Deno runtime");
});

Deno.test("[GAP-004] Lefthook runs the fast gates on commit and push", async () => {
  const document = await hooks();
  const preCommit = hookStage(document, "pre-commit");
  assert(
    preCommit.some((job) =>
      job.run.includes("deno fmt --check") && job.run.includes("{staged_files}")
    ),
    "pre-commit must check formatting of the staged files without rewriting them",
  );
  assert(
    preCommit.some((job) =>
      job.run.includes("deno lint") && job.run.includes("{staged_files}")
    ),
    "pre-commit must lint the staged files",
  );
  for (const job of preCommit) {
    assert(
      !/deno fmt(?!\s+--check)/.test(job.run),
      `the pre-commit job ${job.name} must not rewrite files`,
    );
    assert(
      !job.run.includes("git add"),
      `the pre-commit job ${job.name} must not stage files`,
    );
  }

  const prePush = hookStage(document, "pre-push");
  const pushed = new Set(taskNames(prePush.map((job) => job.run)));
  // The whole-repository static gates run here too: pre-commit sees only the
  // staged files, so a lint, format, or type error elsewhere reached CI.
  for (
    const task of ["fmt:check", "lint", "check", "test:unit", "test:contract"]
  ) {
    assert(pushed.has(task), `pre-push must run deno task ${task}`);
  }
});
