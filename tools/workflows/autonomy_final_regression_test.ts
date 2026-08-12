import {
  validateTicketBundle,
  type ValidationIssue,
} from "./ticket_contract.ts";
import { runTicketValidator } from "./validate_ticket.ts";

type JsonRecord = Record<string, unknown>;

const TASK_TICKET_ID = "AUTONOMY-FINAL-TASK-REGRESSION";
const TASK_TICKET_PATH = `docs/planning/tickets/${TASK_TICKET_ID}`;
const TASK_CONTROLLER_RUN_ID =
  `${TASK_TICKET_ID}/orchestrator/r0/00000000-0000-4000-8000-000000000021`;
const TASK_IMPLEMENTER_RUN_ID =
  `${TASK_TICKET_ID}/implementer/r1/00000000-0000-4000-8000-000000000022`;
const TASK_REVIEWER_RUN_ID =
  `${TASK_TICKET_ID}/reviewer/r1/00000000-0000-4000-8000-000000000023`;
const BASE_CHECK_DEFINITION = "deno check tools/workflows/production.ts";
const GUARD_DEFINITION = "deno test tools/workflows/guard_test.ts";
const RED_TEST_PATH = "tools/workflows/final_task_regression_test.ts";
const RED_TEST_SOURCE = "Deno.test('frozen RED proof', () => {});\n";
const AVAILABLE_TASKS = new Set([
  "fmt:check",
  "lint",
  "check",
  "ticket:validate",
  "test:workflow",
  "test:workflow:coverage",
  "test:schema:matrix",
]);
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

