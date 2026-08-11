import { runTicketValidator } from "./validate_ticket.ts";

const REQUIRED_TASKS = [
  "fmt:check",
  "lint",
  "check",
  "test:workflow",
  "test:workflow:coverage",
  "ticket:validate",
  "test:schema:matrix",
] as const;

const TICKET_ID = "PILOT-001";
const CANONICAL_TICKET_PATH = `docs/planning/tickets/${TICKET_ID}`;
const DEFAULT_TEST_PATH = "tools/workflows/regression_test.ts";

type Change =
  | { readonly kind: "write"; readonly path: string; readonly text: string }
  | { readonly kind: "delete"; readonly path: string }
  | { readonly kind: "rename"; readonly from: string; readonly to: string };

type MetadataMode =
  | "untracked"
  | "committed"
  | "dirty"
  | "stale"
  | "non-descendant";

interface FixtureOptions {
  readonly redChanges?: readonly Change[];
  readonly declaredRedTests?: readonly string[];
  readonly candidateChanges?: readonly Change[];
  readonly declaredProductionFiles?: readonly string[];
  readonly ticketPath?: string;
  readonly transitionMapping?: "legacy" | "from-to";
  readonly metadataMode?: MetadataMode;
}

interface GitFixture {
  readonly root: string;
  readonly ticketDirectory: string;
  readonly ticketPath: string;
  readonly candidateRevision: string;
}

interface ValidatorRun {
  readonly exitCode: number;
  readonly output: string;
}

function pathIn(root: string, relativePath: string): string {
  return `${root}/${relativePath}`;
}

function parentPath(path: string): string {
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return separator < 0 ? "." : path.slice(0, separator);
}

function writeText(root: string, relativePath: string, text: string): void {
  const destination = pathIn(root, relativePath);
  Deno.mkdirSync(parentPath(destination), { recursive: true });
  Deno.writeTextFileSync(destination, text);
}

function runGit(root: string, args: readonly string[]): string {
  const result = new Deno.Command("git", {
    args: [...args],
    cwd: root,
    stdout: "piped",
    stderr: "piped",
  }).outputSync();
  if (!result.success) {
    throw new Error(
      `Git fixture command failed (${args.join(" ")}): ${
        new TextDecoder().decode(result.stderr).trim()
      }`,
    );
  }
  return new TextDecoder().decode(result.stdout).trim();
}

function applyChanges(root: string, changes: readonly Change[]): void {
  for (const change of changes) {
    if (change.kind === "write") {
      writeText(root, change.path, change.text);
      continue;
    }
    if (change.kind === "delete") {
      Deno.removeSync(pathIn(root, change.path));
      continue;
    }
    const destination = pathIn(root, change.to);
    Deno.mkdirSync(parentPath(destination), { recursive: true });
    Deno.renameSync(pathIn(root, change.from), destination);
  }
}

