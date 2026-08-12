const ADR_PATH =
  "docs/architecture/decisions/0004-onboarding-invitation-and-atomic-audit-coordination.md";
const ADR_INDEX_PATH = "docs/architecture/decisions/README.md";
const BACKEND_PATH = "docs/architecture/backend-architecture.md";
const MANIFEST_PATH = "docs/architecture/module-boundaries.yaml";

type ModuleContract = {
  allowedModuleDependencies: string[];
  publishes: string[];
  consumes: string[];
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function moduleBlock(yaml: string, id: string): string | undefined {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = yaml.match(
    new RegExp(
      `^  - id: ${escapedId}\\r?\\n([\\s\\S]*?)(?=^  - id: |^readModels:)`,
      "m",
    ),
  );
  return match?.[0];
}

function listProperty(block: string, property: string): string[] {
  const lines = block.split(/\r?\n/);
  const propertyIndex = lines.findIndex((line) =>
    line.startsWith(`    ${property}:`)
  );
  if (propertyIndex < 0) return [];

  const propertyLine = lines[propertyIndex]!;
  const initial = propertyLine.slice(
    propertyLine.indexOf(":") + 1,
  ).trim();
  if (initial.startsWith("[")) {
    if (initial.endsWith("]")) {
      return initial.slice(1, -1).split(",").map((value) => value.trim())
        .filter(
          Boolean,
        );
    }
    const values: string[] = [];
    for (let index = propertyIndex + 1; index < lines.length; index++) {
      const line = lines[index]!;
      if (/^    \]/.test(line)) break;
      const item = line.match(/^\s{6}([^#,\]]+),?\s*$/)?.[1]?.trim();
      if (item) values.push(item);
    }
    return values;
  }

  const values: string[] = [];
  for (let index = propertyIndex + 1; index < lines.length; index++) {
    const line = lines[index]!;
    if (/^    \S/.test(line)) break;
    const item = line.match(/^\s{6}-\s+([^#,\]]+)/)?.[1]?.trim();
    if (item) values.push(item);
  }
  return values;
}

function parseModule(yaml: string, id: string): ModuleContract | undefined {
  const block = moduleBlock(yaml, id);
  if (!block) return undefined;
  return {
    allowedModuleDependencies: listProperty(block, "allowedModuleDependencies"),
    publishes: listProperty(block, "publishes"),
    consumes: listProperty(block, "consumes"),
  };
}

function manifestCoordinationIssues(yaml: string): string[] {
  const issues: string[] = [];
  const identity = parseModule(yaml, "identity");
  const workspaces = parseModule(yaml, "workspaces");
  const governance = parseModule(yaml, "governance");

  if (!identity || !workspaces || !governance) {
    return [
      "identity, workspaces, and governance module declarations are required",
    ];
  }

  if (!workspaces.allowedModuleDependencies.includes("identity")) {
    issues.push("workspaces must retain its public dependency on identity");
  }
  if (workspaces.allowedModuleDependencies.includes("governance")) {
    issues.push("workspaces must not gain a governance dependency");
  }
  if (workspaces.consumes.includes("identity.user-registered")) {
    issues.push("workspaces must not consume identity.user-registered");
  }

  const requiredGovernanceEvents = [
    "identity.user-registered",
    "workspace.created",
    "workspace.member-joined",
  ];
  for (const event of requiredGovernanceEvents) {
    if (!governance.consumes.includes(event)) {
      issues.push(`governance must consume ${event}`);
    }
  }

  if (!identity.publishes.includes("identity.user-registered")) {
    issues.push(
      "identity must remain the publisher of identity.user-registered",
    );
  }
  for (const event of ["workspace.created", "workspace.member-joined"]) {
    if (!workspaces.publishes.includes(event)) {
      issues.push(`workspaces must remain the publisher of ${event}`);
    }
  }

  if (/^  - id: .*coordinat(?:or|ion).*$/mi.test(yaml)) {
    issues.push("a generic coordination module is forbidden");
  }
  return issues;
}

function normalized(markdown: string): string {
  return markdown.toLowerCase().replace(/[`*_]/g, "").replace(/\s+/g, " ");
}

function requirePattern(
  issues: string[],
  criterion: string,
  text: string,
  pattern: RegExp,
  description: string,
): void {
  if (!pattern.test(text)) issues.push(`${criterion}: ${description}`);
}

async function readArchitectureFile(path: string): Promise<string | undefined> {
  try {
    return await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
}

Deno.test("manifest discriminator accepts DG-06A and rejects competing choreography", () => {
  const compliant = `modules:
  - id: identity
    allowedModuleDependencies: []
    publishes: [identity.user-registered]
    consumes: []
  - id: workspaces
    allowedModuleDependencies: [identity]
    publishes: [workspace.created, workspace.member-joined]
    consumes: []
  - id: governance
    allowedModuleDependencies: [identity, workspaces]
    publishes: []
    consumes: [identity.user-registered, workspace.created, workspace.member-joined]
readModels:
`;
  const competing = compliant
    .replace(
      "    consumes: []\n  - id: governance",
      "    consumes: [identity.user-registered]\n  - id: governance",
    )
    .replace(
      "    consumes: [identity.user-registered, workspace.created, workspace.member-joined]",
      "    consumes: [identity.user-registered]",
    );

  const compliantIssues = manifestCoordinationIssues(compliant);
  assert(
    compliantIssues.length === 0,
    `compliant fixture was rejected: ${compliantIssues.join("; ")}`,
  );

  const competingIssues = manifestCoordinationIssues(competing);
  assert(
    competingIssues.includes(
      "workspaces must not consume identity.user-registered",
    ),
    "discriminator did not reject identity-driven workspace choreography",
  );
  assert(
    competingIssues.includes("governance must consume workspace.created") &&
      competingIssues.includes(
        "governance must consume workspace.member-joined",
      ),
    "discriminator did not reject missing governance lifecycle edges",
  );
});

Deno.test("accepted architecture contracts record the DG-06A boundary", async () => {
  const [adrSource, indexSource, backendSource, manifestSource] = await Promise
    .all([
      readArchitectureFile(ADR_PATH),
      readArchitectureFile(ADR_INDEX_PATH),
      readArchitectureFile(BACKEND_PATH),
      readArchitectureFile(MANIFEST_PATH),
    ]);
  const issues: string[] = [];

  if (!adrSource) {
    issues.push(`AC-01: accepted ADR is absent at ${ADR_PATH}`);
    issues.push(
      "AC-04: proof-pending and synchronous-versus-durable delivery contract is absent with the ADR",
    );
  } else {
    const adr = normalized(adrSource);
    requirePattern(
      issues,
      "AC-01",
      adr,
      /status.{0,40}accepted/,
      "ADR must be accepted",
    );
    requirePattern(
      issues,
      "AC-01",
      adr,
      /workspaces-owned/,
      "coordinator must be workspaces-owned",
    );
    requirePattern(
      issues,
      "AC-01",
      adr,
      /use-case-specific/,
      "coordinator must be use-case-specific",
    );
    requirePattern(
      issues,
      "AC-01",
      adr,
      /identity.{0,100}public (application )?facade/,
      "identity calls must use its public facade",
    );
    requirePattern(
      issues,
      "AC-01",
      adr,
      /composition root.{0,140}(register|registration).{0,140}governance.{0,80}(audit )?handler/,
      "composition root must register governance audit handlers",
    );
    requirePattern(
      issues,
      "AC-01",
      adr,
      /generic horizontal (service|coordinator)/,
      "generic horizontal coordination must be forbidden",
    );
    requirePattern(
      issues,
      "AC-01",
      adr,
      /private adapter import/,
      "private adapter imports must be forbidden",
    );
    requirePattern(
      issues,
      "AC-01",
      adr,
      /direct cross-module table write/,
      "direct cross-module table writes must be forbidden",
    );

    requirePattern(
      issues,
      "AC-04",
      adr,
      /synchronous.{0,100}transaction-scoped/,
      "coordination must be synchronous and transaction-scoped",
    );
    requirePattern(
      issues,
      "AC-04",
      adr,
      /durable asynchronous delivery/,
      "durable asynchronous delivery must be distinguished",
    );
    requirePattern(
      issues,
      "AC-04",
      adr,
      /fnd-002.{0,140}(does not|has not|not).{0,100}(implement|prove)/,
      "FND-002 must disclaim application implementation and proof",
    );
    requirePattern(
      issues,
      "AC-04",
      adr,
      /protected walking skeleton.{0,120}slice 1.{0,120}(executable )?proof/,
      "walking-skeleton and Slice 1 executable proof must remain required",
    );
  }

  const index = normalized(indexSource ?? "");
  requirePattern(
    issues,
    "AC-01",
    index,
    /0004-onboarding-invitation-and-atomic-audit-coordination\.md.{0,100}accepted|accepted.{0,100}0004-onboarding-invitation-and-atomic-audit-coordination\.md/,
    "ADR index must link ADR 0004 and mark it accepted",
  );

  const backend = normalized(backendSource ?? "");
  requirePattern(
    issues,
    "AC-02",
    backend,
    /workspaces-owned.{0,100}(application service|use case)/,
    "workspaces must own the coordinating application service",
  );
  requirePattern(
    issues,
    "AC-02",
    backend,
    /first-user.{0,80}workspace creation/,
    "first-user/workspace creation must be covered",
  );
  requirePattern(
    issues,
    "AC-02",
    backend,
    /invitation acceptance/,
    "invitation acceptance must be covered",
  );
  requirePattern(
    issues,
    "AC-02",
    backend,
    /one (transaction\/session|transaction or session|shared transaction)/,
    "one transaction/session boundary must be explicit",
  );
  requirePattern(
    issues,
    "AC-02",
    backend,
    /identity.{0,120}(workspace membership|membership).{0,120}(required )?governance audit/,
    "identity, membership, and required governance audit effects must share the boundary",
  );
  requirePattern(
    issues,
    "AC-02",
    backend,
    /all-or-nothing rollback/,
    "all-or-nothing rollback must be required",
  );
  requirePattern(
    issues,
    "AC-02",
    backend,
    /postconditions?.{0,100}before commit/,
    "success postconditions must be checked before commit",
  );

  if (!manifestSource) {
    issues.push(`AC-03: manifest is absent at ${MANIFEST_PATH}`);
  } else {
    issues.push(
      ...manifestCoordinationIssues(manifestSource).map((issue) =>
        `AC-03: ${issue}`
      ),
    );
  }

  assert(
    issues.length === 0,
    `DG-06A accepted-contract mismatches:\n- ${issues.join("\n- ")}`,
  );
});
