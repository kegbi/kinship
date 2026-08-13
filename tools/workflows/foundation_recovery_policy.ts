export interface RecoverySnapshot {
  readonly files: Readonly<Record<string, string>>;
  readonly existingPaths: ReadonlySet<string>;
}

export interface PolicyIssue {
  readonly code: string;
  readonly path: string;
}

export const COVERAGE_POLICY_FILES = [
  "AGENTS.md",
  "docs/architecture/quality-gates.md",
  "docs/architecture/technology-baseline.md",
  "docs/planning/README.md",
  "docs/planning/roadmap.md",
  "docs/planning/quality-and-operations.md",
  "docs/development/autonomous-delivery.md",
  ".agents/skills/run-tdd-ticket-loop/SKILL.md",
] as const;

export const DELIVERY_POLICY_FILES = [
  "AGENTS.md",
  "docs/development/autonomous-delivery.md",
  ".agents/skills/run-tdd-ticket-loop/SKILL.md",
] as const;

export const OBSOLETE_WORKFLOW_PATHS = [
  "tools/workflows/ticket_contract.ts",
  "tools/workflows/validate_ticket.ts",
  "tools/workflows/validate_ticket_test.ts",
  ".agents/skills/run-tdd-ticket-loop/assets/acceptance.template.md",
  ".agents/skills/run-tdd-ticket-loop/assets/dispatch.template.md",
  ".agents/skills/run-tdd-ticket-loop/assets/events.template.jsonl",
  ".agents/skills/run-tdd-ticket-loop/assets/finding-waiver.template.json",
  ".agents/skills/run-tdd-ticket-loop/assets/not-applicable-lens.template.json",
  ".agents/skills/run-tdd-ticket-loop/assets/result.template.json",
  ".agents/skills/run-tdd-ticket-loop/assets/review.template.json",
  ".agents/skills/run-tdd-ticket-loop/assets/state.template.json",
  ".agents/skills/run-tdd-ticket-loop/assets/ticket.template.json",
  ".agents/skills/run-tdd-ticket-loop/assets/ticket.template.md",
] as const;

export const RETIRED_RUNTIME_GRAPH_PATHS = [
  "tools/runtime/FND-003",
  "docs/validation/runtime-graph-fnd003.json",
  "docs/validation/runtime-graph-fnd003.md",
] as const;

const OBSOLETE_DELIVERY =
  /controllerRunId|issuedByControllerRunId|actorRunId|events\.jsonl|state\.json|schemaVersion|UUID|ticket-metadata-only|ticket artifacts|state transitions?|state machine/i;
