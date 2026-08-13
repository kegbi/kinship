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

function withWorkflowCoverageTask(
  snapshot: RecoverySnapshot,
  command: string,
): RecoverySnapshot {
  return mutate(snapshot, "deno.json", (contents) => {
    const config = JSON.parse(contents) as { tasks: Record<string, string> };
    config.tasks["test:workflow:coverage"] = command;
    return JSON.stringify(config);
  });
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

Deno.test("validator rejects non-executable workflow coverage tasks", () => {
  const validCommand =
    "DENO_NO_PACKAGE_JSON=1 deno test --allow-read --coverage=.coverage/workflows --clean tools/workflows/foundation_recovery_policy_test.ts && deno coverage --include=tools/workflows/foundation_recovery_policy\\.ts$ --detailed --threshold=80 .coverage/workflows";
  const invalidCommands = [
    "DENO_NO_PACKAGE_JSON=1 deno eval --threshold=80 \"console.log('covered')\"",
    validCommand.split(" && ")[1] ?? "",
    validCommand.split(" && ")[0] ?? "",
    validCommand.replace(
      "--include=tools/workflows/foundation_recovery_policy\\.ts$",
      "--include=tools/workflows/other\\.ts$",
    ),
    validCommand.replace("--threshold=80", "--threshold=79"),
    `${validCommand} || DENO_NO_PACKAGE_JSON=1 deno eval \"Deno.exit(0)\"`,
    validCommand.replace("deno test", "deno test --filter=no-tests"),
    validCommand.replace("deno test", "deno test --quiet"),
    `${validCommand} > /dev/null`,
    `${validCommand} ; DENO_NO_PACKAGE_JSON=1 deno eval \"Deno.exit(0)\"`,
    `${validCommand} | DENO_NO_PACKAGE_JSON=1 deno eval \"Deno.exit(0)\"`,
  ];

  for (const command of invalidCommands) {
    const snapshot = withWorkflowCoverageTask(repositorySnapshot(), command);
    assertEquals(issueCodes(validateFoundationRecovery(snapshot)), [
      "toolchain.deno",
    ]);
  }
});

Deno.test("validator retains every mandatory test class in policy inputs", () => {
  const cases: ReadonlyArray<
    readonly [path: string, removed: string | RegExp, issueCode: string]
  > = [
    ["AGENTS.md", "changed behavior", "tests.changed-behavior"],
    [
      "AGENTS.md",
      "Required user flows still need end-to-end coverage",
      "tests.required-e2e",
    ],
    ["AGENTS.md", "security/tenant boundaries", "tests.security-tenant"],
    ["AGENTS.md", "schema behavior", "tests.schema"],
    [
      "docs/architecture/quality-gates.md",
      "Every new or changed production behavior",
      "tests.changed-behavior",
    ],
    [
      "docs/architecture/quality-gates.md",
      /Every defined user-facing workflow[\s\S]*?have end-to-end coverage\./,
      "tests.required-e2e",
    ],
    [
      "docs/architecture/quality-gates.md",
      "rejection of every cross-workspace relationship path;",
      "tests.security-tenant",
    ],
    [
      "docs/architecture/quality-gates.md",
      "## Required Schema Tests",
      "tests.schema",
    ],
    [
      "docs/development/autonomous-delivery.md",
      "a regression or changed-behavior test for every production change;",
      "tests.changed-behavior",
    ],
    [
      "docs/development/autonomous-delivery.md",
      "all required cataloged Playwright flows before a flow is delivered;",
      "tests.required-e2e",
    ],
    [
      "docs/development/autonomous-delivery.md",
      "authorization, workspace-isolation, and other security boundary tests;",
      "tests.security-tenant",
    ],
    [
      "docs/development/autonomous-delivery.md",
      "the PostgreSQL schema matrix for schema or harness changes;",
      "tests.schema",
    ],
    [
      ".agents/skills/run-tdd-ticket-loop/SKILL.md",
      "Changed-behavior tests",
      "tests.changed-behavior",
    ],
    [
      ".agents/skills/run-tdd-ticket-loop/SKILL.md",
      "required E2E flows",
      "tests.required-e2e",
    ],
    [
      ".agents/skills/run-tdd-ticket-loop/SKILL.md",
      "security and tenant-isolation tests",
      "tests.security-tenant",
    ],
    [
      ".agents/skills/run-tdd-ticket-loop/SKILL.md",
      "schema tests",
      "tests.schema",
    ],
  ];

  for (const [path, removed, issueCode] of cases) {
    const snapshot = mutate(
      repositorySnapshot(),
      path,
      (contents) =>
        contents.replace(removed, "policy requirement removed for mutation"),
    );
    assertEquals(issueCodes(validateFoundationRecovery(snapshot)), [issueCode]);
  }
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
