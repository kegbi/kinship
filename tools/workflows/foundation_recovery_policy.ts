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
  ".agents/skills/run-tdd-ticket-loop/assets/state.template.json",
  ".agents/skills/run-tdd-ticket-loop/assets/events.template.jsonl",
  ".agents/skills/run-tdd-ticket-loop/assets/ticket.template.json",
  ".agents/skills/run-tdd-ticket-loop/assets/result.template.json",
  ".agents/skills/run-tdd-ticket-loop/assets/review.template.json",
] as const;

const COVERAGE_MINIMUM =
  /80%[^\n]*(?:line|lines)[^\n]*(?:branch|branches)[^\n]*(?:function|functions)/i;
const SUPERSEDED_COVERAGE =
  /(?:production TypeScript[^\n]*100%|100%[^\n]*(?:line|branch|function)|100 percent[^\n]*(?:line|branch|function))/i;
const OBSOLETE_DELIVERY =
  /controllerRunId|issuedByControllerRunId|actorRunId|events\.jsonl|state\.json|schemaVersion|UUID|ticket-metadata-only/i;

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

export function validateFoundationRecovery(
  snapshot: RecoverySnapshot,
): PolicyIssue[] {
  const issues: PolicyIssue[] = [];

  for (const path of COVERAGE_POLICY_FILES) {
    const policy = file(snapshot, path);
    issueWhen(issues, !COVERAGE_MINIMUM.test(policy), "coverage.minimum", path);
    issueWhen(
      issues,
      SUPERSEDED_COVERAGE.test(policy),
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
  }

  const denoConfig = JSON.parse(file(snapshot, "deno.json")) as {
    tasks: Record<string, string>;
  };
  const tasks = denoConfig.tasks;
  issueWhen(
    issues,
    tasks["ticket:validate"] !== undefined ||
      !tasks.check?.startsWith("DENO_NO_PACKAGE_JSON=1 deno check ") ||
      tasks["test:workflow"] !==
        "DENO_NO_PACKAGE_JSON=1 deno test --allow-read tools/workflows/foundation_recovery_policy_test.ts" ||
      !tasks["test:workflow:coverage"]?.includes("--threshold=80") ||
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
