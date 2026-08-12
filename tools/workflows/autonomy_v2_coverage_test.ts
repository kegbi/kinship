import {
  validateTicketBundle,
  type ValidationIssue,
} from "./ticket_contract.ts";
import { runTicketValidator } from "./validate_ticket.ts";

type JsonRecord = Record<string, unknown>;

const TICKET_ID = "COVERAGE-001";
const TASK_NAME = "check";
const TASK_DEFINITION = "echo";
const AVAILABLE_TASKS = new Set([TASK_NAME]);
const REVISION = "1".repeat(40);
const CONTROLLER_RUN_ID =
  `${TICKET_ID}/orchestrator/r0/00000000-0000-4000-8000-000000000001`;
const IMPLEMENTER_RUN_ID =
  `${TICKET_ID}/implementer/r1/00000000-0000-4000-8000-000000000002`;
const REVIEWER_RUN_ID =
  `${TICKET_ID}/reviewer/r1/00000000-0000-4000-8000-000000000003`;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface GitFixture {
  readonly root: string;
  readonly ticketDirectory: string;
}

interface ValidatorRun {
  readonly exitCode: number;
  readonly issues: readonly ValidationIssue[];
}

function asRecord(value: unknown): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected an object fixture value");
  }
  return value as JsonRecord;
}

function baseTicket(): JsonRecord {
  return {
    schemaVersion: 2,
    ticketId: TICKET_ID,
    revision: 1,
    title: "Cover defensive autonomous validation branches",
    outcome: "Malformed control evidence is rejected deterministically.",
    baseRevision: REVISION,
    controllerRunId: CONTROLLER_RUN_ID,
    executionClass: "ordinary",
    protectedWriteAuthorization: null,
    dependencies: [],
    maxRounds: 1,
    scope: ["Workflow validation"],
    nonGoals: ["Application behavior"],
    allowedWrites: ["tools/workflows/"],
    contractRefs: ["docs/planning/tickets/AUTONOMY-001/contract.md"],
    acceptanceCriteria: [{
      id: "AC-01",
      text: "Reject malformed autonomous control evidence.",
      redProof: "Coverage fixtures exercise defensive diagnostics.",
    }],
    requiredTasks: {
      baseline: [{ name: TASK_NAME, definition: TASK_DEFINITION }],
      candidate: [{
        name: TASK_NAME,
        definition: TASK_DEFINITION,
        guardedBy: null,
      }],
    },
    risks: ["Malformed evidence could evade a workflow gate"],
    unresolvedDecisions: [],
  };
}

function ticketOnlyBundle(ticket: JsonRecord): JsonRecord {
  return {
    ticket,
    state: null,
    events: [],
    results: [],
    reviews: [],
  };
}

function assertIssue(
  issues: readonly ValidationIssue[],
  path: string,
  code: string,
): void {
  if (!issues.some((entry) => entry.path === path && entry.code === code)) {
    throw new Error(
      `Expected ${path} ${code}, received ${JSON.stringify(issues)}`,
    );
  }
}

