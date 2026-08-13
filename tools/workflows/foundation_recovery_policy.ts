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

const COVERAGE_MINIMUM =
  /80%[^\n]*(?:line|lines)[^\n]*(?:branch|branches)[^\n]*(?:function|functions)/i;
const OBSOLETE_DELIVERY =
  /controllerRunId|issuedByControllerRunId|actorRunId|events\.jsonl|state\.json|schemaVersion|UUID|ticket-metadata-only|ticket artifacts|state transitions?|state machine/i;
const UNSUPPORTED_AGENT_DIRECTION =
  /\.codex["'`]?\s*(?:[\\/]\s*)+["'`]?\s*agents\b|project\s+custom\s+agents/i;
const GOVERNED_COVERAGE_SCOPE =
  /\b(?:production|back[ -]?end|front[ -]?end|server[ -]?side|client[ -]?side)\b/i;
const COVERAGE_ASSERTION =
  /\b(?:floor|minimum|threshold|gate|rate|at\s+least|at\s+most|up\s+to|maximum|no\s+more\s+than|cap(?:ped)?|ceiling|may|must|required|accepted|maintain)\b/i;
const COVERAGE_CAP =
  /\b(?:at\s+most|up\s+to|maximum(?:\s+of)?|no\s+more\s+than|cap(?:ped)?|ceiling)\b/i;
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

function unquoteCommandToken(token: string): string {
  const quote = token[0];
  return quote !== undefined && /["'`]/.test(quote) && token.at(-1) === quote
    ? token.slice(1, -1)
    : token;
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
  return commandTokens(command).map(unquoteCommandToken).some((token) =>
    /(?:_test|\.test)\.ts$/i.test(token)
  );
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

function coverageThresholds(claim: string): number[] {
  const thresholds = [...claim.matchAll(
    /\b(\d+(?:\.\d+)?)\s*(?:%|percent(?:age)?\b)/gi,
  )].map((match) => Number(match[1]));

  const wordThresholds: Readonly<Record<string, number>> = {
    "seventy-nine": 79,
    "seventy nine": 79,
    eighty: 80,
  };
  for (
    const match of claim.matchAll(
      /\b(seventy(?:[- ]nine)|eighty)\s+percent(?:age)?\b/gi,
    )
  ) {
    const threshold = wordThresholds[match[1]?.toLowerCase() ?? ""];
    if (threshold !== undefined) thresholds.push(threshold);
  }

  for (
    const match of claim.matchAll(
      /\b(?:rate(?:\s+must\s+be)?|must\s+be)\s+(0\.\d+)\b/gi,
    )
  ) {
    thresholds.push(Number(match[1]) * 100);
  }
  return thresholds;
}

function hasConflictingProductionCoverageThreshold(policy: string): boolean {
  const claims = policy.split(
    /[!?;|]+|\.(?!\d)|(?:^|\r?\n)\s*(?:[-*+]|\d+[.)])\s+/gm,
  );
  for (const claim of claims) {
    const hasAllMetrics = /\blines?\b/i.test(claim) &&
      /\bbranch(?:es)?\b/i.test(claim) && /\bfunctions?\b/i.test(claim);
    const describesProductionCoverage = GOVERNED_COVERAGE_SCOPE.test(claim) &&
      (/\bcoverage\b/i.test(claim) || hasAllMetrics) &&
      COVERAGE_ASSERTION.test(claim);
    if (!describesProductionCoverage) continue;

    const thresholds = coverageThresholds(claim);
    if (thresholds.length > 0 && COVERAGE_CAP.test(claim)) return true;
    if (thresholds.some((threshold) => threshold !== 80)) return true;
  }
  return false;
}

export function validateFoundationRecovery(
  snapshot: RecoverySnapshot,
): PolicyIssue[] {
  const issues: PolicyIssue[] = [];

  for (const path of COVERAGE_POLICY_FILES) {
    const policy = file(snapshot, path);
    issueWhen(issues, !COVERAGE_MINIMUM.test(policy), "coverage.minimum", path);
    issueWhen(
      issues,
      hasConflictingProductionCoverageThreshold(policy),
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
  issueWhen(
    issues,
    !denoConfig.fmt.exclude?.includes("docs/planning/tickets/"),
    "toolchain.formatter-history",
    "deno.json",
  );
  issueWhen(
    issues,
    hasDirectTestTarget(tasks.check),
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
      !tasks.check?.startsWith("DENO_NO_PACKAGE_JSON=1 deno check ") ||
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
