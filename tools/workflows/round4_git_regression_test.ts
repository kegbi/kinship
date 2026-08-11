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
const TICKET_PATH = `docs/planning/tickets/${TICKET_ID}`;
const TEST_PATH = "tools/workflows/round4_fixture_test.ts";
const PRODUCTION_PATH = "tools/workflows/production.ts";
const MAX_FILE_BYTES = 1_000_000;

type CandidateTestChange = "unchanged" | "delete" | "replace" | "skip";

interface FixtureOptions {
  readonly testBytes?: Uint8Array;
  readonly declaredSha256?: string;
  readonly candidateTestChange?: CandidateTestChange;
}

interface GitFixture {
  readonly root: string;
  readonly ticketDirectory: string;
}

interface ValidatorRun {
  readonly exitCode: number;
  readonly output: string;
}

interface EmittedValidation {
  readonly ok: boolean;
  readonly issues: readonly {
    readonly path: string;
    readonly code: string;
    readonly message: string;
  }[];
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function pathIn(root: string, relativePath: string): string {
  return `${root}/${relativePath}`;
}

function parentPath(path: string): string {
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return separator < 0 ? "." : path.slice(0, separator);
}

function writeBytes(
  root: string,
  relativePath: string,
  value: Uint8Array,
): void {
  const destination = pathIn(root, relativePath);
  Deno.mkdirSync(parentPath(destination), { recursive: true });
  Deno.writeFileSync(destination, value);
}

function writeText(root: string, relativePath: string, value: string): void {
  writeBytes(root, relativePath, encoder.encode(value));
}

function runGitBytes(root: string, args: readonly string[]): Uint8Array {
  const result = new Deno.Command("git", {
    args: [...args],
    cwd: root,
    stdout: "piped",
    stderr: "piped",
  }).outputSync();
  if (!result.success) {
    throw new Error(
      `Git fixture command failed (${args.join(" ")}): ${
        decoder.decode(result.stderr).trim()
      }`,
    );
  }
  return result.stdout;
}

function runGitText(root: string, args: readonly string[]): string {
  return decoder.decode(runGitBytes(root, args)).trim();
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

function testBlob(byteLength: number): Uint8Array {
  const prefix = encoder.encode(
    'Deno.test("frozen RED regression", () => {});\n/*\n',
  );
  const suffix = encoder.encode("\n*/\n");
  if (byteLength < prefix.byteLength + suffix.byteLength) {
    throw new Error("Test blob length is too small for the fixture source");
  }
  const value = new Uint8Array(byteLength);
  value.fill("x".charCodeAt(0));
  value.set(prefix);
  value.set(suffix, byteLength - suffix.byteLength);
  return value;
}

function lifecycleEvents(
  baseRevision: string,
  redRevision: string,
  candidateRevision: string,
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
      evidenceRef: "results/round-01.json",
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
  testSha256: string,
): Record<string, unknown> {
  const events = lifecycleEvents(
    baseRevision,
    redRevision,
    candidateRevision,
  );
  return {
    ticket: {
      schemaVersion: 1,
      ticketId: TICKET_ID,
      revision: 1,
      title: "Retain complete frozen RED blobs",
      outcome: "Permitted RED blobs remain complete and unchanged.",
      baseRevision,
      dependencies: [],
      maxRounds: 3,
      scope: ["Workflow validation"],
      nonGoals: ["Application behavior"],
      allowedWrites: ["tools/workflows/"],
      contractRefs: [
        "AGENTS.md#mandatory-change-method",
        "docs/development/autonomous-delivery.md",
      ],
      acceptanceCriteria: [{
        id: "AC-01",
        text: "Validate complete and retained frozen RED test blobs.",
        redProof: "Large or weakened Git evidence is rejected incorrectly.",
      }],
      requiredTasks: [...REQUIRED_TASKS],
      risks: ["Truncation or candidate replacement could forge RED evidence"],
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
      events,
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
    events: structuredClone(events),
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
        command: `deno test ${TEST_PATH}`,
        exitCode: 1,
        expectedFailure: "The regression exposes missing evidence integrity.",
        output: "Expected rejection was not observed.",
        logRef: "evidence/round-01-red.log",
        testFiles: [{ path: TEST_PATH, sha256: testSha256 }],
        productionFiles: [],
      },
      green: {
        command: `deno test ${TEST_PATH}`,
        exitCode: 0,
        logRef: "evidence/round-01-green.log",
        productionFiles: [PRODUCTION_PATH],
      },
      refactor: {
        summary: "Kept evidence validation bounded and dependency-free.",
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
          evidence: ["Complete Git blobs were inspected."],
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
          evidence: ["Bounded blob consumption was inspected."],
        },
        style_maintainability: {
          verdict: "pass",
          evidence: ["The implementation was inspected."],
        },
        tests_tdd: {
          verdict: "pass",
          evidence: ["Frozen RED retention was inspected."],
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
  const events = bundle.events as Record<string, unknown>[];
  Deno.mkdirSync(pathIn(ticketDirectory, "dispatch"), { recursive: true });
  Deno.mkdirSync(pathIn(ticketDirectory, "evidence"), { recursive: true });
  Deno.mkdirSync(pathIn(ticketDirectory, "results"), { recursive: true });
  Deno.mkdirSync(pathIn(ticketDirectory, "reviews"), { recursive: true });
  writeText(
    ticketDirectory,
    "ticket.json",
    `${JSON.stringify(bundle.ticket, null, 2)}\n`,
  );
  writeText(
    ticketDirectory,
    "state.json",
    `${JSON.stringify(state, null, 2)}\n`,
  );
  writeText(
    ticketDirectory,
    "events.jsonl",
    `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
  );
  writeText(
    ticketDirectory,
    "results/round-01.json",
    `${JSON.stringify(results[0], null, 2)}\n`,
  );
  writeText(
    ticketDirectory,
    "reviews/round-01.json",
    `${JSON.stringify(reviews[0], null, 2)}\n`,
  );
  writeText(ticketDirectory, "dispatch/round-01.md", "# Round 1 dispatch\n");
  for (const phase of ["red", "green", "refactor"]) {
    writeText(
      ticketDirectory,
      `evidence/round-01-${phase}.log`,
      `round 1 ${phase} evidence\n`,
    );
  }
  writeText(ticketDirectory, "acceptance.md", "Accepted exact candidate.\n");
}

async function createFixture(
  options: FixtureOptions = {},
): Promise<GitFixture> {
  const root = Deno.makeTempDirSync({ prefix: "round4-git-regression-" });
  try {
    runGitText(root, ["init", "--quiet"]);
    runGitText(root, ["config", "user.email", "workflow@example.invalid"]);
    runGitText(root, ["config", "user.name", "Workflow Fixture"]);
    writeText(
      root,
      "deno.json",
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
    writeText(root, PRODUCTION_PATH, "export const version = 'base';\n");
    runGitText(root, ["add", "--all"]);
    runGitText(root, ["commit", "--quiet", "-m", "base"]);
    const baseRevision = runGitText(root, ["rev-parse", "HEAD"]);

    writeBytes(
      root,
      TEST_PATH,
      options.testBytes ?? testBlob(1_024),
    );
    runGitText(root, ["add", "--all"]);
    runGitText(root, ["commit", "--quiet", "-m", "red"]);
    const redRevision = runGitText(root, ["rev-parse", "HEAD"]);
    const redBlob = runGitBytes(root, ["show", `${redRevision}:${TEST_PATH}`]);
    const testSha256 = options.declaredSha256 ?? await sha256(redBlob);

    writeText(root, PRODUCTION_PATH, "export const version = 'candidate';\n");
    switch (options.candidateTestChange ?? "unchanged") {
      case "unchanged":
        break;
      case "delete":
        Deno.removeSync(pathIn(root, TEST_PATH));
        break;
      case "replace":
        writeText(
          root,
          TEST_PATH,
          'Deno.test("replacement without RED assertion", () => {});\n',
        );
        break;
      case "skip":
        writeText(
          root,
          TEST_PATH,
          'Deno.test.ignore("disabled frozen RED regression", () => {});\n',
        );
        break;
    }
    runGitText(root, ["add", "--all"]);
    runGitText(root, ["commit", "--quiet", "-m", "candidate"]);
    const candidateRevision = runGitText(root, ["rev-parse", "HEAD"]);

    const ticketDirectory = pathIn(root, TICKET_PATH);
    writeBundle(
      ticketDirectory,
      acceptedBundle(
        baseRevision,
        redRevision,
        candidateRevision,
        testSha256,
      ),
    );
    runGitText(root, ["add", "--all"]);
    runGitText(root, ["commit", "--quiet", "-m", "ticket metadata"]);
    const status = runGitText(root, [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ]);
    if (status !== "") {
      throw new Error(`Git fixture must be clean, received status: ${status}`);
    }
    return { root, ticketDirectory };
  } catch (error) {
    Deno.removeSync(root, { recursive: true });
    throw error;
  }
}

async function captureValidatorRun(fixture: GitFixture): Promise<ValidatorRun> {
  const originalDirectory = Deno.cwd();
  const originalLog = console.log;
  const originalError = console.error;
  const lines: string[] = [];
  const capture = (...values: unknown[]): void => {
    lines.push(values.map(String).join(" "));
  };
  Deno.chdir(fixture.root);
  console.log = capture;
  console.error = capture;
  try {
    return {
      exitCode: await runTicketValidator([fixture.ticketDirectory]),
      output: lines.join("\n"),
    };
  } finally {
    console.log = originalLog;
    console.error = originalError;
    Deno.chdir(originalDirectory);
  }
}

function parseValidation(run: ValidatorRun): EmittedValidation {
  try {
    return JSON.parse(run.output) as EmittedValidation;
  } catch {
    throw new Error(`Validator did not emit JSON: ${run.output}`);
  }
}

function assertSuccess(run: ValidatorRun): void {
  const emitted = parseValidation(run);
  if (
    run.exitCode !== 0 || emitted.ok !== true || emitted.issues.length !== 0
  ) {
    throw new Error(
      `Expected exact validation success, received exit ${run.exitCode}: ${run.output}`,
    );
  }
}

function assertSingleIssue(
  run: ValidatorRun,
  expected: EmittedValidation["issues"][number],
): void {
  const emitted = parseValidation(run);
  const actual = emitted.issues[0];
  if (
    run.exitCode !== 1 || emitted.ok !== false || emitted.issues.length !== 1 ||
    actual?.path !== expected.path || actual.code !== expected.code ||
    actual.message !== expected.message
  ) {
    throw new Error(
      `Expected only ${
        JSON.stringify(expected)
      }, received exit ${run.exitCode}: ${run.output}`,
    );
  }
}

async function runFixture(
  options: FixtureOptions,
  assertion: (run: ValidatorRun) => void,
): Promise<void> {
  const fixture = await createFixture(options);
  try {
    assertion(await captureValidatorRun(fixture));
  } finally {
    Deno.removeSync(fixture.root, { recursive: true });
  }
}

Deno.test("PILOT-001-R3-001 accepts a complete 64 KiB RED blob", async () => {
  await runFixture({ testBytes: testBlob(64 * 1_024) }, assertSuccess);
});

Deno.test("PILOT-001-R3-001 accepts a RED blob at the 1 MB limit", async () => {
  await runFixture({ testBytes: testBlob(MAX_FILE_BYTES) }, assertSuccess);
});

Deno.test("PILOT-001-R3-001 reports one exact wrong-hash diagnostic for a large blob", async () => {
  await runFixture(
    {
      testBytes: testBlob(64 * 1_024),
      declaredSha256: "0".repeat(64),
    },
    (run) =>
      assertSingleIssue(run, {
        path: "$.results[0].red.testFiles[0].sha256",
        code: "content_hash_mismatch",
        message: "Declared RED test digest does not match the Git blob",
      }),
  );
});

Deno.test("PILOT-001-R3-001 rejects a truly oversized RED blob", async () => {
  await runFixture(
    { testBytes: testBlob(MAX_FILE_BYTES + 1) },
    (run) =>
      assertSingleIssue(run, {
        path: "$.results[0].red.testFiles[0].path",
        code: "git_output_limit",
        message: "Declared RED test blob exceeds the validation limit",
      }),
  );
});

Deno.test("PILOT-001-R3-002 accepts an unchanged frozen RED test", async () => {
  await runFixture({ candidateTestChange: "unchanged" }, assertSuccess);
});

Deno.test("PILOT-001-R3-002 rejects candidate deletion of the frozen RED test", async () => {
  await runFixture(
    { candidateTestChange: "delete" },
    (run) =>
      assertSingleIssue(run, {
        path: "$.results[0].red.testFiles[0].path",
        code: "content_missing",
        message: "Declared RED test blob does not exist in the candidate",
      }),
  );
});

Deno.test("PILOT-001-R3-002 rejects candidate replacement of the frozen RED test", async () => {
  await runFixture(
    { candidateTestChange: "replace" },
    (run) =>
      assertSingleIssue(run, {
        path: "$.results[0].red.testFiles[0].sha256",
        code: "content_hash_mismatch",
        message:
          "Declared RED test digest does not match the candidate Git blob",
      }),
  );
});

Deno.test("PILOT-001-R3-002 rejects skipping the frozen RED test in the candidate", async () => {
  await runFixture(
    { candidateTestChange: "skip" },
    (run) =>
      assertSingleIssue(run, {
        path: "$.results[0].red.testFiles[0].sha256",
        code: "content_hash_mismatch",
        message:
          "Declared RED test digest does not match the candidate Git blob",
      }),
  );
});
