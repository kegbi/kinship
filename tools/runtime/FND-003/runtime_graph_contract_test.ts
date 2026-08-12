// FND-003 freezes this test before the runtime graph is implemented.
// It intentionally uses only Deno and Web Platform built-ins.

type JsonRecord = Record<string, unknown>;

const PACKAGE_IDS = [
  "deno",
  "node",
  "corepack",
  "pnpm",
  "astro",
  "astro-react",
  "react",
  "react-dom",
  "astro-check",
  "typescript",
  "tailwindcss",
  "tailwind-vite",
  "vite",
  "hono",
  "zod",
  "hono-standard-validator",
  "standard-schema-spec",
  "kysely",
  "kysely-postgres-js",
  "postgres",
  "vitest",
  "coverage-v8",
  "happy-dom",
  "playwright-test",
  "shadcn",
  "base-ui-react",
  "class-variance-authority",
  "clsx",
  "tailwind-merge",
  "lucide-react",
] as const;

const COMPATIBILITY_EDGES = [
  "astro-check-typescript",
  "astro-react",
  "hono-standard-validator",
  "dialect-postgres-js",
  "kysely-postgres-dialect",
  "playwright-image",
  "standard-schema-zod",
  "tailwind-vite",
  "vite-vitest",
] as const;

const IMPORT_EDGES = [
  "astro-check-typescript",
  "astro-react",
  "hono-standard-validator",
  "hono-validator-zod",
  "kysely-dialect",
  "kysely-postgres-js",
  "shadcn-button-base-ui",
  "shadcn-button-cva",
  "shadcn-button-lucide",
  "shadcn-cn-clsx",
  "shadcn-cn-tailwind-merge",
  "tailwind-vite",
  "vite-vitest",
  "vitest-coverage",
  "vitest-dom-environment",
] as const;

const IMPORT_EDGE_PAIRS: Record<string, [string, string]> = {
  "astro-check-typescript": ["astro-check", "typescript"],
  "astro-react": ["astro", "astro-react"],
  "hono-standard-validator": ["hono", "hono-standard-validator"],
  "hono-validator-zod": ["hono-standard-validator", "zod"],
  "kysely-dialect": ["kysely", "kysely-postgres-js"],
  "kysely-postgres-js": ["kysely-postgres-js", "postgres"],
  "shadcn-button-base-ui": ["shadcn", "base-ui-react"],
  "shadcn-button-cva": ["shadcn", "class-variance-authority"],
  "shadcn-button-lucide": ["shadcn", "lucide-react"],
  "shadcn-cn-clsx": ["shadcn", "clsx"],
  "shadcn-cn-tailwind-merge": ["shadcn", "tailwind-merge"],
  "tailwind-vite": ["tailwind-vite", "vite"],
  "vite-vitest": ["vite", "vitest"],
  "vitest-coverage": ["vitest", "coverage-v8"],
  "vitest-dom-environment": ["vitest", "happy-dom"],
};

const BUTTON_IMPORT_CLOSURE = [
  "base-ui-react",
  "class-variance-authority",
  "clsx",
  "lucide-react",
  "tailwind-merge",
] as const;

const FOLLOW_ON_LOCKS = ["deno.lock", "pnpm-lock.yaml"] as const;

const PACKAGE_NAME_OVERRIDES: Record<string, string> = {
  "astro-react": "@astrojs/react",
  "astro-check": "@astrojs/check",
  "tailwind-vite": "@tailwindcss/vite",
  "hono-standard-validator": "@hono/standard-validator",
  "standard-schema-spec": "@standard-schema/spec",
  "coverage-v8": "@vitest/coverage-v8",
  "playwright-test": "@playwright/test",
  "base-ui-react": "@base-ui/react",
};

const OCI_IDS = [
  "deno",
  "node",
  "playwright",
  "postgres18",
  "postgres17",
] as const;

const FOLLOW_ONS: Record<string, string> = {
  "FND-003A": "backend-database-runtime",
  "FND-003B": "frontend-component-test-runtime",
  "FND-003C": "playwright-browser-image-runtime",
  "FND-003D": "root-commands-and-hooks",
};

const REPOSITORY_FILES = [
  ".npmrc",
  "deno.json",
  "deno.lock",
  "package.json",
  "pnpm-workspace.yaml",
  "pnpm-lock.yaml",
] as const;

const GRAPH_PATH = "docs/validation/runtime-graph-fnd003.json";
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const SHA512 = /^sha512-[A-Za-z0-9+/]{16,}={0,2}$/;
const EXACT_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const OCI_INDEX_MEDIA = "application/vnd.oci.image.index.v1+json";
const OCI_MANIFEST_MEDIA = "application/vnd.oci.image.manifest.v1+json";

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function object(value: unknown, label: string): JsonRecord {
  invariant(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${label} must be an object`,
  );
  return value as JsonRecord;
}

function array(value: unknown, label: string): unknown[] {
  invariant(Array.isArray(value), `${label} must be an array`);
  return value;
}

function string(value: unknown, label: string): string {
  invariant(
    typeof value === "string" && value.length > 0,
    `${label} must be a non-empty string`,
  );
  return value;
}

function boolean(value: unknown, label: string): boolean {
  invariant(typeof value === "boolean", `${label} must be a boolean`);
  return value;
}

function exactKeys(
  value: JsonRecord,
  keys: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  invariant(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label} has missing or unknown fields`,
  );
}

function uniqueStrings(values: unknown[], label: string): string[] {
  const strings = values.map((value, index) =>
    string(value, `${label}[${index}]`)
  );
  invariant(
    new Set(strings).size === strings.length,
    `${label} contains duplicates`,
  );
  return strings;
}

function exactSet(
  actual: string[],
  expected: readonly string[],
  label: string,
): void {
  invariant(
    JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort()),
    `${label} membership is not exact`,
  );
}

function instant(value: unknown, label: string): number {
  const text = string(value, label);
  invariant(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/.test(text),
    `${label} must be canonical UTC`,
  );
  const parsed = Date.parse(text);
  invariant(Number.isFinite(parsed), `${label} is not a valid instant`);
  return parsed;
}

function exactVersion(value: unknown, label: string): string {
  const version = string(value, label);
  invariant(
    EXACT_VERSION.test(version),
    `${label} must be an exact stable version`,
  );
  return version;
}

