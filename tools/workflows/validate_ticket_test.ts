import {
  validateTicketBundle,
  type ValidationIssue,
} from "./ticket_contract.ts";
import { runTicketValidator } from "./validate_ticket.ts";

const BASE_REVISION = "9d4693e1335797f1ecf98c4515ddba8e2603d8fb";
const RED_REVISION = "960d91526ea6b9779754d7c2ba13193974aa6448";
const CANDIDATE_REVISION = "2222222222222222222222222222222222222222";
const TEST_SHA256 =
  "94c3c75525c4d11ffc81afc650dfa79473adae3f17a5259bf95d7bbcb9a55625";

const REQUIRED_TASKS = [
  "fmt:check",
  "lint",
  "check",
  "test:workflow",
  "test:workflow:coverage",
  "ticket:validate",
  "test:schema:matrix",
] as const;

const AVAILABLE_TASKS = new Set(REQUIRED_TASKS);

function validEvents(): Record<string, unknown>[] {
  return [
    {
      sequence: 1,
      from: "planned",
      to: "ready",
      round: 0,
      actorRunId: "orchestrator-ready-20260811",
      evidenceRef: "ticket.json",
      revision: BASE_REVISION,
    },
    {
      sequence: 2,
      from: "ready",
      to: "red",
      round: 1,
      actorRunId: "implementer-round-01-20260811",
      evidenceRef: "evidence/round-01-red.log",
      revision: RED_REVISION,
    },
    {
      sequence: 3,
      from: "red",
      to: "green",
      round: 1,
      actorRunId: "implementer-round-01-20260811",
      evidenceRef: "evidence/round-01-green.log",
      revision: CANDIDATE_REVISION,
    },
    {
      sequence: 4,
      from: "green",
      to: "refactor",
      round: 1,
      actorRunId: "implementer-round-01-20260811",
      evidenceRef: "evidence/round-01-refactor.log",
      revision: CANDIDATE_REVISION,
    },
    {
      sequence: 5,
      from: "refactor",
      to: "review",
      round: 1,
      actorRunId: "orchestrator-review-20260811",
      evidenceRef: "results/round-01.json",
      revision: CANDIDATE_REVISION,
    },
    {
      sequence: 6,
      from: "review",
      to: "accepted",
      round: 1,
      actorRunId: "orchestrator-accept-20260811",
      evidenceRef: "acceptance.md",
      revision: CANDIDATE_REVISION,
    },
  ];
}

function validBundle(): Record<string, unknown> {
  const events = validEvents();
  return {
    ticket: {
      schemaVersion: 1,
      ticketId: "PILOT-001",
      revision: 1,
      title: "Enforce autonomous ticket evidence",
      outcome: "A complete ticket record is validated mechanically.",
      baseRevision: BASE_REVISION,
      dependencies: [],
      maxRounds: 3,
      scope: ["Workflow validation"],
      nonGoals: ["Application behavior"],
      allowedWrites: ["tools/workflows/"],
      contractRefs: ["AGENTS.md#mandatory-change-method"],
      acceptanceCriteria: [{
        id: "AC-01",
        text: "Accept a complete exact-revision ticket record.",
        redProof:
          "A valid bundle fails with not_implemented before production changes.",
      }],
      requiredTasks: [...REQUIRED_TASKS],
      risks: ["False approval from permissive validation"],
      unresolvedDecisions: [],
    },
    state: {
      schemaVersion: 1,
      ticketId: "PILOT-001",
      ticketRevision: 1,
      phase: "accepted",
      round: 1,
      baseRevision: BASE_REVISION,
      candidateRevision: CANDIDATE_REVISION,
      events,
      resultRefs: ["results/round-01.json"],
      reviewRefs: ["reviews/round-01.json"],
      dependencyRevisions: {},
      openFindingIds: [],
      orchestratorChecks: REQUIRED_TASKS.map((task, index) => ({
        runId: `orchestrator-check-${index + 1}-20260811`,
        revision: CANDIDATE_REVISION,
        command: `deno task ${task}`,
        exitCode: 0,
      })),
      acceptedCandidateRevision: CANDIDATE_REVISION,
      blocker: null,
    },
    events: structuredClone(events),
    results: [{
      schemaVersion: 1,
      ticketId: "PILOT-001",
      ticketRevision: 1,
      round: 1,
      implementerRunId: "implementer-round-01-20260811",
      inputBaseRevision: BASE_REVISION,
      dispatchRef: "dispatch/round-01.md",
      redRevision: RED_REVISION,
      red: {
        command: "deno test tools/workflows/validate_ticket_test.ts",
        exitCode: 1,
        expectedFailure: "A complete valid bundle yields zero issues.",
        output: "The zero-issues assertion received not_implemented.",
        logRef: "evidence/round-01-red.log",
        testFiles: [{
          path: "tools/workflows/validate_ticket_test.ts",
          sha256: TEST_SHA256,
        }],
        productionFiles: [],
      },
      green: {
        command: "deno test tools/workflows/validate_ticket_test.ts",
        exitCode: 0,
        logRef: "evidence/round-01-green.log",
        productionFiles: ["tools/workflows/ticket_contract.ts"],
      },
      refactor: {
        summary: "Kept validation deterministic and dependency-free.",
        command: "deno task test:workflow:coverage",
        exitCode: 0,
        logRef: "evidence/round-01-refactor.log",
      },
      candidateRevision: CANDIDATE_REVISION,
    }],
    reviews: [{
      schemaVersion: 1,
      ticketId: "PILOT-001",
      ticketRevision: 1,
      round: 1,
      implementerRunId: "implementer-round-01-20260811",
      reviewerRunId: "reviewer-round-01-20260811",
      baseRevision: BASE_REVISION,
      candidateRevision: CANDIDATE_REVISION,
      verdict: "APPROVED",
      commands: [{
        command: "deno task test:workflow:coverage",
        exitCode: 0,
      }],
      lenses: {
        bug_correctness: {
          verdict: "pass",
          evidence: ["No correctness defects found."],
        },
        security_privacy: {
          verdict: "pass",
          evidence: ["No security or privacy defects found."],
        },
        architecture_contracts: {
          verdict: "pass",
          evidence: ["Accepted boundaries are preserved."],
        },
        performance_reliability: {
          verdict: "pass",
          evidence: ["Validation is bounded and deterministic."],
        },
        style_maintainability: {
          verdict: "pass",
          evidence: ["The implementation is maintainable."],
        },
        tests_tdd: {
          verdict: "pass",
          evidence: ["RED, GREEN, and REFACTOR evidence is complete."],
        },
      },
      findings: [],
      notes: [],
    }],
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Test fixture expected an object");
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error("Test fixture expected an array");
  }
  return value;
}

function assertNoIssues(issues: readonly ValidationIssue[]): void {
  if (issues.length !== 0) {
    throw new Error(
      `Expected a complete valid bundle to yield zero issues, received ${
        JSON.stringify(issues)
      }`,
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
      `Expected issue ${path}:${code}, received ${JSON.stringify(issues)}`,
    );
  }
}

