import {
  validateTicketBundle,
  type ValidationIssue,
} from "./ticket_contract.ts";

const BASE_REVISION = "9d4693e1335797f1ecf98c4515ddba8e2603d8fb";
const RED_REVISION = "1111111111111111111111111111111111111111";
const CANDIDATE_REVISION = "2222222222222222222222222222222222222222";

const EVENTS = [
  {
    sequence: 1,
    from: "planned",
    to: "ready",
    round: 0,
    actorRunId: "orchestrator-ready-20260811",
  },
  {
    sequence: 2,
    from: "ready",
    to: "red",
    round: 1,
    actorRunId: "implementer-round-01-20260811",
  },
  {
    sequence: 3,
    from: "red",
    to: "green",
    round: 1,
    actorRunId: "implementer-round-01-20260811",
  },
  {
    sequence: 4,
    from: "green",
    to: "refactor",
    round: 1,
    actorRunId: "implementer-round-01-20260811",
  },
  {
    sequence: 5,
    from: "refactor",
    to: "review",
    round: 1,
    actorRunId: "orchestrator-review-20260811",
  },
  {
    sequence: 6,
    from: "review",
    to: "accepted",
    round: 1,
    actorRunId: "orchestrator-accept-20260811",
  },
] as const;

const VALID_BUNDLE = {
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
    requiredTasks: [
      "fmt:check",
      "lint",
      "check",
      "test:workflow",
      "test:workflow:coverage",
      "ticket:validate",
      "test:schema:matrix",
    ],
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
    events: EVENTS,
    resultRefs: ["results/round-01.json"],
    reviewRefs: ["reviews/round-01.json"],
    openFindingIds: [],
    orchestratorChecks: [
      {
        runId: "orchestrator-checks-20260811",
        revision: CANDIDATE_REVISION,
        command: "deno task test:workflow",
        exitCode: 0,
      },
    ],
    acceptedCandidateRevision: CANDIDATE_REVISION,
    blocker: null,
  },
  events: EVENTS,
  results: [{
    schemaVersion: 1,
    ticketId: "PILOT-001",
    ticketRevision: 1,
    round: 1,
    implementerRunId: "implementer-round-01-20260811",
    baseRevision: BASE_REVISION,
    redRevision: RED_REVISION,
    candidateRevision: CANDIDATE_REVISION,
    red: {
      command: "deno test tools/workflows/validate_ticket_test.ts",
      exitCode: 1,
      intendedAssertion: "A complete valid bundle yields zero issues.",
      output: "Expected zero issues; received not_implemented.",
      testFiles: [{
        path: "tools/workflows/validate_ticket_test.ts",
        sha256:
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }],
      productionFiles: [],
    },
    green: {
      command: "deno test tools/workflows/validate_ticket_test.ts",
      exitCode: 0,
      output: "1 passed; 0 failed.",
    },
    refactor: {
      command: "deno test tools/workflows/validate_ticket_test.ts",
      exitCode: 0,
      output: "1 passed; 0 failed.",
    },
    changedTestFiles: ["tools/workflows/validate_ticket_test.ts"],
    changedProductionFiles: ["tools/workflows/ticket_contract.ts"],
  }],
  reviews: [{
    schemaVersion: 1,
    ticketId: "PILOT-001",
    ticketRevision: 1,
    round: 1,
    reviewerRunId: "reviewer-round-01-20260811",
    candidateRevision: CANDIDATE_REVISION,
    lenses: [
      { id: "bugs_correctness", evidence: "No correctness defects found." },
      {
        id: "security_privacy",
        evidence: "No security or privacy defects found.",
      },
      {
        id: "architecture_contracts",
        evidence: "Accepted boundaries are preserved.",
      },
      {
        id: "performance_reliability",
        evidence: "Validation is bounded and deterministic.",
      },
      {
        id: "style_maintainability",
        evidence: "The implementation is maintainable.",
      },
      {
        id: "tests_tdd",
        evidence: "RED, GREEN, and REFACTOR evidence is complete.",
      },
    ],
    findings: [],
    notes: [],
  }],
} as const;

const AVAILABLE_TASKS = new Set([
  "fmt:check",
  "lint",
  "check",
  "test:workflow",
  "test:workflow:coverage",
  "ticket:validate",
  "test:schema:matrix",
]);

function assertNoIssues(issues: readonly ValidationIssue[]): void {
  if (issues.length !== 0) {
    throw new Error(
      `Expected a complete valid bundle to yield zero issues, received ${
        JSON.stringify(issues)
      }`,
    );
  }
}

Deno.test("validateTicketBundle accepts one complete valid bundle", () => {
  assertNoIssues(validateTicketBundle(VALID_BUNDLE, AVAILABLE_TASKS));
});
