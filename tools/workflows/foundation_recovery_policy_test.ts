import {
  COVERAGE_POLICY_FILES,
  DELIVERY_POLICY_FILES,
  OBSOLETE_WORKFLOW_PATHS,
  type PolicyIssue,
  type RecoverySnapshot,
  validateFoundationRecovery,
} from "./foundation_recovery_policy.ts";

const INPUT_PATHS = [
  ...new Set([
    ...COVERAGE_POLICY_FILES,
    ...DELIVERY_POLICY_FILES,
    "deno.json",
    "package.json",
    ".gitignore",
  ]),
];

function repositorySnapshot(): RecoverySnapshot {
  const files = Object.fromEntries(
    INPUT_PATHS.map((path) => [path, Deno.readTextFileSync(path)]),
  );
  const existingPaths = new Set<string>();
  for (const path of OBSOLETE_WORKFLOW_PATHS) {
    try {
      Deno.statSync(path);
      existingPaths.add(path);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
  return { files, existingPaths };
}

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function mutate(
  snapshot: RecoverySnapshot,
  path: string,
  transform: (contents: string) => string,
): RecoverySnapshot {
  return {
    ...snapshot,
    files: { ...snapshot.files, [path]: transform(snapshot.files[path] ?? "") },
  };
}

function issueCodes(issues: PolicyIssue[]): string[] {
  return [...new Set(issues.map((issue) => issue.code))].sort();
}

Deno.test("repository satisfies the foundation recovery policy", () => {
  assertEquals(validateFoundationRecovery(repositorySnapshot()), []);
});

Deno.test("validator rejects coverage and delivery policy regression", () => {
  let snapshot = repositorySnapshot();
  snapshot = mutate(
    snapshot,
    "AGENTS.md",
    (value) =>
      value.replace("80% line, branch, and function", "70% line and function"),
  );
  snapshot = mutate(
    snapshot,
    ".agents/skills/run-tdd-ticket-loop/SKILL.md",
    (value) => `${value}\ncontrollerRunId\n`,
  );
  assertEquals(issueCodes(validateFoundationRecovery(snapshot)), [
    "coverage.minimum",
    "delivery.obsolete",
  ]);
});

Deno.test("validator rejects toolchain drift and obsolete workflow paths", () => {
  let snapshot = repositorySnapshot();
  snapshot = mutate(
    snapshot,
    "deno.json",
    (value) => value.replace("--threshold=80", "--threshold=79"),
  );
  snapshot = mutate(
    snapshot,
    "package.json",
    (value) => value.replace(">=24.0.0 <25", "24.19.0"),
  );
  snapshot = mutate(
    snapshot,
    ".gitignore",
    (value) => value.replace("node_modules/", ""),
  );
  snapshot = {
    ...snapshot,
    existingPaths: new Set([OBSOLETE_WORKFLOW_PATHS[0]]),
  };
  assertEquals(issueCodes(validateFoundationRecovery(snapshot)), [
    "toolchain.deno",
    "toolchain.ignore",
    "toolchain.node",
    "workflow.obsolete-path",
  ]);
});

Deno.test("validator fails closed when a required policy input is absent", () => {
  const snapshot = repositorySnapshot();
  const files = { ...snapshot.files };
  delete files["AGENTS.md"];
  let message = "";
  try {
    validateFoundationRecovery({ ...snapshot, files });
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assertEquals(message, "missing policy input: AGENTS.md");
});