const UNSUPPORTED_AGENT_DIRECTION =
  /\.codex["'`]?\s*(?:[\\/]\s*)+["'`]?\s*agents\b|project\s+custom\s+agents/i;
const GOVERNED_COVERAGE_SCOPE =
  /\b(?:production|back[ -]?end|front[ -]?end|server[ -]?side|client[ -]?side)\b/i;
const QUANTITATIVE_COVERAGE_ASSERTION =
  /(?:\d+(?:\.\d+)?\s*%|\b\w+(?:[- ]\w+)?\s+percent(?:age)?\b|(?:^|\s)0?\.\d+\b)/i;
const NON_GOVERNING_EXAMPLE =
  /\b(?:example|local)\s+(?:coverage\s+report|fixture)\b|\boutside\s+production\b/i;
const APPROVED_COVERAGE_ASSERTIONS = new Set([
  "maintain at least 80% line, branch, and function coverage for production code",
  "production code maintains at least 80% line, branch, and function coverage",
  "production code must maintain at least 80% line, branch, and function coverage",
  "production typescript has at least 80% line, branch, and function coverage",
  "production typescript must reach at least 80% line, branch, and function coverage",
  "production typescript must reach at least 80% line, branch, and function coverage through unit and integration tests",
  "production typescript remains at 80% line, branch, and function coverage",
  "coverage reporting with 80% line, branch, and function thresholds",
  "configure backend and frontend coverage independently at 80% line, branch, and function thresholds with exhaustive production-file inclusion",
  "the minimum is 80% line, branch, and function coverage for each scope",
  "enforce 80% line, branch, and function workflow coverage",
  "independent 80% backend and frontend production typescript gates",
  "deno production typescript/tsx: 80% lines, branches, and functions",
  "frontend production typescript/tsx: 80% lines, branches, and functions",
  "holding each scope at 80% prevents an aggregate report from hiding missing frontend coverage behind backend volume or vice versa",
  "frontend utility/component suites enforce their independent 80% line/branch/function gate",
  "merge all backend unit, integration, contract, and process-observable reports, include every production domain/application/adapter/transport/read-model/ bootstrap/api/worker path, reject shard gaps, and enforce the final independent 80% line/branch/function gate",
  "backend and frontend production typescript independently report 80% line, branch, and function coverage",
  "the minimum production threshold is 80% independently for lines, branches, and functions",
]);
const REQUIRED_COVERAGE_ASSERTIONS: Readonly<
  Record<string, readonly string[]>
> = {
  "AGENTS.md": [
    "maintain at least 80% line, branch, and function coverage for production code",
  ],
  "docs/architecture/quality-gates.md": [
    "production typescript must reach at least 80% line, branch, and function coverage through unit and integration tests",
    "coverage reporting with 80% line, branch, and function thresholds",
  ],
  "docs/architecture/technology-baseline.md": [
    "production typescript has at least 80% line, branch, and function coverage",
  ],
  "docs/planning/README.md": [
    "production typescript remains at 80% line, branch, and function coverage",
  ],
  "docs/planning/roadmap.md": [
    "configure backend and frontend coverage independently at 80% line, branch, and function thresholds with exhaustive production-file inclusion",
    "the minimum is 80% line, branch, and function coverage for each scope",
  ],
  "docs/planning/quality-and-operations.md": [
    "deno production typescript/tsx: 80% lines, branches, and functions",
    "frontend production typescript/tsx: 80% lines, branches, and functions",
  ],
  "docs/development/autonomous-delivery.md": [
    "production code must maintain at least 80% line, branch, and function coverage",
    "the minimum production threshold is 80% independently for lines, branches, and functions",
  ],
  ".agents/skills/run-tdd-ticket-loop/SKILL.md": [
    "production code maintains at least 80% line, branch, and function coverage",
  ],
};
const ROOT_CHECK_COMMAND =
  "DENO_NO_PACKAGE_JSON=1 deno check tools/schema/validate_postgres.ts tools/workflows/foundation_recovery_policy.ts";
const WORKFLOW_COVERAGE_COMMAND =
  "DENO_NO_PACKAGE_JSON=1 deno test --allow-read --coverage=.coverage/workflows --clean tools/workflows/foundation_recovery_policy_test.ts && deno coverage --include=tools/workflows/foundation_recovery_policy\\.ts$ --detailed --threshold=80 .coverage/workflows";

const REQUIRED_TEST_POLICY: Readonly<
  Record<string, ReadonlyArray<readonly [code: string, requirement: RegExp]>>
> = {
  "AGENTS.md": [
    ["tests.changed-behavior", /changed behavior/i],
    [
      "tests.required-e2e",
      /Required user flows still need end-to-end coverage/i,
    ],
    ["tests.security-tenant", /security\/tenant boundaries/i],
    ["tests.schema", /schema behavior always need focused tests/i],
  ],
  "docs/architecture/quality-gates.md": [
    [
      "tests.changed-behavior",
      /Every new or changed production behavior uses a recorded RED/i,
    ],
    [
      "tests.required-e2e",
      /Every defined user-facing workflow[\s\S]{0,120}have end-to-end coverage/i,
    ],
    [
      "tests.security-tenant",
      /rejection of every cross-workspace relationship path/i,
    ],
    ["tests.schema", /## Required Schema Tests/i],
  ],
  "docs/development/autonomous-delivery.md": [
    [
      "tests.changed-behavior",
      /a regression or changed-behavior test for every production change/i,
    ],
    [
      "tests.required-e2e",
      /all required cataloged Playwright flows before a flow is delivered/i,
    ],
    [
      "tests.security-tenant",
      /authorization, workspace-isolation, and other security boundary tests/i,
    ],
    [
      "tests.schema",
      /the PostgreSQL schema matrix for schema or harness changes/i,
    ],
  ],
  ".agents/skills/run-tdd-ticket-loop/SKILL.md": [
    ["tests.changed-behavior", /Changed-behavior tests/i],
    ["tests.required-e2e", /required E2E flows/i],
    [
      "tests.security-tenant",
      /security and tenant-isolation tests/i,
    ],
    ["tests.schema", /schema tests remain mandatory/i],
  ],
};

function file(snapshot: RecoverySnapshot, path: string): string {
  const contents = snapshot.files[path];
  if (contents === undefined) throw new Error(`missing policy input: ${path}`);
  return contents;
}

function issueWhen(
  issues: PolicyIssue[],
  condition: boolean,
  code: string,
  path: string,
): void {
  if (condition) issues.push({ code, path });
}

function isWorkflowCoverageCommand(command: string | undefined): boolean {
  return command === WORKFLOW_COVERAGE_COMMAND;
}

function commandTokens(command: string | undefined): string[] {
  return command?.trim().split(/\s+/).filter(Boolean) ?? [];
}

function isExactCommand(
  command: string | undefined,
  prefix: readonly string[],
  options: readonly string[],
): boolean {
  const tokens = commandTokens(command);
  if (
    tokens.length !== prefix.length + options.length ||
    prefix.some((token, index) => tokens[index] !== token)
  ) return false;
  return JSON.stringify(tokens.slice(prefix.length).sort()) ===
    JSON.stringify([...options].sort());
}

function isDependencyBootstrapTruthful(
  tasks: Readonly<Record<string, string>>,
): boolean {
  const aggregate = tasks.deps?.split(/\s*&&\s*/).map((step) =>
    commandTokens(step).join(" ")
  );
  return isExactCommand(
    tasks["deps:deno"],
    ["DENO_NO_PACKAGE_JSON=1", "deno", "install"],
    ["--frozen", "--node-modules-dir=none"],
  ) && isExactCommand(
    tasks["deps:deno:offline"],
    ["DENO_NO_PACKAGE_JSON=1", "deno", "install"],
    ["--cached-only", "--frozen", "--node-modules-dir=none"],
  ) && isExactCommand(
    tasks["deps:node"],
    ["pnpm", "install"],
    ["--frozen-lockfile"],
  ) && isExactCommand(
    tasks["deps:node:offline"],
    ["pnpm", "install"],
    ["--frozen-lockfile", "--offline"],
  ) && JSON.stringify(aggregate) === JSON.stringify([
        "deno task deps:deno",
        "deno task deps:node",
      ]);
}

function hasDirectTestTarget(command: string | undefined): boolean {
  return /(?:_test|\.test)\.ts(?=$|[\s"'`;>|&])/i.test(command ?? "");
}

function hasCanonicalPnpmLockConfiguration(config: string): boolean {
  const lines = config.split(/\r?\n/);
  const hasExactSetting = (name: string, value: boolean): boolean => {
    const declarations = lines.filter((line) =>
      new RegExp(`^${name}\\s*:`).test(line)
    );
    return declarations.length === 1 &&
      declarations[0] === `${name}: ${value}`;
  };

  return hasExactSetting("lockfile", true) &&
    hasExactSetting("sharedWorkspaceLockfile", true) &&
    hasExactSetting("gitBranchLockfile", false) &&
    !lines.some((line) => /^lockfileDir\s*:/.test(line));
}

function normalizeCoverageAssertion(claim: string): string {
  return claim.toLowerCase().replace(/[`*_#]/g, "").replace(/\s+/g, " ")
    .trim();
}

function controlledCoverageAssertions(policy: string): string[] {
  return policy.split(
    /\r?\n\s*\r?\n|[!?;|]+|\.(?!\d)|(?:^|\r?\n)\s*(?:[-*+]|\d+[.)])\s+/gm,
  ).filter((claim) => {
    if (
      !QUANTITATIVE_COVERAGE_ASSERTION.test(claim) ||
      NON_GOVERNING_EXAMPLE.test(claim)
    ) return false;

    const hasAllMetrics = /\blines?\b/i.test(claim) &&
      /\bbranch(?:es)?\b/i.test(claim) && /\bfunctions?\b/i.test(claim);
    const hasGovernedCoverage = GOVERNED_COVERAGE_SCOPE.test(claim) &&
      (/\bcoverage\b/i.test(claim) || /\bgates?\b/i.test(claim));
    return hasAllMetrics || hasGovernedCoverage;
  }).map(normalizeCoverageAssertion);
}

export function validateFoundationRecovery(
  snapshot: RecoverySnapshot,
): PolicyIssue[] {
  const issues: PolicyIssue[] = [];

  for (const path of COVERAGE_POLICY_FILES) {
    const policy = file(snapshot, path);
    const assertions = controlledCoverageAssertions(policy);
    const required = REQUIRED_COVERAGE_ASSERTIONS[path] ?? [];
    issueWhen(
      issues,
      required.some((assertion) => !assertions.includes(assertion)),
      "coverage.minimum",
      path,
    );
    issueWhen(
      issues,
      assertions.some((assertion) =>
        !APPROVED_COVERAGE_ASSERTIONS.has(assertion)
      ),
      "coverage.superseded",
      path,
    );
    issueWhen(
      issues,
      UNSUPPORTED_AGENT_DIRECTION.test(policy),
      "delivery.unsupported-agent-path",
      path,
    );
  }

  for (const path of DELIVERY_POLICY_FILES) {
    const policy = file(snapshot, path);
    const requirements = [
      /RED[^\n]*(?:GREEN|-> GREEN)[^\n]*REFACTOR/i,
      /fresh|clean/i,
      /read-only/i,
      /exact candidate revision/i,
      /concise\s+evidence/i,
      /finding[\s\S]{0,120}fresh implementer/i,
    ];
    issueWhen(
      issues,
      requirements.some((requirement) => !requirement.test(policy)),
      "delivery.missing",
      path,
    );
    issueWhen(
      issues,
      OBSOLETE_DELIVERY.test(policy),
      "delivery.obsolete",
      path,
    );
  }

  for (const [path, requirements] of Object.entries(REQUIRED_TEST_POLICY)) {
    const policy = file(snapshot, path);
    for (const [code, requirement] of requirements) {
      issueWhen(issues, !requirement.test(policy), code, path);
    }
  }

  const denoConfig = JSON.parse(file(snapshot, "deno.json")) as {
    fmt: { exclude?: string[] };
    tasks: Record<string, string>;
    lock?: { frozen?: boolean; path?: string };
  };
  const tasks = denoConfig.tasks;
  const checkHasTestTarget = hasDirectTestTarget(tasks.check);
  const checkHasShellControl = /[;|>&]/.test(tasks.check ?? "");
  issueWhen(
    issues,
    !denoConfig.fmt.exclude?.includes("docs/planning/tickets/"),
    "toolchain.formatter-history",
    "deno.json",
  );
  issueWhen(
    issues,
    checkHasTestTarget,
    "toolchain.hidden-test",
    "deno.json",
  );
  issueWhen(
    issues,
    denoConfig.lock?.frozen !== true ||
      denoConfig.lock.path !== "./deno.lock" ||
      !isDependencyBootstrapTruthful(tasks),
    "toolchain.dependencies",
    "deno.json",
  );
  issueWhen(
    issues,
    !hasCanonicalPnpmLockConfiguration(
      file(snapshot, "pnpm-workspace.yaml"),
    ),
    "toolchain.dependencies",
    "pnpm-workspace.yaml",
  );
  issueWhen(
    issues,
    tasks["ticket:validate"] !== undefined ||
      (tasks.check !== ROOT_CHECK_COMMAND &&
        (!checkHasTestTarget || checkHasShellControl)) ||
      tasks["test:workflow"] !==
        "DENO_NO_PACKAGE_JSON=1 deno test --allow-read tools/workflows/foundation_recovery_policy_test.ts" ||
      !isWorkflowCoverageCommand(tasks["test:workflow:coverage"]) ||
      /--allow-(?:write|run)/.test(tasks["test:workflow"] ?? ""),
    "toolchain.deno",
    "deno.json",
  );

  const packageManifest = JSON.parse(file(snapshot, "package.json")) as {
    engines: Record<string, string>;
    packageManager: string;
  };
  issueWhen(
    issues,
    packageManifest.engines.node !== ">=24.0.0 <25" ||
      packageManifest.engines.pnpm !== "11.21.0" ||
      !/^pnpm@11\.21\.0\+sha512\./.test(packageManifest.packageManager),
    "toolchain.node",
    "package.json",
  );
  issueWhen(
    issues,
    !file(snapshot, ".gitignore").split(/\r?\n/).includes("node_modules/"),
    "toolchain.ignore",
    ".gitignore",
  );

  for (const path of OBSOLETE_WORKFLOW_PATHS) {
    issueWhen(
      issues,
      snapshot.existingPaths.has(path),
      "workflow.obsolete-path",
      path,
    );
  }

  for (const path of RETIRED_RUNTIME_GRAPH_PATHS) {
    issueWhen(
      issues,
      snapshot.existingPaths.has(path),
      "runtime.retired-artifact",
      path,
    );
  }

  return issues;
}
