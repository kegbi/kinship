import {
  validateTicketBundle,
  type ValidationIssue,
} from "./ticket_contract.ts";
import { runTicketValidator } from "./validate_ticket.ts";

type JsonRecord = Record<string, unknown>;

const STRUCTURAL_TICKET_ID = "AUTONOMY-REVIEW-REGRESSION";
const STRUCTURAL_BASE_REVISION = "1".repeat(40);
const STRUCTURAL_CONTROLLER_RUN_ID =
  `${STRUCTURAL_TICKET_ID}/orchestrator/r0/00000000-0000-4000-8000-000000000001`;
const AVAILABLE_TASKS = new Set([
  "fmt:check",
  "lint",
  "check",
  "ticket:validate",
  "test:workflow",
  "test:workflow:coverage",
  "test:schema:matrix",
]);
const PROTECTED_AGENT_PATH = ".codex/agents/reviewer.toml";
const PROTECTED_SKILL_PATH = ".agents/skills/run-tdd-ticket-loop/SKILL.md";
const ORDINARY_TOOL_PATH = "tools/workflows/";
const ORDINARY_DOC_PATH = "docs/development/autonomous-delivery.md";
const ALTERNATE_LEGACY_BASE = "5cdf892a0669b25b447cf782e280530b66a6ed25";

const TASK_TICKET_ID = "AUTONOMY-TASK-REGRESSION";
const TASK_TICKET_PATH = `docs/planning/tickets/${TASK_TICKET_ID}`;
const TASK_CONTROLLER_RUN_ID =
  `${TASK_TICKET_ID}/orchestrator/r0/00000000-0000-4000-8000-000000000011`;
const TASK_IMPLEMENTER_RUN_ID =
  `${TASK_TICKET_ID}/implementer/r1/00000000-0000-4000-8000-000000000012`;
const TASK_REVIEWER_RUN_ID =
  `${TASK_TICKET_ID}/reviewer/r1/00000000-0000-4000-8000-000000000013`;
const BASE_CHECK_DEFINITION = "deno check tools/workflows/production.ts";
const LEGITIMATE_CHECK_DEFINITION =
  "deno check tools/workflows/production.ts tools/workflows/guard_test.ts";
const GUARD_DEFINITION = "deno test tools/workflows/guard_test.ts";
const RED_TEST_PATH = "tools/workflows/task_definition_regression_test.ts";
const RED_TEST_SOURCE = "Deno.test('frozen RED proof', () => {});\n";
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

function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error("Expected an array fixture value");
  }
  return value;
}

function assertNoIssues(
  issues: readonly ValidationIssue[],
  context: string,
): void {
  if (issues.length !== 0) {
    throw new Error(
      `${context}: expected no issues, received ${JSON.stringify(issues)}`,
    );
  }
}

function assertIssue(
  issues: readonly ValidationIssue[],
  path: string,
  code: string,
  context: string,
): void {
  if (!issues.some((issue) => issue.path === path && issue.code === code)) {
    throw new Error(
      `${context}: expected ${path} ${code}, received ${
        JSON.stringify(issues)
      }`,
    );
  }
}

function structuralBundle(): JsonRecord {
  const event = {
    sequence: 1,
    from: "planned",
    to: "ready",
    round: 0,
    actorRunId: STRUCTURAL_CONTROLLER_RUN_ID,
    evidenceRef: "ticket.json",
    revision: STRUCTURAL_BASE_REVISION,
  };
  return {
    ticket: {
      schemaVersion: 2,
      ticketId: STRUCTURAL_TICKET_ID,
      revision: 1,
      title: "Exercise reviewed autonomous-delivery regressions",
      outcome: "Only exact delegated authority can certify ticket work.",
      baseRevision: STRUCTURAL_BASE_REVISION,
      controllerRunId: STRUCTURAL_CONTROLLER_RUN_ID,
      executionClass: "ordinary",
      protectedWriteAuthorization: null,
      dependencies: [],
      maxRounds: 1,
      scope: ["Autonomous workflow validation"],
      nonGoals: ["Application behavior"],
      allowedWrites: [ORDINARY_TOOL_PATH],
      contractRefs: [
        "docs/planning/tickets/AUTONOMY-001/contract.md",
      ],
      acceptanceCriteria: [{
        id: "AC-01",
        text: "Reject authority replay and trivial delivery gates.",
        redProof: "Focused regressions expose each missing guard.",
      }],
      requiredTasks: {
        baseline: [{ name: "check", definition: BASE_CHECK_DEFINITION }],
        candidate: [{
          name: "check",
          definition: BASE_CHECK_DEFINITION,
          guardedBy: null,
        }],
      },
      risks: ["A permissive control plane could self-certify work"],
      unresolvedDecisions: [],
    },
    state: {
      schemaVersion: 1,
      ticketId: STRUCTURAL_TICKET_ID,
      ticketRevision: 1,
      phase: "ready",
      round: 0,
      baseRevision: STRUCTURAL_BASE_REVISION,
      candidateRevision: null,
      events: [event],
      resultRefs: [],
      reviewRefs: [],
      dependencyRevisions: {},
      openFindingIds: [],
      orchestratorChecks: [],
      acceptedCandidateRevision: null,
      blocker: null,
    },
    events: [structuredClone(event)],
    results: [],
    reviews: [],
  };
}

