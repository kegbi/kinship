import {
  validateTicketBundle,
  type ValidationIssue,
  WORKFLOW_POLICY,
} from "./ticket_contract.ts";
import { runTicketValidator } from "./validate_ticket.ts";

const CURRENT_TICKET_ID = "AUTONOMY-001";
const DEPENDENCY_TICKET_ID = "FOUNDATION-001";
const REQUIRED_TASKS = ["check"] as const;
const AVAILABLE_TASKS = new Set(REQUIRED_TASKS);
const STRUCTURAL_BASE = "1111111111111111111111111111111111111111";
const STRUCTURAL_RED = "2222222222222222222222222222222222222222";
const STRUCTURAL_CANDIDATE = "3333333333333333333333333333333333333333";
const STRUCTURAL_INTEGRATION = "4444444444444444444444444444444444444444";
const STRUCTURAL_SHA256 = "a".repeat(64);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

type JsonRecord = Record<string, unknown>;

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

interface AcceptedTicket {
  readonly bundle: JsonRecord;
  readonly acceptedRevision: string;
  readonly candidateRevision: string;
}

function asRecord(value: unknown): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Fixture value must be an object");
  }
  return value as JsonRecord;
}

function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Fixture value must be an array");
  return value;
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

function writeJson(root: string, relativePath: string, value: unknown): void {
  writeText(root, relativePath, `${JSON.stringify(value, null, 2)}\n`);
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

function initializeRepository(prefix: string): string {
  const root = Deno.makeTempDirSync({ prefix });
  runGit(root, ["init", "--quiet"]);
  runGit(root, ["config", "user.email", "workflow@example.invalid"]);
  runGit(root, ["config", "user.name", "Workflow Fixture"]);
  writeJson(root, "deno.json", {
    tasks: Object.fromEntries(REQUIRED_TASKS.map((task) => [task, "echo"])),
  });
  writeText(root, "tools/workflows/base.ts", "export const base = true;\n");
  commit(root, "repository base");
  return root;
}

function checks(revision: string, prefix: string): JsonRecord[] {
  return REQUIRED_TASKS.map((task, index) => ({
    runId: `${prefix}-${index + 1}`,
    revision,
    command: `deno task ${task}`,
    exitCode: 0,
  }));
}

function acceptedEvents(
  baseRevision: string,
  redRevision: string,
  candidateRevision: string,
): JsonRecord[] {
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

function integratedEvents(
  baseRevision: string,
  redRevision: string,
  candidateRevision: string,
  integrationRevision: string,
): JsonRecord[] {
  return [
    ...acceptedEvents(baseRevision, redRevision, candidateRevision),
    {
      sequence: 7,
      from: "accepted",
      to: "integrated",
      round: 1,
      actorRunId: "orchestrator-integrate",
      evidenceRef: "integration.md",
      revision: integrationRevision,
    },
  ];
}

function ticket(
  ticketId: string,
  baseRevision: string,
  dependencies: readonly string[] = [],
): JsonRecord {
  return {
    schemaVersion: 1,
    ticketId,
    revision: 1,
    title: "Anchor autonomous ticket integration",
    outcome: "Integrated evidence remains historically verifiable.",
    baseRevision,
    dependencies: [...dependencies],
    maxRounds: 2,
    scope: ["Workflow integration validation"],
    nonGoals: ["Application behavior"],
    allowedWrites: ["tools/workflows/"],
    contractRefs: ["docs/development/autonomous-delivery.md#state-machine"],
    acceptanceCriteria: [{
      id: "AC-01",
      text: "Bind integration and dependency evidence to durable revisions.",
      redProof: "Real Git histories expose HEAD-relative validation gaps.",
    }],
    requiredTasks: [...REQUIRED_TASKS],
    risks: ["Mutable HEAD state could rewrite historical acceptance."],
    unresolvedDecisions: [],
  };
}

function result(
  ticketId: string,
  baseRevision: string,
  redRevision: string,
  candidateRevision: string,
  testPath: string,
  testSha256: string,
): JsonRecord {
  return {
    schemaVersion: 1,
    ticketId,
    ticketRevision: 1,
    round: 1,
    implementerRunId: "implementer-round-01",
    inputBaseRevision: baseRevision,
    dispatchRef: "dispatch/round-01.md",
    redRevision,
    red: {
      command: `deno test ${testPath}`,
      exitCode: 1,
      expectedFailure: "The integration contract is not implemented.",
      output: "The focused integration assertion failed.",
      logRef: "evidence/round-01-red.log",
      testFiles: [{ path: testPath, sha256: testSha256 }],
      productionFiles: [],
    },
    green: {
      command: `deno test ${testPath}`,
      exitCode: 0,
      logRef: "evidence/round-01-green.log",
      productionFiles: ["tools/workflows/base.ts"],
    },
    refactor: {
      summary: "Kept integration evidence deterministic and bounded.",
      command: "deno task check",
      exitCode: 0,
      logRef: "evidence/round-01-refactor.log",
    },
    candidateRevision,
  };
}

function review(
  ticketId: string,
  baseRevision: string,
  candidateRevision: string,
): JsonRecord {
  const lens = (evidence: string): JsonRecord => ({
    verdict: "pass",
    evidence: [evidence],
  });
  return {
    schemaVersion: 1,
    ticketId,
    ticketRevision: 1,
    round: 1,
    implementerRunId: "implementer-round-01",
    reviewerRunId: "reviewer-round-01",
    baseRevision,
    candidateRevision,
    verdict: "APPROVED",
    commands: [{ command: "deno task check", exitCode: 0 }],
    lenses: {
      bug_correctness: lens("Exact integration behavior was inspected."),
      security_privacy: lens("Evidence containment was inspected."),
      architecture_contracts: lens("Lifecycle contracts were inspected."),
      performance_reliability: lens("Git operations remain bounded."),
      style_maintainability: lens("The change remains maintainable."),
      tests_tdd: lens("Frozen RED evidence was inspected."),
    },
    findings: [],
    notes: [],
  };
}

function acceptedBundle(
  ticketId: string,
  baseRevision: string,
  redRevision: string,
  candidateRevision: string,
  testPath: string,
  testSha256: string,
  dependencies: readonly string[] = [],
  dependencyRevisions: Readonly<Record<string, string>> = {},
): JsonRecord {
  const events = acceptedEvents(baseRevision, redRevision, candidateRevision);
  return {
    ticket: ticket(ticketId, baseRevision, dependencies),
    state: {
      schemaVersion: 1,
      ticketId,
      ticketRevision: 1,
      phase: "accepted",
      round: 1,
      baseRevision,
      candidateRevision,
      events,
      resultRefs: ["results/round-01.json"],
      reviewRefs: ["reviews/round-01.json"],
      dependencyRevisions: { ...dependencyRevisions },
      openFindingIds: [],
      orchestratorChecks: checks(candidateRevision, "acceptance-check"),
      acceptedCandidateRevision: candidateRevision,
      blocker: null,
    },
    events: structuredClone(events),
    results: [
      result(
        ticketId,
        baseRevision,
        redRevision,
        candidateRevision,
        testPath,
        testSha256,
      ),
    ],
    reviews: [review(ticketId, baseRevision, candidateRevision)],
  };
}

function integrateBundle(
  bundle: JsonRecord,
  integrationRevision: string,
): void {
  const state = asRecord(bundle.state);
  const ticket = asRecord(bundle.ticket);
  const resultEntry = asRecord(asArray(bundle.results)[0]);
  const events = integratedEvents(
    ticket.baseRevision as string,
    resultEntry.redRevision as string,
    resultEntry.candidateRevision as string,
    integrationRevision,
  );
  state.phase = "integrated";
  state.events = events;
  state.integrationRevision = integrationRevision;
  state.integrationChecks = checks(integrationRevision, "integration-check");
  bundle.events = structuredClone(events);
}

function structuralIntegratedBundle(): JsonRecord {
  const bundle = acceptedBundle(
    CURRENT_TICKET_ID,
    STRUCTURAL_BASE,
    STRUCTURAL_RED,
    STRUCTURAL_CANDIDATE,
    "tools/workflows/integration_anchor_regression_test.ts",
    STRUCTURAL_SHA256,
  );
  integrateBundle(bundle, STRUCTURAL_INTEGRATION);
  return bundle;
}

function ticketPath(ticketId: string): string {
  return `docs/planning/tickets/${ticketId}`;
}

function writePacket(root: string, bundle: JsonRecord): void {
  const ticketEntry = asRecord(bundle.ticket);
  const path = ticketPath(ticketEntry.ticketId as string);
  const events = asArray(bundle.events);
  writeJson(root, `${path}/ticket.json`, bundle.ticket);
  writeJson(root, `${path}/state.json`, bundle.state);
  writeText(
    root,
    `${path}/events.jsonl`,
    `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
  );
  writeJson(root, `${path}/results/round-01.json`, asArray(bundle.results)[0]);
  writeJson(root, `${path}/reviews/round-01.json`, asArray(bundle.reviews)[0]);
  writeText(root, `${path}/dispatch/round-01.md`, "# Round 1 dispatch\n");
  writeText(
    root,
    `${path}/evidence/round-01-red.log`,
    "RED failed as intended.\n",
  );
  writeText(root, `${path}/evidence/round-01-green.log`, "GREEN passed.\n");
  writeText(
    root,
    `${path}/evidence/round-01-refactor.log`,
    "REFACTOR passed.\n",
  );
  writeText(root, `${path}/acceptance.md`, "Accepted exact candidate.\n");
  if (asRecord(bundle.state).phase === "integrated") {
    writeText(
      root,
      `${path}/integration.md`,
      "Integrated exact anchor after aggregate gates passed.\n",
    );
  }
}

function writeReadyPacket(
  root: string,
  baseRevision: string,
  dependencyRevision: string,
): string {
  const path = ticketPath(CURRENT_TICKET_ID);
  const events = [{
    sequence: 1,
    from: "planned",
    to: "ready",
    round: 0,
    actorRunId: "orchestrator-ready",
    evidenceRef: "ticket.json",
    revision: baseRevision,
  }];
  writeJson(
    root,
    `${path}/ticket.json`,
    ticket(CURRENT_TICKET_ID, baseRevision, [DEPENDENCY_TICKET_ID]),
  );
  writeJson(root, `${path}/state.json`, {
    schemaVersion: 1,
    ticketId: CURRENT_TICKET_ID,
    ticketRevision: 1,
    phase: "ready",
    round: 0,
    baseRevision,
    candidateRevision: null,
    events,
    resultRefs: [],
    reviewRefs: [],
    dependencyRevisions: { [DEPENDENCY_TICKET_ID]: dependencyRevision },
    openFindingIds: [],
    orchestratorChecks: [],
    acceptedCandidateRevision: null,
    blocker: null,
  });
  writeText(
    root,
    `${path}/events.jsonl`,
    `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
  );
  return pathIn(root, path);
}

async function createAcceptedTicket(
  root: string,
  ticketId: string,
): Promise<AcceptedTicket> {
  const baseRevision = runGit(root, ["rev-parse", "HEAD"]);
  const testPath = `tools/workflows/${ticketId.toLowerCase()}_test.ts`;
  writeText(root, testPath, `Deno.test("${ticketId} RED", () => {});\n`);
  const redRevision = commit(root, `${ticketId} red`);
  const testSha256 = await sha256(
    runGitBytes(root, ["show", `${redRevision}:${testPath}`]),
  );
  writeText(
    root,
    `tools/workflows/${ticketId.toLowerCase()}.ts`,
    `export const ticket = "${ticketId}";\n`,
  );
  const candidateRevision = commit(root, `${ticketId} candidate`);
  const bundle = acceptedBundle(
    ticketId,
    baseRevision,
    redRevision,
    candidateRevision,
    testPath,
    testSha256,
  );
  writePacket(root, bundle);
  const acceptedRevision = commit(root, `${ticketId} accepted metadata`);
  return { bundle, acceptedRevision, candidateRevision };
}

function integrateTicket(
  root: string,
  ticketEntry: AcceptedTicket,
  ticketId: string,
): string {
  const integrationRevision = commit(
    root,
    `${ticketId} integration anchor`,
    true,
  );
  integrateBundle(ticketEntry.bundle, integrationRevision);
  writePacket(root, ticketEntry.bundle);
  commit(root, `${ticketId} integrated metadata`);
  return integrationRevision;
}

async function createHistoricalIntegratedFixture(): Promise<GitFixture> {
  const root = initializeRepository("integration-anchor-history-");
  try {
    const dependency = await createAcceptedTicket(root, DEPENDENCY_TICKET_ID);
    const dependencyIntegration = integrateTicket(
      root,
      dependency,
      DEPENDENCY_TICKET_ID,
    );
    const currentBase = runGit(root, ["rev-parse", "HEAD"]);
    const testPath = "tools/workflows/autonomy_001_test.ts";
    writeText(root, testPath, "Deno.test('current RED', () => {});\n");
    const redRevision = commit(root, "current red");
    const testSha256 = await sha256(
      runGitBytes(root, ["show", `${redRevision}:${testPath}`]),
    );
    writeText(
      root,
      "tools/workflows/autonomy_001.ts",
      "export const anchored = true;\n",
    );
    const candidateRevision = commit(root, "current candidate");
    const bundle = acceptedBundle(
      CURRENT_TICKET_ID,
      currentBase,
      redRevision,
      candidateRevision,
      testPath,
      testSha256,
      [DEPENDENCY_TICKET_ID],
      { [DEPENDENCY_TICKET_ID]: dependencyIntegration },
    );
    writePacket(root, bundle);
    commit(root, "current accepted metadata");
    const integrationRevision = commit(
      root,
      "current integration anchor",
      true,
    );
    integrateBundle(bundle, integrationRevision);
    writePacket(root, bundle);
    commit(root, "current integrated metadata");

    const dependencyStatePath = `${
      ticketPath(DEPENDENCY_TICKET_ID)
    }/state.json`;
    const laterDependencyState = asRecord(
      structuredClone(dependency.bundle.state),
    );
    laterDependencyState.phase = "accepted";
    delete laterDependencyState.integrationRevision;
    delete laterDependencyState.integrationChecks;
    writeJson(root, dependencyStatePath, laterDependencyState);
    writeText(root, "later-unrelated.txt", "later unrelated repository work\n");
    commit(root, "later unrelated work");
    return {
      root,
      ticketDirectory: pathIn(root, ticketPath(CURRENT_TICKET_ID)),
    };
  } catch (error) {
    Deno.removeSync(root, { recursive: true });
    throw error;
  }
}

async function createLateDependencyFixture(): Promise<GitFixture> {
  const root = initializeRepository("integration-anchor-dependency-");
  try {
    const dependency = await createAcceptedTicket(root, DEPENDENCY_TICKET_ID);
    const ticketBase = dependency.acceptedRevision;
    const originalBranch = runGit(root, ["branch", "--show-current"]);
    runGit(root, ["switch", "--quiet", "-c", "late-dependency-integration"]);
    const dependencyIntegration = integrateTicket(
      root,
      dependency,
      DEPENDENCY_TICKET_ID,
    );
    runGit(root, ["switch", "--quiet", originalBranch]);
    const ticketDirectory = writeReadyPacket(
      root,
      ticketBase,
      dependencyIntegration,
    );
    commit(root, "dependent ready metadata");
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

function parseValidation(run: ValidatorRun): EmittedValidation | undefined {
  try {
    return JSON.parse(run.output) as EmittedValidation;
  } catch {
    return undefined;
  }
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
  if (!issues.some((entry) => entry.path === path && entry.code === code)) {
    throw new Error(
      `Expected ${path}:${code}, received ${JSON.stringify(issues)}`,
    );
  }
}

function assertSuccess(run: ValidatorRun): void {
  const emitted = parseValidation(run);
  if (
    run.exitCode !== 0 || emitted?.ok !== true || emitted.issues.length !== 0
  ) {
    throw new Error(
      `Expected historical validation to pass, received exit ${run.exitCode}: ${run.output}`,
    );
  }
}

function assertRejectedWithIssue(
  run: ValidatorRun,
  path: string,
  code: string,
): void {
  const emitted = parseValidation(run);
  if (run.exitCode !== 1 || emitted?.ok !== false) {
    throw new Error(
      `Expected validation rejection, received exit ${run.exitCode}: ${run.output}`,
    );
  }
  assertIssue(emitted.issues, path, code);
}

function removeFixture(fixture: GitFixture): void {
  Deno.removeSync(fixture.root, { recursive: true });
}

Deno.test("AUTONOMY-001 integration transition binds the durable anchor and integration.md", () => {
  const policy = WORKFLOW_POLICY as unknown as {
    readonly transitions: readonly JsonRecord[];
    readonly evidence: JsonRecord;
  };
  const transition = policy.transitions.find((entry) =>
    entry.from === "accepted" && entry.to === "integrated"
  );
  if (
    transition?.revision !== "integration" ||
    transition.evidence !== "integration" ||
    policy.evidence.integration !== "integration.md"
  ) {
    throw new Error(
      `Expected accepted->integrated to bind integrationRevision and integration.md, received ${
        JSON.stringify({ transition, evidence: policy.evidence })
      }`,
    );
  }
});

Deno.test("AUTONOMY-001 accepts an integrated state with separate candidate and integration checks", () => {
  assertNoIssues(
    validateTicketBundle(structuralIntegratedBundle(), AVAILABLE_TASKS),
  );
});

Deno.test("AUTONOMY-001 requires a durable integration revision in integrated state", () => {
  const bundle = structuralIntegratedBundle();
  delete asRecord(bundle.state).integrationRevision;
  assertIssue(
    validateTicketBundle(bundle, AVAILABLE_TASKS),
    "$.state.integrationRevision",
    "integration_required",
  );
});

Deno.test("AUTONOMY-001 requires every ticket task in integration checks", () => {
  const bundle = structuralIntegratedBundle();
  asRecord(bundle.state).integrationChecks = [];
  assertIssue(
    validateTicketBundle(bundle, AVAILABLE_TASKS),
    "$.state.integrationChecks",
    "check_missing",
  );
});

Deno.test("AUTONOMY-001 validates an integrated ticket after unrelated later commits using dependency state at its base", async () => {
  const fixture = await createHistoricalIntegratedFixture();
  try {
    assertSuccess(await captureValidatorRun(fixture));
  } finally {
    removeFixture(fixture);
  }
});

Deno.test("AUTONOMY-001 rejects a dependency integrated only after the ticket base", async () => {
  const fixture = await createLateDependencyFixture();
  try {
    assertRejectedWithIssue(
      await captureValidatorRun(fixture),
      `$.state.dependencyRevisions.${DEPENDENCY_TICKET_ID}`,
      "dependency_not_integrated_at_base",
    );
  } finally {
    removeFixture(fixture);
  }
});