function writeBundleFiles(
  directory: string,
  bundle: Record<string, unknown>,
): string {
  Deno.mkdirSync(`${directory}/results`, { recursive: true });
  Deno.mkdirSync(`${directory}/reviews`, { recursive: true });
  Deno.writeTextFileSync(
    `${directory}/ticket.json`,
    `${JSON.stringify(bundle.ticket, null, 2)}\n`,
  );
  Deno.writeTextFileSync(
    `${directory}/state.json`,
    `${JSON.stringify(bundle.state, null, 2)}\n`,
  );
  const events = asArray(bundle.events);
  Deno.writeTextFileSync(
    `${directory}/events.jsonl`,
    `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
  );
  Deno.writeTextFileSync(
    `${directory}/results/round-01.json`,
    `${JSON.stringify(asArray(bundle.results)[0], null, 2)}\n`,
  );
  Deno.writeTextFileSync(
    `${directory}/reviews/round-01.json`,
    `${JSON.stringify(asArray(bundle.reviews)[0], null, 2)}\n`,
  );
  return directory;
}

function writeRequiredEvidenceFiles(
  directory: string,
  bundle: Record<string, unknown>,
): void {
  Deno.mkdirSync(`${directory}/dispatch`, { recursive: true });
  Deno.mkdirSync(`${directory}/evidence`, { recursive: true });
  for (const value of asArray(bundle.results)) {
    const result = asRecord(value);
    for (
      const reference of [
        result.dispatchRef,
        asRecord(result.red).logRef,
        asRecord(result.green).logRef,
        asRecord(result.refactor).logRef,
      ]
    ) {
      if (typeof reference === "string") {
        Deno.writeTextFileSync(`${directory}/${reference}`, "verified\n");
      }
    }
  }
  Deno.writeTextFileSync(`${directory}/acceptance.md`, "Accepted.\n");
}

function writeBundleDirectory(bundle: Record<string, unknown>): string {
  const directory = writeBundleFiles(
    Deno.makeTempDirSync({ prefix: "ticket-validator-" }),
    bundle,
  );
  writeRequiredEvidenceFiles(directory, bundle);
  return directory;
}

function runGit(directory: string, args: readonly string[]): string {
  const result = new Deno.Command("git", {
    args: [...args],
    cwd: directory,
    stdout: "piped",
    stderr: "piped",
  }).outputSync();
  if (!result.success) {
    throw new Error(
      `Git fixture command failed: ${
        new TextDecoder().decode(result.stderr).trim()
      }`,
    );
  }
  return new TextDecoder().decode(result.stdout).trim();
}

async function sha256Text(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

async function writeGitBundleDirectory(
  options: {
    readonly redProduction?: boolean;
    readonly staleCandidate?: boolean;
    readonly outsideCandidate?: boolean;
    readonly oversizedRedTest?: boolean;
    readonly candidateFileCount?: number;
    readonly longCandidatePaths?: boolean;
  } = {},
): Promise<{
  readonly root: string;
  readonly ticketDirectory: string;
  readonly bundle: Record<string, unknown>;
}> {
  const root = Deno.makeTempDirSync({ prefix: "ticket-validator-git-" });
  runGit(root, ["init", "--quiet"]);
  runGit(root, ["config", "user.email", "workflow@example.invalid"]);
  runGit(root, ["config", "user.name", "Workflow Test"]);
  Deno.mkdirSync(`${root}/tools/workflows`, { recursive: true });
  Deno.writeTextFileSync(`${root}/tools/workflows/base.ts`, "export {};\n");
  Deno.writeTextFileSync(
    `${root}/deno.json`,
    `${
      JSON.stringify(
        {
          tasks: Object.fromEntries(
            REQUIRED_TASKS.map((task) => [task, "deno eval true"]),
          ),
        },
        null,
        2,
      )
    }\n`,
  );
  runGit(root, ["add", "--all"]);
  runGit(root, ["commit", "--quiet", "-m", "base"]);
  const baseRevision = runGit(root, ["rev-parse", "HEAD"]);

  const testText = options.oversizedRedTest
    ? `// ${"x".repeat(1_000_000)}\n`
    : "Deno.test('red proof', () => {});\n";
  Deno.writeTextFileSync(
    `${root}/tools/workflows/validate_ticket_test.ts`,
    testText,
  );
  if (options.redProduction) {
    Deno.writeTextFileSync(
      `${root}/tools/workflows/ticket_contract.ts`,
      "export const redProduction = true;\n",
    );
  }
  runGit(root, ["add", "--all"]);
  runGit(root, ["commit", "--quiet", "-m", "red"]);
  const redRevision = runGit(root, ["rev-parse", "HEAD"]);

  if (options.staleCandidate) {
    runGit(root, ["checkout", "--quiet", "--detach", baseRevision]);
  }
  const productionPaths = Array.from(
    { length: options.candidateFileCount ?? 1 },
    (_, index) => {
      if (options.outsideCandidate) return "outside/production.ts";
      if (options.longCandidatePaths) {
        return `tools/workflows/${"x".repeat(110)}-${index}.ts`;
      }
      return options.candidateFileCount === undefined
        ? "tools/workflows/ticket_contract.ts"
        : `tools/workflows/generated-${index}.ts`;
    },
  );
  for (const productionPath of productionPaths) {
    const productionDirectory = productionPath.slice(
      0,
      productionPath.lastIndexOf("/"),
    );
    Deno.mkdirSync(`${root}/${productionDirectory}`, { recursive: true });
    Deno.writeTextFileSync(
      `${root}/${productionPath}`,
      "export const green = true;\n",
    );
  }
  runGit(root, ["add", "--all"]);
  runGit(root, ["commit", "--quiet", "-m", "candidate"]);
  const candidateRevision = runGit(root, ["rev-parse", "HEAD"]);

  const bundle = validBundle();
  const ticket = asRecord(bundle.ticket);
  const state = asRecord(bundle.state);
  ticket.baseRevision = baseRevision;
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
  const result = asRecord(asArray(bundle.results)[0]);
  result.inputBaseRevision = baseRevision;
  result.redRevision = redRevision;
  result.candidateRevision = candidateRevision;
  asRecord(asArray(asRecord(result.red).testFiles)[0]).sha256 =
    await sha256Text(
      testText,
    );
  asRecord(result.green).productionFiles = productionPaths;
  const review = asRecord(asArray(bundle.reviews)[0]);
  review.baseRevision = baseRevision;
  review.candidateRevision = candidateRevision;
  for (const check of asArray(state.orchestratorChecks)) {
    asRecord(check).revision = candidateRevision;
  }

  const ticketDirectory = `${root}/docs/planning/tickets/PILOT-001`;
  writeBundleFiles(ticketDirectory, bundle);
  writeRequiredEvidenceFiles(ticketDirectory, bundle);
  return { root, ticketDirectory, bundle };
}

async function captureValidatorRun(args: readonly string[]): Promise<{
  readonly exitCode: number;
  readonly output: string;
}> {
  const lines: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  const capture = (...values: unknown[]): void => {
    lines.push(values.map(String).join(" "));
  };
  console.log = capture;
  console.error = capture;
  try {
    return {
      exitCode: await runTicketValidator(args),
      output: lines.join("\n"),
    };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

async function captureValidatorRunInRepository(
  repositoryRoot: string,
  args: readonly string[],
): Promise<{
  readonly exitCode: number;
  readonly output: string;
}> {
  const pendingMetadata = runGit(repositoryRoot, ["status", "--porcelain"]);
  if (pendingMetadata.length > 0) {
    runGit(repositoryRoot, ["add", "--all"]);
    runGit(repositoryRoot, [
      "commit",
      "--quiet",
      "-m",
      "ticket metadata fixture",
    ]);
  }
  const originalDirectory = Deno.cwd();
  try {
    Deno.chdir(repositoryRoot);
    return await captureValidatorRun(args);
  } finally {
    Deno.chdir(originalDirectory);
  }
}

Deno.test("validateTicketBundle accepts one complete valid bundle", () => {
  assertNoIssues(validateTicketBundle(validBundle(), AVAILABLE_TASKS));
});

Deno.test("validateTicketBundle rejects unknown fields", () => {
  const bundle = validBundle();
  asRecord(bundle.ticket).unexpected = true;

  assertIssue(
    validateTicketBundle(bundle, AVAILABLE_TASKS),
    "$.ticket.unexpected",
    "unknown_field",
  );
});

Deno.test("validateTicketBundle rejects duplicate stable IDs", () => {
  const bundle = validBundle();
  const criteria = asArray(asRecord(bundle.ticket).acceptanceCriteria);
  criteria.push(structuredClone(criteria[0]));

  assertIssue(
    validateTicketBundle(bundle, AVAILABLE_TASKS),
    "$.ticket.acceptanceCriteria[1].id",
    "duplicate_id",
  );
});

Deno.test("validateTicketBundle rejects invalid state transitions", () => {
  const bundle = validBundle();
  const stateEvents = asArray(asRecord(bundle.state).events);
  asRecord(stateEvents[2]).from = "ready";

  assertIssue(
    validateTicketBundle(bundle, AVAILABLE_TASKS),
    "$.state.events[2]",
    "invalid_transition",
  );
});

Deno.test("validateTicketBundle rejects repository path traversal", () => {
  const bundle = validBundle();
  asRecord(bundle.ticket).allowedWrites = ["../outside"];

  assertIssue(
    validateTicketBundle(bundle, AVAILABLE_TASKS),
    "$.ticket.allowedWrites[0]",
    "path_traversal",
  );
});

Deno.test("validateTicketBundle rejects absent required Deno tasks", () => {
  const tasksWithoutLint = new Set(
    REQUIRED_TASKS.filter((task) => task !== "lint"),
  );

  assertIssue(
    validateTicketBundle(validBundle(), tasksWithoutLint),
    "$.ticket.requiredTasks[1]",
    "task_missing",
  );
});

Deno.test("validateTicketBundle rejects malformed revisions and blob hashes", () => {
  const bundle = validBundle();
  asRecord(bundle.ticket).baseRevision = "HEAD";
  const result = asRecord(asArray(bundle.results)[0]);
  const red = asRecord(result.red);
  result.redRevision = "red-branch";
  const testFile = asRecord(asArray(red.testFiles)[0]);
  testFile.sha256 = "not-a-sha256";

  const issues = validateTicketBundle(bundle, AVAILABLE_TASKS);
  assertIssue(issues, "$.ticket.baseRevision", "invalid_revision");
  assertIssue(issues, "$.results[0].redRevision", "invalid_revision");
  assertIssue(
    issues,
    "$.results[0].red.testFiles[0].sha256",
    "invalid_sha256",
  );
});

Deno.test("validateTicketBundle rejects incomplete readiness and blocking decisions", () => {
  const bundle = validBundle();
  const ticket = asRecord(bundle.ticket);
  delete ticket.dependencies;
  ticket.unresolvedDecisions = ["DG-99 remains open"];

  const issues = validateTicketBundle(bundle, AVAILABLE_TASKS);
  assertIssue(issues, "$.ticket.dependencies", "required_field");
  assertIssue(
    issues,
    "$.ticket.unresolvedDecisions[0]",
    "unresolved_decision",
  );
});

Deno.test("validateTicketBundle enforces immutable RED evidence", () => {
  const bundle = validBundle();
  const result = asRecord(asArray(bundle.results)[0]);
  const red = asRecord(result.red);
  red.exitCode = 0;
  red.testFiles = [];
  red.productionFiles = ["tools/workflows/ticket_contract.ts"];

  const issues = validateTicketBundle(bundle, AVAILABLE_TASKS);
  assertIssue(issues, "$.results[0].red.exitCode", "red_must_fail");
  assertIssue(
    issues,
    "$.results[0].red.testFiles",
    "test_evidence_required",
  );
  assertIssue(
    issues,
    "$.results[0].red.productionFiles",
    "red_production_change",
  );
});

Deno.test("validateTicketBundle requires fresh implementer and reviewer runs", () => {
  const bundle = validBundle();
  const result = asRecord(asArray(bundle.results)[0]);
  const review = asRecord(asArray(bundle.reviews)[0]);
  review.reviewerRunId = result.implementerRunId;

  assertIssue(
    validateTicketBundle(bundle, AVAILABLE_TASKS),
    "$.reviews[0].reviewerRunId",
    "run_id_not_fresh",
  );
});

Deno.test("validateTicketBundle requires evidence for exactly six review lenses", () => {
  const bundle = validBundle();
  const review = asRecord(asArray(bundle.reviews)[0]);
  const lenses = asRecord(review.lenses);
  delete lenses.tests_tdd;
  asRecord(lenses.bug_correctness).evidence = [];

  const issues = validateTicketBundle(bundle, AVAILABLE_TASKS);
  assertIssue(
    issues,
    "$.reviews[0].lenses.bug_correctness.evidence",
    "evidence_required",
  );
  assertIssue(
    issues,
    "$.reviews[0].lenses.tests_tdd",
    "lens_missing",
  );
});

Deno.test("validateTicketBundle rejects a review of a stale candidate", () => {
  const bundle = validBundle();
  asRecord(asArray(bundle.reviews)[0]).candidateRevision = RED_REVISION;

  assertIssue(
    validateTicketBundle(bundle, AVAILABLE_TASKS),
    "$.reviews[0].candidateRevision",
    "candidate_mismatch",
  );
});

Deno.test("validateTicketBundle rejects open findings", () => {
  const bundle = validBundle();
  asRecord(bundle.state).openFindingIds = ["WFR-001"];
  const review = asRecord(asArray(bundle.reviews)[0]);
  review.verdict = "CHANGES_REQUESTED";
  review.findings = [{
    id: "WFR-001",
    lens: "tests_tdd",
    severity: "P1",
    location: "tools/workflows/ticket_contract.ts:validateTicketBundle",
    expectedBehavior: "A complete valid ticket is accepted.",
    observedBehavior: "Validation is not implemented.",
    reproduction: "Run deno test tools/workflows/validate_ticket_test.ts.",
    impact: "Ticket evidence cannot be trusted.",
    affectedCriterion: "AC-01",
    contractRef: "docs/development/autonomous-delivery.md",
    requiredRemediation: "Implement the validator.",
    verification: "The valid-bundle regression test passes.",
    status: "open",
  }];

  const issues = validateTicketBundle(bundle, AVAILABLE_TASKS);
  assertIssue(issues, "$.state.openFindingIds[0]", "open_finding");
  assertIssue(issues, "$.reviews[0].findings[0].status", "open_finding");
});

Deno.test("validateTicketBundle requires complete finding traceability", () => {
  const bundle = validBundle();
  const review = asRecord(asArray(bundle.reviews)[0]);
  review.findings = [{ id: "WFR-001", status: "resolved" }];

  assertIssue(
    validateTicketBundle(bundle, AVAILABLE_TASKS),
    "$.reviews[0].findings[0].affectedCriterion",
    "required_field",
  );
});

Deno.test("validateTicketBundle requires successful exact-candidate orchestrator checks", () => {
  const bundle = validBundle();
  const checks = asArray(asRecord(bundle.state).orchestratorChecks);
  asRecord(checks[0]).exitCode = 1;
  asRecord(checks[1]).revision = RED_REVISION;
  checks.pop();

  const issues = validateTicketBundle(bundle, AVAILABLE_TASKS);
  assertIssue(
    issues,
    "$.state.orchestratorChecks[0].exitCode",
    "check_failed",
  );
  assertIssue(
    issues,
    "$.state.orchestratorChecks[1].revision",
    "candidate_mismatch",
  );
  assertIssue(
    issues,
    "$.state.orchestratorChecks",
    "check_missing",
  );
});

Deno.test("validateTicketBundle requires ledger and state event agreement", () => {
  const bundle = validBundle();
  asRecord(asArray(bundle.events)[5]).to = "rework";

  assertIssue(
    validateTicketBundle(bundle, AVAILABLE_TASKS),
    "$.events",
    "ledger_mismatch",
  );
});

Deno.test("validateTicketBundle rejects missing and unknown bundle fields", () => {
  const bundle = validBundle();
  bundle.unexpected = true;
  delete bundle.reviews;
  asRecord(bundle.state).unexpected = true;

  const issues = validateTicketBundle(bundle, AVAILABLE_TASKS);
  assertIssue(issues, "$.unexpected", "unknown_field");
  assertIssue(issues, "$.reviews", "required_field");
  assertIssue(issues, "$.state.unexpected", "unknown_field");
});

Deno.test("validateTicketBundle reports malformed bundle roots without throwing", () => {
  assertIssue(validateTicketBundle(null, AVAILABLE_TASKS), "$", "invalid_type");
});

Deno.test("validateTicketBundle enforces cross-record revisions and passing phases", () => {
  const bundle = validBundle();
  const state = asRecord(bundle.state);
  state.acceptedCandidateRevision = RED_REVISION;
  const result = asRecord(asArray(bundle.results)[0]);
  result.inputBaseRevision = RED_REVISION;
  result.candidateRevision = RED_REVISION;
  asRecord(result.green).exitCode = 1;
  asRecord(result.refactor).exitCode = 1;
  const review = asRecord(asArray(bundle.reviews)[0]);
  review.baseRevision = RED_REVISION;

  const issues = validateTicketBundle(bundle, AVAILABLE_TASKS);
  assertIssue(
    issues,
    "$.state.acceptedCandidateRevision",
    "candidate_mismatch",
  );
  assertIssue(
    issues,
    "$.results[0].inputBaseRevision",
    "base_mismatch",
  );
  assertIssue(
    issues,
    "$.results[0].candidateRevision",
    "candidate_mismatch",
  );
  assertIssue(issues, "$.results[0].green.exitCode", "green_failed");
  assertIssue(issues, "$.results[0].refactor.exitCode", "refactor_failed");
  assertIssue(issues, "$.reviews[0].baseRevision", "base_mismatch");
});

Deno.test("validateTicketBundle rejects traversal in every evidence reference", () => {
  const bundle = validBundle();
  asRecord(bundle.state).resultRefs = ["../result.json"];
  const result = asRecord(asArray(bundle.results)[0]);
  result.dispatchRef = "../dispatch.md";
  const red = asRecord(result.red);
  red.logRef = "../red.log";
  asRecord(asArray(red.testFiles)[0]).path = "C:\\outside\\test.ts";
  const green = asRecord(result.green);
  green.productionFiles = ["tools/../outside.ts"];

  const issues = validateTicketBundle(bundle, AVAILABLE_TASKS);
  assertIssue(issues, "$.state.resultRefs[0]", "path_traversal");
  assertIssue(issues, "$.results[0].dispatchRef", "path_traversal");
  assertIssue(issues, "$.results[0].red.logRef", "path_traversal");
  assertIssue(
    issues,
    "$.results[0].red.testFiles[0].path",
    "path_traversal",
  );
  assertIssue(
    issues,
    "$.results[0].green.productionFiles[0]",
    "path_traversal",
  );
});

Deno.test("validateTicketBundle rejects duplicate finding IDs and invalid lens verdicts", () => {
  const bundle = validBundle();
  const review = asRecord(asArray(bundle.reviews)[0]);
  const finding = {
    id: "WFR-001",
    lens: "tests_tdd",
    severity: "P1",
    location: "tools/workflows/ticket_contract.ts:validateTicketBundle",
    expectedBehavior: "Valid evidence is accepted.",
    observedBehavior: "Evidence was incomplete.",
    reproduction: "Run the focused test.",
    impact: "Acceptance could be incorrect.",
    affectedCriterion: "AC-01",
    contractRef: "docs/development/autonomous-delivery.md",
    requiredRemediation: "Validate the evidence.",
    verification: "Run the regression test.",
    status: "resolved",
  };
  review.findings = [finding, structuredClone(finding)];
  asRecord(asRecord(review.lenses).tests_tdd).verdict = "unknown";

  const issues = validateTicketBundle(bundle, AVAILABLE_TASKS);
  assertIssue(
    issues,
    "$.reviews[0].findings[1].id",
    "duplicate_id",
  );
  assertIssue(
    issues,
    "$.reviews[0].lenses.tests_tdd.verdict",
    "invalid_value",
  );
});

Deno.test("runTicketValidator accepts a complete temporary ticket directory", async () => {
  const fixture = await writeGitBundleDirectory();
  try {
    const result = await captureValidatorRunInRepository(
      fixture.root,
      [fixture.ticketDirectory],
    );
    if (result.exitCode !== 0) {
      throw new Error(
        `Expected CLI exit 0 for a valid directory, received ${result.exitCode}: ${result.output}`,
      );
    }
    if (!result.output.includes('"ok":true')) {
      throw new Error(`Expected safe success JSON, received ${result.output}`);
    }
  } finally {
    Deno.removeSync(fixture.root, { recursive: true });
  }
});

Deno.test("runTicketValidator rejects missing and malformed files safely", async () => {
  const missingDirectory = Deno.makeTempDirSync({
    prefix: "ticket-validator-missing-",
  });
  const malformedDirectory = Deno.makeTempDirSync({
    prefix: "ticket-validator-malformed-",
  });
  try {
    const missing = await captureValidatorRun([missingDirectory]);
    if (missing.exitCode === 0 || !missing.output.includes('"file_missing"')) {
      throw new Error(
        `Expected a file_missing diagnostic, received ${missing.output}`,
      );
    }

    Deno.writeTextFileSync(
      `${malformedDirectory}/ticket.json`,
      '{"token":"do-not-echo"',
    );
    const malformed = await captureValidatorRun([malformedDirectory]);
    if (
      malformed.exitCode === 0 ||
      !malformed.output.includes('"malformed_json"')
    ) {
      throw new Error(
        `Expected a malformed_json diagnostic, received ${malformed.output}`,
      );
    }
    if (
      malformed.output.includes("do-not-echo") ||
      malformed.output.includes("at ")
    ) {
      throw new Error(
        `CLI leaked file content or a stack: ${malformed.output}`,
      );
    }
  } finally {
    Deno.removeSync(missingDirectory, { recursive: true });
    Deno.removeSync(malformedDirectory, { recursive: true });
  }
});

Deno.test("runTicketValidator rejects an invalid invocation deterministically", async () => {
  const result = await captureValidatorRun([]);
  if (result.exitCode === 0 || !result.output.includes('"usage"')) {
    throw new Error(`Expected a usage diagnostic, received ${result.output}`);
  }
});

Deno.test("validateTicketBundle strictly validates nested object fields", () => {
  const bundle = validBundle();
  const result = asRecord(asArray(bundle.results)[0]);
  asRecord(result.red).unexpected = true;
  delete result.redRevision;

  const issues = validateTicketBundle(bundle, AVAILABLE_TASKS);
  assertIssue(issues, "$.results[0].red.unexpected", "unknown_field");
  assertIssue(issues, "$.results[0].redRevision", "required_field");
});

Deno.test("validateTicketBundle rejects unsupported schema versions and record mismatches", () => {
  const bundle = validBundle();
  asRecord(bundle.ticket).schemaVersion = 2;
  asRecord(bundle.state).ticketId = "OTHER-001";

  const issues = validateTicketBundle(bundle, AVAILABLE_TASKS);
  assertIssue(issues, "$.ticket.schemaVersion", "invalid_value");
  assertIssue(issues, "$.state.ticketId", "ticket_mismatch");
});

Deno.test("validateTicketBundle rejects non-contiguous event sequences", () => {
  const bundle = validBundle();
  asRecord(asArray(asRecord(bundle.state).events)[0]).sequence = 7;

  assertIssue(
    validateTicketBundle(bundle, AVAILABLE_TASKS),
    "$.state.events[0].sequence",
    "invalid_sequence",
  );
});

Deno.test("validateTicketBundle rejects malformed nested collection types", () => {
  const bundle = validBundle();
  bundle.reviews = 42;

  assertIssue(
    validateTicketBundle(bundle, AVAILABLE_TASKS),
    "$.reviews",
    "invalid_type",
  );
});

Deno.test("validateTicketBundle rejects unknown fields throughout evidence records", () => {
  const bundle = validBundle();
  const ticket = asRecord(bundle.ticket);
  asRecord(asArray(ticket.acceptanceCriteria)[0]).unexpected = true;
  const state = asRecord(bundle.state);
  asRecord(asArray(state.events)[0]).unexpected = true;
  asRecord(asArray(bundle.events)[0]).unexpected = true;
  asRecord(asArray(state.orchestratorChecks)[0]).unexpected = true;
  const result = asRecord(asArray(bundle.results)[0]);
  const red = asRecord(result.red);
  asRecord(asArray(red.testFiles)[0]).unexpected = true;
  asRecord(result.green).unexpected = true;
  asRecord(result.refactor).unexpected = true;
  const review = asRecord(asArray(bundle.reviews)[0]);
  review.unexpected = true;
  asRecord(asRecord(review.lenses).tests_tdd).unexpected = true;
  review.findings = [{
    id: "WFR-001",
    lens: "tests_tdd",
    severity: "P1",
    location: "tools/workflows/ticket_contract.ts:validateTicketBundle",
    expectedBehavior: "Valid evidence is accepted.",
    observedBehavior: "Evidence was incomplete.",
    reproduction: "Run the focused test.",
    impact: "Acceptance could be incorrect.",
    affectedCriterion: "AC-01",
    contractRef: "docs/development/autonomous-delivery.md",
    requiredRemediation: "Validate evidence.",
    verification: "Run the regression test.",
    status: "resolved",
    unexpected: true,
  }];

  const issues = validateTicketBundle(bundle, AVAILABLE_TASKS);
  for (
    const path of [
      "$.ticket.acceptanceCriteria[0].unexpected",
      "$.state.events[0].unexpected",
      "$.state.orchestratorChecks[0].unexpected",
      "$.results[0].red.testFiles[0].unexpected",
      "$.results[0].green.unexpected",
      "$.results[0].refactor.unexpected",
      "$.reviews[0].unexpected",
      "$.reviews[0].lenses.tests_tdd.unexpected",
      "$.reviews[0].findings[0].unexpected",
    ]
  ) {
    assertIssue(issues, path, "unknown_field");
  }
});

Deno.test("validateTicketBundle rejects malformed nested evidence values", () => {
  const bundle = validBundle();
  const ticket = asRecord(bundle.ticket);
  ticket.acceptanceCriteria = [42];
  const state = asRecord(bundle.state);
  state.events = "not-an-array";
  const result = asRecord(asArray(bundle.results)[0]);
  asRecord(result.red).testFiles = ["not-an-object"];
  result.green = false;
  const review = asRecord(asArray(bundle.reviews)[0]);
  review.lenses = false;
  review.findings = ["not-an-object"];

  const issues = validateTicketBundle(bundle, AVAILABLE_TASKS);
  for (
    const path of [
      "$.ticket.acceptanceCriteria[0]",
      "$.state.events",
      "$.results[0].red.testFiles[0]",
      "$.results[0].green",
      "$.reviews[0].lenses",
      "$.reviews[0].findings[0]",
    ]
  ) {
    assertIssue(issues, path, "invalid_type");
  }
});

Deno.test("validateTicketBundle requires exact integrated dependency evidence", () => {
  const bundle = validBundle();
  asRecord(bundle.ticket).dependencies = ["FOUNDATION-001"];

  assertIssue(
    validateTicketBundle(bundle, AVAILABLE_TASKS),
    "$.state.dependencyRevisions.FOUNDATION-001",
    "dependency_unresolved",
  );
});

Deno.test("validateTicketBundle reports malformed evidence entries", () => {
  const cases: Array<{
    readonly mutate: (bundle: Record<string, unknown>) => void;
    readonly path: string;
  }> = [
    {
      mutate: (bundle) => {
        asRecord(bundle.state).events = [42];
        bundle.events = [42];
      },
      path: "$.state.events[0]",
    },
    {
      mutate: (bundle) => {
        const event = asRecord(asArray(asRecord(bundle.state).events)[0]);
        event.from = 42;
        asRecord(asArray(bundle.events)[0]).from = 42;
      },
      path: "$.state.events[0].from",
    },
    { mutate: (bundle) => void (bundle.results = 42), path: "$.results" },
    { mutate: (bundle) => void (bundle.results = [42]), path: "$.results[0]" },
    {
      mutate: (bundle) => {
        asRecord(asArray(bundle.results)[0]).red = 42;
      },
      path: "$.results[0].red",
    },
    {
      mutate: (bundle) => {
        asRecord(asRecord(asArray(bundle.results)[0]).red).testFiles = 42;
      },
      path: "$.results[0].red.testFiles",
    },
    { mutate: (bundle) => void (bundle.reviews = [42]), path: "$.reviews[0]" },
    {
      mutate: (bundle) => {
        asRecord(bundle.state).dependencyRevisions = 42;
      },
      path: "$.state.dependencyRevisions",
    },
    {
      mutate: (bundle) => {
        asRecord(bundle.state).orchestratorChecks = [42];
      },
      path: "$.state.orchestratorChecks[0]",
    },
  ];

  for (const testCase of cases) {
    const bundle = validBundle();
    testCase.mutate(bundle);
    assertIssue(
      validateTicketBundle(bundle, AVAILABLE_TASKS),
      testCase.path,
      "invalid_type",
    );
  }
});

Deno.test("runTicketValidator bounds files and ledger input", async () => {
  const oversizedDirectory = Deno.makeTempDirSync({
    prefix: "ticket-validator-oversized-",
  });
  const ledgerDirectory = writeBundleDirectory(validBundle());
  try {
    Deno.writeTextFileSync(
      `${oversizedDirectory}/ticket.json`,
      "x".repeat(1_000_001),
    );
    const oversized = await captureValidatorRun([oversizedDirectory]);
    if (
      oversized.exitCode === 0 ||
      !oversized.output.includes('"file_too_large"')
    ) {
      throw new Error(
        `Expected a file size diagnostic, received ${oversized.output}`,
      );
    }

    Deno.writeTextFileSync(
      `${ledgerDirectory}/events.jsonl`,
      `${Array.from({ length: 1_001 }, () => "{}").join("\n")}\n`,
    );
    const ledger = await captureValidatorRun([ledgerDirectory]);
    if (ledger.exitCode === 0 || !ledger.output.includes('"file_too_large"')) {
      throw new Error(
        `Expected a ledger bound diagnostic, received ${ledger.output}`,
      );
    }
  } finally {
    Deno.removeSync(oversizedDirectory, { recursive: true });
    Deno.removeSync(ledgerDirectory, { recursive: true });
  }
});

Deno.test("runTicketValidator rejects malformed ledger lines and missing references", async () => {
  const malformedDirectory = writeBundleDirectory(validBundle());
  const missingReferenceDirectory = writeBundleDirectory(validBundle());
  try {
    Deno.writeTextFileSync(`${malformedDirectory}/events.jsonl`, "not-json\n");
    const malformed = await captureValidatorRun([malformedDirectory]);
    if (
      malformed.exitCode === 0 ||
      !malformed.output.includes('"malformed_json"')
    ) {
      throw new Error(
        `Expected a malformed ledger diagnostic: ${malformed.output}`,
      );
    }

    Deno.removeSync(`${missingReferenceDirectory}/results/round-01.json`);
    const missing = await captureValidatorRun([missingReferenceDirectory]);
    if (missing.exitCode === 0 || !missing.output.includes('"file_missing"')) {
      throw new Error(
        `Expected a missing reference diagnostic: ${missing.output}`,
      );
    }
  } finally {
    Deno.removeSync(malformedDirectory, { recursive: true });
    Deno.removeSync(missingReferenceDirectory, { recursive: true });
  }
});

Deno.test("runTicketValidator never follows unsafe evidence references", async () => {
  const bundle = validBundle();
  asRecord(bundle.state).resultRefs = ["../outside.json"];
  const directory = writeBundleDirectory(bundle);
  try {
    const result = await captureValidatorRun([directory]);
    if (
      result.exitCode === 0 ||
      !result.output.includes('"path_traversal"')
    ) {
      throw new Error(
        `Expected traversal rejection, received ${result.output}`,
      );
    }
  } finally {
    Deno.removeSync(directory, { recursive: true });
  }
});

Deno.test("runTicketValidator handles non-files and unreadable paths safely", async () => {
  const directory = Deno.makeTempDirSync({
    prefix: "ticket-validator-nonfile-",
  });
  try {
    Deno.mkdirSync(`${directory}/ticket.json`);
    const nonFile = await captureValidatorRun([directory]);
    if (nonFile.exitCode === 0 || !nonFile.output.includes('"file_missing"')) {
      throw new Error(
        `Expected a non-file diagnostic, received ${nonFile.output}`,
      );
    }

    const unreadable = await captureValidatorRun(["\0"]);
    if (
      unreadable.exitCode === 0 ||
      !unreadable.output.includes('"file_unreadable"')
    ) {
      throw new Error(
        `Expected an unreadable diagnostic, received ${unreadable.output}`,
      );
    }
  } finally {
    Deno.removeSync(directory, { recursive: true });
  }
});

Deno.test("runTicketValidator rejects malformed root task configuration", async () => {
  const directory = writeBundleDirectory(validBundle());
  const fakeRoot = Deno.makeTempDirSync({ prefix: "ticket-validator-config-" });
  const originalDirectory = Deno.cwd();
  try {
    Deno.writeTextFileSync(`${fakeRoot}/deno.json`, "{}\n");
    Deno.chdir(fakeRoot);
    const result = await captureValidatorRun([directory]);
    if (result.exitCode === 0 || !result.output.includes('"invalid_type"')) {
      throw new Error(`Expected a tasks diagnostic, received ${result.output}`);
    }
  } finally {
    Deno.chdir(originalDirectory);
    Deno.removeSync(directory, { recursive: true });
    Deno.removeSync(fakeRoot, { recursive: true });
  }
});

Deno.test("runTicketValidator maps unexpected failures without a stack", async () => {
  const directory = writeBundleDirectory(validBundle());
  const originalLog = console.log;
  const lines: string[] = [];
  let writes = 0;
  console.log = (...values: unknown[]): void => {
    writes += 1;
    if (writes === 1) {
      throw new Error("simulated output failure");
    }
    lines.push(values.map(String).join(" "));
  };
  try {
    const exitCode = await runTicketValidator([directory]);
    const output = lines.join("\n");
    if (exitCode === 0 || !output.includes('"io_error"')) {
      throw new Error(`Expected a safe I/O diagnostic, received ${output}`);
    }
  } finally {
    console.log = originalLog;
    Deno.removeSync(directory, { recursive: true });
  }
});

Deno.test("validateTicketBundle rejects malformed core records", () => {
  const malformedTicket = validBundle();
  malformedTicket.ticket = 42;
  assertIssue(
    validateTicketBundle(malformedTicket, AVAILABLE_TASKS),
    "$.ticket",
    "invalid_type",
  );

  const malformedState = validBundle();
  malformedState.state = 42;
  assertIssue(
    validateTicketBundle(malformedState, AVAILABLE_TASKS),
    "$.state",
    "invalid_type",
  );
});

Deno.test("validateTicketBundle identifies a malformed event destination", () => {
  const bundle = validBundle();
  asRecord(asArray(asRecord(bundle.state).events)[0]).to = 42;
  asRecord(asArray(bundle.events)[0]).to = 42;

  assertIssue(
    validateTicketBundle(bundle, AVAILABLE_TASKS),
    "$.state.events[0].to",
    "invalid_type",
  );
});

Deno.test("validate_ticket CLI entry point exits zero for a valid directory", async () => {
  const fixture = await writeGitBundleDirectory();
  try {
    runGit(fixture.root, ["add", "--all"]);
    runGit(fixture.root, [
      "commit",
      "--quiet",
      "-m",
      "ticket metadata fixture",
    ]);
    const validatorPath = Deno.realPathSync(
      new URL("./validate_ticket.ts", import.meta.url),
    );
    const result = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-read",
        "--allow-run=git",
        validatorPath,
        fixture.ticketDirectory,
      ],
      cwd: fixture.root,
      stdout: "piped",
      stderr: "piped",
    }).outputSync();
    const stdout = new TextDecoder().decode(result.stdout);
    const stderr = new TextDecoder().decode(result.stderr);
    if (!result.success || !stdout.includes('"ok":true')) {
      throw new Error(
        `Expected successful CLI entry point, code ${result.code}: ${stdout}${stderr}`,
      );
    }
  } finally {
    Deno.removeSync(fixture.root, { recursive: true });
  }
});

