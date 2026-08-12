const REPOSITORY_ROOT = new URL("../../../", import.meta.url);
const DENO_CONFIG_URL = new URL("deno.json", REPOSITORY_ROOT);
const DELIVERY_CONTRACT_URL = new URL(
  "docs/development/autonomous-delivery.md",
  REPOSITORY_ROOT,
);
const WORKTREE_SECTION_HEADING = "## Worktrees, branches, and threads";

const EXPECTED_POLICY_BLOCK = normalizeProse(`
Every persistent desktop pilot has exactly one top-level Codex ticket task and
exactly one corresponding opaque \`ticketTaskId\`. \`integration.md\` records that
ID exactly once. Implementer and reviewer executions are roles of that ticket
task and do not create, replace, or count as additional ticket-task
identities.

For every implementer or reviewer execution, \`integration.md\` separately
records exactly one fresh controller-issued \`implementerRunId\` or
\`reviewerRunId\`, as applicable, and exactly one opaque \`worktreeRef\`. The
\`ticketTaskId\`, the ticket's \`controllerRunId\`, and all implementer and
reviewer run IDs are mutually distinct; a task ID never substitutes for a run
ID or vice versa.

All persisted task, controller, role-run, and worktree identifiers are opaque
stable identifiers. A \`worktreeRef\` is a controller-issued alias of the form
\`worktree:<ticket-id>:<ordinal>\`. No persisted identifier or reference
contains an absolute or repository-relative filesystem path, a \`..\` segment,
or user, profile, personal, client, credential, secret-bearing, or other
sensitive topology information. Within one pilot, two executions use the same
physical worktree if and only if they record the same \`worktreeRef\`; distinct
physical worktrees always use distinct references. Once issued, an alias is
never rebound to another worktree.

Sequential role executions may reuse one physical worktree and its
\`worktreeRef\`, or use distinct ones. Concurrent write-enabled executions must
use distinct physical worktrees and distinct references. Reviewers remain
read-only; a reviewer may share a worktree with another read-only execution,
but never with an active write-enabled execution.
`);

function assertRecord(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Expected ${label} to be an object`);
  }
}

function taskDefinition(
  tasks: Record<string, unknown>,
  taskName: string,
): string {
  const definition = tasks[taskName];
  if (typeof definition !== "string") {
    throw new Error(`Expected deno.json task ${taskName} to be a string`);
  }
  return definition;
}

function assertDiscoversWorkflowDirectory(
  taskName: string,
  definition: string,
): void {
  const testCommand = definition.split("&&", 1)[0]?.trim() ?? "";
  const commandParts = testCommand.split(/\s+/u);
  if (
    commandParts[0] !== "deno" || commandParts[1] !== "test" ||
    !commandParts.includes("tools/workflows")
  ) {
    throw new Error(
      `Expected deno.json task ${taskName} to run deno test against tools/workflows`,
    );
  }
}

function normalizeProse(source: string): string {
  return source.replaceAll("\r\n", "\n").trim().split(/\n\s*\n/u).map(
    (paragraph) => paragraph.replace(/\s+/gu, " ").trim(),
  ).join("\n\n");
}

function countOccurrences(source: string, expected: string): number {
  let count = 0;
  let offset = 0;
  while (offset <= source.length - expected.length) {
    const index = source.indexOf(expected, offset);
    if (index === -1) break;
    count += 1;
    offset = index + expected.length;
  }
  return count;
}

function worktreeSection(document: string): string {
  const sectionStart = document.indexOf(WORKTREE_SECTION_HEADING);
  if (sectionStart === -1) {
    throw new Error(`Missing ${WORKTREE_SECTION_HEADING} section`);
  }
  const nextSection = document.indexOf("\n## ", sectionStart + 1);
  return document.slice(
    sectionStart,
    nextSection === -1 ? document.length : nextSection,
  );
}

Deno.test("PILOT-006 canonical workflow tasks discover the pilot test directory", () => {
  const config: unknown = JSON.parse(Deno.readTextFileSync(DENO_CONFIG_URL));
  assertRecord(config, "deno.json root");
  assertRecord(config.tasks, "deno.json tasks");

  for (
    const taskName of ["test:workflow", "test:workflow:coverage"] as const
  ) {
    assertDiscoversWorkflowDirectory(
      taskName,
      taskDefinition(config.tasks, taskName),
    );
  }
});

Deno.test("PILOT-006 delivery contract contains the exact provenance policy once", () => {
  const document = Deno.readTextFileSync(DELIVERY_CONTRACT_URL);
  const normalizedDocument = normalizeProse(document);
  const normalizedSection = normalizeProse(worktreeSection(document));
  const documentCount = countOccurrences(
    normalizedDocument,
    EXPECTED_POLICY_BLOCK,
  );
  const sectionCount = countOccurrences(
    normalizedSection,
    EXPECTED_POLICY_BLOCK,
  );

  if (documentCount !== 1 || sectionCount !== 1) {
    throw new Error(
      "Expected the exact contiguous four-paragraph persistent desktop " +
        "provenance policy once in Worktrees, branches, and threads; " +
        `found ${sectionCount} in that section and ${documentCount} document-wide`,
    );
  }
});
