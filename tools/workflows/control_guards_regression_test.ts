import {
  validateTicketBundle,
  type ValidationIssue,
} from "./ticket_contract.ts";
import { runTicketValidator } from "./validate_ticket.ts";

const TICKET_ID = "AUTONOMY-001";
const TICKET_PATH = `docs/planning/tickets/${TICKET_ID}`;
const BASE_REVISION = "1111111111111111111111111111111111111111";
const RED_ONE_REVISION = "2222222222222222222222222222222222222222";
const CANDIDATE_ONE_REVISION = "3333333333333333333333333333333333333333";
const RED_TWO_REVISION = "4444444444444444444444444444444444444444";
const CANDIDATE_TWO_REVISION = "5555555555555555555555555555555555555555";
const TEST_SHA256 = "a".repeat(64);
const CONTROLLER_RUN_ID =
  `${TICKET_ID}/orchestrator/r0/00000000-0000-4000-8000-000000000001`;
const IMPLEMENTER_ONE_RUN_ID =
  `${TICKET_ID}/implementer/r1/00000000-0000-4000-8000-000000000002`;
const REVIEWER_ONE_RUN_ID =
  `${TICKET_ID}/reviewer/r1/00000000-0000-4000-8000-000000000003`;
const IMPLEMENTER_TWO_RUN_ID =
  `${TICKET_ID}/implementer/r2/00000000-0000-4000-8000-000000000004`;
const REVIEWER_TWO_RUN_ID =
  `${TICKET_ID}/reviewer/r2/00000000-0000-4000-8000-000000000005`;
const BASE_CHECK_DEFINITION = "deno check tools/workflows/production.ts";
const CHANGED_CHECK_DEFINITION =
  "deno check tools/workflows/production.ts tools/workflows/task_guard_test.ts";
const WORKFLOW_TEST_DEFINITION = "deno test tools/workflows";
const CHANGED_WORKFLOW_TEST_DEFINITION =
  "deno test --fail-fast tools/workflows";
const NOOP_CHECK_DEFINITION = "deno eval true";
const AVAILABLE_TASKS = new Set([
  "fmt:check",
  "lint",
  "check",
  "test:workflow",
  "test:workflow:coverage",
  "ticket:validate",
  "test:schema:matrix",
]);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

type JsonRecord = Record<string, unknown>;

interface TaskFixtureOptions {
  readonly candidateCheckDefinition?: string;
  readonly candidateWorkflowDefinition?: string;
  readonly recordedBaseCheckDefinition?: string;
  readonly recordedCandidateCheckDefinition?: string;
  readonly recordedCandidateWorkflowDefinition?: string;
  readonly guardedBy?: string | null;
  readonly workflowGuardedBy?: string | null;
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
  readonly issues: readonly ValidationIssue[];
}

function asRecord(value: unknown): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected an object in the regression fixture");
  }
  return value as JsonRecord;
}

function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error("Expected an array in the regression fixture");
  }
  return value;
}

function assertNoIssues(issues: readonly ValidationIssue[]): void {
  if (issues.length !== 0) {
    throw new Error(
      `Expected no validation issues, received ${JSON.stringify(issues)}`,
    );
  }
}

function assertIssue(
  issues: readonly ValidationIssue[],
  path: string,
  code: string,
): void {
  if (!issues.some((issue) => issue.path === path && issue.code === code)) {
    throw new Error(
      `Expected ${path} ${code}, received ${JSON.stringify(issues)}`,
    );
  }
}

function taskDefinitions(
  checkDefinition = BASE_CHECK_DEFINITION,
  guardedBy: string | null = null,
): JsonRecord {
  return {
    baseline: [
      { name: "check", definition: BASE_CHECK_DEFINITION },
      { name: "test:workflow", definition: WORKFLOW_TEST_DEFINITION },
    ],
    candidate: [
      { name: "check", definition: checkDefinition, guardedBy },
      {
        name: "test:workflow",
        definition: WORKFLOW_TEST_DEFINITION,
        guardedBy: null,
      },
    ],
  };
}

function lenses(failed = false): JsonRecord {
  return {
    bug_correctness: {
      verdict: failed ? "fail" : "pass",
      evidence: ["The exact candidate behavior was inspected."],
    },
    security_privacy: {
      verdict: "pass",
      evidence: ["Protected control paths were inspected."],
    },
    architecture_contracts: {
      verdict: "pass",
      evidence: ["The autonomous-delivery contract was inspected."],
    },
    performance_reliability: {
      verdict: "pass",
      evidence: ["The bounded validator behavior was inspected."],
    },
    style_maintainability: {
      verdict: "pass",
      evidence: ["The implementation was inspected."],
    },
    tests_tdd: {
      verdict: "pass",
      evidence: ["The frozen RED evidence was inspected."],
    },
  };
}