Deno.test("validateTicketBundle rejects accepted state without lifecycle or review evidence", () => {
  const bundle = validBundle();
  asRecord(bundle.ticket).requiredTasks = [];
  const state = asRecord(bundle.state);
  state.events = [];
  state.resultRefs = [];
  state.reviewRefs = [];
  state.orchestratorChecks = [];
  state.candidateRevision = null;
  state.acceptedCandidateRevision = null;
  bundle.events = [];
  bundle.results = [];
  bundle.reviews = [];

  assertIssue(
    validateTicketBundle(bundle, AVAILABLE_TASKS),
    "$.state.events",
    "lifecycle_incomplete",
  );
});

Deno.test("validateTicketBundle enforces phase-aware lifecycle record agreement", () => {
  const cases: Array<{
    readonly mutate: (bundle: Record<string, unknown>) => void;
    readonly path: string;
    readonly code: string;
  }> = [
    {
      mutate: (bundle) => {
        asArray(asRecord(bundle.state).events).pop();
        asArray(bundle.events).pop();
      },
      path: "$.state.events",
      code: "lifecycle_incomplete",
    },
    {
      mutate: (bundle) => {
        asRecord(bundle.state).resultRefs = [];
        bundle.results = [];
      },
      path: "$.results",
      code: "lifecycle_incomplete",
    },
    {
      mutate: (bundle) => {
        asRecord(bundle.state).reviewRefs = [];
        bundle.reviews = [];
      },
      path: "$.reviews",
      code: "review_required",
    },
    {
      mutate: (bundle) => {
        asRecord(asArray(bundle.results)[0]).ticketId = "OTHER-001";
      },
      path: "$.results[0].ticketId",
      code: "ticket_mismatch",
    },
    {
      mutate: (bundle) => {
        asRecord(asArray(bundle.results)[0]).ticketRevision = 2;
      },
      path: "$.results[0].ticketRevision",
      code: "ticket_revision_mismatch",
    },
    {
      mutate: (bundle) => {
        asRecord(asArray(bundle.reviews)[0]).round = 2;
      },
      path: "$.reviews[0].round",
      code: "round_mismatch",
    },
    {
      mutate: (bundle) => {
        asRecord(asArray(bundle.reviews)[0]).implementerRunId =
          "different-implementer";
      },
      path: "$.reviews[0].implementerRunId",
      code: "run_mismatch",
    },
    {
      mutate: (bundle) => {
        const state = asRecord(bundle.state);
        const stateEvent = asRecord(asArray(state.events)[1]);
        const ledgerEvent = asRecord(asArray(bundle.events)[1]);
        stateEvent.actorRunId = "different-implementer";
        ledgerEvent.actorRunId = "different-implementer";
      },
      path: "$.state.events[1].actorRunId",
      code: "run_mismatch",
    },
  ];

  for (const testCase of cases) {
    const bundle = validBundle();
    testCase.mutate(bundle);
    assertIssue(
      validateTicketBundle(bundle, AVAILABLE_TASKS),
      testCase.path,
      testCase.code,
    );
  }
});

