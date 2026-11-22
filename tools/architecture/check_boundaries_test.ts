/**
 * The architecture checker's own suite.
 *
 * The first group drives `inspectBoundaries` with small in-memory manifests so
 * each rule is proven in isolation. The second group replaces the ticket-named
 * text greps that used to live in `tools/architecture/<TICKET>/`: each case
 * runs the real manifest, the canonical DDL, and the real files that ticket
 * protected through the same checker, and proves the boundary it fixed is
 * still closed and is not hiding in the baseline.
 */

import {
  type Baseline,
  type BoundaryInput,
  compareWithBaseline,
  inspectBoundaries,
  isSourceFile,
  type SourceFile,
  validateAgainstSchema,
  type Violation,
} from "./check_boundaries.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const ROOT = new URL("../../", import.meta.url);
const MANIFEST_PATH = "docs/architecture/module-boundaries.yaml";
const SCHEMA_PATH = "docs/architecture/module-boundaries.schema.json";
const CANONICAL_SCHEMA_PATH =
  "personal-crm-schema/v15/personal_crm_schema_v15.sql";
const BASELINE_PATH = "tools/architecture/boundary-baseline.json";

// --- Fixtures ------------------------------------------------------------

const MANIFEST = `schemaVersion: 1
decisionStatus: accepted
schemaSource: schema.sql

sharedKernel:
  path: packages/backend/shared-kernel
  allowedContents: [clock-and-instant-contracts]
  forbiddenContents: [generic-repositories]

compositionRoots:
  - apps/api/composition.ts

approvedCrossModuleReads:
  - adapter: packages/backend/modules/gifts/adapters/postgres/actor_context.ts
    module: gifts
    tables: [people]
    reason: The one approved actor-context read.

generatedContracts:
  path: packages/contracts/generated
  source: packages/contracts/openapi
  consumers: [apps/web]

layerRules:
  domainMayImport: [same-module-domain]
  applicationMayImport: [allowed-module-public]
  portsMayImport: [same-module-domain]
  adaptersMayImport: [same-module-application]
  transportMayImport: [same-module-public]
  compositionMayImport: [module-public, module-adapters]
  frontendMayImport: [contracts-generated]
  forbiddenCrossModuleTargets: [adapters]

modules:
  - id: people
    path: packages/backend/modules/people
    kind: core
    description: People.
    ownsTables: [people]
    publicEntryPoints: [packages/backend/modules/people/public.ts]
    allowedModuleDependencies: []
    publishes: []
    consumes: []

  - id: files
    path: packages/backend/modules/files
    kind: core
    description: Files.
    ownsTables: [files, gift_file_links]
    publicEntryPoints: [packages/backend/modules/files/public.ts]
    allowedModuleDependencies: [people]
    publishes: []
    consumes: []

  - id: gifts
    path: packages/backend/modules/gifts
    kind: core
    description: Gifts.
    ownsTables: [gifts]
    publicEntryPoints: [packages/backend/modules/gifts/public.ts]
    allowedModuleDependencies: [files, people]
    publishes: []
    consumes: []

readModels:
  - id: today
    path: packages/backend/read-models/today
    sourceModules: [people]
    consumers: [apps/api]
    writeAccess: false
`;

const SQL = `CREATE SCHEMA IF NOT EXISTS crm;
CREATE TABLE people (id uuid PRIMARY KEY);
CREATE TABLE files (id uuid PRIMARY KEY);
CREATE TABLE gift_file_links (id uuid PRIMARY KEY);
CREATE TABLE gifts (id uuid PRIMARY KEY);
`;

const read = (path: string): Promise<string> =>
  Deno.readTextFile(new URL(path, ROOT));

let schemaCache: string | undefined;
async function boundarySchema(): Promise<string> {
  schemaCache ??= await read(SCHEMA_PATH);
  return schemaCache;
}

async function fixture(
  files: readonly SourceFile[],
  overrides: Partial<BoundaryInput> = {},
): Promise<Violation[]> {
  return inspectBoundaries({
    manifestPath: MANIFEST_PATH,
    manifestText: MANIFEST,
    schemaText: await boundarySchema(),
    canonicalSchemaPath: "schema.sql",
    canonicalSchemaSql: SQL,
    files,
    ...overrides,
  });
}

/** Runs the real manifest and canonical schema over the named real files. */
async function repository(paths: readonly string[]): Promise<Violation[]> {
  const files = await Promise.all(
    paths.map(async (path) => ({ path, text: await read(path) })),
  );
  return inspectBoundaries({
    manifestPath: MANIFEST_PATH,
    manifestText: await read(MANIFEST_PATH),
    schemaText: await boundarySchema(),
    canonicalSchemaPath: CANONICAL_SCHEMA_PATH,
    canonicalSchemaSql: await read(CANONICAL_SCHEMA_PATH),
    files,
  });
}

let baselineCache: Baseline | undefined;
async function baseline(): Promise<Baseline> {
  baselineCache ??= JSON.parse(await read(BASELINE_PATH)) as Baseline;
  return baselineCache;
}

function render(violations: readonly Violation[]): string {
  return violations
    .map((violation) =>
      `${violation.rule} ${violation.subject}: ${violation.detail}`
    )
    .join("; ");
}

/** Fails when any violation mentions one of the forbidden fragments. */
function refuse(
  violations: readonly Violation[],
  fragments: readonly string[],
  message: string,
): void {
  const matched = violations.filter((violation) =>
    fragments.some((fragment) => violation.detail.includes(fragment))
  );
  assert(matched.length === 0, `${message}: ${render(matched)}`);
}

// --- Rule 4: table access ------------------------------------------------

Deno.test("[GAP-005] the files adapter reading a gifts-owned table is a violation", async () => {
  const violations = await fixture([{
    path: "packages/backend/modules/files/adapters/postgres/attachments.ts",
    text: "const query = sql`select id from crm.gifts where id = ${id}`;",
  }]);
  assert(
    violations.length === 1,
    `expected one violation, got ${render(violations)}`,
  );
  assert(
    violations[0]?.rule === "table-access" &&
      violations[0].detail.includes("crm.gifts") &&
      violations[0].detail.includes("owned by gifts"),
    `expected a table-access violation naming crm.gifts, got ${
      render(violations)
    }`,
  );
});

Deno.test("[GAP-005] a read reaching a declared dependency is the weaker foreign read", async () => {
  const violations = await fixture([{
    path: "packages/backend/modules/gifts/adapters/postgres/gifts.ts",
    text: "sql`select name from crm.people join crm.gifts using (id)`",
  }]);
  assert(
    violations.length === 1 && violations[0]?.rule === "table-foreign-read",
    `expected one foreign-read violation, got ${render(violations)}`,
  );
  assert(
    violations[0].detail === "gifts reads crm.people, owned by people",
    `unexpected detail: ${violations[0].detail}`,
  );
});