function result(
  round: number,
  implementerRunId: string,
  inputBaseRevision: string,
  redRevision: string,
  candidateRevision: string,
): JsonRecord {
  const roundName = String(round).padStart(2, "0");
  return {
    schemaVersion: 2,
    ticketId: TICKET_ID,
    ticketRevision: 1,
    round,
    implementerRunId,
    issuedByControllerRunId: CONTROLLER_RUN_ID,
    inputBaseRevision,
    dispatchRef: `dispatch/round-${roundName}.md`,
    redRevision,
    red: {
      command:
        "deno test --allow-read --allow-write --allow-run=git tools/workflows/control_guards_regression_test.ts",
      exitCode: 1,
      expectedFailure: "The missing control guard is exposed.",
      output: "The expected control-guard diagnostic was absent.",
      logRef: `evidence/round-${roundName}-red.log`,
      testFiles: [{
        path: "tools/workflows/task_guard_test.ts",
        sha256: TEST_SHA256,
      }],
      productionFiles: [],
    },
    green: {
      command:
        "deno test --allow-read --allow-write --allow-run=git tools/workflows/control_guards_regression_test.ts",
      exitCode: 0,
      logRef: `evidence/round-${roundName}-green.log`,
      productionFiles: ["tools/workflows/production.ts"],
    },
    refactor: {
      summary: "Kept the control guard deterministic and bounded.",
      command: "deno task test:workflow:coverage",
      exitCode: 0,
      logRef: `evidence/round-${roundName}-refactor.log`,
    },
    candidateRevision,
  };
}

function review(
  round: number,
  implementerRunId: string,
  reviewerRunId: string,
  candidateRevision: string,
  verdict: "APPROVED" | "CHANGES_REQUESTED",
): JsonRecord {
  return {
    schemaVersion: 2,
    ticketId: TICKET_ID,
    ticketRevision: 1,
    round,
    implementerRunId,
    reviewerRunId,
    issuedByControllerRunId: CONTROLLER_RUN_ID,
    baseRevision: BASE_REVISION,
    candidateRevision,
    verdict,
    commands: [{ command: "deno task test:workflow", exitCode: 0 }],
    lenses: lenses(verdict === "CHANGES_REQUESTED"),
    findings: verdict === "CHANGES_REQUESTED"
      ? [{
        id: "AUTONOMY-001-R1-001",
        lens: "bug_correctness",
        severity: "P1",
        location: "tools/workflows/ticket_contract.ts:control guards",
        expectedBehavior: "The controller guard is enforced.",
        observedBehavior: "The first candidate omitted the guard.",
        reproduction: "Run the focused regression.",
        impact: "An untrusted context could self-certify a ticket.",
        affectedCriterion: "AC-01",
        contractRef: "AGENTS.md#mandatory-change-method",
        requiredRemediation: "Implement the missing controller guard.",
        verification: "Run the next frozen RED round.",
        status: "resolved",
      }]
      : [],
    notes: [],
  };
}

function oneRoundEvents(): JsonRecord[] {
  return [
    {
      sequence: 1,
      from: "planned",
      to: "ready",
      round: 0,
      actorRunId: CONTROLLER_RUN_ID,
      evidenceRef: "ticket.json",
      revision: BASE_REVISION,
    },
    {
      sequence: 2,
      from: "ready",
      to: "red",
      round: 1,
      actorRunId: IMPLEMENTER_ONE_RUN_ID,
      evidenceRef: "evidence/round-01-red.log",
      revision: RED_ONE_REVISION,
    },
    {
      sequence: 3,
      from: "red",
      to: "green",
      round: 1,
      actorRunId: IMPLEMENTER_ONE_RUN_ID,
      evidenceRef: "evidence/round-01-green.log",
      revision: CANDIDATE_ONE_REVISION,
    },
    {
      sequence: 4,
      from: "green",
      to: "refactor",
      round: 1,
      actorRunId: IMPLEMENTER_ONE_RUN_ID,
      evidenceRef: "evidence/round-01-refactor.log",
      revision: CANDIDATE_ONE_REVISION,
    },
    {
      sequence: 5,
      from: "refactor",
      to: "review",
      round: 1,
      actorRunId: CONTROLLER_RUN_ID,
      evidenceRef: "results/round-01.json",
      revision: CANDIDATE_ONE_REVISION,
    },
    {
      sequence: 6,
      from: "review",
      to: "accepted",
      round: 1,
      actorRunId: CONTROLLER_RUN_ID,
      evidenceRef: "acceptance.md",
      revision: CANDIDATE_ONE_REVISION,
    },
  ];
}

