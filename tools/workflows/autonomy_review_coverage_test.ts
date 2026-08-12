import {
  validateTicketBundle,
  type ValidationIssue,
} from "./ticket_contract.ts";
import { runTicketValidator } from "./validate_ticket.ts";

type JsonRecord = Record<string, unknown>;

const AVAILABLE_TASKS = new Set([
  "fmt:check",
  "lint",
  "check",
  "ticket:validate",
  "test:workflow",
  "test:workflow:coverage",
  "test:schema:matrix",
]);
const LEGACY_TICKET_PATH = "docs/planning/tickets/PILOT-002";

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

function assertIssue(
  issues: readonly ValidationIssue[],
  path: string,
  code: string,
): void {
  if (!issues.some((issue) => issue.path === path && issue.code === code)) {
    throw new Error(
      `Expected ${path} ${code}, received ${JSON.stringify(issues)}`,
    );
  }
}

function readLegacyBundle(): JsonRecord {
  const ticket: unknown = JSON.parse(
    Deno.readTextFileSync(`${LEGACY_TICKET_PATH}/ticket.json`),
  );
  const state: unknown = JSON.parse(
    Deno.readTextFileSync(`${LEGACY_TICKET_PATH}/state.json`),
  );
  const stateRecord = asRecord(state);
  const events = Deno.readTextFileSync(`${LEGACY_TICKET_PATH}/events.jsonl`)
    .trim().split(/\r?\n/).map((line) => JSON.parse(line) as unknown);
  return {
    ticket,
    state,
    events,
    results: asArray(stateRecord.resultRefs).map((reference) =>
      JSON.parse(
        Deno.readTextFileSync(`${LEGACY_TICKET_PATH}/${String(reference)}`),
      ) as unknown
    ),
    reviews: asArray(stateRecord.reviewRefs).map((reference) =>
      JSON.parse(
        Deno.readTextFileSync(`${LEGACY_TICKET_PATH}/${String(reference)}`),
      ) as unknown
    ),
  };
}

function appendLegacyIntegration(bundle: JsonRecord): void {
  const state = asRecord(bundle.state);
  const events = asArray(state.events);
  const candidateRevision = String(state.candidateRevision);
  events.push({
    sequence: events.length + 1,
    from: "accepted",
    to: "integrated",
    round: state.round,
    actorRunId: "legacy-orchestrator-integration",
    evidenceRef: "acceptance.md",
    revision: candidateRevision,
  });
  state.phase = "integrated";
  bundle.events = structuredClone(events);
}

async function copyDirectory(
  source: string,
  destination: string,
): Promise<void> {
  await Deno.mkdir(destination, { recursive: true });
  for await (const entry of Deno.readDir(source)) {
    const sourcePath = `${source}/${entry.name}`;
    const destinationPath = `${destination}/${entry.name}`;
    if (entry.isDirectory) {
      await copyDirectory(sourcePath, destinationPath);
    } else if (entry.isFile) {
      await Deno.copyFile(sourcePath, destinationPath);
    }
  }
}

Deno.test("AUTONOMY-001 coverage exercises strict v2 authority diagnostics", () => {
  const ticket = {
    schemaVersion: 2,
    ticketId: "COVERAGE-AUTHORITY",
    revision: 1,
    title: "Exercise defensive authority diagnostics",
    outcome: "Malformed authority is rejected.",
    baseRevision: "1".repeat(40),
    controllerRunId: "",
    executionClass: "unsupported",
    protectedWriteAuthorization: null,
    dependencies: [],
    maxRounds: 1,
    scope: ["Workflow validation"],
    nonGoals: [],
    allowedWrites: ["tools/workflows/"],
    contractRefs: ["docs/planning/tickets/AUTONOMY-001/contract.md"],
    acceptanceCriteria: [{
      id: "AC-01",
      text: "Reject malformed authority.",
      redProof: "Coverage exercises the defensive diagnostics.",
    }],
    requiredTasks: {
      baseline: [{ name: "check", definition: "deno check fixture.ts" }],
      candidate: [{
        name: "check",
        definition: "deno check fixture.ts",
        guardedBy: null,
      }],
    },
    risks: [],
    unresolvedDecisions: [],
  };
  const issues = validateTicketBundle(
    { ticket, state: null, events: [], results: [], reviews: [] },
    AVAILABLE_TASKS,
  );
  assertIssue(issues, "$.ticket.controllerRunId", "empty_value");
  assertIssue(issues, "$.ticket.executionClass", "invalid_value");
});

Deno.test("AUTONOMY-001 coverage retains legacy collection diagnostics", () => {
  const bundle = readLegacyBundle();
  const tasks = asArray(asRecord(bundle.ticket).requiredTasks);
  tasks.push(tasks[0], "missing-workflow-task");
  const issues = validateTicketBundle(bundle, AVAILABLE_TASKS);
  assertIssue(
    issues,
    `$.ticket.requiredTasks[${tasks.length - 2}]`,
    "duplicate_value",
  );
  assertIssue(
    issues,
    `$.ticket.requiredTasks[${tasks.length - 1}]`,
    "task_missing",
  );
});

Deno.test("AUTONOMY-001 coverage preserves legacy integration evidence mapping", async () => {
  const bundle = readLegacyBundle();
  appendLegacyIntegration(bundle);
  const structuralIssues = validateTicketBundle(bundle, AVAILABLE_TASKS);
  if (
    structuralIssues.some((issue) =>
      issue.code === "revision_mismatch" || issue.code === "reference_mismatch"
    )
  ) {
    throw new Error(
      `Legacy integration mapping regressed: ${
        JSON.stringify(structuralIssues)
      }`,
    );
  }

  const root = Deno.makeTempDirSync({ prefix: "autonomy-legacy-coverage-" });
  const ticketDirectory = `${root}/PILOT-002`;
  const originalLog = console.log;
  const output: string[] = [];
  try {
    await copyDirectory(LEGACY_TICKET_PATH, ticketDirectory);
    const state = asRecord(bundle.state);
    Deno.writeTextFileSync(
      `${ticketDirectory}/state.json`,
      `${JSON.stringify(state, null, 2)}\n`,
    );
    Deno.writeTextFileSync(
      `${ticketDirectory}/events.jsonl`,
      `${
        asArray(bundle.events).map((event) => JSON.stringify(event)).join("\n")
      }\n`,
    );
    console.log = (...values: unknown[]): void => {
      output.push(values.map(String).join(" "));
    };
    const exitCode = await runTicketValidator([ticketDirectory]);
    if (exitCode !== 1 || !output.at(-1)?.includes('"ok":false')) {
      throw new Error(
        `External legacy fixture should fail Git containment: ${
          output.join("\n")
        }`,
      );
    }

    output.length = 0;
    const canonicalExitCode = await runTicketValidator([LEGACY_TICKET_PATH]);
    if (
      canonicalExitCode !== 1 ||
      !output.at(-1)?.includes('"metadata_scope_violation"')
    ) {
      throw new Error(
        `Canonical legacy validation should reach Git metadata checks: ${
          output.join("\n")
        }`,
      );
    }
  } finally {
    console.log = originalLog;
    Deno.removeSync(root, { recursive: true });
  }
});