Deno.test("[GAP-005] adapters reading only owned tables are clean", async () => {
  const violations = await fixture([{
    path: "packages/backend/modules/files/adapters/postgres/files.ts",
    text: "sql`select id from crm.files join crm.gift_file_links using (id)`",
  }]);
  assert(violations.length === 0, `unexpected: ${render(violations)}`);
});

Deno.test("[GAP-008] only the declared actor-context read is exempt", async () => {
  const declared = await fixture([{
    path: "packages/backend/modules/gifts/adapters/postgres/actor_context.ts",
    text: "sql`select 1 from crm.people where id = ${id} for update`",
  }]);
  assert(
    declared.length === 0,
    `the declared actor-context read must pass, got ${render(declared)}`,
  );

  const undeclared = await fixture([{
    path: "packages/backend/modules/gifts/adapters/postgres/elsewhere.ts",
    text: "sql`select 1 from crm.people where id = ${id} for update`",
  }]);
  assert(
    undeclared.length === 1 &&
      undeclared[0]?.rule === "table-foreign-read" &&
      undeclared[0].detail === "gifts reads crm.people, owned by people",
    `an undeclared adapter reading the same table is still reported, got ${
      render(undeclared)
    }`,
  );

  const otherTable = await fixture([{
    path: "packages/backend/modules/gifts/adapters/postgres/actor_context.ts",
    text: "sql`select 1 from crm.files`",
  }]);
  assert(
    otherTable.length === 1 &&
      otherTable[0]?.detail === "gifts reads crm.files, owned by files",
    `a table the declaration does not name is still reported, got ${
      render(otherTable)
    }`,
  );
});

Deno.test("[GAP-008] an approved read never excuses an undeclared owner", async () => {
  const violations = await fixture([{
    path: "packages/backend/modules/files/adapters/postgres/actor_context.ts",
    text: "sql`select 1 from crm.gifts`",
  }], {
    manifestText: MANIFEST.replace(
      "  - adapter: packages/backend/modules/gifts/adapters/postgres/actor_context.ts\n    module: gifts\n    tables: [people]\n",
      "  - adapter: packages/backend/modules/files/adapters/postgres/actor_context.ts\n    module: files\n    tables: [gifts]\n",
    ),
  });
  assert(
    violations.length === 1 && violations[0]?.rule === "table-access",
    `reading a table no declared dependency owns stays a breach, got ${
      render(violations)
    }`,
  );
});

Deno.test("[GAP-005] a read model is measured against its source modules", async () => {
  const clean = await fixture([{
    path: "packages/backend/read-models/today/adapters/postgres/today.ts",
    text: "sql`select id from crm.people`",
  }]);
  assert(clean.length === 0, `unexpected: ${render(clean)}`);

  const crossing = await fixture([{
    path: "packages/backend/read-models/today/adapters/postgres/today.ts",
    text: "sql`select id from crm.gifts`",
  }]);
  assert(
    crossing.length === 1 && crossing[0]?.rule === "table-access" &&
      crossing[0].detail.includes("today reads crm.gifts"),
    `expected the read model to be caught, got ${render(crossing)}`,
  );
});

// --- Rule 1: the manifest against its schema -----------------------------

Deno.test("[GAP-005] the manifest is validated against its JSON Schema", async () => {
  const unknownProperty = await fixture([], {
    manifestText: `${MANIFEST}\nunexpected: true\n`,
  });
  assert(
    unknownProperty.some((violation) =>
      violation.rule === "manifest-schema" &&
      violation.detail.includes("unknown property unexpected")
    ),
    `expected an unknown-property issue, got ${render(unknownProperty)}`,
  );

  const wrongStatus = await fixture([], {
    manifestText: MANIFEST.replace(
      "decisionStatus: accepted",
      "decisionStatus: proposed",
    ),
  });
  assert(
    wrongStatus.some((violation) =>
      violation.rule === "manifest-schema" &&
      violation.detail.includes("/decisionStatus")
    ),
    `expected a decisionStatus issue, got ${render(wrongStatus)}`,
  );

  const missingOwner = await fixture([], {
    manifestText: MANIFEST.replace("    ownsTables: [gifts]\n", ""),
  });
  assert(
    missingOwner.some((violation) =>
      violation.rule === "manifest-schema" &&
      violation.detail.includes("missing required property ownsTables")
    ),
    `expected a required-property issue, got ${render(missingOwner)}`,
  );
});

Deno.test("[GAP-005] the schema validator fails closed on an unsupported keyword", () => {
  const issues: string[] = [];
  let thrown: unknown;
  try {
    validateAgainstSchema(
      { value: 3 },
      { type: "object", properties: { value: { multipleOf: 2 } } },
      {},
      "",
      issues,
    );
  } catch (error) {
    thrown = error;
  }
  assert(
    thrown instanceof Error && thrown.message.includes("multipleOf"),
    `an unimplemented keyword must fail the check, not pass it: ${thrown}`,
  );
});

// --- Rule 2: table ownership ---------------------------------------------

Deno.test("[GAP-005] every canonical table has exactly one owner", async () => {
  const unowned = await fixture([], {
    canonicalSchemaSql: `${SQL}CREATE TABLE crm.orphans (id uuid);\n`,
  });
  assert(
    unowned.some((violation) =>
      violation.rule === "table-ownership" &&
      violation.detail === "no module owns crm.orphans"
    ),
    `expected an unowned table, got ${render(unowned)}`,
  );

  const shared = await fixture([], {
    manifestText: MANIFEST.replace(
      "    ownsTables: [gifts]",
      "    ownsTables: [gifts, files]",
    ),
  });
  assert(
    shared.some((violation) =>
      violation.rule === "table-ownership" &&
      violation.detail === "crm.files is owned by files, gifts"
    ),
    `expected a shared table, got ${render(shared)}`,
  );

  const invented = await fixture([], {
    manifestText: MANIFEST.replace(
      "    ownsTables: [gifts]",
      "    ownsTables: [gifts, wishlists]",
    ),
  });
  assert(
    invented.some((violation) =>
      violation.rule === "table-ownership" &&
      violation.detail.includes("gifts owns crm.wishlists")
    ),
    `expected an unknown owned table, got ${render(invented)}`,
  );
});