function compareVersions(left: string, right: string): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index]! - b[index]!;
  }
  return 0;
}

function assertSha256(value: unknown, label: string): string {
  const digest = string(value, label);
  invariant(SHA256.test(digest), `${label} must be an immutable sha256 digest`);
  return digest;
}

function assertIntegrity(value: unknown, label: string): string {
  const integrity = string(value, label);
  invariant(
    SHA512.test(integrity),
    `${label} must contain sha512 registry integrity`,
  );
  return integrity;
}

function detectDuplicateJsonKeys(text: string): void {
  const stack: Array<
    { kind: "object"; keys: Set<string> } | { kind: "array" }
  > = [];
  let index = 0;
  while (index < text.length) {
    const token = text[index];
    if (token === "{") {
      stack.push({ kind: "object", keys: new Set() });
      index++;
    } else if (token === "[") {
      stack.push({ kind: "array" });
      index++;
    } else if (token === "}" || token === "]") {
      stack.pop();
      index++;
    } else if (token === '"') {
      const start = index;
      index++;
      while (index < text.length) {
        if (text[index] === "\\") index += 2;
        else if (text[index] === '"') {
          index++;
          break;
        } else index++;
      }
      let cursor = index;
      while (/\s/.test(text.charAt(cursor))) cursor++;
      const current = stack.at(-1);
      if (current?.kind === "object" && text[cursor] === ":") {
        const key = JSON.parse(text.slice(start, index)) as string;
        invariant(!current.keys.has(key), `JSON contains duplicate key ${key}`);
        current.keys.add(key);
      }
    } else index++;
  }
}

function parseGraphText(text: string): JsonRecord {
  invariant(
    text.length <= 1_000_000,
    "graph exceeds the deterministic size limit",
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("graph must be valid JSON");
  }
  detectDuplicateJsonKeys(text);
  return object(parsed, "graph");
}

function validateSelection(
  graph: JsonRecord,
): { selectedAt: number; cutoff: number } {
  const selection = object(graph.selection, "selection");
  exactKeys(
    selection,
    ["selectedAt", "minimumAgeHours", "eligibleBefore"],
    "selection",
  );
  invariant(
    selection.minimumAgeHours === 72,
    "minimum release age must be exactly 72 hours",
  );
  const selectedAt = instant(selection.selectedAt, "selection.selectedAt");
  const cutoff = instant(selection.eligibleBefore, "selection.eligibleBefore");
  invariant(
    selectedAt - cutoff === 72 * 60 * 60 * 1000,
    "selection cutoff must be exactly 72 hours",
  );
  return { selectedAt, cutoff };
}

function validatePackages(
  graph: JsonRecord,
  cutoff: number,
): Map<string, JsonRecord> {
  const packages = array(graph.packages, "packages").map((item, index) =>
    object(item, `packages[${index}]`)
  );
  const ids = packages.map((item, index) =>
    string(item.id, `packages[${index}].id`)
  );
  exactSet(ids, PACKAGE_IDS, "packages");
  const byId = new Map<string, JsonRecord>();
  for (const [index, item] of packages.entries()) {
    const label = `packages[${index}]`;
    exactKeys(
      item,
      [
        "id",
        "name",
        "version",
        "publishedAt",
        "integrity",
        "provenanceSha256",
        "manifest",
        "installHooks",
        "newerReleases",
      ],
      label,
    );
    const id = string(item.id, `${label}.id`);
    invariant(
      item.name === (PACKAGE_NAME_OVERRIDES[id] ?? id),
      `${id} package identity is not exact`,
    );
    const version = exactVersion(item.version, `${label}.version`);
    invariant(
      instant(item.publishedAt, `${label}.publishedAt`) <= cutoff,
      `${id} is younger than the 72-hour cutoff`,
    );
    assertIntegrity(item.integrity, `${label}.integrity`);
    assertSha256(item.provenanceSha256, `${label}.provenanceSha256`);
    invariant(
      ["deno", "pnpm", "runtime"].includes(
        string(item.manifest, `${label}.manifest`),
      ),
      `${label}.manifest is unknown`,
    );
    uniqueStrings(
      array(item.installHooks, `${label}.installHooks`),
      `${label}.installHooks`,
    );
    for (
      const [releaseIndex, rawRelease] of array(
        item.newerReleases,
        `${label}.newerReleases`,
      ).entries()
    ) {
      const release = object(
        rawRelease,
        `${label}.newerReleases[${releaseIndex}]`,
      );
      exactKeys(release, [
        "version",
        "publishedAt",
        "compatible",
        "reason",
        "evidenceSha256",
      ], `${label}.newerReleases[${releaseIndex}]`);
      const newer = exactVersion(
        release.version,
        `${label}.newerReleases[${releaseIndex}].version`,
      );
      invariant(
        compareVersions(newer, version) > 0,
        `${id} newer release is not newer`,
      );
      const compatible = boolean(
        release.compatible,
        `${label}.newerReleases[${releaseIndex}].compatible`,
      );
      const publishedAt = instant(
        release.publishedAt,
        `${label}.newerReleases[${releaseIndex}].publishedAt`,
      );
      invariant(
        !(compatible && publishedAt <= cutoff),
        `${id} did not select the newest eligible compatible release`,
      );
      string(release.reason, `${label}.newerReleases[${releaseIndex}].reason`);
      assertSha256(
        release.evidenceSha256,
        `${label}.newerReleases[${releaseIndex}].evidenceSha256`,
      );
    }
    invariant(!byId.has(id), "packages contains duplicate IDs");
    byId.set(id, item);
  }
  invariant(
    Number(
      exactVersion(byId.get("typescript")?.version, "typescript.version").split(
        ".",
      )[0],
    ) < 7,
    "TypeScript 7 is incompatible with the selected Astro check",
  );
  return byId;
}

