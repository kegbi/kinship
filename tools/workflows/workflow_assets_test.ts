function read(relativePath: string): string {
  return Deno.readTextFileSync(
    new URL(`../../${relativePath}`, import.meta.url),
  );
}

function parseObject(relativePath: string): Record<string, unknown> {
  const value: unknown = JSON.parse(read(relativePath));
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${relativePath} must contain a JSON object`);
  }
  return value as Record<string, unknown>;
}

function assertHasOwn(record: Record<string, unknown>, field: string): void {
  if (!Object.hasOwn(record, field)) {
    throw new Error(
      `Expected field ${field}, received ${JSON.stringify(record)}`,
    );
  }
}

function assertIncludes(text: string, expected: string): void {
  if (!text.includes(expected)) {
    throw new Error(`Expected text to include ${JSON.stringify(expected)}`);
  }
}

Deno.test("ticket templates express the complete Definition of Ready", () => {
  const template = parseObject(
    ".agents/skills/run-tdd-ticket-loop/assets/ticket.template.json",
  );
  for (
    const field of [
      "outcome",
      "dependencies",
      "risks",
      "unresolvedDecisions",
    ]
  ) {
    assertHasOwn(template, field);
  }
  const criteria = template.acceptanceCriteria;
  if (!Array.isArray(criteria) || criteria.length !== 1) {
    throw new Error("Expected one template acceptance criterion");
  }
  const criterion = criteria[0];
  if (
    typeof criterion !== "object" || criterion === null ||
    Array.isArray(criterion)
  ) {
    throw new Error("Expected an acceptance criterion object");
  }
  assertHasOwn(criterion as Record<string, unknown>, "redProof");

  const markdown = read(
    ".agents/skills/run-tdd-ticket-loop/assets/ticket.template.md",
  );
  assertIncludes(markdown, "## Unresolved decisions");
  assertIncludes(markdown, "criterion-specific RED proof");

  const state = parseObject(
    ".agents/skills/run-tdd-ticket-loop/assets/state.template.json",
  );
  assertHasOwn(state, "dependencyRevisions");
  assertIncludes(
    read("docs/development/autonomous-delivery.md"),
    "dependencyRevisions",
  );
});

Deno.test("result assets bind RED evidence to a frozen revision and test blobs", () => {
  const template = parseObject(
    ".agents/skills/run-tdd-ticket-loop/assets/result.template.json",
  );
  assertHasOwn(template, "redRevision");
  const red = template.red;
  if (typeof red !== "object" || red === null || Array.isArray(red)) {
    throw new Error("Expected a RED evidence object");
  }
  const redRecord = red as Record<string, unknown>;
  for (
    const field of ["expectedFailure", "output", "testFiles", "productionFiles"]
  ) {
    assertHasOwn(redRecord, field);
  }
  const testFiles = redRecord.testFiles;
  if (!Array.isArray(testFiles) || testFiles.length !== 1) {
    throw new Error("Expected one content-addressed test-file template");
  }
  const testFile = testFiles[0];
  if (
    typeof testFile !== "object" || testFile === null || Array.isArray(testFile)
  ) {
    throw new Error("Expected a test-file evidence object");
  }
  assertHasOwn(testFile as Record<string, unknown>, "path");
  assertHasOwn(testFile as Record<string, unknown>, "sha256");

  assertIncludes(
    read(".codex/agents/feature-implementer.toml"),
    "Stop after RED",
  );
  assertIncludes(
    read(".agents/skills/run-tdd-ticket-loop/SKILL.md"),
    "freeze the RED revision",
  );
  assertIncludes(read("docs/development/autonomous-delivery.md"), "SHA-256");
});

Deno.test("review role and assets require fully traceable findings", () => {
  const template = parseObject(
    ".agents/skills/run-tdd-ticket-loop/assets/review.template.json",
  );
  const findings = template.findings;
  if (!Array.isArray(findings) || findings.length !== 1) {
    throw new Error("Expected one actionable finding template");
  }
  const finding = findings[0];
  if (
    typeof finding !== "object" || finding === null || Array.isArray(finding)
  ) {
    throw new Error("Expected an actionable finding object");
  }
  const findingRecord = finding as Record<string, unknown>;
  for (
    const field of [
      "id",
      "lens",
      "severity",
      "location",
      "expectedBehavior",
      "observedBehavior",
      "reproduction",
      "impact",
      "affectedCriterion",
      "contractRef",
      "requiredRemediation",
      "verification",
      "status",
    ]
  ) {
    assertHasOwn(findingRecord, field);
  }

  const reviewer = read(".codex/agents/reviewer.toml");
  assertIncludes(reviewer, "affected acceptance criterion");
  assertIncludes(reviewer, "expected and observed behavior");
  assertIncludes(reviewer, "contract reference");
  assertIncludes(reviewer, "resolution status");

  const dispatch = read(
    ".agents/skills/run-tdd-ticket-loop/assets/dispatch.template.md",
  );
  for (
    const label of [
      "Expected behavior:",
      "Observed behavior:",
      "Impact:",
      "Affected criterion:",
      "Contract reference:",
      "Required remediation:",
      "Verification:",
      "Resolution status:",
    ]
  ) {
    assertIncludes(dispatch, label);
  }
});

Deno.test("event ledger template is append-only and agrees with state events", () => {
  const ledger = read(
    ".agents/skills/run-tdd-ticket-loop/assets/events.template.jsonl",
  ).trim();
  if (ledger.length === 0 || ledger.includes("\n")) {
    throw new Error("Expected exactly one initial JSONL event");
  }
  const event: unknown = JSON.parse(ledger);
  if (typeof event !== "object" || event === null || Array.isArray(event)) {
    throw new Error("Expected an event object");
  }
  const eventRecord = event as Record<string, unknown>;
  for (
    const field of [
      "sequence",
      "from",
      "to",
      "round",
      "actorRunId",
      "evidenceRef",
      "revision",
    ]
  ) {
    assertHasOwn(eventRecord, field);
  }

  const state = parseObject(
    ".agents/skills/run-tdd-ticket-loop/assets/state.template.json",
  );
  const stateEvents = state.events;
  if (!Array.isArray(stateEvents) || stateEvents.length !== 1) {
    throw new Error("Expected one initial state event");
  }
  const stateEvent = stateEvents[0];
  if (
    typeof stateEvent !== "object" || stateEvent === null ||
    Array.isArray(stateEvent)
  ) {
    throw new Error("Expected a state event object");
  }
  assertHasOwn(stateEvent as Record<string, unknown>, "evidenceRef");
  assertHasOwn(stateEvent as Record<string, unknown>, "revision");

  const delivery = read("docs/development/autonomous-delivery.md");
  assertIncludes(delivery, "state.events exactly matches events.jsonl");
  assertIncludes(delivery, "append-only");
  assertIncludes(read(".codex/agents/orchestrator.toml"), "events.jsonl");
});

Deno.test("root workflow tasks and current-command documentation are truthful", () => {
  const deno = parseObject("deno.json");
  const tasks = deno.tasks;
  if (typeof tasks !== "object" || tasks === null || Array.isArray(tasks)) {
    throw new Error("Expected a Deno tasks object");
  }
  const taskRecord = tasks as Record<string, unknown>;
  for (
    const task of ["ticket:validate", "test:workflow", "test:workflow:coverage"]
  ) {
    assertHasOwn(taskRecord, task);
    if (typeof taskRecord[task] !== "string" || taskRecord[task].length === 0) {
      throw new Error(`Expected ${task} to execute a real command`);
    }
  }
  assertIncludes(String(taskRecord["ticket:validate"]), "validate_ticket.ts");
  assertIncludes(String(taskRecord["test:workflow"]), "deno test");
  assertIncludes(String(taskRecord["test:workflow"]), "--allow-run=deno");
  assertIncludes(
    String(taskRecord["test:workflow:coverage"]),
    "--threshold=100",
  );
  assertIncludes(
    String(taskRecord["test:workflow:coverage"]),
    "--allow-run=deno",
  );
  assertIncludes(String(taskRecord.check), "tools/schema/validate_postgres.ts");
  assertIncludes(
    String(taskRecord.check),
    "tools/workflows/ticket_contract.ts",
  );
  assertIncludes(
    String(taskRecord.check),
    "tools/workflows/validate_ticket.ts",
  );

  const fmt = deno.fmt;
  if (typeof fmt !== "object" || fmt === null || Array.isArray(fmt)) {
    throw new Error("Expected Deno formatter configuration");
  }
  const includes = (fmt as Record<string, unknown>).include;
  if (!Array.isArray(includes)) {
    throw new Error("Expected formatter include paths");
  }
  for (
    const path of [".agents/skills/run-tdd-ticket-loop/", ".codex/agents/"]
  ) {
    if (!includes.includes(path)) {
      throw new Error(`Expected formatter ownership for ${path}`);
    }
  }

  for (
    const path of [
      "docs/architecture/quality-gates.md",
      "docs/development/autonomous-delivery.md",
      "docs/planning/quality-and-operations.md",
    ]
  ) {
    const contents = read(path);
    assertIncludes(contents, "deno task ticket:validate");
    assertIncludes(contents, "deno task test:workflow");
    assertIncludes(contents, "deno task test:workflow:coverage");
  }
});
