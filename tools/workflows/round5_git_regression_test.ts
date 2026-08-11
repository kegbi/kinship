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
const PRODUCTION_PATH = "tools/workflows/production.ts";
const ROUND_ONE_TEST_PATH = "tools/workflows/round5_one_test.ts";
const ROUND_TWO_TEST_PATH = "tools/workflows/round5_two_test.ts";
const MAX_TEST_REFERENCES = 100;
const MAX_GIT_EVIDENCE_BYTES = 5_000_000;

type FinalTestChange = "unchanged" | "delete" | "replace" | "skip";

interface GitFixture {
  readonly root: string;
  readonly ticketDirectory: string;
}

interface ValidatorRun {
  readonly exitCode: number;
  readonly output: string;
}

interface ValidationIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

interface EmittedValidation {
  readonly ok: boolean;
  readonly issues: readonly ValidationIssue[];
}

interface TestFileEvidence {
  readonly path: string;
  readonly sha256: string;
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

function runGit(root: string, args: readonly string[]): string {
  return decoder.decode(runGitBytes(root, args)).trim();
}

function commit(root: string, message: string, allowEmpty = false): string {
  runGit(root, ["add", "--all"]);
  runGit(root, [
    "commit",
    "--quiet",
    ...(allowEmpty ? ["--allow-empty"] : []),
    "-m",
    message,
  ]);
  return runGit(root, ["rev-parse", "HEAD"]);
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

function testBlob(byteLength: number, label: string): Uint8Array {
  const prefix = encoder.encode(`Deno.test("${label}", () => {});\n/*\n`);
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

function initializeRepository(prefix: string): string {
  const root = Deno.makeTempDirSync({ prefix });
  runGit(root, ["init", "--quiet"]);
  runGit(root, ["config", "user.email", "workflow@example.invalid"]);
  runGit(root, ["config", "user.name", "Workflow Fixture"]);
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
  return root;
}

function ticket(baseRevision: string): Record<string, unknown> {
  return {
    schemaVersion: 1,
    ticketId: TICKET_ID,
    revision: 1,
    title: "Bound and retain autonomous workflow evidence",
    outcome: "Workflow evidence is immutable and bounded across all rounds.",
    baseRevision,
    dependencies: [],
    maxRounds: 3,
    scope: ["Workflow validation"],
    nonGoals: ["Application behavior"],
    allowedWrites: ["tools/workflows/"],
    contractRefs: [
      "AGENTS.md#mandatory-change-method",
      "docs/development/autonomous-delivery.md#ticket-packet",
      "docs/development/autonomous-delivery.md#state-machine",
    ],
    acceptanceCriteria: [{
      id: "AC-03",
      text: "Validate immutable, bounded, phase-aware Git evidence.",
      redProof: "A focused real-Git regression exposes the missing guard.",
    }],
    requiredTasks: [...REQUIRED_TASKS],
    risks: ["Unbounded or mutable evidence could be accepted"],
    unresolvedDecisions: [],
  };
}

function result(
  round: number,
  inputBaseRevision: string,
  redRevision: string,
  candidateRevision: string,
  testFiles: readonly TestFileEvidence[],
): Record<string, unknown> {
  const roundName = String(round).padStart(2, "0");
  return {
    schemaVersion: 1,
    ticketId: TICKET_ID,
    ticketRevision: 1,
    round,
    implementerRunId: `implementer-round-${roundName}`,
    inputBaseRevision,
    dispatchRef: `dispatch/round-${roundName}.md`,
    redRevision,
    red: {
      command: "deno test tools/workflows/round5_git_regression_test.ts",
      exitCode: 1,
      expectedFailure: "The regression exposes missing workflow validation.",
      output: "Expected validation behavior was not observed.",
      logRef: `evidence/round-${roundName}-red.log`,
      testFiles,
      productionFiles: [],
    },
    green: {
      command: "deno test tools/workflows/round5_git_regression_test.ts",
      exitCode: 0,
      logRef: `evidence/round-${roundName}-green.log`,
      productionFiles: [],
    },
    refactor: {
      summary: "Kept Git evidence validation bounded and dependency-free.",
      command: "deno task test:workflow:coverage",
      exitCode: 0,
      logRef: `evidence/round-${roundName}-refactor.log`,
    },
    candidateRevision,
  };
}

function lenses(failed = false): Record<string, unknown> {
  return {
    bug_correctness: {
      verdict: failed ? "fail" : "pass",
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
      evidence: ["Resource bounds were inspected."],
    },
    style_maintainability: {
      verdict: "pass",
      evidence: ["The implementation was inspected."],
    },
    tests_tdd: {
      verdict: "pass",
      evidence: ["Frozen RED evidence was inspected."],
    },
  };
}

function review(
  round: number,
  baseRevision: string,
  candidateRevision: string,
  verdict: "APPROVED" | "CHANGES_REQUESTED",
): Record<string, unknown> {
  const roundName = String(round).padStart(2, "0");
  return {
    schemaVersion: 1,
    ticketId: TICKET_ID,
    ticketRevision: 1,
    round,
    implementerRunId: `implementer-round-${roundName}`,
    reviewerRunId: `reviewer-round-${roundName}`,
    baseRevision,
    candidateRevision,
    verdict,
    commands: [{ command: "deno task test:workflow", exitCode: 0 }],
    lenses: lenses(verdict === "CHANGES_REQUESTED"),
    findings: verdict === "CHANGES_REQUESTED"
      ? [{
        id: "PILOT-001-FIXTURE-001",
        lens: "bug_correctness",
        severity: "P2",
        location: "tools/workflows/validate_ticket.ts:validateGitEvidence",
        expectedBehavior: "All frozen evidence is retained.",
        observedBehavior: "The first candidate needed rework.",
        reproduction: "Run the focused fixture.",
        impact: "Evidence integrity could be weakened.",
        affectedCriterion: "AC-03",
        contractRef: "AGENTS.md#mandatory-change-method",
        requiredRemediation: "Complete the next TDD round.",
        verification: "Review the exact next candidate.",
        status: "resolved",
      }]
      : [],
    notes: [],
  };
}

function acceptedState(
  baseRevision: string,
  candidateRevision: string,
  events: readonly Record<string, unknown>[],
  rounds: number,
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    ticketId: TICKET_ID,
    ticketRevision: 1,
    phase: "accepted",
    round: rounds,
    baseRevision,
    candidateRevision,
    events,
    resultRefs: Array.from(
      { length: rounds },
      (_, index) => `results/round-${String(index + 1).padStart(2, "0")}.json`,
    ),
    reviewRefs: Array.from(
      { length: rounds },
      (_, index) => `reviews/round-${String(index + 1).padStart(2, "0")}.json`,
    ),
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
  };
}

function oneRoundEvents(
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

function twoRoundEvents(
  baseRevision: string,
  firstRedRevision: string,
  firstCandidateRevision: string,
  secondRedRevision: string,
  finalCandidateRevision: string,
): Record<string, unknown>[] {
  return [
    ...oneRoundEvents(
      baseRevision,
      firstRedRevision,
      firstCandidateRevision,
    ).slice(0, 5),
    {
      sequence: 6,
      from: "review",
      to: "rework",
      round: 1,
      actorRunId: "reviewer-round-01",
      evidenceRef: "reviews/round-01.json",
      revision: firstCandidateRevision,
    },
    {
      sequence: 7,
      from: "rework",
      to: "red",
      round: 2,
      actorRunId: "implementer-round-02",
      evidenceRef: "evidence/round-02-red.log",
      revision: secondRedRevision,
    },
    {
      sequence: 8,
      from: "red",
      to: "green",
      round: 2,
      actorRunId: "implementer-round-02",
      evidenceRef: "evidence/round-02-green.log",
      revision: finalCandidateRevision,
    },
    {
      sequence: 9,
      from: "green",
      to: "refactor",
      round: 2,
      actorRunId: "implementer-round-02",
      evidenceRef: "evidence/round-02-refactor.log",
      revision: finalCandidateRevision,
    },
    {
      sequence: 10,
      from: "refactor",
      to: "review",
      round: 2,
      actorRunId: "orchestrator-review-round-02",
      evidenceRef: "results/round-02.json",
      revision: finalCandidateRevision,
    },
    {
      sequence: 11,
      from: "review",
      to: "accepted",
      round: 2,
      actorRunId: "orchestrator-accept-round-02",
      evidenceRef: "acceptance.md",
      revision: finalCandidateRevision,
    },
  ];
}

function writePacket(
  ticketDirectory: string,
  packet: Record<string, unknown>,
): void {
  const results = packet.results as readonly Record<string, unknown>[];
  const reviews = packet.reviews as readonly Record<string, unknown>[];
  const events = packet.events as readonly Record<string, unknown>[];
  Deno.mkdirSync(ticketDirectory, { recursive: true });
  writeText(
    ticketDirectory,
    "ticket.json",
    `${JSON.stringify(packet.ticket, null, 2)}\n`,
  );
  writeText(
    ticketDirectory,
    "state.json",
    `${JSON.stringify(packet.state, null, 2)}\n`,
  );
  writeText(
    ticketDirectory,
    "events.jsonl",
    `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
  );
  results.forEach((entry, index) => {
    const roundName = String(index + 1).padStart(2, "0");
    writeText(
      ticketDirectory,
      `results/round-${roundName}.json`,
      `${JSON.stringify(entry, null, 2)}\n`,
    );
    writeText(
      ticketDirectory,
      `dispatch/round-${roundName}.md`,
      `# Round ${index + 1} dispatch\n`,
    );
    for (const phase of ["red", "green", "refactor"]) {
      writeText(
        ticketDirectory,
        `evidence/round-${roundName}-${phase}.log`,
        `round ${index + 1} ${phase} evidence\n`,
      );
    }
  });
  reviews.forEach((entry, index) => {
    const roundName = String(index + 1).padStart(2, "0");
    writeText(
      ticketDirectory,
      `reviews/round-${roundName}.json`,
      `${JSON.stringify(entry, null, 2)}\n`,
    );
  });
  if ((packet.state as Record<string, unknown>).phase === "accepted") {
    writeText(ticketDirectory, "acceptance.md", "Accepted exact candidate.\n");
  }
}

function assertClean(root: string): void {
  const status = runGit(root, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);
  if (status !== "") {
    throw new Error(`Git fixture must be clean, received status: ${status}`);
  }
}

async function createAcceptedFixture(
  blobs: readonly { readonly path: string; readonly bytes: Uint8Array }[],
): Promise<GitFixture> {
  const root = initializeRepository("round5-aggregate-");
  try {
    const baseRevision = commit(root, "base");
    for (const blob of blobs) writeBytes(root, blob.path, blob.bytes);
    const redRevision = commit(root, "red");
    const testFiles = await Promise.all(blobs.map(async (blob) => ({
      path: blob.path,
      sha256: await sha256(
        runGitBytes(root, ["show", `${redRevision}:${blob.path}`]),
      ),
    })));
    const candidateRevision = commit(root, "candidate", true);
    const events = oneRoundEvents(
      baseRevision,
      redRevision,
      candidateRevision,
    );
    const ticketDirectory = pathIn(root, TICKET_PATH);
    writePacket(ticketDirectory, {
      ticket: ticket(baseRevision),
      state: acceptedState(baseRevision, candidateRevision, events, 1),
      events: structuredClone(events),
      results: [
        result(1, baseRevision, redRevision, candidateRevision, testFiles),
      ],
      reviews: [review(1, baseRevision, candidateRevision, "APPROVED")],
    });
    commit(root, "ticket metadata");
    assertClean(root);
    return { root, ticketDirectory };
  } catch (error) {
    Deno.removeSync(root, { recursive: true });
    throw error;
  }
}

async function testEvidence(
  root: string,
  redRevision: string,
  blobs: readonly { readonly path: string; readonly bytes: Uint8Array }[],
): Promise<readonly TestFileEvidence[]> {
  return await Promise.all(blobs.map(async (blob) => ({
    path: blob.path,
    sha256: await sha256(
      runGitBytes(root, ["show", `${redRevision}:${blob.path}`]),
    ),
  })));
}

async function createTwoRoundAggregateFixture(
  firstRoundBlobs: readonly {
    readonly path: string;
    readonly bytes: Uint8Array;
  }[],
  secondRoundBlobs: readonly {
    readonly path: string;
    readonly bytes: Uint8Array;
  }[],
): Promise<GitFixture> {
  const root = initializeRepository("round5-aggregate-references-");
  try {
    const baseRevision = commit(root, "base");
    for (const blob of firstRoundBlobs) {
      writeBytes(root, blob.path, blob.bytes);
    }
    const firstRedRevision = commit(root, "round one red");
    const firstTestFiles = await testEvidence(
      root,
      firstRedRevision,
      firstRoundBlobs,
    );
    writeText(root, PRODUCTION_PATH, "export const version = 'round-one';\n");
    const firstCandidateRevision = commit(root, "round one candidate");

    for (const blob of secondRoundBlobs) {
      writeBytes(root, blob.path, blob.bytes);
    }
    const secondRedRevision = commit(root, "round two red");
    const secondTestFiles = await testEvidence(
      root,
      secondRedRevision,
      secondRoundBlobs,
    );
    writeText(root, PRODUCTION_PATH, "export const version = 'round-two';\n");
    const finalCandidateRevision = commit(root, "round two candidate");

    const events = twoRoundEvents(
      baseRevision,
      firstRedRevision,
      firstCandidateRevision,
      secondRedRevision,
      finalCandidateRevision,
    );
    const ticketDirectory = pathIn(root, TICKET_PATH);
    writePacket(ticketDirectory, {
      ticket: ticket(baseRevision),
      state: acceptedState(baseRevision, finalCandidateRevision, events, 2),
      events: structuredClone(events),
      results: [
        result(
          1,
          baseRevision,
          firstRedRevision,
          firstCandidateRevision,
          firstTestFiles,
        ),
        result(
          2,
          firstCandidateRevision,
          secondRedRevision,
          finalCandidateRevision,
          secondTestFiles,
        ),
      ],
      reviews: [
        review(
          1,
          baseRevision,
          firstCandidateRevision,
          "CHANGES_REQUESTED",
        ),
        review(2, baseRevision, finalCandidateRevision, "APPROVED"),
      ],
    });
    commit(root, "ticket metadata");
    assertClean(root);
    return { root, ticketDirectory };
  } catch (error) {
    Deno.removeSync(root, { recursive: true });
    throw error;
  }
}

async function createTwoRoundFixture(
  finalChange: FinalTestChange,
): Promise<GitFixture> {
  const root = initializeRepository("round5-cross-round-");
  try {
    const baseRevision = commit(root, "base");
    writeBytes(root, ROUND_ONE_TEST_PATH, testBlob(256, "round one RED"));
    const firstRedRevision = commit(root, "round one red");
    const firstTestSha256 = await sha256(
      runGitBytes(root, [
        "show",
        `${firstRedRevision}:${ROUND_ONE_TEST_PATH}`,
      ]),
    );
    writeText(root, PRODUCTION_PATH, "export const version = 'round-one';\n");
    const firstCandidateRevision = commit(root, "round one candidate");

    writeBytes(root, ROUND_TWO_TEST_PATH, testBlob(256, "round two RED"));
    const secondRedRevision = commit(root, "round two red");
    const secondTestSha256 = await sha256(
      runGitBytes(root, [
        "show",
        `${secondRedRevision}:${ROUND_TWO_TEST_PATH}`,
      ]),
    );
    writeText(root, PRODUCTION_PATH, "export const version = 'round-two';\n");
    switch (finalChange) {
      case "unchanged":
        break;
      case "delete":
        Deno.removeSync(pathIn(root, ROUND_ONE_TEST_PATH));
        break;
      case "replace":
        writeText(
          root,
          ROUND_ONE_TEST_PATH,
          'Deno.test("replacement without the RED assertion", () => {});\n',
        );
        break;
      case "skip":
        writeText(
          root,
          ROUND_ONE_TEST_PATH,
          'Deno.test.ignore("disabled round one RED", () => {});\n',
        );
        break;
    }
    const finalCandidateRevision = commit(root, "round two candidate");
    const events = twoRoundEvents(
      baseRevision,
      firstRedRevision,
      firstCandidateRevision,
      secondRedRevision,
      finalCandidateRevision,
    );
    const ticketDirectory = pathIn(root, TICKET_PATH);
    writePacket(ticketDirectory, {
      ticket: ticket(baseRevision),
      state: acceptedState(baseRevision, finalCandidateRevision, events, 2),
      events: structuredClone(events),
      results: [
        result(1, baseRevision, firstRedRevision, firstCandidateRevision, [{
          path: ROUND_ONE_TEST_PATH,
          sha256: firstTestSha256,
        }]),
        result(
          2,
          firstCandidateRevision,
          secondRedRevision,
          finalCandidateRevision,
          [{ path: ROUND_TWO_TEST_PATH, sha256: secondTestSha256 }],
        ),
      ],
      reviews: [
        review(
          1,
          baseRevision,
          firstCandidateRevision,
          "CHANGES_REQUESTED",
        ),
        review(2, baseRevision, finalCandidateRevision, "APPROVED"),
      ],
    });
    commit(root, "ticket metadata");
    assertClean(root);
    return { root, ticketDirectory };
  } catch (error) {
    Deno.removeSync(root, { recursive: true });
    throw error;
  }
}

function createReadyFixture(): GitFixture {
  const root = initializeRepository("round5-ready-");
  try {
    const baseRevision = commit(root, "base");
    const events = [{
      sequence: 1,
      from: "planned",
      to: "ready",
      round: 0,
      actorRunId: "orchestrator-ready",
      evidenceRef: "ticket.json",
      revision: baseRevision,
    }];
    const ticketDirectory = pathIn(root, TICKET_PATH);
    writePacket(ticketDirectory, {
      ticket: ticket(baseRevision),
      state: {
        schemaVersion: 1,
        ticketId: TICKET_ID,
        ticketRevision: 1,
        phase: "ready",
        round: 0,
        baseRevision,
        candidateRevision: null,
        events,
        resultRefs: [],
        reviewRefs: [],
        dependencyRevisions: {},
        openFindingIds: [],
        orchestratorChecks: [],
        acceptedCandidateRevision: null,
        blocker: null,
      },
      events: structuredClone(events),
      results: [],
      reviews: [],
    });
    commit(root, "ticket metadata");
    assertClean(root);
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
    try {
      return {
        exitCode: await runTicketValidator([fixture.ticketDirectory]),
        output: lines.join("\n"),
      };
    } catch (error) {
      return {
        exitCode: -1,
        output: `validator threw: ${String(error)}`,
      };
    }
  } finally {
    console.log = originalLog;
    console.error = originalError;
    Deno.chdir(originalDirectory);
  }
}

function parseValidation(run: ValidatorRun): EmittedValidation | undefined {
  try {
    return JSON.parse(run.output) as EmittedValidation;
  } catch {
    return undefined;
  }
}

function successFailure(label: string, run: ValidatorRun): string[] {
  const emitted = parseValidation(run);
  return run.exitCode === 0 && emitted?.ok === true &&
      emitted.issues.length === 0
    ? []
    : [`${label} should pass, received exit ${run.exitCode}: ${run.output}`];
}

function exactIssueFailure(
  label: string,
  run: ValidatorRun,
  expected: ValidationIssue,
): string[] {
  const emitted = parseValidation(run);
  const actual = emitted?.issues[0];
  if (
    run.exitCode === 1 && emitted?.ok === false &&
    emitted.issues.length === 1 && actual?.path === expected.path &&
    actual.code === expected.code && actual.message === expected.message
  ) {
    return [];
  }
  return [
    `${label} should report only ${
      JSON.stringify(expected)
    }, received exit ${run.exitCode}: ${run.output}`,
  ];
}

function removeFixtures(fixtures: readonly GitFixture[]): void {
  for (const fixture of fixtures) {
    Deno.removeSync(fixture.root, { recursive: true });
  }
}

Deno.test("PILOT-001-R4-001 binds every earlier RED blob to the final candidate", async () => {
  const variants = ["unchanged", "delete", "replace", "skip"] as const;
  const fixtures = await Promise.all(
    variants.map((variant) => createTwoRoundFixture(variant)),
  );
  try {
    const runs: Record<FinalTestChange, ValidatorRun> = {
      unchanged: await captureValidatorRun(fixtures[0]!),
      delete: await captureValidatorRun(fixtures[1]!),
      replace: await captureValidatorRun(fixtures[2]!),
      skip: await captureValidatorRun(fixtures[3]!),
    };
    const path = "$.results[0].red.testFiles[0]";
    const failures = [
      ...successFailure("unchanged earlier RED", runs.unchanged),
      ...exactIssueFailure(
        "deleted earlier RED",
        runs.delete,
        {
          path: `${path}.path`,
          code: "content_missing",
          message:
            "Declared RED test blob does not exist in the final candidate",
        },
      ),
      ...exactIssueFailure(
        "replaced earlier RED",
        runs.replace,
        {
          path: `${path}.sha256`,
          code: "content_hash_mismatch",
          message:
            "Declared RED test digest does not match the final candidate Git blob",
        },
      ),
      ...exactIssueFailure(
        "ignored earlier RED",
        runs.skip,
        {
          path: `${path}.sha256`,
          code: "content_hash_mismatch",
          message:
            "Declared RED test digest does not match the final candidate Git blob",
        },
      ),
    ];
    if (failures.length > 0) throw new Error(failures.join("\n"));
  } finally {
    removeFixtures(fixtures);
  }
});

Deno.test("PILOT-001-R4-002 bounds aggregate Git references and blob bytes", async () => {
  const referenceBlobs = Array.from(
    { length: MAX_TEST_REFERENCES + 1 },
    (_, index) => ({
      path: `tools/workflows/r${String(index).padStart(3, "0")}_test.ts`,
      bytes: testBlob(128, `reference ${index}`),
    }),
  );
  const exactByteBlobs = [1_000_000, 1_000_000, 500_000].map(
    (byteLength, index) => ({
      path: `tools/workflows/bytes_${index}_test.ts`,
      bytes: testBlob(byteLength, `byte budget ${index}`),
    }),
  );
  const overByteBlobs = exactByteBlobs.map((blob, index) => ({
    path: blob.path,
    bytes: index === exactByteBlobs.length - 1
      ? testBlob(blob.bytes.byteLength + 1, `byte budget ${index}`)
      : blob.bytes,
  }));
  if (
    exactByteBlobs.reduce((total, blob) => total + blob.bytes.byteLength, 0) *
        2 !== MAX_GIT_EVIDENCE_BYTES
  ) {
    throw new Error("The exact aggregate-byte fixture is malformed");
  }
  const fixtures = [
    await createTwoRoundAggregateFixture(
      referenceBlobs.slice(0, 50),
      referenceBlobs.slice(50, MAX_TEST_REFERENCES),
    ),
    await createTwoRoundAggregateFixture(
      referenceBlobs.slice(0, 50),
      referenceBlobs.slice(50),
    ),
    await createAcceptedFixture(exactByteBlobs),
    await createAcceptedFixture(overByteBlobs),
  ];
  try {
    const runs = [];
    for (const fixture of fixtures) {
      runs.push(await captureValidatorRun(fixture));
    }
    const failures = [
      ...successFailure("exact aggregate reference boundary", runs[0]!),
      ...exactIssueFailure(
        "over aggregate reference boundary",
        runs[1]!,
        {
          path: "$.results",
          code: "reference_limit",
          message: "Git test evidence exceeds the aggregate reference limit",
        },
      ),
      ...successFailure("exact combined blob-byte boundary", runs[2]!),
      ...exactIssueFailure(
        "over combined blob-byte boundary",
        runs[3]!,
        {
          path: "$.results[0].red.testFiles[2].path",
          code: "aggregate_too_large",
          message: "Git test evidence exceeds the aggregate blob-byte limit",
        },
      ),
    ];
    if (failures.length > 0) throw new Error(failures.join("\n"));
  } finally {
    removeFixtures(fixtures);
  }
});

Deno.test("PILOT-001-AC-03 validates a committed ready packet without a candidate", async () => {
  const fixtures = [
    createReadyFixture(),
    await createAcceptedFixture([{
      path: "tools/workflows/candidate_control_test.ts",
      bytes: testBlob(256, "candidate control"),
    }]),
  ];
  try {
    const readyRun = await captureValidatorRun(fixtures[0]!);
    const candidateRun = await captureValidatorRun(fixtures[1]!);
    const failures = [
      ...successFailure("clean committed ready packet", readyRun),
      ...successFailure("candidate-phase control", candidateRun),
    ];
    if (failures.length > 0) throw new Error(failures.join("\n"));
  } finally {
    removeFixtures(fixtures);
  }
});