function acceptedV2Bundle(rounds: 1 | 2 = 1): JsonRecord {
  const firstResult = result(
    1,
    IMPLEMENTER_ONE_RUN_ID,
    BASE_REVISION,
    RED_ONE_REVISION,
    CANDIDATE_ONE_REVISION,
  );
  const firstReview = review(
    1,
    IMPLEMENTER_ONE_RUN_ID,
    REVIEWER_ONE_RUN_ID,
    CANDIDATE_ONE_REVISION,
    rounds === 1 ? "APPROVED" : "CHANGES_REQUESTED",
  );
  const events = rounds === 1 ? oneRoundEvents() : [
    ...oneRoundEvents().slice(0, 5),
    {
      sequence: 6,
      from: "review",
      to: "rework",
      round: 1,
      actorRunId: REVIEWER_ONE_RUN_ID,
      evidenceRef: "reviews/round-01.json",
      revision: CANDIDATE_ONE_REVISION,
    },
    {
      sequence: 7,
      from: "rework",
      to: "red",
      round: 2,
      actorRunId: IMPLEMENTER_TWO_RUN_ID,
      evidenceRef: "evidence/round-02-red.log",
      revision: RED_TWO_REVISION,
    },
    {
      sequence: 8,
      from: "red",
      to: "green",
      round: 2,
      actorRunId: IMPLEMENTER_TWO_RUN_ID,
      evidenceRef: "evidence/round-02-green.log",
      revision: CANDIDATE_TWO_REVISION,
    },
    {
      sequence: 9,
      from: "green",
      to: "refactor",
      round: 2,
      actorRunId: IMPLEMENTER_TWO_RUN_ID,
      evidenceRef: "evidence/round-02-refactor.log",
      revision: CANDIDATE_TWO_REVISION,
    },
    {
      sequence: 10,
      from: "refactor",
      to: "review",
      round: 2,
      actorRunId: CONTROLLER_RUN_ID,
      evidenceRef: "results/round-02.json",
      revision: CANDIDATE_TWO_REVISION,
    },
    {
      sequence: 11,
      from: "review",
      to: "accepted",
      round: 2,
      actorRunId: CONTROLLER_RUN_ID,
      evidenceRef: "acceptance.md",
      revision: CANDIDATE_TWO_REVISION,
    },
  ];
  const results = rounds === 1 ? [firstResult] : [
    firstResult,
    result(
      2,
      IMPLEMENTER_TWO_RUN_ID,
      CANDIDATE_ONE_REVISION,
      RED_TWO_REVISION,
      CANDIDATE_TWO_REVISION,
    ),
  ];
  const reviews = rounds === 1 ? [firstReview] : [
    firstReview,
    review(
      2,
      IMPLEMENTER_TWO_RUN_ID,
      REVIEWER_TWO_RUN_ID,
      CANDIDATE_TWO_REVISION,
      "APPROVED",
    ),
  ];
  const candidateRevision = rounds === 1
    ? CANDIDATE_ONE_REVISION
    : CANDIDATE_TWO_REVISION;
  return {
    ticket: {
      schemaVersion: 2,
      ticketId: TICKET_ID,
      revision: 1,
      title: "Enforce autonomous controller guards",
      outcome: "Only controller-authorized work can be accepted.",
      baseRevision: BASE_REVISION,
      controllerRunId: CONTROLLER_RUN_ID,
      executionClass: "ordinary",
      protectedWriteAuthorization: null,
      dependencies: [],
      maxRounds: 3,
      scope: ["Autonomous workflow validation"],
      nonGoals: ["Application behavior"],
      allowedWrites: ["tools/workflows/"],
      contractRefs: ["AGENTS.md#mandatory-change-method"],
      acceptanceCriteria: [{
        id: "AC-01",
        text: "Enforce exact controller-issued workflow authority.",
        redProof: "Focused structural and Git fixtures expose missing guards.",
      }],
      requiredTasks: taskDefinitions(),
      risks: ["A mutable control plane could self-certify untrusted work"],
      unresolvedDecisions: [],
    },
    state: {
      schemaVersion: 1,
      ticketId: TICKET_ID,
      ticketRevision: 1,
      phase: "accepted",
      round: rounds,
      baseRevision: BASE_REVISION,
      candidateRevision,
      events,
      resultRefs: results.map((_value, index) =>
        `results/round-${String(index + 1).padStart(2, "0")}.json`
      ),
      reviewRefs: reviews.map((_value, index) =>
        `reviews/round-${String(index + 1).padStart(2, "0")}.json`
      ),
      dependencyRevisions: {},
      openFindingIds: [],
      orchestratorChecks: ["check", "test:workflow"].map((task, index) => ({
        runId: `${CONTROLLER_RUN_ID}/check-${index + 1}`,
        revision: candidateRevision,
        command: `deno task ${task}`,
        exitCode: 0,
      })),
      acceptedCandidateRevision: candidateRevision,
      blocker: null,
    },
    events: structuredClone(events),
    results,
    reviews,
  };
}