function authorizeProtectedWrites(
  bundle: JsonRecord,
  allowedWrites: readonly string[],
  authorizationPaths: readonly string[],
): void {
  const ticket = asRecord(bundle.ticket);
  ticket.executionClass = "protected-config-maintenance";
  ticket.allowedWrites = [...allowedWrites];
  ticket.protectedWriteAuthorization = {
    authorizedByControllerRunId: STRUCTURAL_CONTROLLER_RUN_ID,
    paths: [...authorizationPaths],
    contractRef: "docs/planning/tickets/AUTONOMY-001/contract.md",
    rationale: "Authorize only the exact protected control-file subset.",
  };
}

Deno.test(
  "mixed protected and ordinary writes accept exactly the protected subset",
  () => {
    const bundle = structuralBundle();
    authorizeProtectedWrites(
      bundle,
      [
        ORDINARY_TOOL_PATH,
        PROTECTED_AGENT_PATH,
        ORDINARY_DOC_PATH,
        PROTECTED_SKILL_PATH,
      ],
      [PROTECTED_AGENT_PATH, PROTECTED_SKILL_PATH],
    );
    assertNoIssues(
      validateTicketBundle(bundle, AVAILABLE_TASKS),
      "mixed protected/ordinary authorization",
    );
  },
);

const authorizationRejections: readonly {
  readonly label: string;
  readonly allowedWrites: readonly string[];
  readonly authorizationPaths: readonly string[];
}[] = [
  {
    label: "missing protected entry",
    allowedWrites: [
      PROTECTED_AGENT_PATH,
      ORDINARY_TOOL_PATH,
      PROTECTED_SKILL_PATH,
    ],
    authorizationPaths: [PROTECTED_AGENT_PATH],
  },
  {
    label: "extra protected entry",
    allowedWrites: [PROTECTED_AGENT_PATH, ORDINARY_TOOL_PATH],
    authorizationPaths: [PROTECTED_AGENT_PATH, PROTECTED_SKILL_PATH],
  },
  {
    label: "duplicate protected entry",
    allowedWrites: [PROTECTED_AGENT_PATH, ORDINARY_TOOL_PATH],
    authorizationPaths: [PROTECTED_AGENT_PATH, PROTECTED_AGENT_PATH],
  },
  {
    label: "ordinary entry",
    allowedWrites: [PROTECTED_AGENT_PATH, ORDINARY_TOOL_PATH],
    authorizationPaths: [PROTECTED_AGENT_PATH, ORDINARY_TOOL_PATH],
  },
];

for (const rejection of authorizationRejections) {
  Deno.test(
    `protected authorization rejects ${rejection.label}`,
    () => {
      const bundle = structuralBundle();
      authorizeProtectedWrites(
        bundle,
        rejection.allowedWrites,
        rejection.authorizationPaths,
      );
      const issues = validateTicketBundle(bundle, AVAILABLE_TASKS);
      assertIssue(
        issues,
        "$.ticket.protectedWriteAuthorization.paths",
        "authorization_mismatch",
        rejection.label,
      );
      if (rejection.label === "duplicate protected entry") {
        assertIssue(
          issues,
          "$.ticket.protectedWriteAuthorization.paths[1]",
          "duplicate_value",
          rejection.label,
        );
      }
    },
  );
}