// Schema v14's narrow cross-workspace functions (ADR 0008) are owned like
// tables: only the owning module, or one that declares it as a dependency,
// calls one, and every function the DDL creates has exactly one owner.
Deno.test("[AUD-V2] a SQL function is owned and called like a table", async () => {
  const sql = `${SQL}CREATE FUNCTION enter_gift_workspace(p_id uuid)\n`;
  const manifestText = MANIFEST.replace(
    "    ownsTables: [gifts]\n",
    "    ownsTables: [gifts]\n    ownsFunctions: [enter_gift_workspace]\n",
  );
  const call = "sql`select crm.enter_gift_workspace(${id})`";

  const owner = await fixture([{
    path: "packages/backend/modules/gifts/adapters/postgres/scope.ts",
    text: call,
  }], { manifestText, canonicalSchemaSql: sql });
  assert(
    owner.length === 0,
    `the owner's call must be clean, got ${render(owner)}`,
  );

  const stranger = await fixture([{
    path: "packages/backend/modules/people/adapters/postgres/scope.ts",
    text: call,
  }], { manifestText, canonicalSchemaSql: sql });
  assert(
    stranger.length === 1 && stranger[0]?.rule === "table-access" &&
      stranger[0].detail.includes("crm.enter_gift_workspace") &&
      stranger[0].detail.includes("owned by gifts"),
    `a module that cannot reach gifts must not call its function, got ${
      render(stranger)
    }`,
  );

  const unowned = await fixture([], { canonicalSchemaSql: sql });
  assert(
    unowned.some((violation) =>
      violation.rule === "table-ownership" &&
      violation.detail === "no module owns crm.enter_gift_workspace"
    ),
    `expected an unowned function, got ${render(unowned)}`,
  );

  const invented = await fixture([], { manifestText });
  assert(
    invented.some((violation) =>
      violation.rule === "table-ownership" &&
      violation.detail.includes("gifts owns crm.enter_gift_workspace")
    ),
    `expected an unknown owned function, got ${render(invented)}`,
  );
});

// --- Rule 3: layering ----------------------------------------------------

Deno.test("[GAP-005] cross-module imports go through the public entry point", async () => {
  const deep = await fixture([{
    path: "packages/backend/modules/gifts/application/gift_management.ts",
    text: 'import { load } from "../../files/application/person_files.ts";',
  }]);
  assert(
    deep.some((violation) =>
      violation.rule === "layer" &&
      violation.detail.includes("is not a public entry point of files")
    ),
    `expected a public-entry-point violation, got ${render(deep)}`,
  );

  const facade = await fixture([{
    path: "packages/backend/modules/gifts/application/gift_management.ts",
    text: 'import { load } from "../../files/public.ts";',
  }]);
  assert(facade.length === 0, `unexpected: ${render(facade)}`);

  const undeclared = await fixture([{
    path: "packages/backend/modules/files/application/person_files.ts",
    text: 'import { load } from "../../gifts/public.ts";',
  }]);
  assert(
    undeclared.some((violation) =>
      violation.rule === "layer" &&
      violation.detail === "files imports gifts, which it does not declare"
    ),
    `expected an undeclared dependency, got ${render(undeclared)}`,
  );
});

Deno.test("[GAP-005] the application layer keeps infrastructure out", async () => {
  const kysely = await fixture([{
    path: "packages/backend/modules/gifts/application/gift_management.ts",
    text: 'import { sql } from "kysely";',
  }]);
  assert(
    kysely.some((violation) =>
      violation.detail === "the application layer imports kysely"
    ),
    `expected an infrastructure import, got ${render(kysely)}`,
  );

  const environment = await fixture([{
    path: "packages/backend/modules/gifts/application/gift_management.ts",
    text: "const host = Deno.env.get('PGHOST');",
  }]);
  assert(
    environment.some((violation) =>
      violation.detail === "the application layer reads Deno.env"
    ),
    `expected a Deno.env violation, got ${render(environment)}`,
  );

  const rawSql = await fixture([{
    path: "packages/backend/modules/gifts/application/gift_management.ts",
    text: "const query = `select id from crm.gifts`;",
  }]);
  assert(
    rawSql.some((violation) =>
      violation.detail ===
        "the application layer writes raw SQL against crm.gifts"
    ),
    `expected a raw-SQL violation, got ${render(rawSql)}`,
  );

  const ports = await fixture([{
    path: "packages/backend/modules/gifts/ports/security.ts",
    text: 'import postgres from "postgres";',
  }]);
  assert(
    ports.some((violation) =>
      violation.detail === "the ports layer imports postgres"
    ),
    `expected the ports layer to be covered, got ${render(ports)}`,
  );
});

Deno.test("[GAP-010] platform adapters stay out of the inner layers", async () => {
  const cases = [
    {
      layer: "application",
      path: "packages/backend/modules/gifts/application/gift_management.ts",
      specifier: "../../../platform/postgres/session.ts",
    },
    {
      layer: "domain",
      path: "packages/backend/modules/gifts/domain/gift.ts",
      specifier: "../../../platform/postgres/person_display.ts",
    },
    {
      layer: "ports",
      path: "packages/backend/modules/gifts/ports/security.ts",
      specifier: "../../../platform/postgres/errors.ts",
    },
    {
      layer: "application",
      path: "packages/backend/read-models/today/application/get_today.ts",
      specifier: "../../../platform/postgres/timestamps.ts",
    },
  ] as const;
  for (const example of cases) {
    const violations = await fixture([{
      path: example.path,
      text: `import { helper } from "${example.specifier}";`,
    }]);
    assert(
      violations.some((violation) =>
        violation.rule === "layer" && violation.subject === example.path &&
        violation.detail.startsWith(
          `the ${example.layer} layer imports the platform adapter `,
        )
      ),
      `expected ${example.path} to be reported, got ${render(violations)}`,
    );
  }

  const adapter = await fixture([{
    path: "packages/backend/modules/gifts/adapters/postgres/gifts.ts",
    text:
      'import { databaseFromSession } from "../../../../platform/postgres/session.ts";',
  }]);
  refuse(
    adapter,
    ["platform adapter"],
    "an adapter is where platform belongs",
  );

  const root = await fixture([{
    path: "apps/api/composition.ts",
    text:
      'import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";',
  }]);
  refuse(
    root,
    ["platform adapter"],
    "a composition root wires the platform",
  );
});

Deno.test("[GAP-005] read models never write", async () => {
  const violations = await fixture([{
    path: "packages/backend/read-models/today/adapters/postgres/today.ts",
    text: "await database.insertInto('crm.people').execute();",
  }]);
  assert(
    violations.some((violation) =>
      violation.rule === "layer" &&
      violation.detail === "the today read model calls insertInto"
    ),
    `expected a write violation, got ${render(violations)}`,
  );
});

Deno.test("[GAP-005] apps/web never imports packages/backend", async () => {
  const violations = await fixture([{
    path: "apps/web/src/lib/people.ts",
    text:
      'import { createGiftManagement } from "../../../../packages/backend/modules/gifts/public.ts";',
  }]);
  assert(
    violations.some((violation) =>
      violation.rule === "layer" &&
      violation.detail.startsWith("apps/web imports packages/backend")
    ),
    `expected a frontend violation, got ${render(violations)}`,
  );
});

const WITH_CONTRACT_SCHEMAS = MANIFEST.replace(
  "frontendMayImport: [contracts-generated]",
  "frontendMayImport: [contracts-generated, contracts-schemas]",
);