function readLegacyBundle(ticketId: "PILOT-001" | "PILOT-002"): JsonRecord {
  const root = `docs/planning/tickets/${ticketId}`;
  const ticket = JSON.parse(Deno.readTextFileSync(`${root}/ticket.json`));
  const state = JSON.parse(Deno.readTextFileSync(`${root}/state.json`));
  const events = Deno.readTextFileSync(`${root}/events.jsonl`).trim().split(
    /\r?\n/,
  ).map((line) => JSON.parse(line));
  const resultRefs = asArray(asRecord(state).resultRefs);
  const reviewRefs = asArray(asRecord(state).reviewRefs);
  return {
    ticket,
    state,
    events,
    results: resultRefs.map((reference) =>
      JSON.parse(Deno.readTextFileSync(`${root}/${String(reference)}`))
    ),
    reviews: reviewRefs.map((reference) =>
      JSON.parse(Deno.readTextFileSync(`${root}/${String(reference)}`))
    ),
  };
}

function replaceTicketId(bundle: JsonRecord, ticketId: string): void {
  asRecord(bundle.ticket).ticketId = ticketId;
  asRecord(bundle.state).ticketId = ticketId;
  for (const resultRecord of asArray(bundle.results)) {
    asRecord(resultRecord).ticketId = ticketId;
  }
  for (const reviewRecord of asArray(bundle.reviews)) {
    asRecord(reviewRecord).ticketId = ticketId;
  }
}

function authorizeProtectedWrites(
  bundle: JsonRecord,
  paths: readonly string[],
  authorizedByControllerRunId = CONTROLLER_RUN_ID,
): void {
  const ticket = asRecord(bundle.ticket);
  ticket.executionClass = "protected-config-maintenance";
  ticket.allowedWrites = [...paths];
  ticket.protectedWriteAuthorization = {
    authorizedByControllerRunId,
    paths: [...paths],
    contractRef: "AGENTS.md#mandatory-change-method",
    rationale: "Update only the exact controller-authorized control assets.",
  };
}

function setEventActor(
  bundle: JsonRecord,
  eventIndex: number,
  actorRunId: string,
): void {
  const stateEvents = asArray(asRecord(bundle.state).events);
  const ledgerEvents = asArray(bundle.events);
  asRecord(stateEvents[eventIndex]).actorRunId = actorRunId;
  asRecord(ledgerEvents[eventIndex]).actorRunId = actorRunId;
}

function pathIn(root: string, relativePath: string): string {
  return `${root}/${relativePath}`;
}

function parentPath(path: string): string {
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return separator < 0 ? "." : path.slice(0, separator);
}

function writeText(root: string, relativePath: string, value: string): void {
  const destination = pathIn(root, relativePath);
  Deno.mkdirSync(parentPath(destination), { recursive: true });
  Deno.writeFileSync(destination, encoder.encode(value));
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
        decoder.decode(result.stderr).trim()
      }`,
    );
  }
  return decoder.decode(result.stdout).trim();
}

function commit(root: string, message: string): string {
  runGit(root, ["add", "--all"]);
  runGit(root, ["commit", "--quiet", "-m", message]);
  return runGit(root, ["rev-parse", "HEAD"]);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function writeBundle(root: string, bundle: JsonRecord): void {
  const state = asRecord(bundle.state);
  const events = asArray(bundle.events);
  const results = asArray(bundle.results);
  const reviews = asArray(bundle.reviews);
  writeText(
    root,
    `${TICKET_PATH}/ticket.json`,
    `${JSON.stringify(bundle.ticket, null, 2)}\n`,
  );
  writeText(
    root,
    `${TICKET_PATH}/state.json`,
    `${JSON.stringify(state, null, 2)}\n`,
  );
  writeText(
    root,
    `${TICKET_PATH}/events.jsonl`,
    `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
  );
  results.forEach((value, index) => {
    const round = String(index + 1).padStart(2, "0");
    writeText(
      root,
      `${TICKET_PATH}/results/round-${round}.json`,
      `${JSON.stringify(value, null, 2)}\n`,
    );
    writeText(
      root,
      `${TICKET_PATH}/dispatch/round-${round}.md`,
      `# Round ${index + 1} dispatch\n`,
    );
    for (const phase of ["red", "green", "refactor"]) {
      writeText(
        root,
        `${TICKET_PATH}/evidence/round-${round}-${phase}.log`,
        `round ${index + 1} ${phase} evidence\n`,
      );
    }
  });
  reviews.forEach((value, index) => {
    const round = String(index + 1).padStart(2, "0");
    writeText(
      root,
      `${TICKET_PATH}/reviews/round-${round}.json`,
      `${JSON.stringify(value, null, 2)}\n`,
    );
  });
  writeText(root, `${TICKET_PATH}/acceptance.md`, "Accepted candidate.\n");
}

