const WORKFLOW_DIRECTORY = new URL("./", import.meta.url);
const REPOSITORY_ROOT = new URL("../../", import.meta.url);
const TICKET_CONTRACT_URL = new URL(
  "ticket_contract.ts",
  WORKFLOW_DIRECTORY,
);
const DIRECTORY_VALIDATOR_URL = new URL(
  "validate_ticket.ts",
  WORKFLOW_DIRECTORY,
);
const ROUND_THREE_DISPATCH_URL = new URL(
  "docs/planning/tickets/PILOT-001/dispatch/round-03.md",
  REPOSITORY_ROOT,
);

function sourceOf(url: URL): string {
  return Deno.readTextFileSync(url);
}

function functionSource(source: string, name: string): string {
  const startPattern = new RegExp(
    `(?:async\\s+)?function\\s+${name}\\s*\\(`,
  );
  const match = startPattern.exec(source);
  if (match === null) throw new Error(`Expected function ${name} in source`);
  const remainder = source.slice(match.index + match[0].length);
  const nextFunction = /\n(?:export\s+)?(?:async\s+)?function\s+/.exec(
    remainder,
  );
  const end = nextFunction === null
    ? source.length
    : match.index + match[0].length + nextFunction.index;
  return source.slice(match.index, end);
}

function assertFailures(failures: readonly string[]): void {
  if (failures.length > 0) throw new Error(failures.join("\n"));
}

function gitLines(args: readonly string[]): readonly string[] {
  const result = new Deno.Command("git", {
    args: [...args],
    cwd: REPOSITORY_ROOT,
    stdout: "piped",
    stderr: "piped",
  }).outputSync();
  if (!result.success) {
    throw new Error(
      `Git inspection failed: ${
        new TextDecoder().decode(result.stderr).trim()
      }`,
    );
  }
  return new TextDecoder().decode(result.stdout).split(/\r?\n/).filter(
    (line) => line.length > 0,
  );
}

function isRedOnlyPath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  return /(?:^|\/)[^/]*(?:_test|\.test|\.spec)\.[cm]?[jt]sx?$/.test(
    normalized,
  ) ||
    /^docs\/planning\/tickets\/PILOT-001\/evidence\/round-03-[^/]+\.log$/
      .test(normalized);
}

Deno.test("PILOT-001-R2-008 caps Git output while consuming the stream", () => {
  const source = sourceOf(DIRECTORY_VALIDATOR_URL);
  const runner = functionSource(source, "runGit");
  const failures: string[] = [];

  if (/\.outputSync\s*\(/.test(runner)) {
    failures.push(
      "runGit still calls outputSync, which buffers untrusted Git output before enforcing the cap",
    );
  }
  if (!/\.spawn\s*\(/.test(runner)) {
    failures.push("runGit must spawn Git so output can be bounded in flight");
  }
  if (!/MAX_GIT_OUTPUT_BYTES/.test(runner)) {
    failures.push(
      "runGit must pass the hard byte cap into bounded consumption",
    );
  }
  if (!/(?:\.getReader\s*\(|for\s+await\s*\()/.test(source)) {
    failures.push("Git stdout must be read incrementally during consumption");
  }
  if (!/(?:\.kill\s*\(|\.cancel\s*\(|\.abort\s*\()/.test(source)) {
    failures.push(
      "The Git process or stream must terminate as soon as the cap is exceeded",
    );
  }

  assertFailures(failures);
});

Deno.test("PILOT-001-R2-009 shares one typed lifecycle policy across validators", () => {
  const structural = sourceOf(TICKET_CONTRACT_URL);
  const filesystem = sourceOf(DIRECTORY_VALIDATOR_URL);
  const failures: string[] = [];
  const typeMatch =
    /export\s+(?:interface|type)\s+([A-Za-z][A-Za-z0-9]*Policy)\b/.exec(
      structural,
    );
  const policyMatch = /export\s+const\s+([A-Z][A-Z0-9_]*POLICY)\b/.exec(
    structural,
  );

  if (typeMatch === null) {
    failures.push(
      "ticket_contract.ts must export a typed lifecycle policy contract",
    );
  }
  if (policyMatch === null) {
    failures.push(
      "ticket_contract.ts must export one shared lifecycle policy value",
    );
  }

  if (typeMatch !== null && policyMatch !== null) {
    const typeName = typeMatch[1]!;
    const policyName = policyMatch[1]!;
    const declarationStart = structural.indexOf(policyMatch[0]);
    const policyDeclaration = structural.slice(
      declarationStart,
      declarationStart + 6_000,
    );
    if (
      !new RegExp(
        `(?:${policyName}\\s*:\\s*${typeName}|satisfies\\s+${typeName})`,
      ).test(policyDeclaration)
    ) {
      failures.push(`${policyName} must be statically bound to ${typeName}`);
    }
    for (const concept of ["transition", "round", "evidence"] as const) {
      if (!new RegExp(concept, "i").test(policyDeclaration)) {
        failures.push(`${policyName} must define ${concept} policy`);
      }
    }
    const structuralUses = structural.match(new RegExp(policyName, "g"))
      ?.length ?? 0;
    const filesystemUses = filesystem.match(new RegExp(policyName, "g"))
      ?.length ?? 0;
    if (structuralUses < 2) {
      failures.push(`${policyName} must drive structural validation`);
    }
    if (filesystemUses < 2) {
      failures.push(
        `${policyName} must be imported and used by filesystem validation`,
      );
    }
  }

  if (/const\s+VALID_TRANSITIONS\s*=/.test(structural)) {
    failures.push(
      "The private VALID_TRANSITIONS table must be replaced by the shared policy",
    );
  }
  if (
    /event\.to\s*===\s*["']review["']\s*\|\|\s*event\.to\s*===\s*["']rework["']/
      .test(filesystem)
  ) {
    failures.push(
      "Filesystem evidence mapping must use from/to policy, not destination-only review/rework conditionals",
    );
  }

  assertFailures(failures);
});

Deno.test("PILOT-001-R2-004 dispatch freezes all regressions before production", () => {
  const dispatch = sourceOf(ROUND_THREE_DISPATCH_URL);
  const requiredGuards = [
    /Before any production, configuration,\s*template, or protocol edit,/i,
    /add every regression listed below/i,
    /All regressions must\s*be present together in one failing test-only RED revision/i,
    /stop for\s*controller freeze/i,
    /No production\/config\/template\/protocol changes before the full RED snapshot/i,
  ] as const;
  const failures = requiredGuards.flatMap((guard) =>
    guard.test(dispatch) ? [] : [`Missing dispatch guard ${guard}`]
  );
  assertFailures(failures);
});

Deno.test("PILOT-001-R2-004 current RED diff contains tests and evidence only", () => {
  const changedPaths = new Set([
    ...gitLines(["diff", "--name-only", "--diff-filter=ACDMRTUXB"]),
    ...gitLines([
      "diff",
      "--cached",
      "--name-only",
      "--diff-filter=ACDMRTUXB",
    ]),
    ...gitLines(["ls-files", "--others", "--exclude-standard"]),
  ]);
  const productionPaths = [...changedPaths].filter((path) =>
    !isRedOnlyPath(path)
  );
  if (productionPaths.length > 0) {
    throw new Error(
      `RED snapshot contains changed production paths: ${
        productionPaths.sort().join(", ")
      }`,
    );
  }
});
