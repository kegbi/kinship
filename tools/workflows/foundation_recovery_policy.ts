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

const COVERAGE_MINIMUM =
  /80%[^\n]*(?:line|lines)[^\n]*(?:branch|branches)[^\n]*(?:function|functions)/i;
const OBSOLETE_DELIVERY =
  /controllerRunId|issuedByControllerRunId|actorRunId|events\.jsonl|state\.json|schemaVersion|UUID|ticket-metadata-only/i;
const UNSUPPORTED_AGENT_DIRECTION =
  /\.codex["'`]?\s*(?:[\\/]\s*)+["'`]?\s*agents\b|project\s+custom\s+agents/i;
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

function hasConflictingProductionCoverageThreshold(policy: string): boolean {
  const claims = policy.split(
    /[!?;|]+|\.(?!\d)|(?:^|\r?\n)\s*(?:[-*+]|\d+[.)])\s+/gm,
  );
  for (const claim of claims) {
    const describesProductionCoverage = /\bproduction\b/i.test(claim) &&
      /\bcoverage\b/i.test(claim) &&
      /\b(?:lines?|branch(?:es)?|functions?)\b/i.test(claim);
    if (!describesProductionCoverage) continue;

    for (
      const percentage of claim.matchAll(
        /\b(\d+(?:\.\d+)?)\s*(?:%|percent(?:age)?\b)/gi,
      )
    ) {
      if (Number(percentage[1]) !== 80) return true;
    }
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
    issueWhen(
      issues,
      UNSUPPORTED_AGENT_DIRECTION.test(policy),
      "delivery.unsupported-agent-path",
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
  };
  issueWhen(
    issues,
    !denoConfig.fmt.exclude?.includes("docs/planning/tickets/"),
    "toolchain.formatter-history",
    "deno.json",
  );
  const tasks = denoConfig.tasks;
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

  return issues;
}