async function createTaskFixture(
  options: TaskFixtureOptions = {},
): Promise<GitFixture> {
  const root = Deno.makeTempDirSync({ prefix: "control-task-guard-" });
  try {
    runGit(root, ["init", "--quiet"]);
    runGit(root, ["config", "user.email", "workflow@example.invalid"]);
    runGit(root, ["config", "user.name", "Workflow Fixture"]);
    const baseTasks = {
      check: BASE_CHECK_DEFINITION,
      "test:workflow": WORKFLOW_TEST_DEFINITION,
    };
    writeText(
      root,
      "deno.json",
      `${JSON.stringify({ tasks: baseTasks }, null, 2)}\n`,
    );
    writeText(
      root,
      "tools/workflows/production.ts",
      "export const value = 1;\n",
    );
    const baseRevision = commit(root, "base");

    const testSource = "Deno.test('frozen RED proof', () => {});\n";
    writeText(root, "tools/workflows/task_guard_test.ts", testSource);
    const redRevision = commit(root, "red");

    const candidateCheckDefinition = options.candidateCheckDefinition ??
      BASE_CHECK_DEFINITION;
    const candidateWorkflowDefinition = options.candidateWorkflowDefinition ??
      WORKFLOW_TEST_DEFINITION;
    writeText(
      root,
      "deno.json",
      `${
        JSON.stringify(
          {
            tasks: {
              check: candidateCheckDefinition,
              "test:workflow": candidateWorkflowDefinition,
            },
          },
          null,
          2,
        )
      }\n`,
    );
    writeText(
      root,
      "tools/workflows/production.ts",
      "export const value = 2;\n",
    );
    const candidateRevision = commit(root, "candidate");

    const bundle = acceptedV2Bundle();
    const ticket = asRecord(bundle.ticket);
    ticket.baseRevision = baseRevision;
    ticket.allowedWrites = ["deno.json", "tools/workflows/"];
    ticket.requiredTasks = {
      baseline: [
        {
          name: "check",
          definition: options.recordedBaseCheckDefinition ??
            BASE_CHECK_DEFINITION,
        },
        { name: "test:workflow", definition: WORKFLOW_TEST_DEFINITION },
      ],
      candidate: [
        {
          name: "check",
          definition: options.recordedCandidateCheckDefinition ??
            candidateCheckDefinition,
          guardedBy: options.guardedBy ?? null,
        },
        {
          name: "test:workflow",
          definition: options.recordedCandidateWorkflowDefinition ??
            candidateWorkflowDefinition,
          guardedBy: options.workflowGuardedBy ?? null,
        },
      ],
    };
    const state = asRecord(bundle.state);
    state.baseRevision = baseRevision;
    state.candidateRevision = candidateRevision;
    state.acceptedCandidateRevision = candidateRevision;
    const events = asArray(state.events);
    asRecord(events[0]).revision = baseRevision;
    asRecord(events[1]).revision = redRevision;
    for (const event of events.slice(2)) {
      asRecord(event).revision = candidateRevision;
    }
    bundle.events = structuredClone(events);
    const implementation = asRecord(asArray(bundle.results)[0]);
    implementation.inputBaseRevision = baseRevision;
    implementation.redRevision = redRevision;
    implementation.candidateRevision = candidateRevision;
    asRecord(asArray(asRecord(implementation.red).testFiles)[0]).sha256 =
      await sha256(testSource);
    asRecord(implementation.green).productionFiles = [
      ...(candidateCheckDefinition !== BASE_CHECK_DEFINITION ||
          candidateWorkflowDefinition !== WORKFLOW_TEST_DEFINITION
        ? ["deno.json"]
        : []),
      "tools/workflows/production.ts",
    ];
    const candidateReview = asRecord(asArray(bundle.reviews)[0]);
    candidateReview.baseRevision = baseRevision;
    candidateReview.candidateRevision = candidateRevision;
    for (const check of asArray(state.orchestratorChecks)) {
      asRecord(check).revision = candidateRevision;
    }
    writeBundle(root, bundle);
    commit(root, "ticket metadata");
    return { root, ticketDirectory: pathIn(root, TICKET_PATH) };
  } catch (error) {
    Deno.removeSync(root, { recursive: true });
    throw error;
  }
}

