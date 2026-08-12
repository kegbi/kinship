import { runTicketValidator } from "./validate_ticket.ts";

const TICKET_ID = "SCALE-001";
const TICKET_PATH = `docs/planning/tickets/${TICKET_ID}`;
const CONTROLLER_RUN_ID =
  `${TICKET_ID}/orchestrator/r0/00000000-0000-4000-8000-000000000501`;
const IMPLEMENTER_RUN_ID =
  `${TICKET_ID}/implementer/r1/00000000-0000-4000-8000-000000000502`;
const REVIEWER_RUN_ID =
  `${TICKET_ID}/reviewer/r1/00000000-0000-4000-8000-000000000503`;
const TEST_PATH = "tools/workflows/scale_fixture_test.ts";
const TASK_NAME = "check";
const TASK_DEFINITION = "echo";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

type JsonRecord = Record<string, unknown>;

interface GitFixture {
  readonly root: string;
  readonly ticketDirectory: string;
  readonly bundle?: JsonRecord;
  readonly candidateRevision?: string;
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

interface CommandResult {
  readonly code: number;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
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

function runGitResult(root: string, args: readonly string[]): CommandResult {
  const result = new Deno.Command("git", {
    args: [...args],
    cwd: root,
    stdout: "piped",
    stderr: "piped",
  }).outputSync();
  return { code: result.code, stdout: result.stdout, stderr: result.stderr };
}

function runGitBytes(root: string, args: readonly string[]): Uint8Array {
  const result = runGitResult(root, args);
  if (result.code !== 0) {
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

async function runGitWithInput(
  root: string,
  args: readonly string[],
  input: string,
): Promise<CommandResult> {
  const child = new Deno.Command("git", {
    args: [...args],
    cwd: root,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(encoder.encode(input));
  await writer.close();
  const result = await child.output();
  return { code: result.code, stdout: result.stdout, stderr: result.stderr };
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

function initializeRepository(prefix: string): string {
  const root = Deno.makeTempDirSync({ prefix });
  runGit(root, ["init", "--quiet"]);
  runGit(root, ["config", "user.email", "workflow@example.invalid"]);
  runGit(root, ["config", "user.name", "Workflow Fixture"]);
  writeJson(root, "deno.json", { tasks: { [TASK_NAME]: TASK_DEFINITION } });
  writeText(root, "tools/workflows/base.ts", "export const base = true;\n");
  return root;
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

function ticket(baseRevision: string): JsonRecord {
  return {
    schemaVersion: 2,
    ticketId: TICKET_ID,
    revision: 1,
    title: "Scale workflow Git evidence",
    outcome: "Workflow Git predicates remain bounded as history grows.",
    baseRevision,
    controllerRunId: CONTROLLER_RUN_ID,
    executionClass: "ordinary",
    protectedWriteAuthorization: null,
    dependencies: [],
    maxRounds: 2,
    scope: ["Bound workflow Git evidence"],
    nonGoals: ["Application behavior"],
    allowedWrites: ["tools/workflows/"],
    contractRefs: [
      "docs/development/autonomous-delivery.md#non-negotiable-invariants",
    ],
    acceptanceCriteria: [{
      id: "AC-01",
      text: "Use exact scoped Git decisions without global enumeration.",
      redProof: "Growing real-Git fixtures expose global path caps.",
    }],
    requiredTasks: {
      baseline: [{ name: TASK_NAME, definition: TASK_DEFINITION }],
      candidate: [{
        name: TASK_NAME,
        definition: TASK_DEFINITION,
        guardedBy: null,
      }],
    },
    risks: ["Broad predicates could conceal rename boundaries."],
    unresolvedDecisions: [],
  };
}

function readyEvents(baseRevision: string): JsonRecord[] {
  return [{
    sequence: 1,
    from: "planned",
    to: "ready",
    round: 0,
    actorRunId: CONTROLLER_RUN_ID,
    evidenceRef: "ticket.json",
    revision: baseRevision,
  }];
}

function acceptedEvents(
  baseRevision: string,
  redRevision: string,
  candidateRevision: string,
): JsonRecord[] {
  return [
    ...readyEvents(baseRevision),
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
}

function checks(revision: string, prefix: string): JsonRecord[] {
  return [{
    runId: `${CONTROLLER_RUN_ID}/${prefix}-1`,
    revision,
    command: `deno task ${TASK_NAME}`,
    exitCode: 0,
  }];
}

function resultRecord(
  baseRevision: string,
  redRevision: string,
  candidateRevision: string,
  testSha256: string,
  productionFiles: readonly string[],
): JsonRecord {
  return {
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
      command: `deno test ${TEST_PATH}`,
      exitCode: 1,
      expectedFailure: "The scalable Git regression fails before production.",
      output: "The focused scalable assertion failed.",
      logRef: "evidence/round-01-red.log",
      testFiles: [{ path: TEST_PATH, sha256: testSha256 }],
      productionFiles: [],
    },
    green: {
      command: `deno test ${TEST_PATH}`,
      exitCode: 0,
      logRef: "evidence/round-01-green.log",
      productionFiles: [...productionFiles],
    },
    refactor: {
      summary: "Kept Git evidence decisions bounded and exact.",
      command: `deno task ${TASK_NAME}`,
      exitCode: 0,
      logRef: "evidence/round-01-refactor.log",
    },
    candidateRevision,
  };
}

function reviewRecord(
  baseRevision: string,
  candidateRevision: string,
): JsonRecord {
  const lens = (evidence: string): JsonRecord => ({
    verdict: "pass",
    evidence: [evidence],
  });
  return {
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
    commands: [{ command: `deno task ${TASK_NAME}`, exitCode: 0 }],
    lenses: {
      bug_correctness: lens("Exact Git behavior was inspected."),
      security_privacy: lens("Evidence containment was inspected."),
      architecture_contracts: lens("Workflow contracts were inspected."),
      performance_reliability: lens("Resource bounds were inspected."),
      style_maintainability: lens("The implementation was inspected."),
      tests_tdd: lens("Frozen RED evidence was inspected."),
    },
    findings: [],
    notes: [],
  };
}

function acceptedBundle(
  baseRevision: string,
  redRevision: string,
  candidateRevision: string,
  testSha256: string,
  productionFiles: readonly string[],
): JsonRecord {
  const events = acceptedEvents(baseRevision, redRevision, candidateRevision);
  return {
    ticket: ticket(baseRevision),
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
      dependencyRevisions: {},
      openFindingIds: [],
      orchestratorChecks: checks(candidateRevision, "acceptance-check"),
      acceptedCandidateRevision: candidateRevision,
      blocker: null,
    },
    events: structuredClone(events),
    results: [
      resultRecord(
        baseRevision,
        redRevision,
        candidateRevision,
        testSha256,
        productionFiles,
      ),
    ],
    reviews: [reviewRecord(baseRevision, candidateRevision)],
  };
}

function integrateBundle(
  bundle: JsonRecord,
  integrationRevision: string,
): void {
  const state = bundle.state as JsonRecord;
  const events = state.events as JsonRecord[];
  events.push({
    sequence: 7,
    from: "accepted",
    to: "integrated",
    round: 1,
    actorRunId: CONTROLLER_RUN_ID,
    evidenceRef: "integration.md",
    revision: integrationRevision,
  });
  state.phase = "integrated";
  state.integrationRevision = integrationRevision;
  state.integrationChecks = checks(integrationRevision, "integration-check");
  bundle.events = structuredClone(events);
}

function writePacket(root: string, bundle: JsonRecord): string {
  const events = bundle.events as JsonRecord[];
  const state = bundle.state as JsonRecord;
  writeJson(root, `${TICKET_PATH}/ticket.json`, bundle.ticket);
  writeJson(root, `${TICKET_PATH}/state.json`, state);
  writeText(
    root,
    `${TICKET_PATH}/events.jsonl`,
    `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
  );
  if (state.phase !== "ready") {
    writeJson(
      root,
      `${TICKET_PATH}/results/round-01.json`,
      (bundle.results as JsonRecord[])[0],
    );
    writeJson(
      root,
      `${TICKET_PATH}/reviews/round-01.json`,
      (bundle.reviews as JsonRecord[])[0],
    );
    writeText(root, `${TICKET_PATH}/dispatch/round-01.md`, "# Dispatch\n");
    writeText(
      root,
      `${TICKET_PATH}/evidence/round-01-red.log`,
      "RED failed as intended.\n",
    );
    writeText(
      root,
      `${TICKET_PATH}/evidence/round-01-green.log`,
      "GREEN passed.\n",
    );
    writeText(
      root,
      `${TICKET_PATH}/evidence/round-01-refactor.log`,
      "REFACTOR passed.\n",
    );
    writeText(root, `${TICKET_PATH}/acceptance.md`, "Accepted.\n");
  }
  if (state.phase === "integrated") {
    writeText(root, `${TICKET_PATH}/integration.md`, "Integrated.\n");
  }
  return pathIn(root, TICKET_PATH);
}

function readyBundle(baseRevision: string): JsonRecord {
  const events = readyEvents(baseRevision);
  return {
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
  };
}

function writeNumberedPaths(
  root: string,
  prefix: string,
  count: number,
): string[] {
  return Array.from({ length: count }, (_, index) => {
    const path = `${prefix}/${String(index).padStart(3, "0")}.txt`;
    writeText(root, path, `${index}\n`);
    return path;
  });
}

function createReadyManyUnrelatedFixture(): GitFixture {
  const root = initializeRepository("scale-ready-unrelated-");
  try {
    const baseRevision = commit(root, "base");
    const ticketDirectory = writePacket(root, readyBundle(baseRevision));
    writeNumberedPaths(root, "unrelated/ready", 101);
    commit(root, "ready metadata plus exactly 101 unrelated paths");
    return { root, ticketDirectory };
  } catch (error) {
    Deno.removeSync(root, { recursive: true });
    throw error;
  }
}

function createReadyRenameFixture(): GitFixture {
  const root = initializeRepository("scale-ready-rename-");
  try {
    writeText(root, `${TICKET_PATH}/rename-source.txt`, "rename me\n");
    const baseRevision = commit(root, "base with ticket rename source");
    const ticketDirectory = writePacket(root, readyBundle(baseRevision));
    runGit(root, [
      "mv",
      `${TICKET_PATH}/rename-source.txt`,
      "outside-ticket.txt",
    ]);
    commit(root, "ready metadata with ticket-to-outside rename");
    return { root, ticketDirectory };
  } catch (error) {
    Deno.removeSync(root, { recursive: true });
    throw error;
  }
}

async function createAcceptedFixture(
  prefix: string,
  productionFiles: readonly string[] = ["tools/workflows/change.ts"],
): Promise<GitFixture> {
  const root = initializeRepository(prefix);
  try {
    const baseRevision = commit(root, "base");
    writeText(root, TEST_PATH, 'Deno.test("fixture RED", () => {});\n');
    const redRevision = commit(root, "red");
    const testSha256 = await sha256(
      runGitBytes(root, ["show", `${redRevision}:${TEST_PATH}`]),
    );
    for (const [index, path] of productionFiles.entries()) {
      writeText(root, path, `export const value${index} = ${index};\n`);
    }
    const candidateRevision = commit(
      root,
      "candidate",
      productionFiles.length === 0,
    );
    const bundle = acceptedBundle(
      baseRevision,
      redRevision,
      candidateRevision,
      testSha256,
      productionFiles,
    );
    const ticketDirectory = writePacket(root, bundle);
    commit(root, "accepted metadata");
    return { root, ticketDirectory, bundle, candidateRevision };
  } catch (error) {
    Deno.removeSync(root, { recursive: true });
    throw error;
  }
}

async function createPostCandidateManyUnrelatedFixture(): Promise<GitFixture> {
  const fixture = await createAcceptedFixture("scale-post-candidate-");
  writeNumberedPaths(fixture.root, "unrelated/post-candidate", 101);
  commit(fixture.root, "exactly 101 unrelated post-candidate paths");
  return fixture;
}

async function createIntegratedFixture(
  kind: "unrelated" | "mutation" | "rename",
): Promise<GitFixture> {
  const fixture = await createAcceptedFixture(`scale-integrated-${kind}-`);
  const integrationRevision = commit(
    fixture.root,
    "integration anchor",
    true,
  );
  integrateBundle(fixture.bundle!, integrationRevision);
  writePacket(fixture.root, fixture.bundle!);
  writeText(
    fixture.root,
    `${TICKET_PATH}/rename-source.txt`,
    "durable extra ticket metadata\n",
  );
  commit(fixture.root, "durable integrated metadata");
  if (kind === "unrelated") {
    writeNumberedPaths(fixture.root, "unrelated/integrated", 101);
    commit(fixture.root, "exactly 101 unrelated integrated-history paths");
  } else if (kind === "mutation") {
    writeText(
      fixture.root,
      `${TICKET_PATH}/acceptance.md`,
      "Mutated after durable integration.\n",
    );
    commit(fixture.root, "ordinary later ticket mutation");
  } else {
    runGit(fixture.root, [
      "mv",
      `${TICKET_PATH}/rename-source.txt`,
      "renamed-outside-ticket.txt",
    ]);
    commit(fixture.root, "integrated ticket-to-outside rename");
  }
  return fixture;
}

async function createExactRelevantPathFixture(): Promise<GitFixture> {
  const productionFiles = Array.from(
    { length: 100 },
    (_, index) => `tools/workflows/exact/${String(index).padStart(3, "0")}.ts`,
  );
  return await createAcceptedFixture(
    "scale-exact-relevant-",
    productionFiles,
  );
}

async function createLongOutputFixture(): Promise<GitFixture> {
  const productionFiles = Array.from({ length: 98 }, (_, index) => {
    const segment = `${String(index).padStart(3, "0")}-${"x".repeat(90)}`;
    return `tools/workflows/streamed/${segment}/value.ts`;
  });
  const fixture = await createAcceptedFixture(
    "scale-streamed-bytes-",
    productionFiles,
  );
  const baseRevision = (fixture.bundle!.ticket as JsonRecord)
    .baseRevision as string;
  const candidateRevision = fixture.candidateRevision!;
  const streamed = runGitBytes(fixture.root, [
    "diff",
    "--name-status",
    "--find-renames",
    "--diff-filter=ACDMRTUXB",
    "-z",
    baseRevision,
    candidateRevision,
    "--",
  ]);
  const names = decoder.decode(streamed).split("\0").filter((value) =>
    value !== "" && !/^[ACDMRTUXB][0-9]*$/.test(value)
  );
  if (names.length !== 99 || streamed.byteLength <= 10_000) {
    throw new Error(
      `Long-output control requires 99 records and >10000 bytes, received ${names.length} records and ${streamed.byteLength} bytes`,
    );
  }
  return fixture;
}

async function createMissingRootTreeFixture(): Promise<GitFixture> {
  const root = initializeRepository("scale-missing-root-tree-");
  try {
    const initialRevision = commit(root, "initial valid base");
    const absentResult = await runGitWithInput(
      root,
      ["hash-object", "--stdin"],
      "intrinsically absent root tree\n",
    );
    if (absentResult.code !== 0) {
      throw new Error("Could not derive the absent root-tree OID");
    }
    const absentTree = decoder.decode(absentResult.stdout).trim();
    const absentProof = runGitResult(root, ["cat-file", "-e", absentTree]);
    if (absentProof.code === 0) {
      throw new Error("The derived root-tree OID unexpectedly exists");
    }

    const identity = "Workflow Fixture <workflow@example.invalid> 0 +0000";
    const commitText = [
      `tree ${absentTree}`,
      `parent ${initialRevision}`,
      `author ${identity}`,
      `committer ${identity}`,
      "",
      "syntactically valid commit with an absent root tree",
      "",
    ].join("\n");
    const bogusResult = await runGitWithInput(
      root,
      ["hash-object", "-t", "commit", "-w", "--stdin", "--literally"],
      commitText,
    );
    if (bogusResult.code !== 0) {
      throw new Error(
        `Could not create the bogus commit: ${
          decoder.decode(bogusResult.stderr).trim()
        }`,
      );
    }
    const bogusCommit = decoder.decode(bogusResult.stdout).trim();
    if (
      runGitResult(root, ["cat-file", "-e", `${bogusCommit}^{commit}`]).code !==
        0
    ) {
      throw new Error("The syntactically valid bogus commit does not exist");
    }
    if (runGitResult(root, ["cat-file", "-e", absentTree]).code === 0) {
      throw new Error("Creating the bogus commit unexpectedly wrote its tree");
    }

    const bundle = readyBundle(bogusCommit);
    const ticketDirectory = writePacket(root, bundle);
    runGit(root, ["add", "--all"]);
    const validTree = runGit(root, ["write-tree"]);
    const validHead = runGit(root, [
      "commit-tree",
      validTree,
      "-p",
      bogusCommit,
      "-m",
      "valid metadata head",
    ]);
    runGit(root, ["update-ref", "HEAD", validHead]);

    const scopedDiff = runGitResult(root, [
      "diff",
      "--quiet",
      "--find-renames",
      "--diff-filter=ACDMRTUXB",
      bogusCommit,
      validHead,
      "--",
      ".",
      `:(exclude)${TICKET_PATH}/**`,
    ]);
    if (scopedDiff.code <= 1) {
      throw new Error(
        `Missing-root-tree scoped diff must exit >1, received ${scopedDiff.code}`,
      );
    }
    if (runGitResult(root, ["cat-file", "-e", absentTree]).code === 0) {
      throw new Error("The absent root tree appeared during scoped diff proof");
    }
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

function assertExactIssue(
  label: string,
  run: ValidatorRun,
  expected: ValidationIssue,
): void {
  const emitted = parseValidation(run);
  if (
    run.exitCode !== 1 || emitted?.ok !== false ||
    emitted.issues.length !== 1 ||
    JSON.stringify(emitted.issues[0]) !== JSON.stringify(expected)
  ) {
    throw new Error(
      `${label} should report only ${
        JSON.stringify(expected)
      }, received exit ${run.exitCode}: ${run.output}`,
    );
  }
}

function removeFixture(fixture: GitFixture): void {
  Deno.removeSync(fixture.root, { recursive: true });
}

Deno.test("WORKFLOW-002 ready scope reaches its semantic decision after exactly 101 unrelated paths", async () => {
  const fixture = createReadyManyUnrelatedFixture();
  try {
    assertExactIssue("ready scope", await captureValidatorRun(fixture), {
      path: "$.ticket.baseRevision",
      code: "ready_base_scope_violation",
      message: "Ready-phase commits may change only canonical ticket metadata",
    });
  } finally {
    removeFixture(fixture);
  }
});

Deno.test("WORKFLOW-002 post-candidate scope reaches its semantic decision after exactly 101 unrelated paths", async () => {
  const fixture = await createPostCandidateManyUnrelatedFixture();
  try {
    assertExactIssue(
      "post-candidate scope",
      await captureValidatorRun(fixture),
      {
        path: "$.state.candidateRevision",
        code: "metadata_scope_violation",
        message:
          "Post-candidate commits may change only canonical ticket metadata",
      },
    );
  } finally {
    removeFixture(fixture);
  }
});

Deno.test("WORKFLOW-002 integrated history ignores exactly 101 unrelated later paths", async () => {
  const fixture = await createIntegratedFixture("unrelated");
  try {
    assertSuccess(
      "integrated unrelated history",
      await captureValidatorRun(fixture),
    );
  } finally {
    removeFixture(fixture);
  }
});

Deno.test("WORKFLOW-002 exact evidence enumeration remains capped at 101 relevant paths", async () => {
  const fixture = await createExactRelevantPathFixture();
  try {
    assertExactIssue(
      "101 relevant candidate paths",
      await captureValidatorRun(fixture),
      {
        path: "$.results[0].candidateRevision",
        code: "git_output_limit",
        message: "Git path evidence contains too many changed paths",
      },
    );
  } finally {
    removeFixture(fixture);
  }
});

Deno.test("WORKFLOW-002 streamed exact evidence above 10000 bytes remains capped below 100 records", async () => {
  const fixture = await createLongOutputFixture();
  try {
    assertExactIssue(
      "streamed candidate evidence",
      await captureValidatorRun(fixture),
      {
        path: "$.results[0].candidateRevision",
        code: "git_output_limit",
        message: "Git path evidence could not be read within limits",
      },
    );
  } finally {
    removeFixture(fixture);
  }
});

Deno.test("WORKFLOW-002 preserves ready and integrated rename and mutation boundaries", async () => {
  const fixtures = [
    createReadyRenameFixture(),
    await createIntegratedFixture("mutation"),
    await createIntegratedFixture("rename"),
  ];
  try {
    assertExactIssue(
      "ready ticket-to-outside rename",
      await captureValidatorRun(fixtures[0]!),
      {
        path: "$.ticket.baseRevision",
        code: "ready_base_scope_violation",
        message:
          "Ready-phase commits may change only canonical ticket metadata",
      },
    );
    for (
      const [label, fixture] of [
        ["ordinary later ticket mutation", fixtures[1]!],
        ["integrated ticket-to-outside rename", fixtures[2]!],
      ] as const
    ) {
      assertExactIssue(label, await captureValidatorRun(fixture), {
        path: "$.state.integrationRevision",
        code: "integration_metadata_mutated",
        message: "Integrated ticket metadata changed after its durable record",
      });
    }
  } finally {
    fixtures.forEach(removeFixture);
  }
});

Deno.test("WORKFLOW-002 maps an intrinsic missing-root-tree scoped Git error without object deletion", async () => {
  const fixture = await createMissingRootTreeFixture();
  try {
    assertExactIssue("missing root tree", await captureValidatorRun(fixture), {
      path: "$.ticket.baseRevision",
      code: "git_output_limit",
      message: "Git path evidence could not be read within limits",
    });
  } finally {
    removeFixture(fixture);
  }
});