async function sha256(value: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(value).buffer,
  );
  return [...new Uint8Array(digest)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function writeFixtureDenoConfig(root: string): void {
  Deno.writeTextFileSync(
    pathIn(root, "deno.json"),
    `${
      JSON.stringify(
        {
          tasks: Object.fromEntries(
            REQUIRED_TASKS.map((task) => [task, "echo"]),
          ),
        },
        null,
        2,
      )
    }\n`,
  );
}

function events(
  baseRevision: string,
  redRevision: string,
  candidateRevision: string,
  transitionMapping: "legacy" | "from-to",
): Record<string, unknown>[] {
  return [
    {
      sequence: 1,
      from: "planned",
      to: "ready",
      round: 0,
      actorRunId: "orchestrator-ready",
      evidenceRef: "ticket.json",
      revision: baseRevision,
    },
    {
      sequence: 2,
      from: "ready",
      to: "red",
      round: 1,
      actorRunId: "implementer-round-01",
      evidenceRef: "evidence/round-01-red.log",
      revision: redRevision,
    },
    {
      sequence: 3,
      from: "red",
      to: "green",
      round: 1,
      actorRunId: "implementer-round-01",
      evidenceRef: "evidence/round-01-green.log",
      revision: candidateRevision,
    },
    {
      sequence: 4,
      from: "green",
      to: "refactor",
      round: 1,
      actorRunId: "implementer-round-01",
      evidenceRef: "evidence/round-01-refactor.log",
      revision: candidateRevision,
    },
    {
      sequence: 5,
      from: "refactor",
      to: "review",
      round: 1,
      actorRunId: "orchestrator-review",
      evidenceRef: transitionMapping === "from-to"
        ? "results/round-01.json"
        : "reviews/round-01.json",
      revision: candidateRevision,
    },
    {
      sequence: 6,
      from: "review",
      to: "accepted",
      round: 1,
      actorRunId: "orchestrator-accept",
      evidenceRef: "acceptance.md",
      revision: candidateRevision,
    },
  ];
}

function acceptedBundle(
  baseRevision: string,
  redRevision: string,
  candidateRevision: string,
  testFiles: readonly { readonly path: string; readonly sha256: string }[],
  productionFiles: readonly string[],
  transitionMapping: "legacy" | "from-to",
): Record<string, unknown> {
  const lifecycle = events(
    baseRevision,
    redRevision,
    candidateRevision,
    transitionMapping,
  );
  return {
    ticket: {
      schemaVersion: 1,
      ticketId: TICKET_ID,
      revision: 1,
      title: "Exercise Git evidence boundaries",
      outcome: "Only immutable, canonical, in-scope ticket evidence passes.",
      baseRevision,
      dependencies: [],
      maxRounds: 3,
      scope: ["Workflow validation"],
      nonGoals: ["Application behavior"],
      allowedWrites: ["tools/workflows/"],
      contractRefs: [
        "docs/development/autonomous-delivery.md",
        "docs/architecture/quality-gates.md#test-first-change-contract",
      ],
      acceptanceCriteria: [{
        id: "AC-01",
        text: "Validate content-addressed Git and lifecycle evidence.",
        redProof: "A forged Git evidence fixture is rejected.",
      }],
      requiredTasks: [...REQUIRED_TASKS],
      risks: ["Mutable or out-of-scope evidence could be trusted"],
      unresolvedDecisions: [],
    },
    state: {
      schemaVersion: 1,
      ticketId: TICKET_ID,
      ticketRevision: 1,
      phase: "accepted",
      round: 1,
      baseRevision,
      candidateRevision,
      events: lifecycle,
      resultRefs: ["results/round-01.json"],
      reviewRefs: ["reviews/round-01.json"],
      dependencyRevisions: {},
      openFindingIds: [],
      orchestratorChecks: REQUIRED_TASKS.map((task, index) => ({
        runId: `orchestrator-check-${index + 1}`,
        revision: candidateRevision,
        command: `deno task ${task}`,
        exitCode: 0,
      })),
      acceptedCandidateRevision: candidateRevision,
      blocker: null,
    },
    events: structuredClone(lifecycle),
    results: [{
      schemaVersion: 1,
      ticketId: TICKET_ID,
      ticketRevision: 1,
      round: 1,
      implementerRunId: "implementer-round-01",
      inputBaseRevision: baseRevision,
      dispatchRef: "dispatch/round-01.md",
      redRevision,
      red: {
        command: "deno test tools/workflows/regression_test.ts",
        exitCode: 1,
        expectedFailure: "The regression assertion exposes the missing guard.",
        output: "Expected rejection was not observed.",
        logRef: "evidence/round-01-red.log",
        testFiles,
        productionFiles: [],
      },
      green: {
        command: "deno test tools/workflows/regression_test.ts",
        exitCode: 0,
        logRef: "evidence/round-01-green.log",
        productionFiles,
      },
      refactor: {
        summary: "Kept the fixture bounded and dependency-free.",
        command: "deno task test:workflow:coverage",
        exitCode: 0,
        logRef: "evidence/round-01-refactor.log",
      },
      candidateRevision,
    }],
    reviews: [{
      schemaVersion: 1,
      ticketId: TICKET_ID,
      ticketRevision: 1,
      round: 1,
      implementerRunId: "implementer-round-01",
      reviewerRunId: "reviewer-round-01",
      baseRevision,
      candidateRevision,
      verdict: "APPROVED",
      commands: [{ command: "deno task test:workflow", exitCode: 0 }],
      lenses: {
        bug_correctness: {
          verdict: "pass",
          evidence: ["Exact behavior was inspected."],
        },
        security_privacy: {
          verdict: "pass",
          evidence: ["Evidence containment was inspected."],
        },
        architecture_contracts: {
          verdict: "pass",
          evidence: ["Accepted contracts were inspected."],
        },
        performance_reliability: {
          verdict: "pass",
          evidence: ["The bounded paths were inspected."],
        },
        style_maintainability: {
          verdict: "pass",
          evidence: ["The implementation was inspected."],
        },
        tests_tdd: {
          verdict: "pass",
          evidence: ["The RED lineage was inspected."],
        },
      },
      findings: [],
      notes: [],
    }],
  };
}

function writeBundle(
  ticketDirectory: string,
  bundle: Record<string, unknown>,
): void {
  const state = bundle.state as Record<string, unknown>;
  const results = bundle.results as Record<string, unknown>[];
  const reviews = bundle.reviews as Record<string, unknown>[];
  const lifecycle = bundle.events as Record<string, unknown>[];
  Deno.mkdirSync(pathIn(ticketDirectory, "results"), { recursive: true });
  Deno.mkdirSync(pathIn(ticketDirectory, "reviews"), { recursive: true });
  Deno.mkdirSync(pathIn(ticketDirectory, "dispatch"), { recursive: true });
  Deno.mkdirSync(pathIn(ticketDirectory, "evidence"), { recursive: true });
  Deno.writeTextFileSync(
    pathIn(ticketDirectory, "ticket.json"),
    `${JSON.stringify(bundle.ticket, null, 2)}\n`,
  );
  Deno.writeTextFileSync(
    pathIn(ticketDirectory, "state.json"),
    `${JSON.stringify(state, null, 2)}\n`,
  );
  Deno.writeTextFileSync(
    pathIn(ticketDirectory, "events.jsonl"),
    `${lifecycle.map((event) => JSON.stringify(event)).join("\n")}\n`,
  );
  Deno.writeTextFileSync(
    pathIn(ticketDirectory, "results/round-01.json"),
    `${JSON.stringify(results[0], null, 2)}\n`,
  );
  Deno.writeTextFileSync(
    pathIn(ticketDirectory, "reviews/round-01.json"),
    `${JSON.stringify(reviews[0], null, 2)}\n`,
  );
  Deno.writeTextFileSync(
    pathIn(ticketDirectory, "dispatch/round-01.md"),
    "# Round 1 dispatch\n",
  );
  for (const phase of ["red", "green", "refactor"]) {
    Deno.writeTextFileSync(
      pathIn(ticketDirectory, `evidence/round-01-${phase}.log`),
      `round 1 ${phase} evidence\n`,
    );
  }
  Deno.writeTextFileSync(
    pathIn(ticketDirectory, "acceptance.md"),
    "Accepted exact candidate.\n",
  );
}

async function createFixture(
  options: FixtureOptions = {},
): Promise<GitFixture> {
  const root = Deno.makeTempDirSync({ prefix: "round3-git-regression-" });
  runGit(root, ["init", "--quiet"]);
  runGit(root, ["config", "user.email", "workflow@example.invalid"]);
  runGit(root, ["config", "user.name", "Workflow Fixture"]);
  runGit(root, ["config", "diff.renames", "true"]);
  writeFixtureDenoConfig(root);
  const baseFiles = {
    "tools/workflows/ticket_contract.ts": "export const version = 'base';\n",
    "tools/workflows/production.ts": "export const production = true;\n",
    "outside/delete-me.ts": "export const outside = true;\n",
    "outside/rename-me.ts": "export const renameMe = true;\n",
  };
  for (const [path, text] of Object.entries(baseFiles)) {
    writeText(root, path, text);
  }
  runGit(root, ["add", "--all"]);
  runGit(root, ["commit", "--quiet", "-m", "base"]);
  const baseRevision = runGit(root, ["rev-parse", "HEAD"]);

  const redChanges = options.redChanges ?? [{
    kind: "write",
    path: DEFAULT_TEST_PATH,
    text: "Deno.test('regression', () => { throw new Error('RED'); });\n",
  }];
  applyChanges(root, redChanges);
  runGit(root, ["add", "--all"]);
  runGit(root, ["commit", "--quiet", "-m", "red"]);
  const redRevision = runGit(root, ["rev-parse", "HEAD"]);
  const declaredRedTests = options.declaredRedTests ?? [DEFAULT_TEST_PATH];
  const testFiles = await Promise.all(declaredRedTests.map(async (path) => ({
    path,
    sha256: await sha256(Deno.readFileSync(pathIn(root, path))),
  })));

  const candidateChanges = options.candidateChanges ?? [{
    kind: "write",
    path: "tools/workflows/ticket_contract.ts",
    text: "export const version = 'candidate';\n",
  }];
  applyChanges(root, candidateChanges);
  runGit(root, ["add", "--all"]);
  runGit(root, ["commit", "--quiet", "-m", "candidate"]);
  const candidateRevision = runGit(root, ["rev-parse", "HEAD"]);
  const ticketPath = options.ticketPath ?? CANONICAL_TICKET_PATH;
  const ticketDirectory = pathIn(root, ticketPath);
  const productionFiles = options.declaredProductionFiles ?? [
    "tools/workflows/ticket_contract.ts",
  ];
  const bundle = acceptedBundle(
    baseRevision,
    redRevision,
    candidateRevision,
    testFiles,
    productionFiles,
    options.transitionMapping ?? "legacy",
  );

  const metadataMode = options.metadataMode ?? "committed";
  if (metadataMode === "non-descendant") {
    runGit(root, ["checkout", "--quiet", "--detach", baseRevision]);
  }
  writeBundle(ticketDirectory, bundle);
  if (metadataMode !== "untracked") {
    runGit(root, ["add", "--all"]);
    runGit(root, ["commit", "--quiet", "-m", "ticket metadata"]);
  }
  if (metadataMode === "dirty") {
    Deno.writeTextFileSync(
      pathIn(ticketDirectory, "acceptance.md"),
      "Working-tree approval substituted after review.\n",
    );
  }
  if (metadataMode === "stale") {
    writeText(
      root,
      "outside/post-review.ts",
      "export const changedAfterReview = true;\n",
    );
    runGit(root, ["add", "--all"]);
    runGit(root, ["commit", "--quiet", "-m", "post-review production"]);
  }
  return { root, ticketDirectory, ticketPath, candidateRevision };
}

async function captureValidatorRun(
  ticketDirectory: string,
  canonicalRoot: string,
): Promise<ValidatorRun> {
  const originalDirectory = Deno.cwd();
  const originalLog = console.log;
  const originalError = console.error;
  const lines: string[] = [];
  const capture = (...values: unknown[]): void => {
    lines.push(values.map(String).join(" "));
  };
  Deno.chdir(canonicalRoot);
  console.log = capture;
  console.error = capture;
  try {
    return {
      exitCode: await runTicketValidator([ticketDirectory]),
      output: lines.join("\n"),
    };
  } finally {
    console.log = originalLog;
    console.error = originalError;
    Deno.chdir(originalDirectory);
  }
}

function removeFixture(fixture: GitFixture): void {
  Deno.removeSync(fixture.root, { recursive: true });
}

function summarizeUnexpectedAcceptances(
  results: readonly [string, ValidatorRun][],
): string[] {
  return results.filter(([, result]) => result.exitCode === 0).map(
    ([label]) => label,
  );
}

Deno.test("R2-003 audits deletions, both rename paths, and RED file kinds", async () => {
  const fixtures = [
    [
      "RED production deletion",
      await createFixture({
        redChanges: [
          { kind: "delete", path: "tools/workflows/production.ts" },
          {
            kind: "write",
            path: DEFAULT_TEST_PATH,
            text: "Deno.test('delete regression', () => {});\n",
          },
        ],
      }),
    ],
    [
      "RED out-of-scope deletion",
      await createFixture({
        redChanges: [
          { kind: "delete", path: "outside/delete-me.ts" },
          {
            kind: "write",
            path: DEFAULT_TEST_PATH,
            text: "Deno.test('outside delete regression', () => {});\n",
          },
        ],
      }),
    ],
    [
      "candidate out-of-scope deletion",
      await createFixture({
        candidateChanges: [
          { kind: "delete", path: "outside/delete-me.ts" },
          {
            kind: "write",
            path: "tools/workflows/ticket_contract.ts",
            text: "export const version = 'candidate';\n",
          },
        ],
      }),
    ],
    [
      "RED production-to-test rename",
      await createFixture({
        redChanges: [{
          kind: "rename",
          from: "tools/workflows/production.ts",
          to: "tools/workflows/renamed_test.ts",
        }],
        declaredRedTests: ["tools/workflows/renamed_test.ts"],
      }),
    ],
    [
      "candidate out-of-scope-to-allowed rename",
      await createFixture({
        candidateChanges: [{
          kind: "rename",
          from: "outside/rename-me.ts",
          to: "tools/workflows/renamed.ts",
        }],
        declaredProductionFiles: ["tools/workflows/renamed.ts"],
      }),
    ],
    [
      "production falsely declared as RED test",
      await createFixture({
        redChanges: [{
          kind: "write",
          path: "tools/workflows/ticket_contract.ts",
          text: "export const version = 'falsely-declared-test';\n",
        }],
        declaredRedTests: ["tools/workflows/ticket_contract.ts"],
      }),
    ],
  ] as const;
  try {
    const runs: [string, ValidatorRun][] = [];
    for (const [label, fixture] of fixtures) {
      runs.push([
        label,
        await captureValidatorRun(fixture.ticketDirectory, fixture.root),
      ]);
    }
    const accepted = summarizeUnexpectedAcceptances(runs);
    if (accepted.length > 0) {
      throw new Error(
        `Expected complete Git status/path auditing; validator accepted: ${
          accepted.join(", ")
        }`,
      );
    }
  } finally {
    for (const [, fixture] of fixtures) removeFixture(fixture);
  }
});

Deno.test("R2-005 maps lifecycle evidence by the complete from/to transition", async () => {
  const correct = await createFixture({
    transitionMapping: "from-to",
    metadataMode: "committed",
  });
  const destinationOnly = await createFixture({
    transitionMapping: "legacy",
    metadataMode: "committed",
  });
  try {
    const correctRun = await captureValidatorRun(
      correct.ticketDirectory,
      correct.root,
    );
    const destinationOnlyRun = await captureValidatorRun(
      destinationOnly.ticketDirectory,
      destinationOnly.root,
    );
    const failures: string[] = [];
    if (correctRun.exitCode !== 0) {
      failures.push(
        `truthful refactor->review mapping rejected: ${correctRun.output}`,
      );
    }
    if (destinationOnlyRun.exitCode === 0) {
      failures.push("destination-only review mapping accepted");
    }
    if (failures.length > 0) {
      throw new Error(
        `Expected full from/to lifecycle evidence policy; ${
          failures.join("; ")
        }`,
      );
    }
  } finally {
    removeFixture(correct);
    removeFixture(destinationOnly);
  }
});

Deno.test("R2-007 rejects linked evidence and non-canonical repositories", async () => {
  const linked = await createFixture({ metadataMode: "committed" });
  const wrongPath = await createFixture({
    metadataMode: "committed",
    ticketPath: "tickets/PILOT-001",
  });
  const canonical = await createFixture({ metadataMode: "committed" });
  const external = await createFixture({ metadataMode: "committed" });
  const linkedEvidence = pathIn(linked.ticketDirectory, "evidence");
  const externalEvidence = Deno.makeTempDirSync({
    prefix: "round3-linked-evidence-",
  });
  for (const phase of ["red", "green", "refactor"]) {
    Deno.copyFileSync(
      pathIn(linkedEvidence, `round-01-${phase}.log`),
      pathIn(externalEvidence, `round-01-${phase}.log`),
    );
  }
  Deno.removeSync(linkedEvidence, { recursive: true });
  Deno.symlinkSync(externalEvidence, linkedEvidence, {
    type: Deno.build.os === "windows" ? "junction" : "dir",
  });
  try {
    const linkedStatus = runGit(linked.root, [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ]);
    if (linkedStatus !== "") {
      throw new Error(
        `Link fixture must remain Git-clean, received status: ${linkedStatus}`,
      );
    }
    const runs: [string, ValidatorRun][] = [
      [
        "junction/symlink evidence escape",
        await captureValidatorRun(linked.ticketDirectory, linked.root),
      ],
      [
        "wrong canonical ticket path",
        await captureValidatorRun(wrongPath.ticketDirectory, wrongPath.root),
      ],
      [
        "external repository",
        await captureValidatorRun(external.ticketDirectory, canonical.root),
      ],
    ];
    const accepted = summarizeUnexpectedAcceptances(runs);
    if (accepted.length > 0) {
      throw new Error(
        `Expected physical and canonical containment rejection; validator accepted: ${
          accepted.join(", ")
        }`,
      );
    }
  } finally {
    Deno.removeSync(linkedEvidence);
    Deno.removeSync(externalEvidence, { recursive: true });
    removeFixture(linked);
    removeFixture(wrongPath);
    removeFixture(canonical);
    removeFixture(external);
  }
});

Deno.test("R2-010 binds clean committed metadata to a candidate descendant", async () => {
  const genuine = await createFixture({ metadataMode: "committed" });
  const dirty = await createFixture({ metadataMode: "dirty" });
  const untracked = await createFixture({ metadataMode: "untracked" });
  const stale = await createFixture({ metadataMode: "stale" });
  const nonDescendant = await createFixture({ metadataMode: "non-descendant" });
  try {
    const genuineRun = await captureValidatorRun(
      genuine.ticketDirectory,
      genuine.root,
    );
    const negativeRuns: [string, ValidatorRun][] = [];
    for (
      const [label, fixture] of [
        ["dirty metadata", dirty],
        ["untracked metadata", untracked],
        ["stale metadata after post-review production", stale],
        ["metadata commit not descended from candidate", nonDescendant],
      ] as const
    ) {
      negativeRuns.push([
        label,
        await captureValidatorRun(fixture.ticketDirectory, fixture.root),
      ]);
    }
    const failures: string[] = [];
    if (genuineRun.exitCode !== 0) {
      failures.push(
        `genuine committed descendant rejected: ${genuineRun.output}`,
      );
    }
    failures.push(...summarizeUnexpectedAcceptances(negativeRuns));
    if (failures.length > 0) {
      throw new Error(
        `Expected immutable candidate-bound metadata; failures: ${
          failures.join(", ")
        }`,
      );
    }
  } finally {
    removeFixture(genuine);
    removeFixture(dirty);
    removeFixture(untracked);
    removeFixture(stale);
    removeFixture(nonDescendant);
  }
});