async function captureValidatorRun(fixture: GitFixture): Promise<ValidatorRun> {
  const originalDirectory = Deno.cwd();
  const originalLog = console.log;
  const originalError = console.error;
  const output: string[] = [];
  const capture = (...values: unknown[]): void => {
    output.push(values.map(String).join(" "));
  };
  Deno.chdir(fixture.root);
  console.log = capture;
  console.error = capture;
  try {
    return {
      exitCode: await runTicketValidator([fixture.ticketDirectory]),
      output: output.join("\n"),
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

function assertValidatorSuccess(run: ValidatorRun): void {
  const emitted = parseValidation(run);
  if (run.exitCode !== 0 || !emitted.ok || emitted.issues.length !== 0) {
    throw new Error(
      `Expected validator success, received exit ${run.exitCode}: ${run.output}`,
    );
  }
}

function assertValidatorIssue(
  run: ValidatorRun,
  path: string,
  code: string,
): void {
  const emitted = parseValidation(run);
  if (
    run.exitCode !== 1 || emitted.ok ||
    !emitted.issues.some((issue) => issue.path === path && issue.code === code)
  ) {
    throw new Error(
      `Expected validator issue ${path} ${code}, received ${run.output}`,
    );
  }
}

Deno.test("control guards preserve only the two legacy PILOT v1 packets", () => {
  for (const ticketId of ["PILOT-001", "PILOT-002"] as const) {
    assertNoIssues(
      validateTicketBundle(readLegacyBundle(ticketId), AVAILABLE_TASKS),
    );
  }
});

Deno.test("control guards reject v1 packets outside the legacy allowlist", () => {
  const bundle = readLegacyBundle("PILOT-002");
  replaceTicketId(bundle, "AUTONOMY-LEGACY");
  assertIssue(
    validateTicketBundle(bundle, AVAILABLE_TASKS),
    "$.ticket.schemaVersion",
    "legacy_schema_forbidden",
  );
});

Deno.test("control guards reject same-ID mutations of legacy v1 packets", () => {
  for (const ticketId of ["PILOT-001", "PILOT-002"] as const) {
    const bundle = readLegacyBundle(ticketId);
    asRecord(bundle.ticket).outcome =
      "Mutated legacy content must not inherit historical authority.";
    assertIssue(
      validateTicketBundle(bundle, AVAILABLE_TASKS),
      "$.ticket.schemaVersion",
      "legacy_packet_mismatch",
    );
  }
});

Deno.test("control guards accept an ordinary v2 controller packet", () => {
  assertNoIssues(validateTicketBundle(acceptedV2Bundle(), AVAILABLE_TASKS));
});

Deno.test("ordinary v2 tickets reject protected roots and descendants", () => {
  for (
    const protectedPath of [
      ".codex",
      ".codex/agents/reviewer.toml",
      ".agents",
      ".agents/skills/run-tdd-ticket-loop/SKILL.md",
    ]
  ) {
    const bundle = acceptedV2Bundle();
    asRecord(bundle.ticket).allowedWrites = [protectedPath];
    assertIssue(
      validateTicketBundle(bundle, AVAILABLE_TASKS),
      "$.ticket.allowedWrites[0]",
      "protected_path_forbidden",
    );
  }
});

Deno.test("protected-config v2 tickets accept exact controller authority", () => {
  const bundle = acceptedV2Bundle();
  authorizeProtectedWrites(bundle, [
    ".codex/agents/reviewer.toml",
    ".agents/skills/run-tdd-ticket-loop/SKILL.md",
  ]);
  assertNoIssues(validateTicketBundle(bundle, AVAILABLE_TASKS));
});

Deno.test("protected maintenance requires controller authorization", () => {
  const missingAuthorization = acceptedV2Bundle();
  const missingTicket = asRecord(missingAuthorization.ticket);
  missingTicket.executionClass = "protected-config-maintenance";
  missingTicket.allowedWrites = [".codex/agents/reviewer.toml"];
  assertIssue(
    validateTicketBundle(missingAuthorization, AVAILABLE_TASKS),
    "$.ticket.protectedWriteAuthorization",
    "authorization_required",
  );

  const wrongController = acceptedV2Bundle();
  authorizeProtectedWrites(
    wrongController,
    [".codex/agents/reviewer.toml"],
    `${TICKET_ID}/orchestrator/r0/00000000-0000-4000-8000-000000000099`,
  );
  assertIssue(
    validateTicketBundle(wrongController, AVAILABLE_TASKS),
    "$.ticket.protectedWriteAuthorization.authorizedByControllerRunId",
    "controller_mismatch",
  );
});

Deno.test("protected-config authorization paths exactly match allowed writes", () => {
  const bundle = acceptedV2Bundle();
  authorizeProtectedWrites(bundle, [".codex/agents/reviewer.toml"]);
  asRecord(asRecord(bundle.ticket).protectedWriteAuthorization).paths = [
    ".codex/agents/feature-implementer.toml",
  ];
  assertIssue(
    validateTicketBundle(bundle, AVAILABLE_TASKS),
    "$.ticket.protectedWriteAuthorization.paths",
    "authorization_mismatch",
  );
});

Deno.test(".git is forbidden at root, below root, nested, and by case", () => {
  for (
    const gitPath of [
      ".git",
      ".git/hooks/pre-commit",
      "nested/.git/config",
      ".GiT/config",
    ]
  ) {
    const bundle = acceptedV2Bundle();
    authorizeProtectedWrites(bundle, [gitPath]);
    assertIssue(
      validateTicketBundle(bundle, AVAILABLE_TASKS),
      "$.ticket.allowedWrites[0]",
      "git_path_forbidden",
    );
  }
});

Deno.test("v2 controller IDs are ticket, role, round, and UUID bound", () => {
  for (
    const invalidControllerRunId of [
      `OTHER-TICKET/orchestrator/r0/00000000-0000-4000-8000-000000000001`,
      `${TICKET_ID}/implementer/r0/00000000-0000-4000-8000-000000000001`,
      `${TICKET_ID}/orchestrator/r1/00000000-0000-4000-8000-000000000001`,
      `${TICKET_ID}/orchestrator/r0/not-a-uuid`,
    ]
  ) {
    const bundle = acceptedV2Bundle();
    asRecord(bundle.ticket).controllerRunId = invalidControllerRunId;
    assertIssue(
      validateTicketBundle(bundle, AVAILABLE_TASKS),
      "$.ticket.controllerRunId",
      "run_id_invalid",
    );
  }
});

Deno.test("v2 role IDs enforce namespace, role, round, and UUID", () => {
  for (
    const invalidImplementerRunId of [
      `OTHER-TICKET/implementer/r1/00000000-0000-4000-8000-000000000002`,
      `${TICKET_ID}/reviewer/r1/00000000-0000-4000-8000-000000000002`,
      `${TICKET_ID}/implementer/r2/00000000-0000-4000-8000-000000000002`,
      `${TICKET_ID}/implementer/r1/not-a-uuid`,
    ]
  ) {
    const bundle = acceptedV2Bundle();
    asRecord(asArray(bundle.results)[0]).implementerRunId =
      invalidImplementerRunId;
    assertIssue(
      validateTicketBundle(bundle, AVAILABLE_TASKS),
      "$.results[0].implementerRunId",
      "run_id_invalid",
    );
  }

  for (
    const invalidReviewerRunId of [
      `${TICKET_ID}/implementer/r1/00000000-0000-4000-8000-000000000003`,
      `${TICKET_ID}/reviewer/r2/00000000-0000-4000-8000-000000000003`,
      `${TICKET_ID}/reviewer/r1/not-a-uuid`,
    ]
  ) {
    const bundle = acceptedV2Bundle();
    asRecord(asArray(bundle.reviews)[0]).reviewerRunId = invalidReviewerRunId;
    assertIssue(
      validateTicketBundle(bundle, AVAILABLE_TASKS),
      "$.reviews[0].reviewerRunId",
      "run_id_invalid",
    );
  }
});

Deno.test("implementation and review records require controller issuance", () => {
  const wrongControllerRunId =
    `${TICKET_ID}/orchestrator/r0/00000000-0000-4000-8000-000000000099`;
  for (
    const [collection, path] of [
      ["results", "$.results[0].issuedByControllerRunId"],
      ["reviews", "$.reviews[0].issuedByControllerRunId"],
    ] as const
  ) {
    const bundle = acceptedV2Bundle();
    asRecord(asArray(bundle[collection])[0]).issuedByControllerRunId =
      wrongControllerRunId;
    assertIssue(
      validateTicketBundle(bundle, AVAILABLE_TASKS),
      path,
      "controller_mismatch",
    );
  }
});

Deno.test("implementer and reviewer identities are fresh across rounds", () => {
  const reusedImplementer = acceptedV2Bundle(2);
  asRecord(asArray(reusedImplementer.results)[1]).implementerRunId =
    IMPLEMENTER_ONE_RUN_ID;
  assertIssue(
    validateTicketBundle(reusedImplementer, AVAILABLE_TASKS),
    "$.results[1].implementerRunId",
    "run_id_not_fresh",
  );

  const reusedReviewer = acceptedV2Bundle(2);
  asRecord(asArray(reusedReviewer.reviews)[1]).reviewerRunId =
    REVIEWER_ONE_RUN_ID;
  assertIssue(
    validateTicketBundle(reusedReviewer, AVAILABLE_TASKS),
    "$.reviews[1].reviewerRunId",
    "run_id_not_fresh",
  );
});

Deno.test("controller-owned lifecycle events reject other role identities", () => {
  for (const eventIndex of [0, 4, 5]) {
    const bundle = acceptedV2Bundle();
    setEventActor(bundle, eventIndex, IMPLEMENTER_ONE_RUN_ID);
    assertIssue(
      validateTicketBundle(bundle, AVAILABLE_TASKS),
      `$.state.events[${eventIndex}].actorRunId`,
      "controller_mismatch",
    );
  }
});

Deno.test("orchestrator checks reject non-controller identities", () => {
  const bundle = acceptedV2Bundle();
  asRecord(asArray(asRecord(bundle.state).orchestratorChecks)[0]).runId =
    `${IMPLEMENTER_ONE_RUN_ID}/check-1`;
  assertIssue(
    validateTicketBundle(bundle, AVAILABLE_TASKS),
    "$.state.orchestratorChecks[0].runId",
    "controller_mismatch",
  );
});

Deno.test("Git task guards accept unchanged base/candidate definitions", async () => {
  const fixture = await createTaskFixture();
  try {
    assertValidatorSuccess(await captureValidatorRun(fixture));
  } finally {
    Deno.removeSync(fixture.root, { recursive: true });
  }
});

Deno.test("Git task guards bind recorded definitions to both commits", async () => {
  for (
    const [option, path] of [
      [
        { recordedBaseCheckDefinition: "deno eval false" },
        "$.ticket.requiredTasks.baseline[0].definition",
      ],
      [
        { recordedCandidateCheckDefinition: "deno eval false" },
        "$.ticket.requiredTasks.candidate[0].definition",
      ],
    ] as const
  ) {
    const fixture = await createTaskFixture(option);
    try {
      assertValidatorIssue(
        await captureValidatorRun(fixture),
        path,
        "task_definition_mismatch",
      );
    } finally {
      Deno.removeSync(fixture.root, { recursive: true });
    }
  }
});

Deno.test("a changed task requires an unchanged independent guard", async () => {
  for (const guardedBy of [null, "check"] as const) {
    const fixture = await createTaskFixture({
      candidateCheckDefinition: CHANGED_CHECK_DEFINITION,
      guardedBy,
    });
    try {
      assertValidatorIssue(
        await captureValidatorRun(fixture),
        "$.ticket.requiredTasks.candidate[0].guardedBy",
        guardedBy === null ? "task_guard_required" : "task_guard_invalid",
      );
    } finally {
      Deno.removeSync(fixture.root, { recursive: true });
    }
  }
});

Deno.test("an obvious no-op is rejected even with an independent guard", async () => {
  const fixture = await createTaskFixture({
    candidateCheckDefinition: NOOP_CHECK_DEFINITION,
    guardedBy: "test:workflow",
  });
  try {
    assertValidatorIssue(
      await captureValidatorRun(fixture),
      "$.ticket.requiredTasks.candidate[0].definition",
      "task_definition_noop",
    );
  } finally {
    Deno.removeSync(fixture.root, { recursive: true });
  }
});

Deno.test("an unchanged independent task may guard a legitimate change", async () => {
  const fixture = await createTaskFixture({
    candidateCheckDefinition: CHANGED_CHECK_DEFINITION,
    guardedBy: "test:workflow",
  });
  try {
    assertValidatorSuccess(await captureValidatorRun(fixture));
  } finally {
    Deno.removeSync(fixture.root, { recursive: true });
  }
});

Deno.test("a changed task cannot act as an independent guard", async () => {
  const fixture = await createTaskFixture({
    candidateCheckDefinition: CHANGED_CHECK_DEFINITION,
    candidateWorkflowDefinition: CHANGED_WORKFLOW_TEST_DEFINITION,
    guardedBy: "test:workflow",
  });
  try {
    assertValidatorIssue(
      await captureValidatorRun(fixture),
      "$.ticket.requiredTasks.candidate[0].guardedBy",
      "task_guard_invalid",
    );
  } finally {
    Deno.removeSync(fixture.root, { recursive: true });
  }
});
