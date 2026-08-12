type JsonRecord = Record<string, unknown>;

function read(relativePath: string): string {
  return Deno.readTextFileSync(
    new URL(`../../${relativePath}`, import.meta.url),
  );
}

function parseObject(relativePath: string): JsonRecord {
  const value: unknown = JSON.parse(read(relativePath));
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${relativePath} must contain a JSON object`);
  }
  return value as JsonRecord;
}

function objectField(record: JsonRecord, field: string): JsonRecord {
  const value = record[field];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Expected ${field} to be an object`);
  }
  return value as JsonRecord;
}

function firstObject(value: unknown, label: string): JsonRecord {
  if (
    !Array.isArray(value) || value.length === 0 ||
    typeof value[0] !== "object" || value[0] === null ||
    Array.isArray(value[0])
  ) {
    throw new Error(`Expected ${label} to contain an object`);
  }
  return value[0] as JsonRecord;
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(
      `Expected ${label} to equal ${JSON.stringify(expected)}, received ${
        JSON.stringify(actual)
      }`,
    );
  }
}

function assertHasOwn(record: JsonRecord, field: string): void {
  if (!Object.hasOwn(record, field)) {
    throw new Error(`Expected field ${field}`);
  }
}

function assertIncludesAll(
  relativePath: string,
  expectedValues: readonly string[],
): void {
  const source = read(relativePath);
  const missing = expectedValues.filter((value) => !source.includes(value));
  if (missing.length > 0) {
    throw new Error(
      `${relativePath} is missing ${
        missing.map((value) => JSON.stringify(value)).join(", ")
      }`,
    );
  }
}

Deno.test("AUTONOMY-001 ticket and state templates express v2 authority", () => {
  const ticket = parseObject(
    ".agents/skills/run-tdd-ticket-loop/assets/ticket.template.json",
  );
  assertEqual(ticket.schemaVersion, 2, "ticket schemaVersion");
  assertHasOwn(ticket, "controllerRunId");
  assertEqual(ticket.executionClass, "ordinary", "executionClass");
  assertEqual(
    ticket.protectedWriteAuthorization,
    null,
    "protectedWriteAuthorization",
  );
  const requiredTasks = objectField(ticket, "requiredTasks");
  const baseline = firstObject(requiredTasks.baseline, "baseline tasks");
  const candidate = firstObject(requiredTasks.candidate, "candidate tasks");
  assertHasOwn(baseline, "definition");
  assertHasOwn(candidate, "definition");
  assertHasOwn(candidate, "guardedBy");
  assertEqual(candidate.name, baseline.name, "candidate task name");

  const state = parseObject(
    ".agents/skills/run-tdd-ticket-loop/assets/state.template.json",
  );
  assertEqual(state.schemaVersion, 1, "state schemaVersion");
  const event = firstObject(state.events, "state events");
  assertEqual(
    event.actorRunId,
    "<TICKET-ID>/orchestrator/r0/<UUID>",
    "ready event actorRunId",
  );
});

Deno.test("AUTONOMY-001 result and review templates bind controller issuance", () => {
  const result = parseObject(
    ".agents/skills/run-tdd-ticket-loop/assets/result.template.json",
  );
  assertEqual(result.schemaVersion, 2, "result schemaVersion");
  assertEqual(
    result.implementerRunId,
    "<TICKET-ID>/implementer/r1/<UUID>",
    "implementerRunId",
  );
  assertHasOwn(result, "issuedByControllerRunId");

  const review = parseObject(
    ".agents/skills/run-tdd-ticket-loop/assets/review.template.json",
  );
  assertEqual(review.schemaVersion, 2, "review schemaVersion");
  assertEqual(
    review.reviewerRunId,
    "<TICKET-ID>/reviewer/r1/<UUID>",
    "reviewerRunId",
  );
  assertHasOwn(review, "issuedByControllerRunId");
});

Deno.test("AUTONOMY-001 skill, dispatch, and role prompts state v2 controls", () => {
  assertIncludesAll(
    ".agents/skills/run-tdd-ticket-loop/SKILL.md",
    [
      "schema version 2",
      "controllerRunId",
      "protected-config-maintenance",
      "integrationRevision",
      "integrationChecks",
      "guardedBy",
    ],
  );
  assertIncludesAll(
    ".agents/skills/run-tdd-ticket-loop/assets/dispatch.template.md",
    ["Controller run ID:", "Implementer run ID:", "Execution class:"],
  );
  assertIncludesAll(
    ".codex/agents/feature-implementer.toml",
    [
      "controller-issued implementer run ID",
      "issuedByControllerRunId",
      "`.git`",
      "`.codex`",
      "`.agents`",
    ],
  );
  assertIncludesAll(
    ".codex/agents/orchestrator.toml",
    [
      "controllerRunId",
      "integrationRevision",
      "integrationChecks",
      "integration.md",
      "guardedBy",
    ],
  );
  assertIncludesAll(
    ".codex/agents/reviewer.toml",
    ["controller-issued reviewer run ID", "issuedByControllerRunId"],
  );
});

Deno.test("AUTONOMY-001 delivery contracts document enforced v2 behavior", () => {
  const requiredLanguage = [
    "schemaVersion 2",
    "controllerRunId",
    "protected-config-maintenance",
    "integrationRevision",
    "integrationChecks",
    "integration.md",
    "guardedBy",
    "dependency ticket's base revision",
  ] as const;
  assertIncludesAll(
    "docs/development/autonomous-delivery.md",
    requiredLanguage,
  );
  assertIncludesAll("docs/architecture/quality-gates.md", requiredLanguage);
});