Deno.test("public documentation consumes only the generated external OpenAPI contract", async () => {
  const manifestText = MANIFEST.replace(
    "frontendMayImport: [contracts-generated]",
    "frontendMayImport: [contracts-generated, contracts-external-openapi]",
  );
  const violations = await fixture([{
    path: "apps/web/src/features/reference.ts",
    text:
      'import external from "../../../../packages/contracts/openapi/external.json";',
  }], { manifestText });
  assert(
    violations.length === 0,
    `external reference refused: ${render(violations)}`,
  );
  const internal = await fixture([{
    path: "apps/web/src/features/reference.ts",
    text:
      'import internal from "../../../../packages/contracts/openapi/openapi.json";',
  }], { manifestText });
  assert(
    internal.some((v) => v.rule === "layer"),
    "internal OpenAPI remains private",
  );
  for (
    const [target, manifest] of [
      ["external.json", MANIFEST],
      ["external.json.ts", manifestText],
    ] as const
  ) {
    const refused = await fixture([{
      path: "apps/web/src/features/reference.ts",
      text:
        `import document from "../../../../packages/contracts/openapi/${target}";`,
    }], { manifestText: manifest });
    assert(
      refused.some((v) => v.rule === "layer"),
      "external import requires its exact file and token",
    );
  }
});

Deno.test("[GAP-026] an island validates with the published contract schemas", async () => {
  const violations = await fixture([{
    path: "apps/web/src/islands/person-gifts/gift-form.tsx",
    text: [
      'import { giftCreateInput } from "../../../../../packages/contracts/schemas/gifts.ts";',
      'import { createGift } from "../../../../../packages/contracts/generated/auth-client.ts";',
    ].join("\n"),
  }], { manifestText: WITH_CONTRACT_SCHEMAS });
  assert(
    violations.length === 0,
    `expected no violation, got ${render(violations)}`,
  );
});

Deno.test("[GAP-026] the schema import needs the contracts-schemas token", async () => {
  const violations = await fixture([{
    path: "apps/web/src/islands/person-gifts/gift-form.tsx",
    text:
      'import { giftCreateInput } from "../../../../../packages/contracts/schemas/gifts.ts";',
  }]);
  assert(
    violations.some((violation) =>
      violation.rule === "layer" &&
      violation.detail ===
        "apps/web imports packages/contracts/schemas/gifts.ts, which frontendMayImport allows only with contracts-schemas"
    ),
    `expected a frontend violation, got ${render(violations)}`,
  );
});

Deno.test("[GAP-026] apps/web never imports route descriptors or server kits", async () => {
  const violations = await fixture([{
    path: "apps/web/src/islands/person-gifts/gift-form.tsx",
    text: [
      'import { giftRoutes } from "../../../../../packages/contracts/routes/gifts.ts";',
      'import { problem } from "../../../../../packages/http-kit/problem.ts";',
      'import { request } from "../../../../../packages/contracts/client/request.ts";',
    ].join("\n"),
  }], { manifestText: WITH_CONTRACT_SCHEMAS });
  for (
    const target of [
      "packages/contracts/routes/gifts.ts",
      "packages/http-kit/problem.ts",
      "packages/contracts/client/request.ts",
    ]
  ) {
    assert(
      violations.some((violation) =>
        violation.rule === "layer" &&
        violation.detail ===
          `apps/web imports ${target}, which is not a frontend import surface`
      ),
      `expected a violation for ${target}, got ${render(violations)}`,
    );
  }
});

Deno.test("[GAP-026] the checker reads island .tsx sources but not their suites", () => {
  assert(isSourceFile("gifts-island.tsx"), "an island is a source");
  assert(!isSourceFile("gifts-island.test.tsx"), "an island suite is not");
  assert(isSourceFile("people.ts"), "a module is a source");
  assert(!isSourceFile("people.test.ts"), "a vitest suite is not");
});

Deno.test("[GAP-005] only declared composition roots import adapters", async () => {
  const stray = await fixture([{
    path: "apps/api/main.ts",
    text:
      'import { Repository } from "../../packages/backend/modules/gifts/adapters/postgres/gift_repository.ts";',
  }]);
  assert(
    stray.some((violation) =>
      violation.rule === "layer" &&
      violation.detail.includes("is not a declared composition root")
    ),
    `expected an adapter-import violation, got ${render(stray)}`,
  );

  const root = await fixture([{
    path: "apps/api/composition.ts",
    text:
      'import { Repository } from "../../packages/backend/modules/gifts/adapters/postgres/gift_repository.ts";',
  }]);
  assert(root.length === 0, `unexpected: ${render(root)}`);

  // A unit still reaches its own adapters freely. Since GAP-013 that happens
  // in its `composition.ts`, not in `public.ts`, which rule 7 now guards.
  const ownModule = await fixture([{
    path: "packages/backend/modules/gifts/composition.ts",
    text:
      'import { Repository } from "./adapters/postgres/gift_repository.ts";',
  }]);
  assert(ownModule.length === 0, `unexpected: ${render(ownModule)}`);
});

Deno.test("[GAP-005] delivery code reaches a module only through its facade", async () => {
  const deep = await fixture([{
    path: "apps/api/people.ts",
    text:
      'import { create } from "../../packages/backend/modules/gifts/application/gift_management.ts";',
  }]);
  assert(
    deep.length === 1 && deep[0]?.rule === "layer" &&
      deep[0].detail ===
        "packages/backend/modules/gifts/application/gift_management.ts is not a public entry point of gifts",
    `expected one public-entry-point violation, got ${render(deep)}`,
  );

  const facade = await fixture([{
    path: "apps/api/people.ts",
    text:
      'import { create } from "../../packages/backend/modules/gifts/public.ts";',
  }]);
  assert(facade.length === 0, `unexpected: ${render(facade)}`);

  const adapter = await fixture([{
    path: "apps/api/composition.ts",
    text:
      'import { Repository } from "../../packages/backend/modules/gifts/adapters/postgres/gift_repository.ts";',
  }]);
  assert(adapter.length === 0, `unexpected: ${render(adapter)}`);
});

Deno.test("[GAP-005] delivery code reaches a read model only through its facade", async () => {
  const deep = await fixture([{
    path: "apps/api/today.ts",
    text:
      'import { get } from "../../packages/backend/read-models/today/application/get_today.ts";',
  }]);
  assert(
    deep.length === 1 && deep[0]?.rule === "layer" &&
      deep[0].detail ===
        "packages/backend/read-models/today/application/get_today.ts is not a public entry point of today",
    `expected one public-entry-point violation, got ${render(deep)}`,
  );

  const facade = await fixture([{
    path: "apps/api/today.ts",
    text:
      'import { get } from "../../packages/backend/read-models/today/public.ts";',
  }]);
  assert(facade.length === 0, `unexpected: ${render(facade)}`);
});

// --- Module transport ----------------------------------------------------

const GIFT_ROUTES = "packages/backend/modules/gifts/transport/http/routes.ts";

