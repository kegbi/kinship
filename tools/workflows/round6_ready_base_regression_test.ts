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
const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface Fixture {
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

function pathIn(root: string, relativePath: string): string {
  return `${root}/${relativePath}`;
}

function writeText(root: string, relativePath: string, value: string): void {
  const destination = pathIn(root, relativePath);
  const separator = destination.lastIndexOf("/");
  Deno.mkdirSync(destination.slice(0, separator), { recursive: true });
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
  writeText(root, "tools/workflows/production.ts", "export const value = 1;\n");
  return root;
}

function ticket(baseRevision: string): Record<string, unknown> {
  return {
    schemaVersion: 1,
    ticketId: TICKET_ID,
    revision: 1,
    title: "Bind ready metadata HEAD to its base",
    outcome: "Ready metadata is bound to a clean base descendant.",
    baseRevision,
    dependencies: [],
    maxRounds: 6,
    scope: ["Workflow validation"],
    nonGoals: ["Application behavior"],
    allowedWrites: ["tools/workflows/"],
    contractRefs: ["docs/development/autonomous-delivery.md#state-machine"],
    acceptanceCriteria: [{
      id: "AC-03",
      text: "Bind ready metadata to its declared base.",
      redProof: "Real Git fixtures expose missing ready-base guards.",
    }],
    requiredTasks: [...REQUIRED_TASKS],
    risks: ["Unbound ready metadata could validate."],
    unresolvedDecisions: [],
  };
}

function writeReadyPacket(root: string, baseRevision: string): string {
  const ticketDirectory = pathIn(root, TICKET_PATH);
  const events = [{
    sequence: 1,
    from: "planned",
    to: "ready",
    round: 0,
    actorRunId: "orchestrator-ready",
    evidenceRef: "ticket.json",
    revision: baseRevision,
  }];
  const state = {
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
  };
  writeText(
    root,
    `${TICKET_PATH}/ticket.json`,
    `${JSON.stringify(ticket(baseRevision), null, 2)}\n`,
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
  return ticketDirectory;
}

function createReadyFixture(
  kind: "metadata" | "divergent" | "production",
): Fixture {
  const root = initializeRepository(`round6-ready-${kind}-`);
  try {
    const initialRevision = commit(root, "initial base");
    let baseRevision = initialRevision;
    if (kind === "divergent") {
      runGit(root, ["switch", "--quiet", "--orphan", "declared-base"]);
      writeText(root, "declared-base.txt", "divergent base\n");
      baseRevision = commit(root, "divergent declared base");
      runGit(root, ["switch", "--quiet", "master"]);
    }
    if (kind === "production") {
      writeText(
        root,
        "tools/workflows/production.ts",
        "export const value = 2;\n",
      );
      commit(root, "production change before ready metadata");
    }
    const ticketDirectory = writeReadyPacket(root, baseRevision);
    commit(root, "ready ticket metadata");
    return { root, ticketDirectory };
  } catch (error) {
    Deno.removeSync(root, { recursive: true });
    throw error;
  }
}

async function captureValidatorRun(fixture: Fixture): Promise<ValidatorRun> {
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

function parseValidation(run: ValidatorRun): EmittedValidation | undefined {
  try {
    return JSON.parse(run.output) as EmittedValidation;
  } catch {
    return undefined;
  }
}

function assertSuccess(label: string, run: ValidatorRun): void {
  const emitted = parseValidation(run);
  if (
    run.exitCode !== 0 || emitted?.ok !== true || emitted.issues.length !== 0
  ) {
    throw new Error(
      `${label} should pass, received exit ${run.exitCode}: ${run.output}`,
    );
  }
}

function assertExactIssue(run: ValidatorRun, expected: ValidationIssue): void {
  const emitted = parseValidation(run);
  if (
    run.exitCode !== 1 || emitted?.ok !== false ||
    emitted.issues.length !== 1 ||
    JSON.stringify(emitted.issues[0]) !== JSON.stringify(expected)
  ) {
    throw new Error(
      `Expected only ${
        JSON.stringify(expected)
      }, received exit ${run.exitCode}: ${run.output}`,
    );
  }
}

function removeFixture(fixture: Fixture): void {
  Deno.removeSync(fixture.root, { recursive: true });
}

Deno.test("PILOT-001-R5-001 accepts metadata-only ready HEAD descending from base", async () => {
  const fixture = createReadyFixture("metadata");
  try {
    assertSuccess(
      "metadata-only ready descendant",
      await captureValidatorRun(fixture),
    );
  } finally {
    removeFixture(fixture);
  }
});

Deno.test("PILOT-001-R5-001 rejects a divergent ready base with one stable diagnostic", async () => {
  const fixture = createReadyFixture("divergent");
  try {
    assertExactIssue(await captureValidatorRun(fixture), {
      path: "$.ticket.baseRevision",
      code: "ready_base_ancestry_mismatch",
      message: "Committed ready metadata must descend from the ticket base",
    });
  } finally {
    removeFixture(fixture);
  }
});

Deno.test("PILOT-001-R5-001 rejects production changes before ready metadata with one stable diagnostic", async () => {
  const fixture = createReadyFixture("production");
  try {
    assertExactIssue(await captureValidatorRun(fixture), {
      path: "$.ticket.baseRevision",
      code: "ready_base_scope_violation",
      message: "Ready-phase commits may change only canonical ticket metadata",
    });
  } finally {
    removeFixture(fixture);
  }
});

Deno.test("PILOT-001-R5-001 preserves candidate-bearing ancestry and scope controls", () => {
  const result = new Deno.Command(Deno.execPath(), {
    args: [
      "test",
      "--allow-read",
      "--allow-write",
      "--allow-run=git",
      "--filter",
      "R2-010 binds clean committed metadata to a candidate descendant",
      "tools/workflows/round3_git_regression_test.ts",
    ],
    stdout: "piped",
    stderr: "piped",
  }).outputSync();
  if (!result.success) {
    throw new Error(
      `Candidate-bearing controls regressed: ${
        decoder.decode(result.stderr).trim()
      }`,
    );
  }
});