function validateRepositoryDeclarations(
  graph: JsonRecord,
  packages: Map<string, JsonRecord>,
): void {
  const repository = object(graph.repository, "repository");
  exactKeys(
    repository,
    [
      "artifacts",
      "lockMembers",
      "importEdges",
      "lockRoots",
      "successorLockPlans",
      "lockProof",
    ],
    "repository",
  );
  const artifacts = array(repository.artifacts, "repository.artifacts").map((
    item,
    index,
  ) => object(item, `repository.artifacts[${index}]`));
  const paths = artifacts.map((item, index) => {
    exactKeys(item, ["path", "sha256"], `repository.artifacts[${index}]`);
    assertSha256(item.sha256, `repository.artifacts[${index}].sha256`);
    return string(item.path, `repository.artifacts[${index}].path`);
  });
  exactSet(paths, REPOSITORY_FILES, "repository artifacts");

  const lockMembers = array(repository.lockMembers, "repository.lockMembers")
    .map((item, index) => object(item, `repository.lockMembers[${index}]`));
  const memberIds = lockMembers.map((item, index) => {
    const label = `repository.lockMembers[${index}]`;
    exactKeys(item, ["id", "lock", "resolution", "integrity"], label);
    const id = string(item.id, `${label}.id`);
    const dependency = object(packages.get(id), `${label}.package`);
    const lock = string(item.lock, `${label}.lock`);
    invariant(
      lock === `${dependency.manifest}.lock`,
      `${label}.lock classification is incorrect`,
    );
    invariant(
      string(item.resolution, `${label}.resolution`) ===
        `${dependency.name}@${dependency.version}`,
      `${label}.resolution drifted`,
    );
    invariant(
      item.integrity === dependency.integrity,
      `${label}.integrity drifted`,
    );
    return id;
  });
  exactSet(
    memberIds,
    [...packages.values()].filter((item) =>
      item.manifest === "deno" || item.manifest === "pnpm"
    ).map((item) => String(item.id)),
    "lock members",
  );

  const importEdges = array(repository.importEdges, "repository.importEdges")
    .map((item, index) => object(item, `repository.importEdges[${index}]`));
  const importEdgeIds = importEdges.map((edge, index) => {
    const label = `repository.importEdges[${index}]`;
    exactKeys(edge, ["id", "from", "to"], label);
    const id = string(edge.id, `${label}.id`);
    const from = string(edge.from, `${label}.from`);
    const to = string(edge.to, `${label}.to`);
    invariant(
      packages.has(from),
      `${label}.from is not locked in the root graph`,
    );
    invariant(
      packages.has(to),
      `${label}.to is not locked in the root graph`,
    );
    invariant(
      from === IMPORT_EDGE_PAIRS[id]?.[0] &&
        to === IMPORT_EDGE_PAIRS[id]?.[1],
      `${id} import edge is incorrect`,
    );
    return id;
  });
  exactSet(importEdgeIds, IMPORT_EDGES, "repository import edges");
  exactSet(
    uniqueStrings(
      array(repository.lockRoots, "repository.lockRoots"),
      "repository.lockRoots",
    ),
    FOLLOW_ON_LOCKS,
    "root lock files",
  );
  invariant(
    array(repository.successorLockPlans, "repository.successorLockPlans")
      .length === 0,
    "nested or successor lock plans are forbidden",
  );

  const lockProof = object(repository.lockProof, "repository.lockProof");
  exactKeys(lockProof, [
    "initial",
    "cleanCache",
    "offline",
    "lifecycleExecutions",
  ], "repository.lockProof");
  const initial = object(lockProof.initial, "repository.lockProof.initial");
  const cleanCache = object(
    lockProof.cleanCache,
    "repository.lockProof.cleanCache",
  );
  const offline = object(lockProof.offline, "repository.lockProof.offline");
  for (
    const [label, proof] of [["initial", initial], ["cleanCache", cleanCache], [
      "offline",
      offline,
    ]] as const
  ) {
    exactKeys(proof, ["deno", "pnpm"], `repository.lockProof.${label}`);
    assertSha256(proof.deno, `repository.lockProof.${label}.deno`);
    assertSha256(proof.pnpm, `repository.lockProof.${label}.pnpm`);
  }
  invariant(
    JSON.stringify(initial) === JSON.stringify(cleanCache) &&
      JSON.stringify(initial) === JSON.stringify(offline),
    "lock hashes changed during clean or offline resolution",
  );
  invariant(
    lockProof.lifecycleExecutions === 0,
    "resolution executed a lifecycle script",
  );
}

function validateCorepackAndLifecycle(
  graph: JsonRecord,
  packages: Map<string, JsonRecord>,
): void {
  const corepack = object(graph.corepack, "corepack");
  exactKeys(corepack, [
    "descriptor",
    "defaultToLatest",
    "signatureVerification",
    "integrityUpdatePath",
  ], "corepack");
  const pnpm = object(packages.get("pnpm"), "pnpm package");
  const descriptor = string(corepack.descriptor, "corepack.descriptor");
  invariant(
    descriptor.startsWith(`pnpm@${pnpm.version}+sha512.`) &&
      descriptor.length > 40,
    "Corepack descriptor lacks exact registry integrity",
  );
  invariant(
    corepack.defaultToLatest === "0",
    "COREPACK_DEFAULT_TO_LATEST must equal 0",
  );
  invariant(
    corepack.signatureVerification === true,
    "Corepack signature verification must remain enabled",
  );
  invariant(
    corepack.integrityUpdatePath === "reviewed-only",
    "unchecked Corepack integrity updates are forbidden",
  );

  const lifecycle = object(graph.lifecycle, "lifecycle");
  exactKeys(
    lifecycle,
    ["denoAllowScripts", "pnpm", "hookInventory"],
    "lifecycle",
  );
  const denoAllow = uniqueStrings(
    array(lifecycle.denoAllowScripts, "lifecycle.denoAllowScripts"),
    "lifecycle.denoAllowScripts",
  );
  const pnpmPolicy = object(lifecycle.pnpm, "lifecycle.pnpm");
  exactKeys(pnpmPolicy, [
    "saveExact",
    "frozenLockfile",
    "dangerouslyAllowAllBuilds",
    "onlyBuiltDependencies",
  ], "lifecycle.pnpm");
  invariant(
    pnpmPolicy.saveExact === true && pnpmPolicy.frozenLockfile === true,
    "pnpm exact-save and frozen-lock policy is required",
  );
  invariant(
    pnpmPolicy.dangerouslyAllowAllBuilds === false,
    "dangerouslyAllowAllBuilds is forbidden",
  );
  const pnpmAllow = uniqueStrings(
    array(
      pnpmPolicy.onlyBuiltDependencies,
      "lifecycle.pnpm.onlyBuiltDependencies",
    ),
    "lifecycle.pnpm.onlyBuiltDependencies",
  );
  const inventory = array(lifecycle.hookInventory, "lifecycle.hookInventory")
    .map((item, index) => object(item, `lifecycle.hookInventory[${index}]`));
  const expectedHooks = [...packages.values()].flatMap((item) =>
    array(item.installHooks, `${item.id}.installHooks`).map((hook) =>
      `${item.id}:${hook}`
    )
  ).sort();
  const inventoryHooks = inventory.map((item, index) => {
    const label = `lifecycle.hookInventory[${index}]`;
    exactKeys(item, ["packageId", "hook", "reviewed", "allowed"], label);
    const packageId = string(item.packageId, `${label}.packageId`);
    const hook = string(item.hook, `${label}.hook`);
    invariant(item.reviewed === true, `${label} is not reviewed`);
    const allowed = boolean(item.allowed, `${label}.allowed`);
    invariant(
      allowed === denoAllow.includes(packageId) &&
        allowed === pnpmAllow.includes(packageId),
      `${label} does not match both exact allowlists`,
    );
    return `${packageId}:${hook}`;
  }).sort();
  invariant(
    JSON.stringify(expectedHooks) === JSON.stringify(inventoryHooks),
    "transitive install-hook inventory is incomplete",
  );
  invariant(
    JSON.stringify(denoAllow.sort()) === JSON.stringify(pnpmAllow.sort()),
    "Deno and pnpm lifecycle allowlists differ",
  );
}