Deno.test("[GAP-024] a module's transport reaches its facade, application, kit, contracts, and kernel", async () => {
  const violations = await fixture([
    {
      path: GIFT_ROUTES,
      text: [
        'import { Hono } from "hono";',
        'import { secureHeaders } from "hono/secure-headers";',
        'import type { z } from "zod";',
        'import type { GiftManagement } from "../../public.ts";',
        'import type { GiftContext } from "../../application/gift_context.ts";',
        'import { GIFT_FAILURES } from "./failures.ts";',
        'import { SHARED_FAILURE_STATUSES } from "../../../../shared-kernel/result.ts";',
        'import { createGift } from "../../../../../contracts/routes/gifts.ts";',
        'import { mount } from "../../../../../http-kit/route.ts";',
        'import type { PersonFiles } from "../../../files/public.ts";',
        '// A session that ended differs from "the session store is down".',
      ].join("\n"),
    },
    {
      // A module's routes may serve a projection over its own data: the
      // read model names the module among its sources.
      path: "packages/backend/modules/people/transport/http/routes.ts",
      text:
        'import type { TodayRecentPeople } from "../../../../read-models/today/public.ts";',
    },
  ]);
  assert(violations.length === 0, `unexpected: ${render(violations)}`);
});

Deno.test("[GAP-024] a module's transport never reaches its own adapters, domain, ports, or composition", async () => {
  const violations = await fixture([{
    path: GIFT_ROUTES,
    text: [
      'import { PostgresGiftRepository } from "../../adapters/postgres/gift_repository.ts";',
      'import { validateGift } from "../../domain/gift_rules.ts";',
      'import type { GiftAudit } from "../../ports/audit.ts";',
      'import { composeGifts } from "../../composition.ts";',
    ].join("\n"),
  }]);
  const expected = [
    "packages/backend/modules/gifts/adapters/postgres/gift_repository.ts",
    "packages/backend/modules/gifts/composition.ts",
    "packages/backend/modules/gifts/domain/gift_rules.ts",
    "packages/backend/modules/gifts/ports/audit.ts",
  ].map((target) =>
    `the transport layer imports ${target}; a module's transport reaches its own module only through public.ts, application/, and transport/`
  );
  assert(
    violations.length === expected.length &&
      violations.every((violation) =>
        violation.rule === "layer" && violation.subject === GIFT_ROUTES &&
        expected.includes(violation.detail)
      ),
    `expected four own-module transport violations, got ${render(violations)}`,
  );
});

Deno.test("[GAP-024] a module's transport never reaches the platform, an app, or a vendor client", async () => {
  const violations = await fixture([{
    path: GIFT_ROUTES,
    text: [
      'import { connectDatabase } from "../../../../platform/postgres/database.ts";',
      'import { browserSecurityPolicy } from "../../../../../../apps/api/security_config.ts";',
      'import { fixtures } from "../../../../testing/fixtures.ts";',
      'import { sql } from "kysely";',
      'import postgres from "npm:postgres@3.4.9";',
    ].join("\n"),
  }]);
  const details = violations.map((violation) => violation.detail).sort();
  const outside = (target: string) =>
    `the transport layer imports ${target}, which is outside the HTTP kit, the contracts, the shared kernel, and the module and read-model facades`;
  const expected = [
    outside("apps/api/security_config.ts"),
    outside("packages/backend/platform/postgres/database.ts"),
    outside("packages/backend/testing/fixtures.ts"),
    "the transport layer imports kysely",
    "the transport layer imports npm:postgres@3.4.9",
  ].sort();
  assert(
    JSON.stringify(details) === JSON.stringify(expected) &&
      violations.every((violation) =>
        violation.rule === "layer" && violation.subject === GIFT_ROUTES
      ),
    `expected five transport violations, got ${render(violations)}`,
  );
});

Deno.test("[GAP-024] a module's transport serves only a read model that composes the module", async () => {
  const violations = await fixture([{
    path: GIFT_ROUTES,
    text:
      'import type { TodayRecentPeople } from "../../../../read-models/today/public.ts";',
  }]);
  assert(
    violations.length === 1 && violations[0]?.rule === "layer" &&
      violations[0].detail ===
        "the transport layer imports the today read model, which does not compose gifts",
    `expected one read-model transport violation, got ${render(violations)}`,
  );
});

Deno.test("[GAP-024] only a declared composition root mounts a module's routes, and only through routes.ts", async () => {
  const mounted = await fixture([{
    path: "apps/api/composition.ts",
    text:
      'import { createGiftRoutes } from "../../packages/backend/modules/gifts/transport/http/routes.ts";',
  }]);
  assert(mounted.length === 0, `unexpected: ${render(mounted)}`);

  const violations = await fixture([
    {
      path: "apps/api/gifts.ts",
      text:
        'import { createGiftRoutes } from "../../packages/backend/modules/gifts/transport/http/routes.ts";',
    },
    {
      path: "apps/api/composition.ts",
      text:
        'import { GIFT_FAILURES } from "../../packages/backend/modules/gifts/transport/http/failures.ts";',
    },
    {
      path: GIFT_ROUTES,
      text:
        'import { createFileRoutes } from "../../../files/transport/http/routes.ts";',
    },
  ]);
  const expected = [
    "apps/api/composition.ts|packages/backend/modules/gifts/transport/http/failures.ts is not a public entry point of gifts",
    "apps/api/gifts.ts|packages/backend/modules/gifts/transport/http/routes.ts is not a public entry point of gifts",
    "packages/backend/modules/gifts/transport/http/routes.ts|packages/backend/modules/files/transport/http/routes.ts is not a public entry point of files",
  ];
  const found = violations.map((violation) =>
    `${violation.subject}|${violation.detail}`
  ).sort();
  assert(
    JSON.stringify(found) === JSON.stringify(expected),
    `expected three facade violations, got ${render(violations)}`,
  );
});

// --- The shared kernel ---------------------------------------------------

Deno.test("[GAP-006] every backend layer may import the shared kernel", async () => {
  for (
    const path of [
      "packages/backend/modules/gifts/domain/gift.ts",
      "packages/backend/modules/gifts/application/gift_management.ts",
      "packages/backend/modules/gifts/ports/gift_repository.ts",
      "packages/backend/modules/gifts/adapters/postgres/gift_repository.ts",
      "packages/backend/read-models/today/application/get_today.ts",
    ]
  ) {
    const depth = "../".repeat(path.split("/").length - 3);
    const violations = await fixture([{
      path,
      text: `import type { Clock } from "${depth}shared-kernel/clock.ts";`,
    }]);
    assert(
      violations.length === 0,
      `${path} must reach the kernel: ${render(violations)}`,
    );
  }
});