Deno.test("validateTicketBundle rejects malformed and contradictory semantic records", () => {
  const addFinding = (
    bundle: Record<string, unknown>,
  ): Record<string, unknown> => {
    const finding: Record<string, unknown> = {
      id: "WFR-001",
      lens: "tests_tdd",
      severity: "P1",
      location: "tools/workflows/ticket_contract.ts:validateTicketBundle",
      expectedBehavior: "Valid evidence is accepted.",
      observedBehavior: "Malformed evidence was accepted.",
      reproduction: "Run the focused semantic mutant test.",
      impact: "Ticket evidence could be meaningless.",
      affectedCriterion: "AC-01",
      contractRef: "AGENTS.md#mandatory-change-method",
      requiredRemediation: "Validate required semantic values.",
      verification: "The semantic mutant test passes.",
      status: "resolved",
    };
    asRecord(asArray(bundle.reviews)[0]).findings = [finding];
    return finding;
  };
  const cases: Array<{
    readonly mutate: (bundle: Record<string, unknown>) => void;
    readonly path: string;
    readonly code: string;
  }> = [
    {
      mutate: (bundle) => void (asRecord(bundle.ticket).baseRevision = 42),
      path: "$.ticket.baseRevision",
      code: "invalid_type",
    },
    {
      mutate: (bundle) => void (asRecord(bundle.ticket).title = "  "),
      path: "$.ticket.title",
      code: "empty_value",
    },
    {
      mutate: (bundle) => void (asRecord(bundle.ticket).dependencies = false),
      path: "$.ticket.dependencies",
      code: "invalid_type",
    },
    {
      mutate: (bundle) => {
        asArray(asRecord(bundle.ticket).requiredTasks).push("lint");
      },
      path: "$.ticket.requiredTasks[7]",
      code: "duplicate_value",
    },
    {
      mutate: (bundle) => {
        asRecord(asArray(asRecord(bundle.ticket).acceptanceCriteria)[0]).text =
          null;
      },
      path: "$.ticket.acceptanceCriteria[0].text",
      code: "invalid_type",
    },
    {
      mutate: (bundle) => {
        asRecord(asArray(bundle.results)[0]).dispatchRef = null;
      },
      path: "$.results[0].dispatchRef",
      code: "invalid_type",
    },
    {
      mutate: (bundle) => {
        const red = asRecord(asRecord(asArray(bundle.results)[0]).red);
        asRecord(asArray(red.testFiles)[0]).sha256 = 42;
      },
      path: "$.results[0].red.testFiles[0].sha256",
      code: "invalid_type",
    },
    {
      mutate: (bundle) => {
        const red = asRecord(asRecord(asArray(bundle.results)[0]).red);
        asArray(red.testFiles).push(structuredClone(asArray(red.testFiles)[0]));
      },
      path: "$.results[0].red.testFiles[1].path",
      code: "duplicate_value",
    },
    {
      mutate: (bundle) => {
        asRecord(asArray(bundle.reviews)[0]).verdict = "MAYBE";
      },
      path: "$.reviews[0].verdict",
      code: "invalid_value",
    },
    {
      mutate: (bundle) => {
        asRecord(asArray(bundle.reviews)[0]).commands = [42];
      },
      path: "$.reviews[0].commands[0]",
      code: "invalid_type",
    },
    {
      mutate: (bundle) => {
        const review = asRecord(asArray(bundle.reviews)[0]);
        asRecord(asRecord(review.lenses).tests_tdd).evidence = [""];
      },
      path: "$.reviews[0].lenses.tests_tdd.evidence[0]",
      code: "empty_value",
    },
    {
      mutate: (bundle) => void (addFinding(bundle).lens = "unknown"),
      path: "$.reviews[0].findings[0].lens",
      code: "invalid_value",
    },
    {
      mutate: (bundle) => void (addFinding(bundle).severity = "P9"),
      path: "$.reviews[0].findings[0].severity",
      code: "invalid_value",
    },
    {
      mutate: (bundle) => void (addFinding(bundle).status = "ignored"),
      path: "$.reviews[0].findings[0].status",
      code: "invalid_value",
    },
    {
      mutate: (bundle) =>
        void (
          addFinding(bundle).affectedCriterion = "AC-404"
        ),
      path: "$.reviews[0].findings[0].affectedCriterion",
      code: "unknown_reference",
    },
    {
      mutate: (bundle) =>
        void (
          addFinding(bundle).contractRef = "docs/unknown.md"
        ),
      path: "$.reviews[0].findings[0].contractRef",
      code: "unknown_reference",
    },
    {
      mutate: (bundle) => {
        const review = asRecord(asArray(bundle.reviews)[0]);
        asRecord(asRecord(review.lenses).tests_tdd).verdict = "fail";
      },
      path: "$.reviews[0].verdict",
      code: "verdict_conflict",
    },
  ];

  for (const testCase of cases) {
    const bundle = validBundle();
    testCase.mutate(bundle);
    assertIssue(
      validateTicketBundle(bundle, AVAILABLE_TASKS),
      testCase.path,
      testCase.code,
    );
  }
});