function errorText(error: unknown): string {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
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
  if (result.stdout.byteLength > 4_096 || result.stderr.byteLength > 4_096) {
    throw new Error(`Git fixture output exceeded its bound: ${args.join(" ")}`);
  }
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
      expectedFailure: "The Deno eval task-definition guard is absent.",
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
      summary: "Kept task-definition inspection bounded and deterministic.",
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
      title: "Reject Deno eval task definitions after global options",
      outcome: "Required tasks exercise repository behavior.",
      baseRevision,
      controllerRunId: TASK_CONTROLLER_RUN_ID,
      executionClass: "ordinary",
      protectedWriteAuthorization: null,
      dependencies: [],
      maxRounds: 1,
      scope: ["Workflow task-definition validation"],
      nonGoals: ["Executing task-definition text"],
      allowedWrites: ["deno.json", "tools/workflows/"],
      contractRefs: [
        "docs/planning/tickets/AUTONOMY-001/contract.md",
      ],
      acceptanceCriteria: [{
        id: "AC-01",
        text: "Reject eval-style delivery gates after Deno global options.",
        redProof: "Bounded real-Git fixtures expose missing diagnostics.",
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
  const root = Deno.makeTempDirSync({ prefix: "autonomy-final-task-" });
  try {
    runGit(root, ["init", "--quiet"]);
    runGit(root, ["config", "user.email", "workflow@example.invalid"]);
    runGit(root, ["config", "user.name", "Workflow Fixture"]);
    runGit(root, ["config", "core.autocrlf", "false"]);
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
  ticketDirectory: string,
  workingDirectory?: string,
): Promise<ValidatorRun> {
  const originalDirectory = Deno.cwd();
  const originalLog = console.log;
  const originalError = console.error;
  const output: string[] = [];
  const capture = (...values: unknown[]): void => {
    output.push(values.map(String).join(" "));
  };
  if (workingDirectory !== undefined) Deno.chdir(workingDirectory);
  console.log = capture;
  console.error = capture;
  try {
    const exitCode = await runTicketValidator([ticketDirectory]);
    const emitted = asRecord(JSON.parse(output.join("\n")) as unknown);
    return {
      exitCode,
      issues: asArray(emitted.issues) as ValidationIssue[],
    };
  } finally {
    console.log = originalLog;
    console.error = originalError;
    Deno.chdir(originalDirectory);
  }
}

const evalAfterGlobalOptions: readonly {
  readonly label: string;
  readonly definition: string;
}[] = [
  { label: "quiet", definition: "deno --quiet eval false" },
  {
    label: "separate config value",
    definition: "deno --config deno.json eval false",
  },
  {
    label: "equals config value",
    definition: "deno --config=deno.json eval false",
  },
  { label: "no config", definition: "deno --no-config eval false" },
  { label: "unstable feature", definition: "deno --unstable-kv eval false" },
  {
    label: "combined flags and value",
    definition:
      "deno --quiet --config deno.json --unstable-kv --no-config eval false",
  },
  { label: "short quiet", definition: "deno -q eval false" },
  {
    label: "separate log-level value",
    definition: "deno --log-level debug eval false",
  },
  {
    label: "equals log-level value",
    definition: "deno --log-level=debug eval false",
  },
  { label: "double-quoted eval", definition: 'deno "eval" false' },
  { label: "single-quoted eval", definition: "deno 'eval' false" },
  {
    label: "quoted eval after combined options",
    definition: 'deno --quiet --log-level debug "eval" false',
  },
  {
    label: "deno.exe quoted eval",
    definition: 'deno.exe --config=deno.json "eval" false',
  },
];

const legitimateDenoControls: readonly {
  readonly label: string;
  readonly definition: string;
}[] = [
  { label: "check", definition: BASE_CHECK_DEFINITION },
  { label: "test", definition: "deno test tools/workflows/guard_test.ts" },
  { label: "run", definition: "deno run tools/workflows/production.ts" },
  {
    label: "run with eval argument",
    definition: "deno run tools/workflows/production.ts eval",
  },
  {
    label: "test with eval filter",
    definition: "deno test --filter eval tools/workflows/guard_test.ts",
  },
  {
    label: "check eval-named source",
    definition: "deno check tools/workflows/eval.ts",
  },
  {
    label: "config value named eval before check",
    definition: "deno --config eval check tools/workflows/production.ts",
  },
];

Deno.test(
  "Deno eval remains forbidden after bounded global options without executing task text",
  async () => {
    const failures: string[] = [];
    for (const taskCase of evalAfterGlobalOptions) {
      let fixture: GitFixture | undefined;
      try {
        fixture = await createTaskFixture(taskCase.definition);
        const run = await captureValidatorRun(
          fixture.ticketDirectory,
          fixture.root,
        );
        if (
          run.exitCode !== 1 ||
          !run.issues.some((issue) =>
            issue.path ===
              "$.ticket.requiredTasks.candidate[0].definition" &&
            issue.code === "task_definition_noop"
          )
        ) {
          failures.push(
            `${taskCase.label}: expected task_definition_noop, received exit ${run.exitCode} ${
              JSON.stringify(run.issues)
            }`,
          );
        }
      } catch (error) {
        failures.push(`${taskCase.label}: ${errorText(error)}`);
      } finally {
        if (fixture !== undefined) {
          Deno.removeSync(fixture.root, { recursive: true });
        }
      }
    }

    for (const taskCase of legitimateDenoControls) {
      let fixture: GitFixture | undefined;
      try {
        fixture = await createTaskFixture(taskCase.definition);
        const run = await captureValidatorRun(
          fixture.ticketDirectory,
          fixture.root,
        );
        if (run.exitCode !== 0 || run.issues.length !== 0) {
          failures.push(
            `${taskCase.label}: expected acceptance, received exit ${run.exitCode} ${
              JSON.stringify(run.issues)
            }`,
          );
        }
      } catch (error) {
        failures.push(`${taskCase.label}: ${errorText(error)}`);
      } finally {
        if (fixture !== undefined) {
          Deno.removeSync(fixture.root, { recursive: true });
        }
      }
    }

    if (failures.length > 0) {
      throw new Error(`Task-definition regressions:\n${failures.join("\n")}`);
    }
  },
);

function readLegacyBundle(): JsonRecord {
  const root = "docs/planning/tickets/PILOT-002";
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

function replaceLegacyTicketId(bundle: JsonRecord, ticketId: string): void {
  asRecord(bundle.ticket).ticketId = ticketId;
  asRecord(bundle.state).ticketId = ticketId;
  for (const result of asArray(bundle.results)) {
    asRecord(result).ticketId = ticketId;
  }
  for (const review of asArray(bundle.reviews)) {
    asRecord(review).ticketId = ticketId;
  }
}

function writeLegacyBundle(root: string, bundle: JsonRecord): void {
  const state = asRecord(bundle.state);
  writeText(root, "ticket.json", `${JSON.stringify(bundle.ticket, null, 2)}\n`);
  writeText(root, "state.json", `${JSON.stringify(state, null, 2)}\n`);
  writeText(
    root,
    "events.jsonl",
    `${
      asArray(bundle.events).map((event) => JSON.stringify(event)).join("\n")
    }\n`,
  );
  asArray(state.resultRefs).forEach((reference, index) => {
    writeText(
      root,
      String(reference),
      `${JSON.stringify(asArray(bundle.results)[index], null, 2)}\n`,
    );
  });
  asArray(state.reviewRefs).forEach((reference, index) => {
    writeText(
      root,
      String(reference),
      `${JSON.stringify(asArray(bundle.reviews)[index], null, 2)}\n`,
    );
  });
}

const inheritedTicketIds = [
  "toString",
  "constructor",
  "__proto__",
  "hasOwnProperty",
  "valueOf",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "toLocaleString",
] as const;

Deno.test(
  "schema-v1 inherited ticket IDs return deterministic diagnostics through structural and CLI paths",
  async () => {
    const failures: string[] = [];
    const ticketDirectory = Deno.makeTempDirSync({
      prefix: "autonomy-final-legacy-",
    });
    try {
      for (const ticketId of inheritedTicketIds) {
        const bundle = readLegacyBundle();
        replaceLegacyTicketId(bundle, ticketId);
        let directIssues: readonly ValidationIssue[] | undefined;
        try {
          directIssues = validateTicketBundle(bundle, AVAILABLE_TASKS);
          if (
            !directIssues.some((issue) =>
              issue.path === "$.ticket.schemaVersion" &&
              issue.code === "legacy_schema_forbidden"
            )
          ) {
            failures.push(
              `${ticketId} direct: expected legacy_schema_forbidden, received ${
                JSON.stringify(directIssues)
              }`,
            );
          }
        } catch (error) {
          failures.push(`${ticketId} direct threw ${errorText(error)}`);
        }

        writeLegacyBundle(ticketDirectory, bundle);
        try {
          const cliRun = await captureValidatorRun(ticketDirectory);
          if (
            cliRun.exitCode !== 1 ||
            !cliRun.issues.some((issue) =>
              issue.path === "$.ticket.schemaVersion" &&
              issue.code === "legacy_schema_forbidden"
            ) ||
            cliRun.issues.some((issue) => issue.code === "io_error")
          ) {
            failures.push(
              `${ticketId} CLI: expected deterministic legacy rejection, received exit ${cliRun.exitCode} ${
                JSON.stringify(cliRun.issues)
              }`,
            );
          } else if (
            directIssues !== undefined &&
            JSON.stringify(cliRun.issues) !== JSON.stringify(directIssues)
          ) {
            failures.push(
              `${ticketId}: direct and CLI diagnostics differed: ${
                JSON.stringify(directIssues)
              } versus ${JSON.stringify(cliRun.issues)}`,
            );
          }
        } catch (error) {
          failures.push(`${ticketId} CLI threw ${errorText(error)}`);
        }
      }
    } finally {
      Deno.removeSync(ticketDirectory, { recursive: true });
    }

    if (failures.length > 0) {
      throw new Error(`Legacy ticket-ID regressions:\n${failures.join("\n")}`);
    }
  },
);