function validateCompatibility(
  graph: JsonRecord,
  packages: Map<string, JsonRecord>,
): void {
  const edges = array(graph.compatibility, "compatibility").map((item, index) =>
    object(item, `compatibility[${index}]`)
  );
  const ids = edges.map((edge, index) => {
    exactKeys(
      edge,
      ["id", "from", "to", "status", "evidenceSha256"],
      `compatibility[${index}]`,
    );
    invariant(
      packages.has(string(edge.from, `compatibility[${index}].from`)),
      `compatibility[${index}].from is unknown`,
    );
    invariant(
      packages.has(string(edge.to, `compatibility[${index}].to`)),
      `compatibility[${index}].to is unknown`,
    );
    invariant(
      edge.status === "compatible",
      `compatibility[${index}] is unresolved`,
    );
    assertSha256(edge.evidenceSha256, `compatibility[${index}].evidenceSha256`);
    return string(edge.id, `compatibility[${index}].id`);
  });
  exactSet(ids, COMPATIBILITY_EDGES, "compatibility edges");
  invariant(
    edges.some((edge) =>
      edge.from === "kysely" && edge.to === "kysely-postgres-js"
    ),
    "Kysely requires kysely-postgres-js",
  );
  invariant(
    edges.some((edge) =>
      edge.from === "kysely-postgres-js" && edge.to === "postgres"
    ),
    "the Kysely dialect requires Postgres.js",
  );
}

function validateShadcn(
  graph: JsonRecord,
  packages: Map<string, JsonRecord>,
): void {
  const shadcn = object(graph.shadcn, "shadcn");
  exactKeys(shadcn, [
    "packageId",
    "buttonSourceSha256",
    "buttonImportClosure",
    "registryInvocation",
    "generatedPayloads",
    "provenanceSha256",
  ], "shadcn");
  invariant(
    shadcn.packageId === "shadcn" && packages.has("shadcn"),
    "shadcn CLI package is missing",
  );
  assertSha256(shadcn.buttonSourceSha256, "shadcn.buttonSourceSha256");
  const buttonImportClosure = uniqueStrings(
    array(shadcn.buttonImportClosure, "shadcn.buttonImportClosure"),
    "shadcn.buttonImportClosure",
  );
  exactSet(
    buttonImportClosure,
    BUTTON_IMPORT_CLOSURE,
    "shadcn Button import closure",
  );
  invariant(
    buttonImportClosure.every((packageId) => packages.has(packageId)),
    "shadcn Button import closure is not fully locked",
  );
  invariant(
    shadcn.registryInvocation === null,
    "mutable shadcn registry invocation is forbidden",
  );
  invariant(
    array(shadcn.generatedPayloads, "shadcn.generatedPayloads").length === 0,
    "mutable generated shadcn payloads are forbidden",
  );
  assertSha256(shadcn.provenanceSha256, "shadcn.provenanceSha256");
}

function validateOci(
  graph: JsonRecord,
  packages: Map<string, JsonRecord>,
): void {
  const images = array(graph.ociImages, "ociImages").map((item, index) =>
    object(item, `ociImages[${index}]`)
  );
  const ids = images.map((image, index) => {
    const label = `ociImages[${index}]`;
    exactKeys(image, [
      "id",
      "repository",
      "tag",
      "indexDigest",
      "reference",
      "mediaType",
      "platforms",
      "attestations",
      "evidenceSha256",
    ], label);
    const id = string(image.id, `${label}.id`);
    const repository = string(image.repository, `${label}.repository`);
    const tag = exactVersion(image.tag, `${label}.tag`);
    const indexDigest = assertSha256(image.indexDigest, `${label}.indexDigest`);
    invariant(
      image.reference === `${repository}:${tag}@${indexDigest}`,
      `${label}.reference must contain exact tag plus index digest`,
    );
    invariant(
      image.mediaType === OCI_INDEX_MEDIA,
      `${label} digest is not an OCI index`,
    );
    const platforms = array(image.platforms, `${label}.platforms`).map((
      item,
      platformIndex,
    ) => object(item, `${label}.platforms[${platformIndex}]`));
    const platformKeys = platforms.map((platform, platformIndex) => {
      const platformLabel = `${label}.platforms[${platformIndex}]`;
      exactKeys(
        platform,
        ["os", "architecture", "digest", "mediaType"],
        platformLabel,
      );
      invariant(platform.os === "linux", `${platformLabel}.os must be linux`);
      const architecture = string(
        platform.architecture,
        `${platformLabel}.architecture`,
      );
      invariant(
        architecture === "amd64" || architecture === "arm64",
        `${platformLabel}.architecture is not runnable`,
      );
      const digest = assertSha256(platform.digest, `${platformLabel}.digest`);
      invariant(
        digest !== indexDigest,
        `${label} uses a platform child digest as its index`,
      );
      invariant(
        platform.mediaType === OCI_MANIFEST_MEDIA,
        `${platformLabel} is not an image manifest`,
      );
      return `linux/${architecture}`;
    });
    exactSet(
      platformKeys,
      ["linux/amd64", "linux/arm64"],
      `${label} runnable platforms`,
    );
    const attestations = array(image.attestations, `${label}.attestations`).map(
      (item, attestationIndex) =>
        object(item, `${label}.attestations[${attestationIndex}]`),
    );
    for (const [attestationIndex, attestation] of attestations.entries()) {
      const attestationLabel = `${label}.attestations[${attestationIndex}]`;
      exactKeys(
        attestation,
        ["digest", "mediaType", "classification"],
        attestationLabel,
      );
      const digest = assertSha256(
        attestation.digest,
        `${attestationLabel}.digest`,
      );
      invariant(
        attestation.mediaType === OCI_MANIFEST_MEDIA &&
          attestation.classification === "attestation",
        `${attestationLabel} is not separately classified`,
      );
      invariant(
        !platforms.some((platform) => platform.digest === digest),
        `${attestationLabel} masquerades as a runnable platform`,
      );
    }
    assertSha256(image.evidenceSha256, `${label}.evidenceSha256`);
    return id;
  });
  exactSet(ids, OCI_IDS, "OCI images");
  const playwrightImage = images.find((image) => image.id === "playwright");
  invariant(
    playwrightImage?.repository === "mcr.microsoft.com/playwright",
    "Playwright image must use the official repository",
  );
  invariant(
    playwrightImage?.tag === packages.get("playwright-test")?.version,
    "@playwright/test package and image versions differ",
  );
}