function readLegacyBundle(ticketId: "PILOT-001" | "PILOT-002"): JsonRecord {
  const root = `docs/planning/tickets/${ticketId}`;
  const ticket: unknown = JSON.parse(
    Deno.readTextFileSync(`${root}/ticket.json`),
  );
  const state: unknown = JSON.parse(
    Deno.readTextFileSync(`${root}/state.json`),
  );
  const events = Deno.readTextFileSync(`${root}/events.jsonl`).trim().split(
    /\r?\n/,
  ).map((line) => JSON.parse(line) as unknown);
  const stateRecord = asRecord(state);
  return {
    ticket,
    state,
    events,
    results: asArray(stateRecord.resultRefs).map((reference) =>
      JSON.parse(
        Deno.readTextFileSync(`${root}/${String(reference)}`),
      ) as unknown
    ),
    reviews: asArray(stateRecord.reviewRefs).map((reference) =>
      JSON.parse(
        Deno.readTextFileSync(`${root}/${String(reference)}`),
      ) as unknown
    ),
  };
}

function replaceExactString(
  value: unknown,
  oldValue: string,
  newValue: string,
): unknown {
  if (typeof value === "string") {
    return value === oldValue ? newValue : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => replaceExactString(entry, oldValue, newValue));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        replaceExactString(entry, oldValue, newValue),
      ]),
    );
  }
  return value;
}

for (const ticketId of ["PILOT-001", "PILOT-002"] as const) {
  Deno.test(`exact historical ${ticketId} packet remains valid`, () => {
    assertNoIssues(
      validateTicketBundle(readLegacyBundle(ticketId), AVAILABLE_TASKS),
      `${ticketId} exact historical packet`,
    );
  });

  Deno.test(`${ticketId} legacy identity rejects a re-anchored base`, () => {
    const bundle = readLegacyBundle(ticketId);
    const oldBase = String(asRecord(bundle.ticket).baseRevision);
    const reanchored = asRecord(
      replaceExactString(bundle, oldBase, ALTERNATE_LEGACY_BASE),
    );
    assertIssue(
      validateTicketBundle(reanchored, AVAILABLE_TASKS),
      "$.ticket.schemaVersion",
      "legacy_packet_mismatch",
      `${ticketId} alternate base`,
    );
  });
}

const legacyAuthorityMutations: readonly {
  readonly field: string;
  readonly mutate: (ticket: JsonRecord) => void;
}[] = [
  {
    field: "revision",
    mutate: (ticket) => {
      ticket.revision = Number(ticket.revision) + 1;
    },
  },
  {
    field: "title",
    mutate: (ticket) => {
      ticket.title = `${String(ticket.title)} (replayed)`;
    },
  },
  {
    field: "outcome",
    mutate: (ticket) => {
      ticket.outcome = `${String(ticket.outcome)} Replayed authority.`;
    },
  },
  {
    field: "dependencies",
    mutate: (ticket) => {
      ticket.dependencies = [...asArray(ticket.dependencies), "PILOT-000"];
    },
  },
  {
    field: "maxRounds",
    mutate: (ticket) => {
      ticket.maxRounds = Number(ticket.maxRounds) + 1;
    },
  },
  {
    field: "scope",
    mutate: (ticket) => {
      ticket.scope = [...asArray(ticket.scope), "Expanded replay scope"];
    },
  },
  {
    field: "nonGoals",
    mutate: (ticket) => {
      ticket.nonGoals = [
        ...asArray(ticket.nonGoals),
        "A changed authority boundary",
      ];
    },
  },
  {
    field: "allowedWrites",
    mutate: (ticket) => {
      ticket.allowedWrites = [
        ...asArray(ticket.allowedWrites),
        "tools/workflows/legacy-replay.ts",
      ];
    },
  },
  {
    field: "contractRefs",
    mutate: (ticket) => {
      ticket.contractRefs = [
        ...asArray(ticket.contractRefs),
        "docs/planning/tickets/AUTONOMY-001/contract.md",
      ];
    },
  },
  {
    field: "acceptanceCriteria",
    mutate: (ticket) => {
      const criteria = asArray(ticket.acceptanceCriteria);
      const first = asRecord(criteria[0]);
      first.text = `${String(first.text)} Mutated criterion.`;
    },
  },
  {
    field: "requiredTasks",
    mutate: (ticket) => {
      const tasks = asArray(ticket.requiredTasks);
      tasks[0] = "ticket:validate";
    },
  },
  {
    field: "risks",
    mutate: (ticket) => {
      ticket.risks = [...asArray(ticket.risks), "Replayed legacy authority"];
    },
  },
  {
    field: "unresolvedDecisions",
    mutate: (ticket) => {
      ticket.unresolvedDecisions = [
        ...asArray(ticket.unresolvedDecisions),
        "A replayed authority decision",
      ];
    },
  },
];