Deno.test("[GAP-006] the shared kernel imports nothing outside itself", async () => {
  const module = await fixture([{
    path: "packages/backend/shared-kernel/result.ts",
    text: 'import type { PeopleActor } from "../modules/people/public.ts";',
  }]);
  assert(
    module.length === 1 && module[0]?.rule === "layer" &&
      module[0].detail ===
        "the shared kernel imports packages/backend/modules/people/public.ts, which is outside the kernel",
    `the kernel must not import a module, got ${render(module)}`,
  );

  const readModel = await fixture([{
    path: "packages/backend/shared-kernel/pagination.ts",
    text: 'import { get } from "../read-models/today/public.ts";',
  }]);
  assert(
    readModel.length === 1 && readModel[0]?.rule === "layer" &&
      readModel[0].detail.includes("which is outside the kernel"),
    `the kernel must not import a read model, got ${render(readModel)}`,
  );

  for (const vendor of ["kysely", "postgres", "hono", "minio", "zod"]) {
    const violations = await fixture([{
      path: "packages/backend/shared-kernel/clock.ts",
      text: `import { thing } from "${vendor}";`,
    }]);
    assert(
      violations.length === 1 &&
        violations[0]?.detail ===
          `the shared kernel imports ${vendor}, which is outside the kernel`,
      `the kernel must not import ${vendor}, got ${render(violations)}`,
    );
  }

  const environment = await fixture([{
    path: "packages/backend/shared-kernel/clock.ts",
    text: "const zone = Deno.env.get('TZ');",
  }]);
  assert(
    environment.length === 1 &&
      environment[0]?.detail === "the shared kernel reads Deno.env",
    `the kernel must not read Deno.env, got ${render(environment)}`,
  );

  const rawSql = await fixture([{
    path: "packages/backend/shared-kernel/pagination.ts",
    text: "const query = `select id from crm.people`;",
  }]);
  assert(
    rawSql.length === 1 &&
      rawSql[0]?.detail ===
        "the shared kernel writes raw SQL against crm.people",
    `the kernel must not carry SQL, got ${render(rawSql)}`,
  );

  const inside = await fixture([{
    path: "packages/backend/shared-kernel/validation.ts",
    text: 'import type { Failure } from "./result.ts";',
  }]);
  assert(inside.length === 0, `unexpected: ${render(inside)}`);
});

// --- Rule 5: cycles ------------------------------------------------------

Deno.test("[GAP-005] dependency cycles are reported", async () => {
  const declared = await fixture([], {
    manifestText: MANIFEST.replace(
      `    publicEntryPoints: [packages/backend/modules/people/public.ts]
    allowedModuleDependencies: []`,
      `    publicEntryPoints: [packages/backend/modules/people/public.ts]
    allowedModuleDependencies: [gifts]`,
    ),
  });
  assert(
    declared.some((violation) =>
      violation.rule === "cycle" &&
      violation.detail.includes("allowedModuleDependencies form a cycle")
    ),
    `expected a declared cycle, got ${render(declared)}`,
  );

  const imports = await fixture([
    {
      path: "packages/backend/modules/gifts/application/gift_management.ts",
      text: 'import { load } from "../../files/public.ts";',
    },
    {
      path: "packages/backend/modules/files/application/person_files.ts",
      text: 'import { load } from "../../gifts/public.ts";',
    },
  ]);
  assert(
    imports.some((violation) =>
      violation.rule === "cycle" &&
      violation.detail ===
        "module imports form a cycle: files -> gifts -> files"
    ),
    `expected an import cycle, got ${render(imports)}`,
  );
});

// --- Rule 6: per-module composition ---------------------------------------

Deno.test("[GAP-013] only declared composition roots import a module's composition", async () => {
  const violations = await fixture([
    {
      path: "apps/api/composition.ts",
      text:
        'import { composeGifts } from "../../packages/backend/modules/gifts/composition.ts";',
    },
    {
      path: "apps/api/gifts.ts",
      text:
        'import { composeGifts } from "../../packages/backend/modules/gifts/composition.ts";',
    },
    {
      path: "packages/backend/modules/files/composition.ts",
      text: 'import { target } from "../gifts/composition.ts";',
    },
  ]);
  const composition = violations.filter((violation) =>
    violation.rule === "composition"
  );
  assert(
    composition.length === 2,
    `expected two composition violations, got ${render(violations)}`,
  );
  assert(
    composition.every((violation) =>
      violation.detail ===
        "packages/backend/modules/gifts/composition.ts is gifts's composition file and this file is not a declared composition root"
    ),
    `unexpected detail: ${render(composition)}`,
  );
  assert(
    composition.map((violation) => violation.subject).join(",") ===
      "apps/api/gifts.ts,packages/backend/modules/files/composition.ts",
    `unexpected subjects: ${render(composition)}`,
  );
});

Deno.test("[GAP-013] a module composes itself and its neighbours' facades freely", async () => {
  const violations = await fixture([
    {
      path: "packages/backend/modules/gifts/composition.ts",
      text: [
        'import { PostgresGiftRepository } from "./adapters/postgres/gifts.ts";',
        'import type { GiftAttachmentBoundary } from "../files/public.ts";',
      ].join("\n"),
    },
    {
      path: "packages/backend/modules/gifts/adapters/postgres/gifts.ts",
      text: 'import { shape } from "../../composition.ts";',
    },
  ]);
  assert(violations.length === 0, `unexpected: ${render(violations)}`);
});

// --- Rule 7: the public surface -------------------------------------------

Deno.test("[GAP-013] a public entry point may not re-export an adapter value", async () => {
  const violations = await fixture([{
    path: "packages/backend/modules/gifts/public.ts",
    text: [
      'export { createGiftManagement } from "./application/gift_management.ts";',
      'export { PostgresGiftRepository } from "./adapters/postgres/gifts.ts";',
      'export * from "./adapters/postgres/attachments.ts";',
    ].join("\n"),
  }]);
  assert(
    violations.length === 2 &&
      violations.every((violation) => violation.rule === "public-surface"),
    `expected two public-surface violations, got ${render(violations)}`,
  );
  assert(
    violations.map((violation) => violation.detail).join(" | ") ===
      "packages/backend/modules/gifts/adapters/postgres/attachments.ts is an adapter and a public entry point may re-export only its types | " +
        "packages/backend/modules/gifts/adapters/postgres/gifts.ts is an adapter and a public entry point may re-export only its types",
    `unexpected detail: ${render(violations)}`,
  );
});

Deno.test("[GAP-013] a public entry point still re-exports an adapter's types", async () => {
  const violations = await fixture([{
    path: "packages/backend/modules/gifts/public.ts",
    text: [
      'export type { GiftKeyset } from "./adapters/crypto/keys.ts";',
      'export { type GiftOptions, type GiftShape } from "./adapters/crypto/keys.ts";',
    ].join("\n"),
  }]);
  assert(violations.length === 0, `unexpected: ${render(violations)}`);
});

// --- The baseline --------------------------------------------------------

Deno.test("[GAP-005] the baseline may only shrink", async () => {
  const violations = await fixture([{
    path: "packages/backend/modules/files/adapters/postgres/attachments.ts",
    text: "sql`select id from crm.gifts`",
  }]);
  const recorded = compareWithBaseline(violations, violations);
  assert(
    recorded.introduced.length === 0 && recorded.resolved.length === 0 &&
      recorded.remaining === 1,
    "a fully recorded violation set is green",
  );

  const introduced = compareWithBaseline(violations, []);
  assert(
    introduced.introduced.length === 1 && introduced.remaining === 0,
    "a violation missing from the baseline is new",
  );

  const stale = compareWithBaseline([], violations);
  assert(
    stale.resolved.length === 1 && stale.introduced.length === 0,
    "a baseline entry that no longer occurs fails the check",
  );
});