Deno.test("AUTONOMY-001 coverage rejects malformed v2 task records", () => {
  const nonArrayTicket = baseTicket();
  nonArrayTicket.requiredTasks = {
    baseline: "not-an-array",
  };
  let issues = validateTicketBundle(
    ticketOnlyBundle(nonArrayTicket),
    AVAILABLE_TASKS,
  );
  assertIssue(
    issues,
    "$.ticket.requiredTasks.baseline",
    "invalid_type",
  );

  const malformedRecordsTicket = baseTicket();
  malformedRecordsTicket.requiredTasks = {
    baseline: [
      null,
      { name: TASK_NAME, definition: TASK_DEFINITION },
      { name: TASK_NAME, definition: TASK_DEFINITION },
      { name: "missing", definition: TASK_DEFINITION },
    ],
    candidate: [
      {
        name: TASK_NAME,
        definition: TASK_DEFINITION,
        guardedBy: null,
      },
      {
        name: "missing",
        definition: TASK_DEFINITION,
        guardedBy: null,
      },
    ],
  };
  issues = validateTicketBundle(
    ticketOnlyBundle(malformedRecordsTicket),
    AVAILABLE_TASKS,
  );
  assertIssue(issues, "$.ticket.requiredTasks.baseline[0]", "invalid_type");
  assertIssue(
    issues,
    "$.ticket.requiredTasks.baseline[2].name",
    "duplicate_value",
  );
  assertIssue(
    issues,
    "$.ticket.requiredTasks.baseline[3].name",
    "task_missing",
  );

  const mismatchedTicket = baseTicket();
  mismatchedTicket.requiredTasks = {
    baseline: [{ name: TASK_NAME, definition: TASK_DEFINITION }],
    candidate: [{
      name: "missing",
      definition: TASK_DEFINITION,
      guardedBy: null,
    }],
  };
  issues = validateTicketBundle(
    ticketOnlyBundle(mismatchedTicket),
    new Set([TASK_NAME, "missing"]),
  );
  assertIssue(
    issues,
    "$.ticket.requiredTasks.candidate",
    "task_set_mismatch",
  );

  const unnamedCandidateTicket = baseTicket();
  unnamedCandidateTicket.requiredTasks = {
    baseline: [{ name: TASK_NAME, definition: TASK_DEFINITION }],
    candidate: [null],
  };
  validateTicketBundle(
    {
      ticket: unnamedCandidateTicket,
      state: {},
      events: [],
      results: [],
      reviews: [],
    },
    AVAILABLE_TASKS,
  );
});

Deno.test("AUTONOMY-001 coverage rejects residual v2 authority shapes", () => {
  const unauthorizedOrdinaryTicket = baseTicket();
  unauthorizedOrdinaryTicket.protectedWriteAuthorization = {};
  let issues = validateTicketBundle(
    ticketOnlyBundle(unauthorizedOrdinaryTicket),
    AVAILABLE_TASKS,
  );
  assertIssue(
    issues,
    "$.ticket.protectedWriteAuthorization",
    "authorization_forbidden",
  );

  const nonStringAllowedWriteTicket = baseTicket();
  nonStringAllowedWriteTicket.allowedWrites = [42];
  validateTicketBundle(
    ticketOnlyBundle(nonStringAllowedWriteTicket),
    AVAILABLE_TASKS,
  );

  const malformedAuthorizationTicket = baseTicket();
  malformedAuthorizationTicket.executionClass = "protected-config-maintenance";
  malformedAuthorizationTicket.allowedWrites = [42];
  malformedAuthorizationTicket.protectedWriteAuthorization = {
    authorizedByControllerRunId: CONTROLLER_RUN_ID,
    paths: [42],
    contractRef: "docs/planning/tickets/AUTONOMY-001/contract.md",
    rationale: "Exercise malformed protected paths.",
  };
  validateTicketBundle(
    ticketOnlyBundle(malformedAuthorizationTicket),
    AVAILABLE_TASKS,
  );

  const nonArrayAuthorizationTicket = baseTicket();
  nonArrayAuthorizationTicket.executionClass = "protected-config-maintenance";
  nonArrayAuthorizationTicket.allowedWrites = null;
  nonArrayAuthorizationTicket.protectedWriteAuthorization = {
    authorizedByControllerRunId: CONTROLLER_RUN_ID,
    paths: null,
    contractRef: "docs/planning/tickets/AUTONOMY-001/contract.md",
    rationale: "Exercise non-array protected paths.",
  };
  validateTicketBundle(
    ticketOnlyBundle(nonArrayAuthorizationTicket),
    AVAILABLE_TASKS,
  );

  const unsupportedTicket = baseTicket();
  unsupportedTicket.schemaVersion = 3;
  issues = validateTicketBundle(
    ticketOnlyBundle(unsupportedTicket),
    AVAILABLE_TASKS,
  );
  assertIssue(issues, "$.ticket.schemaVersion", "invalid_value");

  const legacyTicketWithNonStringId = baseTicket();
  legacyTicketWithNonStringId.schemaVersion = 1;
  legacyTicketWithNonStringId.ticketId = 42;
  validateTicketBundle(
    ticketOnlyBundle(legacyTicketWithNonStringId),
    AVAILABLE_TASKS,
  );
});

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