Deno.test("result evidence template contains a valid dispatch reference", () => {
  const template = JSON.parse(
    Deno.readTextFileSync(
      new URL(
        "../../.agents/skills/run-tdd-ticket-loop/assets/result.template.json",
        import.meta.url,
      ),
    ),
  );
  if (template.dispatchRef !== "dispatch/round-01.md") {
    throw new Error(
      `Expected round dispatch reference, received ${template.dispatchRef}`,
    );
  }
});

Deno.test("runTicketValidator bounds duplicate count and aggregate references", async () => {
  const duplicateBundle = validBundle();
  asRecord(duplicateBundle.state).resultRefs = [
    "results/round-01.json",
    "results/round-01.json",
  ];
  const duplicateDirectory = writeBundleDirectory(duplicateBundle);

  const countBundle = validBundle();
  asRecord(countBundle.state).resultRefs = Array.from(
    { length: 101 },
    (_, index) => `results/count-${index}.json`,
  );
  const countDirectory = writeBundleDirectory(countBundle);

  const aggregateBundle = validBundle();
  const aggregateRefs = Array.from(
    { length: 6 },
    (_, index) => `results/aggregate-${index}.json`,
  );
  asRecord(aggregateBundle.state).resultRefs = aggregateRefs;
  const aggregateDirectory = writeBundleDirectory(aggregateBundle);
  try {
    for (const reference of aggregateRefs) {
      Deno.writeTextFileSync(
        `${aggregateDirectory}/${reference}`,
        JSON.stringify({ padding: "x".repeat(899_900) }),
      );
    }

    const duplicate = await captureValidatorRun([duplicateDirectory]);
    const count = await captureValidatorRun([countDirectory]);
    const aggregate = await captureValidatorRun([aggregateDirectory]);
    const diagnostics = [
      [duplicate, "duplicate_reference"],
      [count, "reference_limit"],
      [aggregate, "aggregate_too_large"],
    ] as const;
    const missing = diagnostics.filter(([result, code]) =>
      result.exitCode === 0 || !result.output.includes(`"${code}"`)
    );
    if (missing.length > 0) {
      throw new Error(
        `Expected bounded reference diagnostics, missing ${
          missing.map(([, code]) => code).join(",")
        }`,
      );
    }
  } finally {
    Deno.removeSync(duplicateDirectory, { recursive: true });
    Deno.removeSync(countDirectory, { recursive: true });
    Deno.removeSync(aggregateDirectory, { recursive: true });
  }
});

Deno.test("runTicketValidator verifies Git content-addressed TDD lineage", async () => {
  const genuine = await writeGitBundleDirectory();
  const redProduction = await writeGitBundleDirectory({ redProduction: true });
  const staleCandidate = await writeGitBundleDirectory({
    staleCandidate: true,
  });
  const outsideCandidate = await writeGitBundleDirectory({
    outsideCandidate: true,
  });
  const oversizedRedTest = await writeGitBundleDirectory({
    oversizedRedTest: true,
  });
  const excessivePaths = await writeGitBundleDirectory({
    candidateFileCount: 101,
  });
  const excessiveOutput = await writeGitBundleDirectory({
    candidateFileCount: 80,
    longCandidatePaths: true,
  });
  const brokenTree = await writeGitBundleDirectory();
  try {
    const genuineRun = await captureValidatorRunInRepository(
      genuine.root,
      [genuine.ticketDirectory],
    );

    const exactAllowedBundle = structuredClone(genuine.bundle);
    asRecord(exactAllowedBundle.ticket).allowedWrites = [
      "tools/workflows/validate_ticket_test.ts",
      "tools/workflows/ticket_contract.ts",
    ];
    writeBundleFiles(genuine.ticketDirectory, exactAllowedBundle);
    const exactAllowed = await captureValidatorRunInRepository(
      genuine.root,
      [genuine.ticketDirectory],
    );

    const integratedBundle = structuredClone(genuine.bundle);
    const integratedState = asRecord(integratedBundle.state);
    integratedState.phase = "integrated";
    const integratedEvents = asArray(integratedState.events);
    integratedEvents.push({
      sequence: 7,
      from: "accepted",
      to: "integrated",
      round: 1,
      actorRunId: "orchestrator-integrate-20260811",
      evidenceRef: "acceptance.md",
      revision: integratedState.candidateRevision,
    });
    integratedBundle.events = structuredClone(integratedEvents);
    writeBundleFiles(genuine.ticketDirectory, integratedBundle);
    const integrated = await captureValidatorRunInRepository(
      genuine.root,
      [genuine.ticketDirectory],
    );

    const wrongHashBundle = structuredClone(genuine.bundle);
    const wrongHashResult = asRecord(asArray(wrongHashBundle.results)[0]);
    asRecord(asArray(asRecord(wrongHashResult.red).testFiles)[0]).sha256 = "0"
      .repeat(64);
    writeBundleFiles(genuine.ticketDirectory, wrongHashBundle);
    const wrongHash = await captureValidatorRunInRepository(
      genuine.root,
      [genuine.ticketDirectory],
    );

    const missingBlobBundle = structuredClone(genuine.bundle);
    const missingBlobResult = asRecord(asArray(missingBlobBundle.results)[0]);
    asRecord(asArray(asRecord(missingBlobResult.red).testFiles)[0]).path =
      "tools/workflows/missing_test.ts";
    writeBundleFiles(genuine.ticketDirectory, missingBlobBundle);
    const missingBlob = await captureValidatorRunInRepository(
      genuine.root,
      [genuine.ticketDirectory],
    );

    const nonexistentBundle = structuredClone(genuine.bundle);
    const nonexistentState = asRecord(nonexistentBundle.state);
    const nonexistentBase = "d".repeat(40);
    const nonexistentRed = "e".repeat(40);
    const nonexistentCandidate = "f".repeat(40);
    asRecord(nonexistentBundle.ticket).baseRevision = nonexistentBase;
    nonexistentState.baseRevision = nonexistentBase;
    nonexistentState.candidateRevision = nonexistentCandidate;
    nonexistentState.acceptedCandidateRevision = nonexistentCandidate;
    const nonexistentEvents = asArray(nonexistentState.events);
    asRecord(nonexistentEvents[0]).revision = nonexistentBase;
    asRecord(nonexistentEvents[1]).revision = nonexistentRed;
    for (const event of nonexistentEvents.slice(2)) {
      asRecord(event).revision = nonexistentCandidate;
    }
    nonexistentBundle.events = structuredClone(nonexistentEvents);
    const nonexistentResult = asRecord(asArray(nonexistentBundle.results)[0]);
    nonexistentResult.inputBaseRevision = nonexistentBase;
    nonexistentResult.redRevision = nonexistentRed;
    nonexistentResult.candidateRevision = nonexistentCandidate;
    const nonexistentReview = asRecord(asArray(nonexistentBundle.reviews)[0]);
    nonexistentReview.baseRevision = nonexistentBase;
    nonexistentReview.candidateRevision = nonexistentCandidate;
    for (const check of asArray(nonexistentState.orchestratorChecks)) {
      asRecord(check).revision = nonexistentCandidate;
    }
    writeBundleFiles(genuine.ticketDirectory, nonexistentBundle);
    const nonexistent = await captureValidatorRunInRepository(
      genuine.root,
      [genuine.ticketDirectory],
    );

    const brokenCandidate = asRecord(brokenTree.bundle.state)
      .candidateRevision as string;
    const brokenTreeRevision = runGit(brokenTree.root, [
      "show",
      "-s",
      "--format=%T",
      brokenCandidate,
    ]);
    const objectsRoot = await Deno.realPath(`${brokenTree.root}/.git/objects`);
    const brokenObject = await Deno.realPath(
      `${objectsRoot}/${brokenTreeRevision.slice(0, 2)}/${
        brokenTreeRevision.slice(2)
      }`,
    );
    if (!brokenObject.startsWith(`${objectsRoot}\\`)) {
      throw new Error("Git fixture object escaped its temporary repository");
    }
    Deno.removeSync(brokenObject);
    const brokenDiff = await captureValidatorRunInRepository(
      brokenTree.root,
      [brokenTree.ticketDirectory],
    );

    const diagnostics = [
      [wrongHash, "content_hash_mismatch"],
      [missingBlob, "content_missing"],
      [nonexistent, "revision_not_found"],
      [
        await captureValidatorRunInRepository(
          redProduction.root,
          [redProduction.ticketDirectory],
        ),
        "red_scope_violation",
      ],
      [
        await captureValidatorRunInRepository(
          staleCandidate.root,
          [staleCandidate.ticketDirectory],
        ),
        "ancestry_mismatch",
      ],
      [
        await captureValidatorRunInRepository(
          outsideCandidate.root,
          [outsideCandidate.ticketDirectory],
        ),
        "candidate_scope_violation",
      ],
      [
        await captureValidatorRunInRepository(
          oversizedRedTest.root,
          [oversizedRedTest.ticketDirectory],
        ),
        "git_output_limit",
      ],
      [
        await captureValidatorRunInRepository(
          excessivePaths.root,
          [excessivePaths.ticketDirectory],
        ),
        "git_output_limit",
      ],
      [
        await captureValidatorRunInRepository(
          excessiveOutput.root,
          [excessiveOutput.ticketDirectory],
        ),
        "git_output_limit",
      ],
      [brokenDiff, "git_output_limit"],
    ] as const;
    const missing = diagnostics.filter(([result, code]) =>
      result.exitCode === 0 || !result.output.includes(`"${code}"`)
    );
    if (
      genuineRun.exitCode !== 0 || exactAllowed.exitCode !== 0 ||
      integrated.exitCode !== 0 || missing.length > 0
    ) {
      throw new Error(
        `Expected genuine Git lineage and forged-evidence diagnostics; genuine=${genuineRun.output}; exact=${exactAllowed.output}; integrated=${integrated.output}; missing=${
          missing.map(([, code]) => code).join(",")
        }`,
      );
    }
  } finally {
    Deno.removeSync(genuine.root, { recursive: true });
    Deno.removeSync(redProduction.root, { recursive: true });
    Deno.removeSync(staleCandidate.root, { recursive: true });
    Deno.removeSync(outsideCandidate.root, { recursive: true });
    Deno.removeSync(oversizedRedTest.root, { recursive: true });
    Deno.removeSync(excessivePaths.root, { recursive: true });
    Deno.removeSync(excessiveOutput.root, { recursive: true });
    Deno.removeSync(brokenTree.root, { recursive: true });
  }
});