function validateProofStatus(
  graph: JsonRecord,
  packages: Map<string, JsonRecord>,
): void {
  const proofStatus = object(graph.proofStatus, "proofStatus");
  exactKeys(proofStatus, [
    "runtimeBehavior",
    "followOns",
    "followOnLockReuse",
    "excludedEarlyDependencies",
  ], "proofStatus");
  invariant(
    proofStatus.runtimeBehavior === "proof-pending",
    "deferred runtime behavior cannot be marked complete",
  );
  const followOns = object(proofStatus.followOns, "proofStatus.followOns");
  exactKeys(followOns, Object.keys(FOLLOW_ONS), "proofStatus.followOns");
  for (const [ticket, responsibility] of Object.entries(FOLLOW_ONS)) {
    invariant(
      followOns[ticket] === responsibility,
      `${ticket} responsibility is incorrect`,
    );
  }
  const followOnLockReuse = object(
    proofStatus.followOnLockReuse,
    "proofStatus.followOnLockReuse",
  );
  exactKeys(
    followOnLockReuse,
    ["FND-003A", "FND-003B", "FND-003C"],
    "proofStatus.followOnLockReuse",
  );
  for (const ticket of ["FND-003A", "FND-003B", "FND-003C"]) {
    const reuse = object(
      followOnLockReuse[ticket],
      `proofStatus.followOnLockReuse.${ticket}`,
    );
    exactKeys(
      reuse,
      ["locks", "mutation"],
      `proofStatus.followOnLockReuse.${ticket}`,
    );
    exactSet(
      uniqueStrings(
        array(reuse.locks, `proofStatus.followOnLockReuse.${ticket}.locks`),
        `proofStatus.followOnLockReuse.${ticket}.locks`,
      ),
      FOLLOW_ON_LOCKS,
      `${ticket} predecessor lock reuse`,
    );
    invariant(
      reuse.mutation === "forbidden",
      `${ticket} must not mutate predecessor locks`,
    );
  }
  const excluded = uniqueStrings(
    array(
      proofStatus.excludedEarlyDependencies,
      "proofStatus.excludedEarlyDependencies",
    ),
    "proofStatus.excludedEarlyDependencies",
  );
  exactSet(
    excluded,
    ["lefthook", "mutable-shadcn-generated-payload"],
    "early exclusions",
  );
  invariant(!packages.has("lefthook"), "Lefthook is premature in FND-003");
}