Deno.test("[GAP-005] the recorded baseline is well formed", async () => {
  const recorded = await baseline();
  assert(
    Array.isArray(recorded.violations) && recorded.violations.length > 0,
    "the baseline records the violations this repository already had",
  );
  const keys = new Set<string>();
  for (const violation of recorded.violations) {
    const key = `${violation.rule}|${violation.subject}|${violation.detail}`;
    assert(!keys.has(key), `the baseline repeats ${key}`);
    keys.add(key);
    assert(
      violation.subject.length > 0 && violation.detail.length > 0,
      `an incomplete baseline entry: ${key}`,
    );
  }
});

// --- Folded ticket regressions -------------------------------------------

Deno.test("[APP-004C] organization queries stay inside the People module", async () => {
  const violations = await repository([
    "packages/backend/modules/workspaces/adapters/postgres/profile_fact_configuration.ts",
    "packages/backend/modules/people/adapters/postgres/profile_fact_organizations.ts",
  ]);
  refuse(
    violations,
    ["crm.organizations"],
    "the workspaces configuration adapter must not reach People-owned organizations",
  );
});

Deno.test("[APP-005A] the interaction adapters read only interaction-owned tables", async () => {
  const violations = await repository([
    "packages/backend/modules/interactions/adapters/postgres/interaction_repository.ts",
    "packages/backend/modules/interactions/adapters/postgres/communication_repository.ts",
  ]);
  refuse(
    violations,
    [
      "crm.people",
      "crm.activity_types",
      "crm.emotion_options",
      "crm.contact_method_types",
      "crm.person_contact_methods",
    ],
    "the interaction write adapters must not read foreign tables",
  );
});

Deno.test("[APP-005C] the audit-history read model stays inside its source modules", async () => {
  const violations = await repository([
    "packages/backend/read-models/audit-history/adapters/postgres/audit_history_repository.ts",
    "packages/backend/read-models/audit-history/application/list_audit_history.ts",
    "packages/backend/modules/governance/transport/http/routes.ts",
  ]);
  assert(
    violations.length === 0,
    `the audit-history composition must stay read-only and allowlisted: ${
      render(violations)
    }`,
  );
});

Deno.test("[APP-007B] gifts consume files-owned links only through the files facade", async () => {
  const violations = await repository([
    "packages/backend/modules/gifts/adapters/postgres/gift_repository.ts",
  ]);
  refuse(
    violations,
    ["crm.gift_file_links"],
    "the gifts repository must not read files-owned gift_file_links",
  );
});

Deno.test("[APP-009B] import-export reads people and artifacts through their owners", async () => {
  const violations = await repository([
    "packages/backend/modules/import-export/adapters/postgres/export_repository.ts",
    "packages/backend/modules/import-export/application/export_management.ts",
    "packages/backend/modules/people/adapters/postgres/export_people_boundary.ts",
    "packages/backend/modules/files/adapters/postgres/export_file_boundary.ts",
  ]);
  refuse(
    violations,
    ["crm.people,", "crm.person_contact_methods", "crm.files"],
    "import-export must not cross a source module's table boundary",
  );
});

Deno.test("[GAP-008] one adapter carries the whole actor-context read", async () => {
  const revalidation = await repository([
    "packages/backend/modules/workspaces/adapters/postgres/actor_revalidation.ts",
  ]);
  assert(
    revalidation.length === 0,
    `the declared actor-revalidation adapter must be clean, got ${
      render(revalidation)
    }`,
  );

  // The exemption names one file, so any other workspaces adapter that went
  // back to the join is still reported.
  const undeclared = await fixture([{
    path:
      "packages/backend/modules/workspaces/adapters/postgres/member_ui_state.ts",
    text: "const query = sql`select id from crm.users where id = ${id}`;",
  }], {
    manifestText: await read(MANIFEST_PATH),
    canonicalSchemaPath: CANONICAL_SCHEMA_PATH,
    canonicalSchemaSql: await read(CANONICAL_SCHEMA_PATH),
  });
  assert(
    undeclared.some((violation) =>
      violation.rule === "table-foreign-read" &&
      violation.detail === "workspaces reads crm.users, owned by identity"
    ),
    `another workspaces adapter reading crm.users is still reported, got ${
      render(undeclared)
    }`,
  );

  const waveOne = await repository([
    "packages/backend/modules/people/adapters/postgres/export_people_boundary.ts",
    "packages/backend/modules/people/adapters/postgres/import_people_boundary.ts",
    "packages/backend/modules/people/adapters/postgres/important_date_repository.ts",
    "packages/backend/modules/people/adapters/postgres/people_repository.ts",
    "packages/backend/modules/people/adapters/postgres/person_lifecycle_repository.ts",
    "packages/backend/modules/people/adapters/postgres/profile_fact_repository.ts",
    "packages/backend/modules/relationships/adapters/postgres/relationship_repository.ts",
    "packages/backend/modules/planning/adapters/postgres/task_repository.ts",
  ]);
  refuse(
    waveOne,
    ["crm.users", "crm.workspace_members", "crm.workspaces,"],
    "wave-one adapters must not re-create the actor-context join",
  );
});

Deno.test("[GAP-009] wave two carries no copy of the actor-context join", async () => {
  const waveTwo = await repository([
    "packages/backend/modules/api-access/adapters/postgres/api_token_repository.ts",
    "packages/backend/modules/files/adapters/postgres/export_file_boundary.ts",
    "packages/backend/modules/files/adapters/postgres/file_metadata_repository.ts",
    "packages/backend/modules/files/adapters/postgres/gift_attachment_boundary.ts",
    "packages/backend/modules/files/adapters/postgres/import_file_boundary.ts",
    "packages/backend/modules/files/adapters/postgres/storage_settings_repository.ts",
    "packages/backend/modules/gifts/adapters/postgres/gift_repository.ts",
    "packages/backend/modules/governance/adapters/postgres/legal_acceptance_repository.ts",
    "packages/backend/modules/import-export/adapters/postgres/export_repository.ts",
    "packages/backend/modules/import-export/adapters/postgres/import_repository.ts",
    "packages/backend/modules/integrations/adapters/postgres/dav_repository.ts",
    "packages/backend/modules/interactions/adapters/postgres/journal_activity_boundary.ts",
    "packages/backend/modules/journal/adapters/postgres/journal_repository.ts",
    "packages/backend/modules/workspaces/adapters/postgres/interaction_workspace_boundary.ts",
    "packages/backend/modules/workspaces/adapters/postgres/member_ui_state.ts",
    "packages/backend/modules/workspaces/adapters/postgres/recent_people.ts",
    "packages/backend/modules/workspaces/adapters/postgres/relationship_workspace_boundary.ts",
    "packages/backend/read-models/activity-report/adapters/postgres/activity_report_repository.ts",
    "packages/backend/read-models/journal-timeline/adapters/postgres/journal_timeline_repository.ts",
    "packages/backend/read-models/people-directory/adapters/postgres/people_directory_repository.ts",
    "packages/backend/read-models/person-profile/adapters/postgres/person_profile_repository.ts",
    "packages/backend/read-models/today/adapters/postgres/today_attention_repository.ts",
    "packages/backend/read-models/today/adapters/postgres/today_interactions_repository.ts",
    "packages/backend/read-models/today/adapters/postgres/today_recent_people_repository.ts",
    "packages/backend/read-models/today/adapters/postgres/today_reminders_repository.ts",
    "packages/backend/read-models/today/adapters/postgres/today_tasks_repository.ts",
  ]);
  refuse(
    waveTwo,
    ["crm.users", "crm.gifts,"],
    "wave-two adapters must not re-create the actor-context join",
  );
});