Deno.test("workflow tasks grant only the required Git subprocess permission", () => {
  const config = JSON.parse(
    Deno.readTextFileSync(new URL("../../deno.json", import.meta.url)),
  );
  const expected = [
    ["ticket:validate", "--allow-run=git"],
    ["test:workflow", "--allow-run=deno,git"],
    ["test:workflow:coverage", "--allow-run=deno,git"],
  ] as const;
  for (const [task, permission] of expected) {
    if (!String(config.tasks[task]).includes(permission)) {
      throw new Error(`Expected ${task} to include ${permission}`);
    }
  }
});

Deno.test("runTicketValidator requires exact complete evidence mappings", async () => {
  const fixture = await writeGitBundleDirectory();
  const directory = fixture.ticketDirectory;
  try {
    const run = () =>
      captureValidatorRunInRepository(fixture.root, [directory]);
    const complete = await run();

    Deno.removeSync(`${directory}/dispatch/round-01.md`);
    const missingDispatch = await run();
    writeRequiredEvidenceFiles(directory, fixture.bundle);

    Deno.removeSync(`${directory}/evidence/round-01-red.log`);
    const missingLog = await run();
    writeRequiredEvidenceFiles(directory, fixture.bundle);

    Deno.removeSync(`${directory}/acceptance.md`);
    const missingAcceptance = await run();
    writeRequiredEvidenceFiles(directory, fixture.bundle);

    const wrongPrefixBundle = structuredClone(fixture.bundle);
    asRecord(wrongPrefixBundle.state).resultRefs = ["evidence/ignored.json"];
    writeBundleFiles(directory, wrongPrefixBundle);
    const wrongPrefix = await run();

    const mismatchedRoundBundle = structuredClone(fixture.bundle);
    asRecord(mismatchedRoundBundle.state).resultRefs = [
      "results/round-02.json",
    ];
    writeBundleFiles(directory, mismatchedRoundBundle);
    Deno.writeTextFileSync(
      `${directory}/results/round-02.json`,
      `${JSON.stringify(asArray(mismatchedRoundBundle.results)[0], null, 2)}\n`,
    );
    const mismatchedRound = await run();

    writeBundleFiles(directory, fixture.bundle);
    Deno.removeSync(`${directory}/evidence/round-01-green.log`);
    Deno.mkdirSync(`${directory}/evidence/round-01-green.log`);
    const nonFileLog = await run();
    Deno.removeSync(`${directory}/evidence/round-01-green.log`, {
      recursive: true,
    });
    writeRequiredEvidenceFiles(directory, fixture.bundle);

    Deno.writeTextFileSync(
      `${directory}/evidence/round-01-refactor.log`,
      "x".repeat(1_000_001),
    );
    const oversizedLog = await run();
    writeRequiredEvidenceFiles(directory, fixture.bundle);

    const dispatchMismatchBundle = structuredClone(fixture.bundle);
    asRecord(asArray(dispatchMismatchBundle.results)[0]).dispatchRef =
      "dispatch/round-02.md";
    writeBundleFiles(directory, dispatchMismatchBundle);
    writeRequiredEvidenceFiles(directory, dispatchMismatchBundle);
    const dispatchMismatch = await run();

    const logMismatchBundle = structuredClone(fixture.bundle);
    asRecord(asRecord(asArray(logMismatchBundle.results)[0]).red).logRef =
      "evidence/round-02-red.log";
    writeBundleFiles(directory, logMismatchBundle);
    writeRequiredEvidenceFiles(directory, logMismatchBundle);
    const logMismatch = await run();

    const reviewMismatchBundle = structuredClone(fixture.bundle);
    asRecord(reviewMismatchBundle.state).reviewRefs = [
      "reviews/round-02.json",
    ];
    writeBundleFiles(directory, reviewMismatchBundle);
    Deno.writeTextFileSync(
      `${directory}/reviews/round-02.json`,
      `${JSON.stringify(asArray(reviewMismatchBundle.reviews)[0], null, 2)}\n`,
    );
    const reviewMismatch = await run();

    const eventMismatchBundle = structuredClone(fixture.bundle);
    asRecord(asArray(asRecord(eventMismatchBundle.state).events)[0])
      .evidenceRef = "acceptance.md";
    asRecord(asArray(eventMismatchBundle.events)[0]).evidenceRef =
      "acceptance.md";
    writeBundleFiles(directory, eventMismatchBundle);
    const eventMismatch = await run();

    const diagnostics = [
      [missingDispatch, "file_missing"],
      [missingLog, "file_missing"],
      [missingAcceptance, "file_missing"],
      [wrongPrefix, "invalid_reference"],
      [mismatchedRound, "reference_mismatch"],
      [nonFileLog, "file_missing"],
      [oversizedLog, "file_too_large"],
      [dispatchMismatch, "reference_mismatch"],
      [logMismatch, "reference_mismatch"],
      [reviewMismatch, "reference_mismatch"],
      [eventMismatch, "reference_mismatch"],
    ] as const;
    const missing = diagnostics.filter(([result, code]) =>
      result.exitCode === 0 || !result.output.includes(`"${code}"`)
    );
    if (complete.exitCode !== 0 || missing.length > 0) {
      throw new Error(
        `Expected complete evidence and exact mapping diagnostics; complete=${complete.output}; missing=${
          missing.map(([, code]) => code).join(",")
        }`,
      );
    }
  } finally {
    Deno.removeSync(fixture.root, { recursive: true });
  }
});

