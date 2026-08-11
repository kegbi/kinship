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
      evidenceRef: "reviews/round-01.json",
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
      commands: ["deno task test:workflow:coverage"],
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

function writeBundleDirectory(bundle: Record<string, unknown>): string {
  const directory = Deno.makeTempDirSync({ prefix: "ticket-validator-" });
  Deno.mkdirSync(`${directory}/results`);
  Deno.mkdirSync(`${directory}/reviews`);
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

function captureValidatorRun(args: readonly string[]): {
  readonly exitCode: number;
  readonly output: string;
} {
  const lines: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  const capture = (...values: unknown[]): void => {
    lines.push(values.map(String).join(" "));
  };
  console.log = capture;
  console.error = capture;
  try {
    return { exitCode: runTicketValidator(args), output: lines.join("\n") };
  } finally {
    console.log = originalLog;
    console.error = originalError;
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

Deno.test("runTicketValidator accepts a complete temporary ticket directory", () => {
  const directory = writeBundleDirectory(validBundle());
  try {
    const result = captureValidatorRun([directory]);
    if (result.exitCode !== 0) {
      throw new Error(
        `Expected CLI exit 0 for a valid directory, received ${result.exitCode}: ${result.output}`,
      );
    }
    if (!result.output.includes('"ok":true')) {
      throw new Error(`Expected safe success JSON, received ${result.output}`);
    }
  } finally {
    Deno.removeSync(directory, { recursive: true });
  }
});

Deno.test("runTicketValidator rejects missing and malformed files safely", () => {
  const missingDirectory = Deno.makeTempDirSync({
    prefix: "ticket-validator-missing-",
  });
  const malformedDirectory = Deno.makeTempDirSync({
    prefix: "ticket-validator-malformed-",
  });
  try {
    const missing = captureValidatorRun([missingDirectory]);
    if (missing.exitCode === 0 || !missing.output.includes('"file_missing"')) {
      throw new Error(
        `Expected a file_missing diagnostic, received ${missing.output}`,
      );
    }

    Deno.writeTextFileSync(
      `${malformedDirectory}/ticket.json`,
      '{"token":"do-not-echo"',
    );
    const malformed = captureValidatorRun([malformedDirectory]);
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

Deno.test("runTicketValidator rejects an invalid invocation deterministically", () => {
  const result = captureValidatorRun([]);
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

Deno.test("runTicketValidator bounds files and ledger input", () => {
  const oversizedDirectory = Deno.makeTempDirSync({
    prefix: "ticket-validator-oversized-",
  });
  const ledgerDirectory = writeBundleDirectory(validBundle());
  try {
    Deno.writeTextFileSync(
      `${oversizedDirectory}/ticket.json`,
      "x".repeat(1_000_001),
    );
    const oversized = captureValidatorRun([oversizedDirectory]);
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
    const ledger = captureValidatorRun([ledgerDirectory]);
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

Deno.test("runTicketValidator rejects malformed ledger lines and missing references", () => {
  const malformedDirectory = writeBundleDirectory(validBundle());
  const missingReferenceDirectory = writeBundleDirectory(validBundle());
  try {
    Deno.writeTextFileSync(`${malformedDirectory}/events.jsonl`, "not-json\n");
    const malformed = captureValidatorRun([malformedDirectory]);
    if (
      malformed.exitCode === 0 ||
      !malformed.output.includes('"malformed_json"')
    ) {
      throw new Error(
        `Expected a malformed ledger diagnostic: ${malformed.output}`,
      );
    }

    Deno.removeSync(`${missingReferenceDirectory}/results/round-01.json`);
    const missing = captureValidatorRun([missingReferenceDirectory]);
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

Deno.test("runTicketValidator never follows unsafe evidence references", () => {
  const bundle = validBundle();
  asRecord(bundle.state).resultRefs = ["../outside.json"];
  const directory = writeBundleDirectory(bundle);
  try {
    const result = captureValidatorRun([directory]);
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

Deno.test("runTicketValidator handles non-files and unreadable paths safely", () => {
  const directory = Deno.makeTempDirSync({
    prefix: "ticket-validator-nonfile-",
  });
  try {
    Deno.mkdirSync(`${directory}/ticket.json`);
    const nonFile = captureValidatorRun([directory]);
    if (nonFile.exitCode === 0 || !nonFile.output.includes('"file_missing"')) {
      throw new Error(
        `Expected a non-file diagnostic, received ${nonFile.output}`,
      );
    }

    const unreadable = captureValidatorRun(["\0"]);
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

Deno.test("runTicketValidator rejects malformed root task configuration", () => {
  const directory = writeBundleDirectory(validBundle());
  const fakeRoot = Deno.makeTempDirSync({ prefix: "ticket-validator-config-" });
  const originalDirectory = Deno.cwd();
  try {
    Deno.writeTextFileSync(`${fakeRoot}/deno.json`, "{}\n");
    Deno.chdir(fakeRoot);
    const result = captureValidatorRun([directory]);
    if (result.exitCode === 0 || !result.output.includes('"invalid_type"')) {
      throw new Error(`Expected a tasks diagnostic, received ${result.output}`);
    }
  } finally {
    Deno.chdir(originalDirectory);
    Deno.removeSync(directory, { recursive: true });
    Deno.removeSync(fakeRoot, { recursive: true });
  }
});

Deno.test("runTicketValidator maps unexpected failures without a stack", () => {
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
    const exitCode = runTicketValidator([directory]);
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

Deno.test("validate_ticket CLI entry point exits zero for a valid directory", () => {
  const directory = writeBundleDirectory(validBundle());
  try {
    const result = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-read",
        "tools/workflows/validate_ticket.ts",
        directory,
      ],
      cwd: new URL("../../", import.meta.url),
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
    Deno.removeSync(directory, { recursive: true });
  }
});