Deno.test("[GAP-005] the folded ticket boundaries are not hidden in the baseline", async () => {
  const recorded = await baseline();
  const forbidden = [
    {
      subject:
        "packages/backend/modules/workspaces/adapters/postgres/profile_fact_configuration.ts",
      fragment: "crm.organizations",
    },
    {
      subject:
        "packages/backend/modules/interactions/adapters/postgres/interaction_repository.ts",
      fragment: "crm.people",
    },
    {
      subject:
        "packages/backend/modules/gifts/adapters/postgres/gift_repository.ts",
      fragment: "crm.gift_file_links",
    },
    {
      subject:
        "packages/backend/modules/import-export/adapters/postgres/export_repository.ts",
      fragment: "crm.people,",
    },
  ];
  for (const entry of forbidden) {
    const hidden = recorded.violations.filter((violation) =>
      violation.subject === entry.subject &&
      violation.detail.includes(entry.fragment)
    );
    assert(
      hidden.length === 0,
      `${entry.subject} must not baseline ${entry.fragment}: ${render(hidden)}`,
    );
  }
});

// --- MCP-C1 --------------------------------------------------------------

Deno.test("[MCP-C1] the MCP kit is built only from the contracts, the HTTP kit, and its libraries", async () => {
  const clean = await fixture([{
    path: "packages/mcp-kit/endpoint.ts",
    text: [
      'import { McpServer } from "@modelcontextprotocol/server";',
      'import { Hono } from "hono";',
      'import { z } from "zod";',
      'import { mcp } from "../contracts/routes/mcp.ts";',
      'import { mount } from "../http-kit/route.ts";',
      'import { toolResult } from "./tool_call.ts";',
    ].join("\n"),
  }]);
  assert(clean.length === 0, `expected no violation: ${render(clean)}`);

  const reaching = await fixture([{
    path: "packages/mcp-kit/endpoint.ts",
    text: [
      'import { createTaskManagement } from "../backend/modules/people/public.ts";',
      'import postgres from "postgres";',
    ].join("\n"),
  }]);
  for (
    const target of ["packages/backend/modules/people/public.ts", "postgres"]
  ) {
    assert(
      reaching.some((violation) =>
        violation.detail ===
          `the MCP kit imports ${target}, which is outside the contracts, the HTTP kit, Hono, Zod, and the MCP SDK`
      ),
      `expected a violation for ${target}, got ${render(reaching)}`,
    );
  }
});

Deno.test("[MCP-C1] only a composition root mounts the MCP kit, and nothing else speaks the protocol", async () => {
  const mounted = await fixture([{
    path: "apps/api/composition.ts",
    text:
      'import { createMcpRoutes } from "../../packages/mcp-kit/endpoint.ts";',
  }]);
  assert(mounted.length === 0, `a root may mount it: ${render(mounted)}`);

  const stray = await fixture([
    {
      path: "packages/backend/modules/people/application/people.ts",
      text:
        'import { createMcpRoutes } from "../../../../mcp-kit/endpoint.ts";',
    },
    {
      path: "packages/http-kit/route.ts",
      text:
        'import { McpServer } from "npm:@modelcontextprotocol/server@2.4.0";',
    },
    {
      path: "apps/web/src/islands/agent.tsx",
      text:
        'import { toolResult } from "../../../../packages/mcp-kit/tool_call.ts";',
    },
  ]);
  for (
    const detail of [
      "packages/mcp-kit/endpoint.ts is the MCP kit, which only a declared composition root mounts",
      "packages/http-kit/route.ts imports @modelcontextprotocol/server outside the MCP kit",
      "apps/web imports packages/mcp-kit/tool_call.ts, which is not a frontend import surface",
    ]
  ) {
    assert(
      stray.some((violation) => violation.detail === detail),
      `expected "${detail}", got ${render(stray)}`,
    );
  }
  const application = await fixture([{
    path: "packages/backend/modules/people/application/people.ts",
    text: 'import { McpServer } from "@modelcontextprotocol/server";',
  }]);
  assert(
    application.some((violation) =>
      violation.detail ===
        "the application layer imports @modelcontextprotocol/server"
    ),
    `the SDK is infrastructure to a use case: ${render(application)}`,
  );
});

Deno.test("[MCP-C1] the tool catalog is contract data", async () => {
  const clean = await fixture([{
    path: "packages/contracts/tools/planning.ts",
    text: [
      'import { z } from "zod";',
      'import { createTask } from "../routes/planning.ts";',
      'import { defineTool } from "./define.ts";',
    ].join("\n"),
  }]);
  assert(clean.length === 0, `expected no violation: ${render(clean)}`);
  const reaching = await fixture([{
    path: "packages/contracts/tools/planning.ts",
    text: [
      'import { Hono } from "hono";',
      'import { mount } from "../../http-kit/route.ts";',
    ].join("\n"),
  }]);
  for (const target of ["hono", "packages/http-kit/route.ts"]) {
    assert(
      reaching.some((violation) =>
        violation.detail ===
          `the tool catalog imports ${target}; it is contract data and imports only the contracts and Zod`
      ),
      `expected a violation for ${target}, got ${render(reaching)}`,
    );
  }
});

Deno.test("[MCP-C1] the real MCP kit, catalog, and mount are inside their boundaries", async () => {
  const violations = await repository([
    "apps/api/composition.ts",
    "packages/mcp-kit/endpoint.ts",
    "packages/mcp-kit/server.ts",
    "packages/mcp-kit/tool_call.ts",
    "packages/contracts/tools/define.ts",
    "packages/contracts/tools/mod.ts",
    "packages/contracts/tools/interactions.ts",
  ]);
  refuse(
    violations,
    ["MCP kit", "MCP SDK", "tool catalog", "@modelcontextprotocol"],
    "the MCP boundaries hold for the real files",
  );
});