Deno.test("validateTicketBundle covers strict collection and record diagnostics", () => {
  const cases: Array<{
    readonly mutate: (bundle: Record<string, unknown>) => void;
    readonly path: string;
    readonly code: string;
  }> = [
    {
      mutate: (bundle) => void (delete asRecord(bundle.state).round),
      path: "$.state.round",
      code: "required_field",
    },
    {
      mutate: (bundle) => {
        const red = asRecord(asRecord(asArray(bundle.results)[0]).red);
        delete asRecord(asArray(red.testFiles)[0]).sha256;
      },
      path: "$.results[0].red.testFiles[0].sha256",
      code: "required_field",
    },
    {
      mutate: (bundle) => void (asRecord(bundle.state).round = 1.5),
      path: "$.state.round",
      code: "invalid_type",
    },
    {
      mutate: (bundle) => void (asRecord(bundle.ticket).allowedWrites = 42),
      path: "$.ticket.allowedWrites",
      code: "invalid_type",
    },
    {
      mutate: (bundle) => {
        asRecord(bundle.ticket).allowedWrites = [
          "tools/workflows/",
          "tools/workflows/",
        ];
      },
      path: "$.ticket.allowedWrites[1]",
      code: "duplicate_value",
    },
    {
      mutate: (bundle) => {
        asRecord(bundle.ticket).acceptanceCriteria = 42;
      },
      path: "$.ticket.acceptanceCriteria",
      code: "invalid_type",
    },
    {
      mutate: (bundle) => {
        asRecord(bundle.ticket).acceptanceCriteria = [];
      },
      path: "$.ticket.acceptanceCriteria",
      code: "evidence_required",
    },
    {
      mutate: (bundle) => {
        asRecord(asArray(asRecord(bundle.state).events)[0]).from = "unknown";
        asRecord(asArray(bundle.events)[0]).from = "unknown";
      },
      path: "$.state.events[0]",
      code: "invalid_value",
    },
    {
      mutate: (bundle) => {
        asRecord(asArray(bundle.results)[0]).schemaVersion = 2;
      },
      path: "$.results[0].schemaVersion",
      code: "invalid_value",
    },
    {
      mutate: (bundle) => {
        asRecord(asArray(bundle.results)[0]).refactor = 42;
      },
      path: "$.results[0].refactor",
      code: "invalid_type",
    },
    {
      mutate: (bundle) => {
        asRecord(asArray(bundle.reviews)[0]).schemaVersion = 2;
      },
      path: "$.reviews[0].schemaVersion",
      code: "invalid_value",
    },
    {
      mutate: (bundle) => {
        asRecord(asArray(bundle.reviews)[0]).commands = 42;
      },
      path: "$.reviews[0].commands",
      code: "invalid_type",
    },
    {
      mutate: (bundle) => {
        asRecord(asArray(bundle.reviews)[0]).findings = 42;
      },
      path: "$.reviews[0].findings",
      code: "invalid_type",
    },
    {
      mutate: (bundle) => {
        asRecord(asArray(bundle.reviews)[0]).verdict = "CHANGES_REQUESTED";
      },
      path: "$.reviews[0].verdict",
      code: "verdict_conflict",
    },
    {
      mutate: (bundle) => void (asRecord(bundle.state).schemaVersion = 2),
      path: "$.state.schemaVersion",
      code: "invalid_value",
    },
    {
      mutate: (bundle) => void (asRecord(bundle.state).phase = "unknown"),
      path: "$.state.phase",
      code: "invalid_value",
    },
    {
      mutate: (bundle) => void (asRecord(bundle.state).blocker = 42),
      path: "$.state.blocker",
      code: "invalid_type",
    },
    {
      mutate: (bundle) => {
        asRecord(bundle.state).dependencyRevisions = { UNKNOWN: 42 };
      },
      path: "$.state.dependencyRevisions.UNKNOWN",
      code: "unknown_reference",
    },
    {
      mutate: (bundle) => {
        asRecord(bundle.state).openFindingIds = ["WFR-001", "WFR-001"];
      },
      path: "$.state.openFindingIds[1]",
      code: "duplicate_value",
    },
    {
      mutate: (bundle) => void (asRecord(bundle.state).openFindingIds = 42),
      path: "$.state.openFindingIds",
      code: "invalid_type",
    },
    {
      mutate: (bundle) => void (asRecord(bundle.state).resultRefs = 42),
      path: "$.state.resultRefs",
      code: "invalid_type",
    },
    {
      mutate: (bundle) => void (asRecord(bundle.state).reviewRefs = 42),
      path: "$.state.reviewRefs",
      code: "invalid_type",
    },
    {
      mutate: (bundle) => {
        const checks = asArray(asRecord(bundle.state).orchestratorChecks);
        asRecord(checks[1]).command = asRecord(checks[0]).command;
      },
      path: "$.state.orchestratorChecks[1].command",
      code: "duplicate_value",
    },
    {
      mutate: (bundle) => {
        const checks = asArray(asRecord(bundle.state).orchestratorChecks);
        asRecord(checks[1]).runId = asRecord(checks[0]).runId;
      },
      path: "$.state.orchestratorChecks[1].runId",
      code: "duplicate_value",
    },
    {
      mutate: (bundle) => {
        asRecord(bundle.state).orchestratorChecks = 42;
      },
      path: "$.state.orchestratorChecks",
      code: "invalid_type",
    },
    {
      mutate: (bundle) => void (asRecord(bundle.state).ticketRevision = 2),
      path: "$.state.ticketRevision",
      code: "ticket_revision_mismatch",
    },
    {
      mutate: (bundle) => {
        asRecord(asArray(bundle.reviews)[0]).ticketId = "OTHER-001";
      },
      path: "$.reviews[0].ticketId",
      code: "ticket_mismatch",
    },
    {
      mutate: (bundle) => {
        asRecord(asArray(bundle.reviews)[0]).ticketRevision = 2;
      },
      path: "$.reviews[0].ticketRevision",
      code: "ticket_revision_mismatch",
    },
  ];
  for (const testCase of cases) {
    const bundle = validBundle();
    testCase.mutate(bundle);
    assertIssue(
      validateTicketBundle(bundle, AVAILABLE_TASKS),
      testCase.path,
      testCase.code,
    );
  }

  const commandObjectBundle = validBundle();
  asRecord(asArray(commandObjectBundle.reviews)[0]).commands = [{
    command: "deno task test:workflow",
    exitCode: 0,
  }];
  assertNoIssues(
    validateTicketBundle(commandObjectBundle, AVAILABLE_TASKS),
  );
});

Deno.test("runTicketValidator rejects malformed references and non-repositories", async () => {
  const malformedBundle = validBundle();
  asRecord(malformedBundle.state).resultRefs = [42];
  const malformedDirectory = writeBundleDirectory(malformedBundle);
  const nonRepositoryDirectory = writeBundleDirectory(validBundle());
  try {
    const malformed = await captureValidatorRun([malformedDirectory]);
    const nonRepository = await captureValidatorRun([nonRepositoryDirectory]);
    if (
      !malformed.output.includes('"invalid_type"') ||
      !nonRepository.output.includes('"repository_unavailable"')
    ) {
      throw new Error(
        `Expected malformed-reference and repository diagnostics: ${malformed.output}; ${nonRepository.output}`,
      );
    }
  } finally {
    Deno.removeSync(malformedDirectory, { recursive: true });
    Deno.removeSync(nonRepositoryDirectory, { recursive: true });
  }
});

const ROUND_TWO_RED_REVISION = "3333333333333333333333333333333333333333";
const ROUND_TWO_CANDIDATE_REVISION = "4444444444444444444444444444444444444444";
const UNRELATED_REVISION = "5555555555555555555555555555555555555555";

function reviewFinding(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "PILOT-001-REVIEW-001",
    lens: "bug_correctness",
    severity: "P2",
    location: "tools/workflows/ticket_contract.ts:validateReviews",
    expectedBehavior: "Review authority is validated before acceptance.",
    observedBehavior: "Review authority was accepted without validation.",
    reproduction: "Run the focused structural workflow test.",
    impact: "A ticket could be accepted without trustworthy review evidence.",
    affectedCriterion: "AC-01",
    contractRef: "AGENTS.md#mandatory-change-method",
    requiredRemediation: "Validate the complete review authority record.",
    verification: "The focused structural mutant is rejected.",
    status: "resolved",
    ...overrides,
  };
}

function validWaiver(): Record<string, unknown> {
  return {
    authority: "repository-owner-20260811",
    rationale: "The bounded P2 correctness risk is accepted temporarily.",
    owner: "workflow-maintainer",
    expiresAt: "2999-12-31T23:59:59.000Z",
  };
}

function missingIssue(
  issues: readonly ValidationIssue[],
  path: string,
  code: string,
): string | undefined {
  return issues.some((issue) => issue.path === path && issue.code === code)
    ? undefined
    : `Expected ${path}:${code}, received ${JSON.stringify(issues)}`;
}

function assertTableFailures(failures: readonly string[]): void {
  if (failures.length > 0) {
    throw new Error(failures.join("\n"));
  }
}

function preAcceptanceBundle(phase: "review" | "rework") {
  const bundle = validBundle();
  const state = asRecord(bundle.state);
  const stateEvents = asArray(state.events);
  state.phase = phase;
  state.acceptedCandidateRevision = null;
  state.orchestratorChecks = [];

  if (phase === "review") {
    stateEvents.pop();
    state.reviewRefs = [];
    bundle.reviews = [];
  } else {
    const review = asRecord(asArray(bundle.reviews)[0]);
    review.verdict = "CHANGES_REQUESTED";
    asRecord(asRecord(review.lenses).bug_correctness).verdict = "fail";
    review.findings = [reviewFinding({ status: "open" })];
    state.openFindingIds = ["PILOT-001-REVIEW-001"];
    const finalEvent = asRecord(stateEvents.at(-1));
    finalEvent.to = "rework";
    finalEvent.actorRunId = review.reviewerRunId;
    finalEvent.evidenceRef = "reviews/round-01.json";
  }

  bundle.events = structuredClone(stateEvents);
  return bundle;
}

function twoRoundAcceptedBundle(): Record<string, unknown> {
  const bundle = validBundle();
  const state = asRecord(bundle.state);
  const firstResult = asRecord(asArray(bundle.results)[0]);
  const firstReview = asRecord(asArray(bundle.reviews)[0]);

  firstReview.verdict = "CHANGES_REQUESTED";
  firstReview.commands = [{
    command: "deno task test:workflow",
    exitCode: 0,
  }];
  asRecord(asRecord(firstReview.lenses).bug_correctness).verdict = "fail";
  firstReview.findings = [reviewFinding()];

  const secondResult = structuredClone(firstResult);
  secondResult.round = 2;
  secondResult.implementerRunId = "implementer-round-02-20260811";
  secondResult.inputBaseRevision = CANDIDATE_REVISION;
  secondResult.dispatchRef = "dispatch/round-02.md";
  secondResult.redRevision = ROUND_TWO_RED_REVISION;
  asRecord(secondResult.red).logRef = "evidence/round-02-red.log";
  asRecord(secondResult.green).logRef = "evidence/round-02-green.log";
  asRecord(secondResult.refactor).logRef = "evidence/round-02-refactor.log";
  secondResult.candidateRevision = ROUND_TWO_CANDIDATE_REVISION;

  const secondReview = structuredClone(
    asRecord(asArray(validBundle().reviews)[0]),
  );
  secondReview.round = 2;
  secondReview.implementerRunId = secondResult.implementerRunId;
  secondReview.reviewerRunId = "reviewer-round-02-20260811";
  secondReview.candidateRevision = ROUND_TWO_CANDIDATE_REVISION;
  secondReview.commands = [{
    command: "deno task test:workflow:coverage",
    exitCode: 0,
  }];

  const events: Record<string, unknown>[] = [
    ...validEvents().slice(0, 5),
    {
      sequence: 6,
      from: "review",
      to: "rework",
      round: 1,
      actorRunId: firstReview.reviewerRunId,
      evidenceRef: "reviews/round-01.json",
      revision: CANDIDATE_REVISION,
    },
    {
      sequence: 7,
      from: "rework",
      to: "red",
      round: 2,
      actorRunId: secondResult.implementerRunId,
      evidenceRef: "evidence/round-02-red.log",
      revision: ROUND_TWO_RED_REVISION,
    },
    {
      sequence: 8,
      from: "red",
      to: "green",
      round: 2,
      actorRunId: secondResult.implementerRunId,
      evidenceRef: "evidence/round-02-green.log",
      revision: ROUND_TWO_CANDIDATE_REVISION,
    },
    {
      sequence: 9,
      from: "green",
      to: "refactor",
      round: 2,
      actorRunId: secondResult.implementerRunId,
      evidenceRef: "evidence/round-02-refactor.log",
      revision: ROUND_TWO_CANDIDATE_REVISION,
    },
    {
      sequence: 10,
      from: "refactor",
      to: "review",
      round: 2,
      actorRunId: "orchestrator-review-round-02-20260811",
      evidenceRef: "results/round-02.json",
      revision: ROUND_TWO_CANDIDATE_REVISION,
    },
    {
      sequence: 11,
      from: "review",
      to: "accepted",
      round: 2,
      actorRunId: "orchestrator-accept-round-02-20260811",
      evidenceRef: "acceptance.md",
      revision: ROUND_TWO_CANDIDATE_REVISION,
    },
  ];

  state.phase = "accepted";
  state.round = 2;
  state.candidateRevision = ROUND_TWO_CANDIDATE_REVISION;
  state.acceptedCandidateRevision = ROUND_TWO_CANDIDATE_REVISION;
  state.events = events;
  state.resultRefs = ["results/round-01.json", "results/round-02.json"];
  state.reviewRefs = ["reviews/round-01.json", "reviews/round-02.json"];
  for (const check of asArray(state.orchestratorChecks)) {
    asRecord(check).revision = ROUND_TWO_CANDIDATE_REVISION;
  }
  bundle.events = structuredClone(events);
  bundle.results = [firstResult, secondResult];
  bundle.reviews = [firstReview, secondReview];
  return bundle;
}