function validateGraph(graph: JsonRecord): void {
  exactKeys(graph, [
    "schemaVersion",
    "selection",
    "packages",
    "repository",
    "corepack",
    "lifecycle",
    "compatibility",
    "shadcn",
    "ociImages",
    "proofStatus",
  ], "graph");
  invariant(graph.schemaVersion === 1, "graph schemaVersion must equal 1");
  const { cutoff } = validateSelection(graph);
  const packages = validatePackages(graph, cutoff);
  validateRepositoryDeclarations(graph, packages);
  validateCorepackAndLifecycle(graph, packages);
  validateCompatibility(graph, packages);
  validateShadcn(graph, packages);
  validateOci(graph, packages);
  validateProofStatus(graph, packages);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function digest(seed: string): string {
  return `sha256:${seed.repeat(64).slice(0, 64)}`;
}

function makeValidGraph(): JsonRecord {
  const packageManifest = new Set([
    "astro",
    "astro-react",
    "react",
    "react-dom",
    "astro-check",
    "typescript",
    "tailwindcss",
    "tailwind-vite",
    "vite",
    "vitest",
    "coverage-v8",
    "happy-dom",
    "playwright-test",
    "shadcn",
    "base-ui-react",
    "class-variance-authority",
    "clsx",
    "tailwind-merge",
    "lucide-react",
  ]);
  const denoManifest = new Set([
    "hono",
    "zod",
    "hono-standard-validator",
    "standard-schema-spec",
    "kysely",
    "kysely-postgres-js",
    "postgres",
  ]);
  const packages = PACKAGE_IDS.map((id, index) => ({
    id,
    name: PACKAGE_NAME_OVERRIDES[id] ?? id,
    version: "1.2.3",
    publishedAt: "2026-01-01T00:00:00.000Z",
    integrity: "sha512-QUJDREVGR0hJSktMTU5PUA==",
    provenanceSha256: digest(((index % 9) + 1).toString()),
    manifest: packageManifest.has(id)
      ? "pnpm"
      : denoManifest.has(id)
      ? "deno"
      : "runtime",
    installHooks: [],
    newerReleases: [{
      version: "1.2.4",
      publishedAt: "2026-01-09T00:00:00.000Z",
      compatible: true,
      reason: "younger-than-72-hours",
      evidenceSha256: digest("a"),
    }],
  }));
  const lockMembers = packages.filter((item) => item.manifest !== "runtime")
    .map((item) => ({
      id: item.id,
      lock: `${item.manifest}.lock`,
      resolution: `${item.name}@${item.version}`,
      integrity: item.integrity,
    }));
  const compatibilityPairs: Record<string, [string, string]> = {
    "astro-check-typescript": ["astro-check", "typescript"],
    "astro-react": ["astro", "astro-react"],
    "hono-standard-validator": ["hono", "hono-standard-validator"],
    "dialect-postgres-js": ["kysely-postgres-js", "postgres"],
    "kysely-postgres-dialect": ["kysely", "kysely-postgres-js"],
    "playwright-image": ["playwright-test", "playwright-test"],
    "standard-schema-zod": ["hono-standard-validator", "zod"],
    "tailwind-vite": ["tailwind-vite", "vite"],
    "vite-vitest": ["vite", "vitest"],
  };
  const ociImages = OCI_IDS.map((id, index) => ({
    id,
    repository: id === "playwright"
      ? "mcr.microsoft.com/playwright"
      : `registry.example.invalid/${id}`,
    tag: "1.2.3",
    indexDigest: digest(((index + 1) % 9 + 1).toString()),
    reference: `${
      id === "playwright"
        ? "mcr.microsoft.com/playwright"
        : `registry.example.invalid/${id}`
    }:1.2.3@${digest(((index + 1) % 9 + 1).toString())}`,
    mediaType: OCI_INDEX_MEDIA,
    platforms: [
      {
        os: "linux",
        architecture: "amd64",
        digest: digest("b"),
        mediaType: OCI_MANIFEST_MEDIA,
      },
      {
        os: "linux",
        architecture: "arm64",
        digest: digest("c"),
        mediaType: OCI_MANIFEST_MEDIA,
      },
    ],
    attestations: [{
      digest: digest("d"),
      mediaType: OCI_MANIFEST_MEDIA,
      classification: "attestation",
    }],
    evidenceSha256: digest("e"),
  }));
  const lockHashes = { deno: digest("f"), pnpm: digest("1") };
  return {
    schemaVersion: 1,
    selection: {
      selectedAt: "2026-01-10T00:00:00.000Z",
      minimumAgeHours: 72,
      eligibleBefore: "2026-01-07T00:00:00.000Z",
    },
    packages,
    repository: {
      artifacts: REPOSITORY_FILES.map((path, index) => ({
        path,
        sha256: digest(((index + 2) % 9 + 1).toString()),
      })),
      lockMembers,
      importEdges: IMPORT_EDGES.map((id) => ({
        id,
        from: IMPORT_EDGE_PAIRS[id]![0],
        to: IMPORT_EDGE_PAIRS[id]![1],
      })),
      lockRoots: [...FOLLOW_ON_LOCKS],
      successorLockPlans: [],
      lockProof: {
        initial: lockHashes,
        cleanCache: clone(lockHashes),
        offline: clone(lockHashes),
        lifecycleExecutions: 0,
      },
    },
    corepack: {
      descriptor: "pnpm@1.2.3+sha512.QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=",
      defaultToLatest: "0",
      signatureVerification: true,
      integrityUpdatePath: "reviewed-only",
    },
    lifecycle: {
      denoAllowScripts: [],
      pnpm: {
        saveExact: true,
        frozenLockfile: true,
        dangerouslyAllowAllBuilds: false,
        onlyBuiltDependencies: [],
      },
      hookInventory: [],
    },
    compatibility: COMPATIBILITY_EDGES.map((id) => ({
      id,
      from: compatibilityPairs[id]![0],
      to: compatibilityPairs[id]![1],
      status: "compatible",
      evidenceSha256: digest("2"),
    })),
    shadcn: {
      packageId: "shadcn",
      buttonSourceSha256: digest("4"),
      buttonImportClosure: [...BUTTON_IMPORT_CLOSURE],
      registryInvocation: null,
      generatedPayloads: [],
      provenanceSha256: digest("3"),
    },
    ociImages,
    proofStatus: {
      runtimeBehavior: "proof-pending",
      followOns: clone(FOLLOW_ONS),
      followOnLockReuse: Object.fromEntries(
        ["FND-003A", "FND-003B", "FND-003C"].map((ticket) => [ticket, {
          locks: [...FOLLOW_ON_LOCKS],
          mutation: "forbidden",
        }]),
      ),
      excludedEarlyDependencies: [
        "lefthook",
        "mutable-shadcn-generated-payload",
      ],
    },
  };
}

function expectReject(
  mutator: (graph: JsonRecord) => void,
  expected: string,
): void {
  const graph = clone(makeValidGraph());
  mutator(graph);
  let observed = "";
  try {
    validateGraph(graph);
  } catch (error) {
    observed = (error as Error).message;
  }
  invariant(
    observed.includes(expected),
    `negative control expected '${expected}', observed '${observed}'`,
  );
}

function packageAt(graph: JsonRecord, id: string): JsonRecord {
  const item = array(graph.packages, "packages").find((candidate) =>
    object(candidate, "package").id === id
  );
  return object(item, `package ${id}`);
}

function ociAt(graph: JsonRecord, id: string): JsonRecord {
  const item = array(graph.ociImages, "ociImages").find((candidate) =>
    object(candidate, "OCI image").id === id
  );
  return object(item, `OCI image ${id}`);
}

Deno.test("runtime graph validator controls discriminate every FND-003 policy boundary", async () => {
  validateGraph(parseGraphText(JSON.stringify(makeValidGraph())));
  invariant(
    compareVersions("1.2.3", "1.2.3") === 0,
    "equal versions must compare equally",
  );
  detectDuplicateJsonKeys('{"escaped\\u002dkey" : "value"}');

  let parseError = "";
  try {
    parseGraphText("{");
  } catch (error) {
    parseError = (error as Error).message;
  }
  invariant(
    parseError.includes("valid JSON"),
    "malformed JSON control did not fail closed",
  );
  let duplicateError = "";
  try {
    parseGraphText('{"schemaVersion":1,"schemaVersion":1}');
  } catch (error) {
    duplicateError = (error as Error).message;
  }
  invariant(
    duplicateError.includes("duplicate key"),
    "duplicate JSON key control did not fail closed",
  );
  let sizeError = "";
  try {
    parseGraphText(" ".repeat(1_000_001));
  } catch (error) {
    sizeError = (error as Error).message;
  }
  invariant(
    sizeError.includes("size limit"),
    "oversized graph control did not fail closed",
  );

  expectReject((graph) => graph.unknown = true, "unknown fields");
  expectReject(
    (graph) => delete graph.schemaVersion,
    "missing or unknown fields",
  );
  expectReject(
    (graph) => packageAt(graph, "astro").version = "^1.2.3",
    "exact stable version",
  );
  expectReject(
    (graph) => packageAt(graph, "astro").version = "latest",
    "exact stable version",
  );
  expectReject(
    (graph) => packageAt(graph, "astro").version = "npm:astro@1.2.3",
    "exact stable version",
  );
  expectReject(
    (graph) => packageAt(graph, "playwright-test").name = "playwright",
    "package identity is not exact",
  );
  expectReject(
    (graph) =>
      packageAt(graph, "astro").publishedAt = "2026-01-08T00:00:00.000Z",
    "younger than",
  );
  expectReject(
    (graph) =>
      object(graph.selection, "selection").eligibleBefore =
        "2026-01-07T00:00:01.000Z",
    "exactly 72 hours",
  );
  expectReject(
    (graph) =>
      object(
        array(packageAt(graph, "astro").newerReleases, "releases")[0],
        "release",
      ).publishedAt = "2026-01-07T00:00:00.000Z",
    "newest eligible",
  );
  expectReject(
    (graph) =>
      array(graph.packages, "packages").push(
        clone(array(graph.packages, "packages")[0]),
      ),
    "membership is not exact",
  );

  expectReject(
    (graph) =>
      array(object(graph.repository, "repository").lockMembers, "members")
        .pop(),
    "lock members membership is not exact",
  );
  expectReject(
    (graph) =>
      object(
        array(object(graph.repository, "repository").lockMembers, "members")[0],
        "member",
      ).resolution = "drift@9.9.9",
    "resolution drifted",
  );
  expectReject(
    (graph) =>
      object(
        array(object(graph.repository, "repository").lockMembers, "members")[0],
        "member",
      ).integrity = "sha512-driftedAAAAAAAAAA=",
    "integrity drifted",
  );
  expectReject(
    (graph) =>
      object(
        object(object(graph.repository, "repository").lockProof, "proof")
          .offline,
        "offline",
      ).deno = digest("9"),
    "lock hashes changed",
  );
  expectReject(
    (graph) =>
      object(object(graph.repository, "repository").lockProof, "proof")
        .lifecycleExecutions = 1,
    "executed a lifecycle",
  );
  expectReject(
    (graph) =>
      array(object(graph.repository, "repository").importEdges, "imports")
        .pop(),
    "repository import edges membership is not exact",
  );
  expectReject(
    (graph) =>
      object(
        array(
          object(graph.repository, "repository").importEdges,
          "imports",
        ).find((edge) => object(edge, "edge").id === "vitest-dom-environment"),
        "DOM environment edge",
      ).to = "vitest",
    "vitest-dom-environment import edge is incorrect",
  );
  expectReject(
    (graph) =>
      array(object(graph.repository, "repository").lockRoots, "lock roots")
        .push("apps/web/pnpm-lock.yaml"),
    "root lock files membership is not exact",
  );
  expectReject(
    (graph) =>
      array(
        object(graph.repository, "repository").successorLockPlans,
        "successor locks",
      ).push("FND-003B"),
    "nested or successor lock plans are forbidden",
  );

  expectReject(
    (graph) => object(graph.corepack, "corepack").descriptor = "pnpm@1.2.3",
    "lacks exact registry integrity",
  );
  expectReject(
    (graph) => object(graph.corepack, "corepack").defaultToLatest = "1",
    "must equal 0",
  );
  expectReject(
    (graph) => object(graph.corepack, "corepack").signatureVerification = false,
    "must remain enabled",
  );
  expectReject(
    (graph) =>
      object(graph.corepack, "corepack").integrityUpdatePath = "automatic",
    "unchecked Corepack integrity",
  );
  expectReject(
    (graph) =>
      object(object(graph.lifecycle, "lifecycle").pnpm, "pnpm")
        .dangerouslyAllowAllBuilds = true,
    "dangerouslyAllowAllBuilds",
  );
  expectReject(
    (graph) =>
      object(graph.lifecycle, "lifecycle").denoAllowScripts = ["x", "x"],
    "contains duplicates",
  );
  expectReject(
    (graph) => packageAt(graph, "astro").installHooks = ["postinstall"],
    "inventory is incomplete",
  );
  const reviewedHookGraph = makeValidGraph();
  packageAt(reviewedHookGraph, "astro").installHooks = ["postinstall"];
  object(reviewedHookGraph.lifecycle, "lifecycle").denoAllowScripts = ["astro"];
  object(object(reviewedHookGraph.lifecycle, "lifecycle").pnpm, "pnpm")
    .onlyBuiltDependencies = ["astro"];
  object(reviewedHookGraph.lifecycle, "lifecycle").hookInventory = [{
    packageId: "astro",
    hook: "postinstall",
    reviewed: true,
    allowed: true,
  }];
  validateGraph(reviewedHookGraph);

  expectReject((graph) => {
    const typescript = packageAt(graph, "typescript");
    typescript.version = "7.0.0";
    object(array(typescript.newerReleases, "releases")[0], "release").version =
      "7.0.1";
  }, "TypeScript 7");
  expectReject(
    (graph) =>
      graph.compatibility = array(graph.compatibility, "compatibility").filter((
        edge,
      ) => object(edge, "edge").id !== "kysely-postgres-dialect"),
    "membership is not exact",
  );
  expectReject(
    (graph) =>
      object(
        array(graph.compatibility, "compatibility").find((edge) =>
          object(edge, "edge").id === "kysely-postgres-dialect"
        ),
        "edge",
      ).to = "postgres",
    "requires kysely-postgres-js",
  );
  expectReject(
    (graph) =>
      object(graph.shadcn, "shadcn").registryInvocation =
        "npx shadcn@latest add button",
    "registry invocation",
  );
  expectReject(
    (graph) =>
      object(graph.shadcn, "shadcn").generatedPayloads = ["button.tsx"],
    "generated shadcn payloads",
  );
  expectReject(
    (graph) => object(graph.shadcn, "shadcn").buttonSourceSha256 = "mutable",
    "immutable sha256 digest",
  );
  expectReject(
    (graph) =>
      array(
        object(graph.shadcn, "shadcn").buttonImportClosure,
        "Button closure",
      ).pop(),
    "shadcn Button import closure membership is not exact",
  );

  expectReject(
    (graph) =>
      ociAt(graph, "deno").reference = "registry.example.invalid/deno:latest",
    "exact tag plus index digest",
  );
  expectReject(
    (graph) => ociAt(graph, "deno").mediaType = OCI_MANIFEST_MEDIA,
    "not an OCI index",
  );
  expectReject(
    (graph) => {
      const image = ociAt(graph, "playwright");
      image.repository = "registry.example.invalid/playwright";
      image.reference = `${image.repository}:${image.tag}@${image.indexDigest}`;
    },
    "official repository",
  );
  expectReject(
    (graph) =>
      object(array(ociAt(graph, "deno").platforms, "platforms")[0], "platform")
        .digest = ociAt(graph, "deno").indexDigest,
    "platform child digest",
  );
  expectReject(
    (graph) => array(ociAt(graph, "deno").platforms, "platforms").pop(),
    "runnable platforms membership is not exact",
  );
  expectReject(
    (graph) =>
      array(ociAt(graph, "deno").platforms, "platforms").push(
        clone(array(ociAt(graph, "deno").platforms, "platforms")[0]),
      ),
    "runnable platforms membership is not exact",
  );
  expectReject(
    (graph) =>
      object(
        array(ociAt(graph, "deno").attestations, "attestations")[0],
        "attestation",
      ).digest = object(
        array(ociAt(graph, "deno").platforms, "platforms")[0],
        "platform",
      ).digest,
    "masquerades as a runnable platform",
  );
  expectReject((graph) => {
    const image = ociAt(graph, "playwright");
    image.tag = "1.2.4";
    image.reference = `${image.repository}:1.2.4@${image.indexDigest}`;
  }, "package and image versions differ");

  expectReject(
    (graph) =>
      object(graph.proofStatus, "proofStatus").runtimeBehavior = "proven",
    "cannot be marked complete",
  );
  expectReject(
    (graph) =>
      delete object(
        object(graph.proofStatus, "proofStatus").followOns,
        "followOns",
      )["FND-003C"],
    "missing or unknown fields",
  );
  expectReject(
    (graph) =>
      object(graph.proofStatus, "proofStatus").excludedEarlyDependencies = [
        "lefthook",
      ],
    "early exclusions membership is not exact",
  );
  expectReject(
    (graph) =>
      object(
        object(
          object(graph.proofStatus, "proofStatus").followOnLockReuse,
          "follow-on lock reuse",
        )["FND-003B"],
        "FND-003B lock reuse",
      ).mutation = "allowed",
    "must not mutate predecessor locks",
  );

  const repositoryGraph = makeValidGraph();
  const repositoryContents = new Map<string, string>();
  for (const path of REPOSITORY_FILES) {
    const content = `synthetic:${path}`;
    repositoryContents.set(path, content);
    const artifact = array(
      object(repositoryGraph.repository, "repository").artifacts,
      "artifacts",
    )
      .map((item) => object(item, "artifact"))
      .find((item) => item.path === path);
    object(artifact, `artifact ${path}`).sha256 = await sha256Text(content);
  }
  repositoryContents.set(GRAPH_PATH, JSON.stringify(repositoryGraph));
  await validateRepositoryGraph((path) =>
    Promise.resolve(string(repositoryContents.get(path), path))
  );

  const [missingResult, readFailureResult] = await Promise.allSettled([
    readRepositoryInputs((_path: string): Promise<string> => {
      throw new Deno.errors.NotFound();
    }),
    readRepositoryInputs((_path: string): Promise<string> => {
      throw new Error("synthetic read failure");
    }),
  ]);
  invariant(
    missingResult.status === "rejected",
    "missing repository inputs must reject",
  );
  const missingInput = (missingResult.reason as Error).message;
  invariant(
    missingInput.includes("repository graph is absent"),
    "missing repository inputs were not aggregated",
  );

  invariant(
    readFailureResult.status === "rejected",
    "unexpected read failures must reject",
  );
  const readFailure = (readFailureResult.reason as Error).message;
  invariant(
    readFailure === "synthetic read failure",
    "unexpected read failures must propagate",
  );
});

async function sha256Text(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${
    Array.from(
      new Uint8Array(hash),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("")
  }`;
}

async function readRepositoryInputs(
  readTextFile: (path: string) => Promise<string> = Deno.readTextFile,
): Promise<Map<string, string>> {
  const contents = new Map<string, string>();
  const missing: string[] = [];
  for (const path of [...REPOSITORY_FILES, GRAPH_PATH]) {
    try {
      contents.set(path, await readTextFile(path));
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) missing.push(path);
      else throw error;
    }
  }
  invariant(
    missing.length === 0,
    `FND-003 repository graph is absent: missing ${
      missing.join(", ")
    }; exact manifests, locks, pin record, and hashed provenance evidence are required`,
  );
  return contents;
}

async function validateRepositoryGraph(
  readTextFile?: (path: string) => Promise<string>,
): Promise<void> {
  const contents = await readRepositoryInputs(readTextFile);
  const graph = parseGraphText(string(contents.get(GRAPH_PATH), GRAPH_PATH));
  validateGraph(graph);
  const repository = object(graph.repository, "repository");
  for (
    const rawArtifact of array(repository.artifacts, "repository.artifacts")
  ) {
    const artifact = object(rawArtifact, "repository artifact");
    const path = string(artifact.path, "repository artifact path");
    invariant(
      await sha256Text(string(contents.get(path), path)) === artifact.sha256,
      `${path} hash does not match the graph`,
    );
  }
}

Deno.test("repository supplies the immutable FND-003 runtime graph", async () => {
  await validateRepositoryGraph();
});