function writeJson(root: string, relativePath: string, value: unknown): void {
  writeText(root, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

function runGitBytes(root: string, args: readonly string[]): Uint8Array {
  const output = new Deno.Command("git", {
    args: [...args],
    cwd: root,
    stdout: "piped",
    stderr: "piped",
  }).outputSync();
  if (!output.success) {
    throw new Error(
      `Git fixture command failed (${args.join(" ")}): ${
        decoder.decode(output.stderr).trim()
      }`,
    );
  }
  return output.stdout;
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

function taskDefinitions(): JsonRecord {
  return {
    baseline: [{ name: TASK_NAME, definition: TASK_DEFINITION }],
    candidate: [{
      name: TASK_NAME,
      definition: TASK_DEFINITION,
      guardedBy: null,
    }],
  };
}

function lifecycleEvents(
  baseRevision: string,
  redRevision: string,
  candidateRevision: string,
  integrationRevision?: string,
): JsonRecord[] {
  const events: JsonRecord[] = [
    {
      sequence: 1,
      from: "planned",
      to: "ready",
      round: 0,
      actorRunId: CONTROLLER_RUN_ID,
      evidenceRef: "ticket.json",
      revision: baseRevision,
    },
    {
      sequence: 2,
      from: "ready",
      to: "red",
      round: 1,
      actorRunId: IMPLEMENTER_RUN_ID,
      evidenceRef: "evidence/round-01-red.log",
      revision: redRevision,
    },
    {
      sequence: 3,
      from: "red",
      to: "green",
      round: 1,
      actorRunId: IMPLEMENTER_RUN_ID,
      evidenceRef: "evidence/round-01-green.log",
      revision: candidateRevision,
    },
    {
      sequence: 4,
      from: "green",
      to: "refactor",
      round: 1,
      actorRunId: IMPLEMENTER_RUN_ID,
      evidenceRef: "evidence/round-01-refactor.log",
      revision: candidateRevision,
    },
    {
      sequence: 5,
      from: "refactor",
      to: "review",
      round: 1,
      actorRunId: CONTROLLER_RUN_ID,
      evidenceRef: "results/round-01.json",
      revision: candidateRevision,
    },
    {
      sequence: 6,
      from: "review",
      to: "accepted",
      round: 1,
      actorRunId: CONTROLLER_RUN_ID,
      evidenceRef: "acceptance.md",
      revision: candidateRevision,
    },
  ];
  if (integrationRevision !== undefined) {
    events.push({
      sequence: 7,
      from: "accepted",
      to: "integrated",
      round: 1,
      actorRunId: CONTROLLER_RUN_ID,
      evidenceRef: "integration.md",
      revision: integrationRevision,
    });
  }
  return events;
}

function passingLenses(): JsonRecord {
  const lens = (evidence: string): JsonRecord => ({
    verdict: "pass",
    evidence: [evidence],
  });
  return {
    bug_correctness: lens("Malformed historical evidence was inspected."),
    security_privacy: lens("Control authority was inspected."),
    architecture_contracts: lens("Workflow contracts were inspected."),
    performance_reliability: lens("Git operations remain bounded."),
    style_maintainability: lens("The validator remains maintainable."),
    tests_tdd: lens("Frozen RED lineage was inspected."),
  };
}

function acceptedBundle(
  baseRevision: string,
  redRevision: string,
  candidateRevision: string,
  testPath: string,
  testSha256: string,
): JsonRecord {
  const events = lifecycleEvents(
    baseRevision,
    redRevision,
    candidateRevision,
  );
  const ticket = baseTicket();
  ticket.baseRevision = baseRevision;
  ticket.dependencies = ["invalid/id", "SCALAR-001"];
  ticket.allowedWrites = ["deno.json", "tools/workflows/"];
  ticket.requiredTasks = taskDefinitions();
  const result: JsonRecord = {
    schemaVersion: 2,
    ticketId: TICKET_ID,
    ticketRevision: 1,
    round: 1,
    implementerRunId: IMPLEMENTER_RUN_ID,
    issuedByControllerRunId: CONTROLLER_RUN_ID,
    inputBaseRevision: baseRevision,
    dispatchRef: "dispatch/round-01.md",
    redRevision,
    red: {
      command: `deno test ${testPath}`,
      exitCode: 1,
      expectedFailure: "The defensive validation behavior was absent.",
      output: "The intended diagnostic was absent.",
      logRef: "evidence/round-01-red.log",
      testFiles: [{ path: testPath, sha256: testSha256 }],
      productionFiles: [],
    },
    green: {
      command: `deno test ${testPath}`,
      exitCode: 0,
      logRef: "evidence/round-01-green.log",
      productionFiles: ["tools/workflows/coverage_production.ts"],
    },
    refactor: {
      summary: "Kept the defensive diagnostics deterministic.",
      command: "deno task check",
      exitCode: 0,
      logRef: "evidence/round-01-refactor.log",
    },
    candidateRevision,
  };
  const review: JsonRecord = {
    schemaVersion: 2,
    ticketId: TICKET_ID,
    ticketRevision: 1,
    round: 1,
    implementerRunId: IMPLEMENTER_RUN_ID,
    reviewerRunId: REVIEWER_RUN_ID,
    issuedByControllerRunId: CONTROLLER_RUN_ID,
    baseRevision,
    candidateRevision,
    verdict: "APPROVED",
    commands: [{ command: "deno task check", exitCode: 0 }],
    lenses: passingLenses(),
    findings: [],
    notes: [],
  };
  return {
    ticket,
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
      dependencyRevisions: {
        "invalid/id": "f".repeat(40),
        "SCALAR-001": "e".repeat(40),
      },
      openFindingIds: [],
      orchestratorChecks: [{
        runId: `${CONTROLLER_RUN_ID}/acceptance-check-1`,
        revision: candidateRevision,
        command: `deno task ${TASK_NAME}`,
        exitCode: 0,
      }],
      acceptedCandidateRevision: candidateRevision,
      blocker: null,
    },
    events: structuredClone(events),
    results: [result],
    reviews: [review],
  };
}

function integrateBundle(
  bundle: JsonRecord,
  integrationRevision: string,
): void {
  const ticket = asRecord(bundle.ticket);
  const state = asRecord(bundle.state);
  const result = asRecord((bundle.results as unknown[])[0]);
  const events = lifecycleEvents(
    ticket.baseRevision as string,
    result.redRevision as string,
    result.candidateRevision as string,
    integrationRevision,
  );
  state.phase = "integrated";
  state.events = events;
  state.integrationRevision = integrationRevision;
  state.integrationChecks = [{
    runId: `${CONTROLLER_RUN_ID}/integration-check-1`,
    revision: integrationRevision,
    command: `deno task ${TASK_NAME}`,
    exitCode: 0,
  }];
  bundle.events = structuredClone(events);
}

function writePacket(root: string, bundle: JsonRecord): void {
  const path = `docs/planning/tickets/${TICKET_ID}`;
  writeJson(root, `${path}/ticket.json`, bundle.ticket);
  writeJson(root, `${path}/state.json`, bundle.state);
  writeText(
    root,
    `${path}/events.jsonl`,
    `${
      (bundle.events as unknown[]).map((event) => JSON.stringify(event)).join(
        "\n",
      )
    }\n`,
  );
  writeJson(
    root,
    `${path}/results/round-01.json`,
    (bundle.results as unknown[])[0],
  );
  writeJson(
    root,
    `${path}/reviews/round-01.json`,
    (bundle.reviews as unknown[])[0],
  );
  writeText(root, `${path}/dispatch/round-01.md`, "# Coverage dispatch\n");
  writeText(root, `${path}/evidence/round-01-red.log`, "RED failed.\n");
  writeText(root, `${path}/evidence/round-01-green.log`, "GREEN passed.\n");
  writeText(
    root,
    `${path}/evidence/round-01-refactor.log`,
    "REFACTOR passed.\n",
  );
  writeText(root, `${path}/acceptance.md`, "Accepted exact candidate.\n");
  if (asRecord(bundle.state).phase === "integrated") {
    writeText(root, `${path}/integration.md`, "Integrated exact anchor.\n");
  }
}

async function createDefensiveGitFixture(): Promise<GitFixture> {
  const root = Deno.makeTempDirSync({ prefix: "autonomy-coverage-" });
  try {
    runGit(root, ["init", "--quiet"]);
    runGit(root, ["config", "user.email", "workflow@example.invalid"]);
    runGit(root, ["config", "user.name", "Workflow Fixture"]);
    writeText(root, "deno.json", "{\n");
    writeText(root, "tools/workflows/base.ts", "export const base = true;\n");
    writeText(root, "docs/planning/tickets/SCALAR-001/state.json", "[]\n");
    const baseRevision = commit(root, "malformed historical base");

    const testPath = "tools/workflows/coverage_regression_test.ts";
    writeText(root, testPath, "Deno.test('coverage RED', () => {});\n");
    const redRevision = commit(root, "coverage RED");
    const testSha256 = await sha256(
      runGitBytes(root, ["show", `${redRevision}:${testPath}`]),
    );

    writeJson(root, "deno.json", { tasks: [] });
    writeText(
      root,
      "tools/workflows/coverage_production.ts",
      "export const covered = true;\n",
    );
    const candidateRevision = commit(root, "coverage candidate");
    const bundle = acceptedBundle(
      baseRevision,
      redRevision,
      candidateRevision,
      testPath,
      testSha256,
    );
    writePacket(root, bundle);
    writeJson(root, "deno.json", { tasks: { [TASK_NAME]: TASK_DEFINITION } });
    commit(root, "accepted metadata and runnable current tasks");
    const integrationRevision = commit(root, "integration anchor", true);
    integrateBundle(bundle, integrationRevision);
    writePacket(root, bundle);
    return {
      root,
      ticketDirectory: pathIn(
        root,
        `docs/planning/tickets/${TICKET_ID}`,
      ),
    };
  } catch (error) {
    Deno.removeSync(root, { recursive: true });
    throw error;
  }
}

async function captureValidatorRun(fixture: GitFixture): Promise<ValidatorRun> {
  const originalDirectory = Deno.cwd();
  const originalLog = console.log;
  const output: string[] = [];
  console.log = (...values: unknown[]): void => {
    output.push(values.map(String).join(" "));
  };
  try {
    Deno.chdir(fixture.root);
    const exitCode = await runTicketValidator([fixture.ticketDirectory]);
    const emitted = JSON.parse(output.at(-1) ?? "{}") as {
      readonly issues?: readonly ValidationIssue[];
    };
    return { exitCode, issues: emitted.issues ?? [] };
  } finally {
    Deno.chdir(originalDirectory);
    console.log = originalLog;
  }
}

Deno.test(
  "AUTONOMY-001 coverage rejects unreadable task history and missing integration metadata",
  async () => {
    const fixture = await createDefensiveGitFixture();
    try {
      const run = await captureValidatorRun(fixture);
      if (run.exitCode !== 1) {
        throw new Error(`Expected rejection, received exit ${run.exitCode}`);
      }
      assertIssue(
        run.issues,
        "$.ticket.requiredTasks",
        "task_definition_mismatch",
      );
      assertIssue(
        run.issues,
        "$.state.dependencyRevisions.invalid/id",
        "dependency_not_integrated_at_base",
      );
      assertIssue(
        run.issues,
        "$.state.dependencyRevisions.SCALAR-001",
        "dependency_not_integrated_at_base",
      );
      assertIssue(
        run.issues,
        "$.state.integrationRevision",
        "integration_metadata_mutated",
      );
    } finally {
      Deno.removeSync(fixture.root, { recursive: true });
    }
  },
);