for (const ticketId of ["PILOT-001", "PILOT-002"] as const) {
  for (const mutation of legacyAuthorityMutations) {
    Deno.test(
      `${ticketId} legacy identity rejects ${mutation.field} mutation`,
      () => {
        const bundle = readLegacyBundle(ticketId);
        mutation.mutate(asRecord(bundle.ticket));
        assertIssue(
          validateTicketBundle(bundle, AVAILABLE_TASKS),
          "$.ticket.schemaVersion",
          "legacy_packet_mismatch",
          `${ticketId} ${mutation.field}`,
        );
      },
    );
  }
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

function reviewLenses(): JsonRecord {
  return Object.fromEntries(
    [
      "bug_correctness",
      "security_privacy",
      "architecture_contracts",
      "performance_reliability",
      "style_maintainability",
      "tests_tdd",
    ].map((lens) => [
      lens,
      {
        verdict: "pass",
        evidence: [`${lens} was independently inspected.`],
      },
    ]),
  );
}

async function acceptedTaskBundle(
  baseRevision: string,
  redRevision: string,
  candidateRevision: string,
  candidateDefinition: string,
): Promise<JsonRecord> {
  const events = [
    {
      sequence: 1,
      from: "planned",
      to: "ready",
      round: 0,
      actorRunId: TASK_CONTROLLER_RUN_ID,
      evidenceRef: "ticket.json",
      revision: baseRevision,
    },
    {
      sequence: 2,
      from: "ready",
      to: "red",
      round: 1,
      actorRunId: TASK_IMPLEMENTER_RUN_ID,
      evidenceRef: "evidence/round-01-red.log",
      revision: redRevision,
    },
    {
      sequence: 3,
      from: "red",
      to: "green",
      round: 1,
      actorRunId: TASK_IMPLEMENTER_RUN_ID,
      evidenceRef: "evidence/round-01-green.log",
      revision: candidateRevision,
    },
    {
      sequence: 4,
      from: "green",
      to: "refactor",
      round: 1,
      actorRunId: TASK_IMPLEMENTER_RUN_ID,
      evidenceRef: "evidence/round-01-refactor.log",
      revision: candidateRevision,
    },
    {
      sequence: 5,
      from: "refactor",
      to: "review",
      round: 1,
      actorRunId: TASK_CONTROLLER_RUN_ID,
      evidenceRef: "results/round-01.json",
      revision: candidateRevision,
    },
    {
      sequence: 6,
      from: "review",
      to: "accepted",
      round: 1,
      actorRunId: TASK_CONTROLLER_RUN_ID,
      evidenceRef: "acceptance.md",
      revision: candidateRevision,
    },
  ];
  const result = {
    schemaVersion: 2,
    ticketId: TASK_TICKET_ID,
    ticketRevision: 1,
    round: 1,
    implementerRunId: TASK_IMPLEMENTER_RUN_ID,
    issuedByControllerRunId: TASK_CONTROLLER_RUN_ID,
    inputBaseRevision: baseRevision,
    dispatchRef: "dispatch/round-01.md",
    redRevision,
    red: {
      command: `deno test ${RED_TEST_PATH}`,
      exitCode: 1,
      expectedFailure: "The task-definition guard is absent.",
      output: "Expected task_definition_noop was absent.",
      logRef: "evidence/round-01-red.log",
      testFiles: [{
        path: RED_TEST_PATH,
        sha256: await sha256(RED_TEST_SOURCE),
      }],
      productionFiles: [],
    },
    green: {
      command: `deno test ${RED_TEST_PATH}`,
      exitCode: 0,
      logRef: "evidence/round-01-green.log",
      productionFiles: ["deno.json", "tools/workflows/production.ts"],
    },
    refactor: {
      summary: "Kept the task-definition guard bounded.",
      command: "deno task test:workflow",
      exitCode: 0,
      logRef: "evidence/round-01-refactor.log",
    },
    candidateRevision,
  };
  const review = {
    schemaVersion: 2,
    ticketId: TASK_TICKET_ID,
    ticketRevision: 1,
    round: 1,
    implementerRunId: TASK_IMPLEMENTER_RUN_ID,
    reviewerRunId: TASK_REVIEWER_RUN_ID,
    issuedByControllerRunId: TASK_CONTROLLER_RUN_ID,
    baseRevision,
    candidateRevision,
    verdict: "APPROVED",
    commands: [{ command: "deno task check", exitCode: 0 }],
    lenses: reviewLenses(),
    findings: [],
    notes: [],
  };
  return {
    ticket: {
      schemaVersion: 2,
      ticketId: TASK_TICKET_ID,
      revision: 1,
      title: "Reject trivial task definitions",
      outcome: "Required tasks exercise repository behavior.",
      baseRevision,
      controllerRunId: TASK_CONTROLLER_RUN_ID,
      executionClass: "ordinary",
      protectedWriteAuthorization: null,
      dependencies: [],
      maxRounds: 1,
      scope: ["Workflow task-definition validation"],
      nonGoals: ["Application behavior"],
      allowedWrites: ["deno.json", "tools/workflows/"],
      contractRefs: [
        "docs/planning/tickets/AUTONOMY-001/contract.md",
      ],
      acceptanceCriteria: [{
        id: "AC-01",
        text: "Reject trivial eval-style delivery gates.",
        redProof: "Real-Git fixtures expose missing no-op diagnostics.",
      }],
      requiredTasks: {
        baseline: [
          { name: "check", definition: BASE_CHECK_DEFINITION },
          { name: "test:workflow", definition: GUARD_DEFINITION },
        ],
        candidate: [
          {
            name: "check",
            definition: candidateDefinition,
            guardedBy: "test:workflow",
          },
          {
            name: "test:workflow",
            definition: GUARD_DEFINITION,
            guardedBy: null,
          },
        ],
      },
      risks: ["A trivial task could self-certify delivery"],
      unresolvedDecisions: [],
    },
    state: {
      schemaVersion: 1,
      ticketId: TASK_TICKET_ID,
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
      orchestratorChecks: ["check", "test:workflow"].map((task, index) => ({
        runId: `${TASK_CONTROLLER_RUN_ID}/check-${index + 1}`,
        revision: candidateRevision,
        command: `deno task ${task}`,
        exitCode: 0,
      })),
      acceptedCandidateRevision: candidateRevision,
      blocker: null,
    },
    events: structuredClone(events),
    results: [result],
    reviews: [review],
  };
}

function writeTaskBundle(root: string, bundle: JsonRecord): void {
  const state = asRecord(bundle.state);
  writeText(
    root,
    `${TASK_TICKET_PATH}/ticket.json`,
    `${JSON.stringify(bundle.ticket, null, 2)}\n`,
  );
  writeText(
    root,
    `${TASK_TICKET_PATH}/state.json`,
    `${JSON.stringify(state, null, 2)}\n`,
  );
  writeText(
    root,
    `${TASK_TICKET_PATH}/events.jsonl`,
    `${
      asArray(bundle.events).map((event) => JSON.stringify(event)).join("\n")
    }\n`,
  );
  writeText(
    root,
    `${TASK_TICKET_PATH}/results/round-01.json`,
    `${JSON.stringify(asArray(bundle.results)[0], null, 2)}\n`,
  );
  writeText(
    root,
    `${TASK_TICKET_PATH}/reviews/round-01.json`,
    `${JSON.stringify(asArray(bundle.reviews)[0], null, 2)}\n`,
  );
  writeText(
    root,
    `${TASK_TICKET_PATH}/dispatch/round-01.md`,
    "# Round 1 dispatch\n",
  );
  for (const phase of ["red", "green", "refactor"]) {
    writeText(
      root,
      `${TASK_TICKET_PATH}/evidence/round-01-${phase}.log`,
      `round 1 ${phase} evidence\n`,
    );
  }
  writeText(
    root,
    `${TASK_TICKET_PATH}/acceptance.md`,
    "Accepted candidate.\n",
  );
}

async function createTaskFixture(
  candidateDefinition: string,
): Promise<GitFixture> {
  const root = Deno.makeTempDirSync({ prefix: "autonomy-review-task-" });
  try {
    runGit(root, ["init", "--quiet"]);
    runGit(root, ["config", "user.email", "workflow@example.invalid"]);
    runGit(root, ["config", "user.name", "Workflow Fixture"]);
    writeText(
      root,
      "deno.json",
      `${
        JSON.stringify(
          {
            tasks: {
              check: BASE_CHECK_DEFINITION,
              "test:workflow": GUARD_DEFINITION,
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
      "export const value = 1;\n",
    );
    writeText(
      root,
      "tools/workflows/guard_test.ts",
      "Deno.test('independent guard', () => {});\n",
    );
    const baseRevision = commit(root, "base");

    writeText(root, RED_TEST_PATH, RED_TEST_SOURCE);
    const redRevision = commit(root, "red");

    writeText(
      root,
      "deno.json",
      `${
        JSON.stringify(
          {
            tasks: {
              check: candidateDefinition,
              "test:workflow": GUARD_DEFINITION,
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

    const bundle = await acceptedTaskBundle(
      baseRevision,
      redRevision,
      candidateRevision,
      candidateDefinition,
    );
    writeTaskBundle(root, bundle);
    commit(root, "ticket metadata");
    return {
      root,
      ticketDirectory: pathIn(root, TASK_TICKET_PATH),
    };
  } catch (error) {
    Deno.removeSync(root, { recursive: true });
    throw error;
  }
}

async function captureValidatorRun(
  fixture: GitFixture,
): Promise<ValidatorRun> {
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
    const exitCode = await runTicketValidator([fixture.ticketDirectory]);
    const emitted: unknown = JSON.parse(output.join("\n"));
    const record = asRecord(emitted);
    return {
      exitCode,
      issues: asArray(record.issues) as ValidationIssue[],
    };
  } finally {
    console.log = originalLog;
    console.error = originalError;
    Deno.chdir(originalDirectory);
  }
}

function assertValidatorIssue(
  run: ValidatorRun,
  code: string,
  context: string,
): void {
  if (
    run.exitCode !== 1 ||
    !run.issues.some((issue) =>
      issue.path === "$.ticket.requiredTasks.candidate[0].definition" &&
      issue.code === code
    )
  ) {
    throw new Error(
      `${context}: expected ${code}, received exit ${run.exitCode} ${
        JSON.stringify(run.issues)
      }`,
    );
  }
}

function assertValidatorSuccess(run: ValidatorRun, context: string): void {
  if (run.exitCode !== 0 || run.issues.length !== 0) {
    throw new Error(
      `${context}: expected success, received exit ${run.exitCode} ${
        JSON.stringify(run.issues)
      }`,
    );
  }
}

const trivialEvalDefinitions: readonly {
  readonly label: string;
  readonly definition: string;
}[] = [
  { label: "boolean false", definition: "deno eval false" },
  { label: "empty expression", definition: 'deno eval ""' },
  { label: "string expression", definition: `deno eval '"passed"'` },
  { label: "numeric expression", definition: "deno eval 0" },
  { label: "explicit successful exit", definition: 'deno eval "Deno.exit(0)"' },
  { label: "quiet boolean", definition: 'deno eval --quiet "false"' },
  { label: "typed void expression", definition: 'deno eval --ext=ts "void 0"' },
  { label: "quoted true with semicolon", definition: 'deno eval "true;"' },
];

for (const taskCase of trivialEvalDefinitions) {
  Deno.test(`trivial eval gate rejects ${taskCase.label}`, async () => {
    const fixture = await createTaskFixture(taskCase.definition);
    try {
      assertValidatorIssue(
        await captureValidatorRun(fixture),
        "task_definition_noop",
        taskCase.label,
      );
    } finally {
      Deno.removeSync(fixture.root, { recursive: true });
    }
  });
}

Deno.test(
  "a legitimate task change passes with an unchanged independent guard",
  async () => {
    const fixture = await createTaskFixture(LEGITIMATE_CHECK_DEFINITION);
    try {
      assertValidatorSuccess(
        await captureValidatorRun(fixture),
        "legitimate independently guarded task",
      );
    } finally {
      Deno.removeSync(fixture.root, { recursive: true });
    }
  },
);