Deno.test("PILOT-001-R2-001 permits structurally valid review and rework before acceptance", () => {
  const failures = (["review", "rework"] as const).flatMap((phase) => {
    const issues = validateTicketBundle(
      preAcceptanceBundle(phase),
      AVAILABLE_TASKS,
    );
    return issues.length === 0 ? [] : [{ phase, issues }];
  });
  if (failures.length > 0) {
    throw new Error(
      `Expected pre-acceptance phases to be structurally valid: ${
        JSON.stringify(failures)
      }`,
    );
  }
});

Deno.test("PILOT-001-R2-002 validates a chained per-round input base", () => {
  const failures: string[] = [];
  const chained = twoRoundAcceptedBundle();
  const chainedIssues = validateTicketBundle(chained, AVAILABLE_TASKS);
  if (chainedIssues.length > 0) {
    failures.push(`Valid chain was rejected: ${JSON.stringify(chainedIssues)}`);
  }

  const broken = twoRoundAcceptedBundle();
  asRecord(asArray(broken.results)[1]).inputBaseRevision = UNRELATED_REVISION;
  const missing = missingIssue(
    validateTicketBundle(broken, AVAILABLE_TASKS),
    "$.results[1].inputBaseRevision",
    "round_chain_mismatch",
  );
  if (missing !== undefined) failures.push(missing);
  assertTableFailures(failures);
});

Deno.test("PILOT-001-R2-006 requires explicit not-applicable agreement", () => {
  const failures: string[] = [];
  const agreed = validBundle();
  const agreedLens = asRecord(
    asRecord(asRecord(asArray(agreed.reviews)[0]).lenses).security_privacy,
  );
  agreedLens.verdict = "not_applicable";
  agreedLens.notApplicableAgreement = {
    orchestratorRunId: "orchestrator-scope-agreement-20260811",
    scopeOrContractRef: "AGENTS.md#mandatory-change-method",
    rationale: "The ticket processes public synthetic workflow metadata only.",
  };
  const agreedIssues = validateTicketBundle(agreed, AVAILABLE_TASKS);
  if (agreedIssues.length > 0) {
    failures.push(
      `Explicit agreement was rejected: ${JSON.stringify(agreedIssues)}`,
    );
  }

  const unsupported = validBundle();
  asRecord(
    asRecord(asRecord(asArray(unsupported.reviews)[0]).lenses)
      .security_privacy,
  ).verdict = "not_applicable";
  const missing = missingIssue(
    validateTicketBundle(unsupported, AVAILABLE_TASKS),
    "$.reviews[0].lenses.security_privacy.notApplicableAgreement",
    "agreement_required",
  );
  if (missing !== undefined) failures.push(missing);

  for (
    const field of [
      "orchestratorRunId",
      "scopeOrContractRef",
      "rationale",
    ] as const
  ) {
    const incomplete = validBundle();
    const agreement: Record<string, unknown> = {
      orchestratorRunId: "orchestrator-scope-agreement-20260811",
      scopeOrContractRef: "AGENTS.md#mandatory-change-method",
      rationale: "The lens is outside the declared workflow scope.",
    };
    delete agreement[field];
    const lens = asRecord(
      asRecord(asRecord(asArray(incomplete.reviews)[0]).lenses)
        .security_privacy,
    );
    lens.verdict = "not_applicable";
    lens.notApplicableAgreement = agreement;
    const missingField = missingIssue(
      validateTicketBundle(incomplete, AVAILABLE_TASKS),
      `$.reviews[0].lenses.security_privacy.notApplicableAgreement.${field}`,
      "required_field",
    );
    if (missingField !== undefined) failures.push(missingField);
  }

  const unknownCitation = validBundle();
  const unknownCitationLens = asRecord(
    asRecord(asRecord(asArray(unknownCitation.reviews)[0]).lenses)
      .security_privacy,
  );
  unknownCitationLens.verdict = "not_applicable";
  unknownCitationLens.notApplicableAgreement = {
    orchestratorRunId: "orchestrator-scope-agreement-20260811",
    scopeOrContractRef: "docs/unknown-contract.md",
    rationale: "The lens is outside the declared workflow scope.",
  };
  const missingCitation = missingIssue(
    validateTicketBundle(unknownCitation, AVAILABLE_TASKS),
    "$.reviews[0].lenses.security_privacy.notApplicableAgreement.scopeOrContractRef",
    "unknown_reference",
  );
  if (missingCitation !== undefined) failures.push(missingCitation);
  assertTableFailures(failures);
});

Deno.test("PILOT-001-R2-006 requires complete unexpired waiver authority", () => {
  const failures: string[] = [];
  const valid = validBundle();
  asRecord(asArray(valid.reviews)[0]).findings = [reviewFinding({
    status: "waived",
    waiver: validWaiver(),
  })];
  const validIssues = validateTicketBundle(valid, AVAILABLE_TASKS);
  if (validIssues.length > 0) {
    failures.push(`Valid waiver was rejected: ${JSON.stringify(validIssues)}`);
  }

  const cases = [
    ["authority", "required_field"],
    ["rationale", "required_field"],
    ["owner", "required_field"],
    ["expiresAt", "required_field"],
  ] as const;
  for (const [field, code] of cases) {
    const bundle = validBundle();
    const waiver = validWaiver();
    delete waiver[field];
    asRecord(asArray(bundle.reviews)[0]).findings = [reviewFinding({
      status: "waived",
      waiver,
    })];
    const missing = missingIssue(
      validateTicketBundle(bundle, AVAILABLE_TASKS),
      `$.reviews[0].findings[0].waiver.${field}`,
      code,
    );
    if (missing !== undefined) failures.push(missing);
  }

  const expired = validBundle();
  asRecord(asArray(expired.reviews)[0]).findings = [reviewFinding({
    status: "waived",
    waiver: {
      ...validWaiver(),
      expiresAt: "2000-01-01T00:00:00.000Z",
    },
  })];
  const missing = missingIssue(
    validateTicketBundle(expired, AVAILABLE_TASKS),
    "$.reviews[0].findings[0].waiver.expiresAt",
    "waiver_expired",
  );
  if (missing !== undefined) failures.push(missing);
  assertTableFailures(failures);
});

Deno.test("PILOT-001-R2-006 rejects non-waivable findings", () => {
  const failures: string[] = [];
  const cases = [
    { severity: "P0", lens: "bug_correctness" },
    { severity: "P1", lens: "bug_correctness" },
    { severity: "P2", lens: "security_privacy" },
    { severity: "P2", lens: "architecture_contracts" },
    { severity: "P2", lens: "tests_tdd" },
  ] as const;
  for (const testCase of cases) {
    const bundle = validBundle();
    asRecord(asArray(bundle.reviews)[0]).findings = [reviewFinding({
      ...testCase,
      status: "waived",
      waiver: validWaiver(),
    })];
    const missing = missingIssue(
      validateTicketBundle(bundle, AVAILABLE_TASKS),
      "$.reviews[0].findings[0].status",
      "waiver_forbidden",
    );
    if (missing !== undefined) {
      failures.push(`${JSON.stringify(testCase)}: ${missing}`);
    }
  }
  assertTableFailures(failures);
});

Deno.test("PILOT-001-R2-011 enforces maximum and contiguous rounds", () => {
  const failures: string[] = [];
  const cases: Array<{
    readonly mutate: (bundle: Record<string, unknown>) => void;
    readonly path: string;
    readonly code: string;
  }> = [
    {
      mutate: (bundle) => void (asRecord(bundle.ticket).maxRounds = 1),
      path: "$.state.round",
      code: "round_limit_exceeded",
    },
    {
      mutate: (bundle) => {
        asRecord(bundle.state).round = 3;
        asRecord(asArray(bundle.results)[1]).round = 3;
        asRecord(asArray(bundle.reviews)[1]).round = 3;
        for (const event of asArray(asRecord(bundle.state).events).slice(6)) {
          asRecord(event).round = 3;
        }
        bundle.events = structuredClone(asRecord(bundle.state).events);
      },
      path: "$.results[1].round",
      code: "round_sequence",
    },
  ];
  for (const testCase of cases) {
    const bundle = twoRoundAcceptedBundle();
    testCase.mutate(bundle);
    const missing = missingIssue(
      validateTicketBundle(bundle, AVAILABLE_TASKS),
      testCase.path,
      testCase.code,
    );
    if (missing !== undefined) failures.push(missing);
  }
  assertTableFailures(failures);
});

Deno.test("PILOT-001-R2-011 binds every event to exact round revisions and actors", () => {
  const failures: string[] = [];
  const revisionCases = [0, 1, 2, 3, 4, 5] as const;
  for (const index of revisionCases) {
    const bundle = validBundle();
    asRecord(asArray(asRecord(bundle.state).events)[index]).revision =
      UNRELATED_REVISION;
    bundle.events = structuredClone(asRecord(bundle.state).events);
    const missing = missingIssue(
      validateTicketBundle(bundle, AVAILABLE_TASKS),
      `$.state.events[${index}].revision`,
      "revision_mismatch",
    );
    if (missing !== undefined) failures.push(missing);
  }

  const wrongRound = validBundle();
  const stateEvents = asArray(asRecord(wrongRound.state).events);
  asRecord(stateEvents[1]).round = 2;
  asRecord(stateEvents[1]).actorRunId = "unbound-implementer";
  wrongRound.events = structuredClone(stateEvents);
  const missingRound = missingIssue(
    validateTicketBundle(wrongRound, AVAILABLE_TASKS),
    "$.state.events[1].round",
    "round_mismatch",
  );
  if (missingRound !== undefined) failures.push(missingRound);

  const wrongReviewer = twoRoundAcceptedBundle();
  const reworkEvent = asRecord(
    asArray(asRecord(wrongReviewer.state).events)[5],
  );
  reworkEvent.actorRunId = "different-reviewer";
  wrongReviewer.events = structuredClone(asRecord(wrongReviewer.state).events);
  const missingReviewer = missingIssue(
    validateTicketBundle(wrongReviewer, AVAILABLE_TASKS),
    "$.state.events[5].actorRunId",
    "run_mismatch",
  );
  if (missingReviewer !== undefined) failures.push(missingReviewer);
  assertTableFailures(failures);
});

Deno.test("PILOT-001-R2-012 requires passing unique approved-review commands", () => {
  const failures: string[] = [];
  const valid = validBundle();
  asRecord(asArray(valid.reviews)[0]).commands = [{
    command: "deno task test:workflow:coverage",
    exitCode: 0,
  }];
  const validIssues = validateTicketBundle(valid, AVAILABLE_TASKS);
  if (validIssues.length > 0) {
    failures.push(
      `Valid approved commands were rejected: ${JSON.stringify(validIssues)}`,
    );
  }

  const cases: Array<{
    readonly commands: unknown[];
    readonly path: string;
    readonly code: string;
  }> = [
    {
      commands: [],
      path: "$.reviews[0].commands",
      code: "evidence_required",
    },
    {
      commands: [
        { command: "deno task test:workflow", exitCode: 0 },
        { command: "deno task test:workflow", exitCode: 0 },
      ],
      path: "$.reviews[0].commands[1].command",
      code: "duplicate_value",
    },
    {
      commands: [{ command: "deno task test:workflow", exitCode: 1 }],
      path: "$.reviews[0].commands[0].exitCode",
      code: "review_command_failed",
    },
    {
      commands: ["deno task test:workflow"],
      path: "$.reviews[0].commands[0]",
      code: "invalid_type",
    },
  ];
  for (const testCase of cases) {
    const bundle = validBundle();
    asRecord(asArray(bundle.reviews)[0]).commands = testCase.commands;
    const missing = missingIssue(
      validateTicketBundle(bundle, AVAILABLE_TASKS),
      testCase.path,
      testCase.code,
    );
    if (missing !== undefined) failures.push(missing);
  }
  assertTableFailures(failures);
});
