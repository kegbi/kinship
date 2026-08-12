// FND-003 freezes this dependency-free contract test before repository inputs exist.

type JsonRecord = Record<string, unknown>;

const GRAPH_PATH = "docs/validation/runtime-graph-fnd003.json";
const REPORT_PATH = "docs/validation/runtime-graph-fnd003.md";
const REPOSITORY_FILES = [
  ".npmrc",
  "deno.json",
  "deno.lock",
  "package.json",
  "pnpm-workspace.yaml",
  "pnpm-lock.yaml",
] as const;
const LOCK_ROOTS = ["deno.lock", "pnpm-lock.yaml"] as const;
const EXACT_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const RFC3339_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{1,9}Z$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const RAW_SHA256 = /^[0-9a-f]{64}$/;
const NPM_SRI = /^sha512-[A-Za-z0-9+/]{86}==$/;
const COREPACK_SHA512 = /^[0-9a-f]{128}$/;
const OCI_INDEX_MEDIA = "application/vnd.oci.image.index.v1+json";
const OCI_MANIFEST_MEDIA = "application/vnd.oci.image.manifest.v1+json";
const BASE_DENO_CONFIGURATION: JsonRecord = {
  compilerOptions: {
    strict: true,
    noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true,
    noImplicitOverride: true,
    noImplicitReturns: true,
    noFallthroughCasesInSwitch: true,
    noUnusedLocals: true,
    noUnusedParameters: true,
    useUnknownInCatchVariables: true,
    verbatimModuleSyntax: true,
  },
  fmt: {
    lineWidth: 80,
    include: [
      "AGENTS.md",
      "compose.schema-test.yaml",
      "deno.json",
      ".agents/skills/run-tdd-ticket-loop/",
      ".codex/agents/",
      "docs/",
      "tools/",
    ],
  },
  lint: {
    include: ["tools/"],
    rules: { tags: ["recommended"], include: ["eqeqeq"] },
  },
  tasks: {
    fmt: "deno fmt",
    "fmt:check": "deno fmt --check",
    lint: "deno lint",
    check:
      "deno check tools/schema/validate_postgres.ts tools/workflows/ticket_contract.ts tools/workflows/validate_ticket.ts",
    "ticket:validate":
      "deno run --allow-read --allow-run=git tools/workflows/validate_ticket.ts",
    "test:workflow":
      "deno test --allow-read --allow-write --allow-run=deno,git tools/workflows",
    "test:workflow:coverage":
      'deno test --allow-read --allow-write --allow-run=deno,git --coverage=.coverage/workflows --clean tools/workflows && deno coverage --detailed --threshold=100 --include="tools/workflows/(ticket_contract|validate_ticket)\\.ts$" .coverage/workflows',
    "test:schema":
      "deno run --allow-read=personal-crm-schema/v1 --allow-run=docker tools/schema/validate_postgres.ts",
    "test:schema:compat":
      "deno task test:schema --postgres-image postgres:17.10-alpine3.23",
    "test:schema:matrix":
      "deno task test:schema && deno task test:schema:compat",
  },
};

const DIRECT: { deno: readonly string[]; pnpm: readonly string[] } = {
  deno: [
    "hono",
    "zod",
    "hono-standard-validator",
    "standard-schema-spec",
    "kysely",
    "kysely-postgres-js",
    "postgres",
  ],
  pnpm: [
    "astro",
    "astro-react",
    "astro-node",
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
    "eslint",
    "eslint-plugin-astro",
    "eslint-plugin-jsx-a11y",
    "typescript-eslint-parser",
    "eslint-plugin-react-hooks",
  ],
};

const RUNTIMES = ["deno", "node", "corepack", "pnpm"] as const;
const NAMES: Record<string, string> = {
  "astro-react": "@astrojs/react",
  "astro-node": "@astrojs/node",
  "astro-check": "@astrojs/check",
  "tailwind-vite": "@tailwindcss/vite",
  "hono-standard-validator": "@hono/standard-validator",
  "standard-schema-spec": "@standard-schema/spec",
  "kysely-postgres-js": "kysely-postgres-js",
  "coverage-v8": "@vitest/coverage-v8",
  "playwright-test": "@playwright/test",
  "base-ui-react": "@base-ui/react",
  "types-react": "@types/react",
  "types-react-dom": "@types/react-dom",
  "eslint-plugin-astro": "eslint-plugin-astro",
  "eslint-plugin-jsx-a11y": "eslint-plugin-jsx-a11y",
  "typescript-eslint-parser": "@typescript-eslint/parser",
  "astro-eslint-parser": "astro-eslint-parser",
  "eslint-plugin-react-hooks": "eslint-plugin-react-hooks",
};
const nameOf = (id: string): string => NAMES[id] ?? id;

const IMPORT_PAIRS: Record<string, [string, string]> = {
  "astro-react": ["astro", "astro-react"],
  "astro-node": ["astro", "astro-node"],
  "astro-check-typescript": ["astro-check", "typescript"],
  "astro-react-types": ["astro-react", "types-react"],
  "astro-react-dom-types": ["astro-react", "types-react-dom"],
  "hono-validator": ["hono", "hono-standard-validator"],
  "validator-zod": ["hono-standard-validator", "zod"],
  "validator-standard-schema": [
    "hono-standard-validator",
    "standard-schema-spec",
  ],
  "kysely-dialect": ["kysely", "kysely-postgres-js"],
  "dialect-postgres": ["kysely-postgres-js", "postgres"],
  "tailwind-vite": ["tailwind-vite", "vite"],
  "vite-vitest": ["vite", "vitest"],
  "vitest-coverage": ["vitest", "coverage-v8"],
  "vitest-dom": ["vitest", "happy-dom"],
  "button-base-ui": ["shadcn", "base-ui-react"],
  "button-cva": ["shadcn", "class-variance-authority"],
  "cn-clsx": ["shadcn", "clsx"],
  "cn-tailwind-merge": ["shadcn", "tailwind-merge"],
  "astro-eslint-parser": ["eslint-plugin-astro", "astro-eslint-parser"],
  "astro-eslint-a11y": ["eslint-plugin-astro", "eslint-plugin-jsx-a11y"],
  "react-hooks-eslint": ["eslint-plugin-react-hooks", "eslint"],
  "typescript-eslint-typescript": ["typescript-eslint-parser", "typescript"],
};

const PEER_PAIRS: Record<string, [string, string]> = {
  "astro-react-peer-react": ["astro-react", "react"],
  "astro-react-peer-react-dom": ["astro-react", "react-dom"],
  "astro-react-peer-types-react": ["astro-react", "types-react"],
  "astro-react-peer-types-react-dom": ["astro-react", "types-react-dom"],
  "astro-check-peer-typescript": ["astro-check", "typescript"],
  "coverage-peer-vitest": ["coverage-v8", "vitest"],
  "base-ui-peer-react": ["base-ui-react", "react"],
  "base-ui-peer-react-dom": ["base-ui-react", "react-dom"],
  "astro-node-peer-astro": ["astro-node", "astro"],
  "astro-eslint-peer-eslint": ["eslint-plugin-astro", "eslint"],
  "astro-parser-peer-eslint": ["astro-eslint-parser", "eslint"],
  "jsx-a11y-peer-eslint": ["eslint-plugin-jsx-a11y", "eslint"],
  "react-hooks-peer-eslint": ["eslint-plugin-react-hooks", "eslint"],
  "typescript-eslint-peer-eslint": ["typescript-eslint-parser", "eslint"],
  "typescript-eslint-peer-typescript": [
    "typescript-eslint-parser",
    "typescript",
  ],
};

const FOLLOW_ONS: Record<string, string> = {
  "FND-003A": "backend-database-runtime",
  "FND-003B": "frontend-component-test-runtime",
  "FND-003C": "playwright-browser-image-runtime",
  "FND-003D": "root-commands-and-hooks",
  "FND-003E": "better-auth-probe-root-lock-amendment",
  "FND-003F": "accessibility-e2e-root-lock-amendment",
};

const FIXTURE_VERSIONS: Record<string, string> = {
  deno: "2.5.6",
  node: "24.11.0",
  corepack: "0.34.5",
  pnpm: "11.21.0",
  hono: "4.10.6",
  zod: "4.1.12",
  "hono-standard-validator": "0.2.0",
  "standard-schema-spec": "1.0.0",
  kysely: "0.28.8",
  "kysely-postgres-js": "3.0.0",
  postgres: "3.4.7",
  astro: "5.15.5",
  "astro-react": "4.4.1",
  "astro-node": "9.4.3",
  react: "19.2.0",
  "react-dom": "19.2.0",
  "astro-check": "0.9.5",
  typescript: "6.0.3",
  tailwindcss: "4.1.17",
  "tailwind-vite": "4.1.17",
  vite: "7.2.2",
  vitest: "4.0.8",
  "coverage-v8": "4.0.8",
  "happy-dom": "20.0.10",
  "playwright-test": "1.56.1",
  shadcn: "3.5.0",
  "base-ui-react": "1.0.0",
  "class-variance-authority": "0.7.1",
  clsx: "2.1.1",
  "tailwind-merge": "3.4.0",
  "types-react": "19.2.2",
  "types-react-dom": "19.2.2",
  eslint: "9.39.5",
  "eslint-plugin-astro": "1.7.0",
  "eslint-plugin-jsx-a11y": "6.10.2",
  "typescript-eslint-parser": "8.66.0",
  "eslint-plugin-react-hooks": "7.1.1",
  "astro-eslint-parser": "1.3.0",
  esbuild: "0.25.12",
  fsevents: "2.3.3",
};
const fixtureVersion = (id: string) => FIXTURE_VERSIONS[id]!;
const nextFixtureVersion = (id: string) => {
  const [major, minor, patch] = fixtureVersion(id).split(".").map(Number);
  return `${major!}.${minor!}.${patch! + 1}`;
};

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

function exactKeys(
  value: JsonRecord,
  expected: readonly string[],
  label: string,
) {
  invariant(
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...expected].sort()),
    `${label} has missing or unknown fields`,
  );
}

function strings(value: unknown, label: string): string[] {
  const result = array(value, label).map((item, index) =>
    string(item, `${label}[${index}]`)
  );
  invariant(new Set(result).size === result.length, `${label} has duplicates`);
  return result;
}

function exactSet(
  actual: string[],
  expected: readonly string[],
  label: string,
) {
  invariant(
    JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort()),
    `${label} membership is not exact`,
  );
}

function digest(value: unknown, label: string): string {
  const result = string(value, label);
  invariant(SHA256.test(result), `${label} must be a sha256 digest`);
  return result;
}

function sri(value: unknown, label: string): string {
  const result = string(value, label);
  invariant(NPM_SRI.test(result), `${label} must be npm sha512 SRI`);
  return result;
}

function version(value: unknown, label: string): string {
  const result = string(value, label);
  invariant(
    EXACT_VERSION.test(result),
    `${label} must be an exact stable version`,
  );
  return result;
}

function compareVersions(left: string, right: string): number {
  const a = version(left, "left version").split(".").map(Number);
  const b = version(right, "right version").split(".").map(Number);
  for (let index = 0; index < 3; index++) {
    const difference = a[index]! - b[index]!;
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

function satisfiesComparator(candidate: string, raw: string): boolean {
  const comparator = raw.trim();
  if (
    comparator === "" || comparator === "*" || comparator.toLowerCase() === "x"
  ) {
    return true;
  }
  const wildcard = /^(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/i.exec(
    comparator,
  );
  if (
    wildcard && (wildcard[2] === undefined || /^(x|\*)$/i.test(wildcard[2]) ||
      wildcard[3] === undefined || /^(x|\*)$/i.test(wildcard[3]))
  ) {
    const [major, minor, patch] = candidate.split(".").map(Number);
    return major === Number(wildcard[1]) &&
      (wildcard[2] === undefined || /^(x|\*)$/i.test(wildcard[2]) ||
        minor === Number(wildcard[2])) &&
      (wildcard[3] === undefined || /^(x|\*)$/i.test(wildcard[3]) ||
        patch === Number(wildcard[3]));
  }
  const match = /^(\^|~|>=|<=|>|<|=)?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(
    comparator,
  );
  invariant(
    match !== null,
    `unsupported manifest range comparator ${comparator}`,
  );
  const operator = match[1] ?? "=";
  const boundary = `${match[2]}.${match[3] ?? 0}.${match[4] ?? 0}`;
  const comparison = compareVersions(candidate, boundary);
  if (operator === "=") return comparison === 0;
  if (operator === ">") return comparison > 0;
  if (operator === ">=") return comparison >= 0;
  if (operator === "<") return comparison < 0;
  if (operator === "<=") return comparison <= 0;
  const [major, minor] = boundary.split(".").map(Number);
  const upper = operator === "~"
    ? `${major}.${minor! + 1}.0`
    : major! > 0
    ? `${major! + 1}.0.0`
    : minor! > 0
    ? `0.${minor! + 1}.0`
    : `0.0.${Number(boundary.split(".")[2]) + 1}`;
  return comparison >= 0 && compareVersions(candidate, upper) < 0;
}

function satisfiesRange(candidate: string, range: string): boolean {
  string(range, "manifest range");
  return range.split("||").some((alternative) => {
    const trimmed = alternative.trim().replace(/(>=|<=|>|<|=)\s+/g, "$1");
    const hyphen = /^(\d+\.\d+\.\d+)\s+-\s+(\d+\.\d+\.\d+)$/.exec(trimmed);
    if (hyphen) {
      return compareVersions(candidate, hyphen[1]!) >= 0 &&
        compareVersions(candidate, hyphen[2]!) <= 0;
    }
    return trimmed.split(/\s+/).every((part) =>
      satisfiesComparator(candidate, part)
    );
  });
}

function validateObservation(raw: unknown, label: string, kind: string) {
  const observation = object(raw, label);
  exactKeys(
    observation,
    ["kind", "source", "contentSha256", "observedAt"],
    label,
  );
  invariant(observation.kind === kind, `${label} kind is incorrect`);
  invariant(
    /^https:\/\//.test(string(observation.source, `${label}.source`)),
    `${label} source must be official HTTPS`,
  );
  digest(observation.contentSha256, `${label}.contentSha256`);
  instant(observation.observedAt, `${label}.observedAt`);
}

function parsePnpmPeerSuffix(suffix: string): Record<string, string> {
  const peers: Record<string, string> = {};
  let index = 0;
  while (index < suffix.length) {
    invariant(suffix[index] === "(", "pnpm peer suffix is malformed");
    let depth = 1;
    const start = ++index;
    while (index < suffix.length && depth > 0) {
      if (suffix[index] === "(") depth++;
      else if (suffix[index] === ")") depth--;
      index++;
    }
    invariant(depth === 0, "pnpm peer suffix is unbalanced");
    const token = suffix.slice(start, index - 1);
    const delimiter = token.startsWith("@")
      ? token.indexOf("@", 1)
      : token.indexOf("@");
    invariant(delimiter > 0, "pnpm peer suffix token is malformed");
    const name = token.slice(0, delimiter);
    invariant(!(name in peers), "pnpm peer suffix contains duplicate peer");
    peers[name] = token.slice(delimiter + 1);
  }
  return peers;
}

function instant(value: unknown, label: string): number {
  const result = string(value, label);
  invariant(
    RFC3339_UTC.test(result),
    `${label} must preserve RFC3339 UTC precision`,
  );
  const parsed = Date.parse(result);
  invariant(Number.isFinite(parsed), `${label} is not a valid instant`);
  return parsed;
}

function parseJson(text: string, label: string): JsonRecord {
  invariant(text.length <= 1_000_000, `${label} exceeds size limit`);
  const stack: Array<
    { kind: "object"; keys: Set<string> } | { kind: "array" }
  > = [];
  let index = 0;
  while (index < text.length) {
    if (text[index] === "{") {
      stack.push({ kind: "object", keys: new Set() });
      index++;
    } else if (text[index] === "[") {
      stack.push({ kind: "array" });
      index++;
    } else if (text[index] === "}" || text[index] === "]") {
      stack.pop();
      index++;
    } else if (text[index] === '"') {
      const start = index++;
      while (index < text.length) {
        if (text[index] === "\\") index += 2;
        else if (text[index++] === '"') break;
      }
      let cursor = index;
      while (/\s/.test(text.charAt(cursor))) cursor++;
      const current = stack.at(-1);
      if (current?.kind === "object" && text[cursor] === ":") {
        const key = JSON.parse(text.slice(start, index)) as string;
        invariant(
          !current.keys.has(key),
          `${label} contains duplicate key ${key}`,
        );
        current.keys.add(key);
      }
    } else index++;
  }
  try {
    return object(JSON.parse(text), label);
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
}

function validateSelection(graph: JsonRecord): number {
  const selection = object(graph.selection, "selection");
  exactKeys(
    selection,
    ["selectedAt", "minimumAgeHours", "eligibleBefore"],
    "selection",
  );
  invariant(
    selection.minimumAgeHours === 72,
    "minimum age must equal 72 hours",
  );
  const selected = instant(selection.selectedAt, "selection.selectedAt");
  const cutoff = instant(selection.eligibleBefore, "selection.eligibleBefore");
  invariant(
    selected - cutoff === 72 * 60 * 60 * 1000,
    "cutoff must be exactly 72 hours",
  );
  return cutoff;
}

function validateSelected(
  graph: JsonRecord,
  cutoff: number,
): Map<string, JsonRecord> {
  const expected = [...RUNTIMES, ...DIRECT.deno, ...DIRECT.pnpm];
  const items = array(graph.selectedPackages, "selectedPackages").map((
    item,
    i,
  ) => object(item, `selectedPackages[${i}]`));
  exactSet(
    items.map((item) => string(item.id, "selected id")),
    expected,
    "selected packages",
  );
  const result = new Map<string, JsonRecord>();
  for (const [index, item] of items.entries()) {
    const label = `selectedPackages[${index}]`;
    exactKeys(item, [
      "id",
      "name",
      "version",
      "publishedAt",
      "manifest",
      "publicationEvidence",
      "artifactEvidence",
      "latestStable",
      "newerReleases",
    ], label);
    const id = string(item.id, `${label}.id`);
    invariant(item.name === nameOf(id), `${id} name is incorrect`);
    version(item.version, `${label}.version`);
    invariant(
      instant(item.publishedAt, `${label}.publishedAt`) <= cutoff,
      `${id} is too young`,
    );
    invariant(
      item.manifest ===
        (DIRECT.deno.includes(id)
          ? "deno"
          : DIRECT.pnpm.includes(id)
          ? "pnpm"
          : "runtime"),
      `${id} manifest ownership is incorrect`,
    );
    validateObservation(
      item.publicationEvidence,
      `${label}.publicationEvidence`,
      id === "deno" || id === "node"
        ? "official-release-metadata"
        : "npm-packument",
    );
    const artifact = object(item.artifactEvidence, `${label}.artifactEvidence`);
    exactKeys(artifact, [
      "kind",
      "value",
      "source",
      "contentSha256",
      "observedAt",
    ], `${label}.artifactEvidence`);
    invariant(
      /^https:\/\//.test(
        string(artifact.source, `${label}.artifactEvidence.source`),
      ),
      `${id} artifact source must be official HTTPS`,
    );
    digest(artifact.contentSha256, `${label}.artifactEvidence.contentSha256`);
    instant(artifact.observedAt, `${label}.artifactEvidence.observedAt`);
    if (id === "deno" || id === "node") {
      invariant(
        artifact.kind === "release-checksum",
        `${id} must use runtime release checksum evidence`,
      );
      digest(artifact.value, `${label}.artifactEvidence.value`);
      invariant(
        artifact.source ===
          (id === "deno"
            ? `https://github.com/denoland/deno/releases/download/v${item.version}/deno-x86_64-pc-windows-msvc.zip.sha256sum`
            : `https://nodejs.org/dist/v${item.version}/SHASUMS256.txt`),
        `${id} checksum source is not exact`,
      );
    } else {
      invariant(
        artifact.kind === "npm-manifest-sri",
        `${id} must use npm registry SRI evidence`,
      );
      sri(artifact.value, `${label}.artifactEvidence.value`);
      invariant(
        artifact.source ===
          `https://registry.npmjs.org/${
            encodeURIComponent(String(item.name))
          }/${item.version}`,
        `${id} selected manifest source is not exact`,
      );
    }
    const latest = object(item.latestStable, `${label}.latestStable`);
    exactKeys(
      latest,
      ["version", "source", "contentSha256", "observedAt"],
      `${label}.latestStable`,
    );
    const latestVersion = version(
      latest.version,
      `${label}.latestStable.version`,
    );
    invariant(
      compareVersions(latestVersion, String(item.version)) >= 0,
      `${id} latest stable predates selection`,
    );
    invariant(
      /^https:\/\//.test(string(latest.source, `${label}.latestStable.source`)),
      `${id} latest stable source is not official`,
    );
    digest(latest.contentSha256, `${label}.latestStable.contentSha256`);
    instant(latest.observedAt, `${label}.latestStable.observedAt`);
    const newerVersions: string[] = [];
    let previous = String(item.version);
    for (const release of array(item.newerReleases, `${label}.newerReleases`)) {
      const newer = object(release, `${label}.newerRelease`);
      exactKeys(newer, [
        "version",
        "publishedAt",
        "compatible",
        "reason",
        "publicationEvidence",
        "compatibilityEvidence",
      ], `${label}.newerRelease`);
      const newerVersion = version(
        newer.version,
        `${label}.newerRelease.version`,
      );
      invariant(
        compareVersions(newerVersion, previous) > 0,
        `${id} newer releases must be strictly ordered`,
      );
      previous = newerVersion;
      newerVersions.push(newerVersion);
      instant(newer.publishedAt, `${label}.newerRelease.publishedAt`);
      invariant(
        newer.compatible === false ||
          instant(newer.publishedAt, "newer published") > cutoff,
        `${id} omitted eligible compatible release`,
      );
      string(newer.reason, `${label}.newerRelease.reason`);
      validateObservation(
        newer.publicationEvidence,
        `${label}.newerRelease.publicationEvidence`,
        id === "deno" || id === "node"
          ? "official-release-metadata"
          : "npm-packument",
      );
      validateObservation(
        newer.compatibilityEvidence,
        `${label}.newerRelease.compatibilityEvidence`,
        "compatibility-evaluation",
      );
    }
    invariant(
      latestVersion === item.version
        ? newerVersions.length === 0
        : newerVersions.length > 0 && newerVersions.at(-1) === latestVersion,
      `${id} newer release evidence is incomplete or vacuous`,
    );
    invariant(!result.has(id), "selected package IDs must be unique");
    result.set(id, item);
  }
  invariant(
    Number(
      version(result.get("typescript")?.version, "typescript.version").split(
        ".",
      )[0],
    ) < 7,
    "TypeScript 7 is incompatible with Astro check",
  );
  const eslintMajor = Number(
    String(result.get("eslint")?.version).split(".")[0],
  );
  const astroPluginMajor = Number(
    String(result.get("eslint-plugin-astro")?.version).split(".")[0],
  );
  invariant(
    eslintMajor <= 9 && !(astroPluginMajor >= 3 && eslintMajor < 10),
    "ESLint plugin peer ranges are incompatible",
  );
  return result;
}

function validateEdges(graph: JsonRecord, packages: Map<string, JsonRecord>) {
  const repository = object(graph.repository, "repository");
  exactKeys(repository, [
    "artifacts",
    "directDependencyIds",
    "importEdges",
    "peerEdges",
    "denoSpecifiers",
    "denoLockNodes",
    "pnpmLockNodes",
    "lockRoots",
    "successorLockPlans",
    "repeatability",
  ], "repository");
  const artifacts = array(repository.artifacts, "repository.artifacts").map((
    item,
  ) => object(item, "repository artifact"));
  exactSet(
    artifacts.map((artifact) => string(artifact.path, "artifact path")),
    REPOSITORY_FILES,
    "repository artifacts",
  );
  for (const artifact of artifacts) {
    exactKeys(artifact, ["path", "sha256"], "repository artifact");
    digest(artifact.sha256, "repository artifact sha256");
  }
  exactSet(strings(repository.directDependencyIds, "directDependencyIds"), [
    ...DIRECT.deno,
    ...DIRECT.pnpm,
  ], "direct dependencies");
  const validatePairs = (
    raw: unknown,
    expected: Record<string, [string, string]>,
    label: string,
  ) => {
    const edges = array(raw, label).map((item, i) =>
      object(item, `${label}[${i}]`)
    );
    exactSet(
      edges.map((edge) => string(edge.id, `${label}.id`)),
      Object.keys(expected),
      label,
    );
    for (const edge of edges) {
      exactKeys(edge, [
        "id",
        "from",
        "to",
        "manifestRange",
        "selectedResolution",
        "manifestEvidence",
      ], `${label} edge`);
      const id = string(edge.id, `${label}.id`);
      const pair = expected[id];
      invariant(pair !== undefined, `${id} edge has no contract`);
      invariant(
        edge.from === pair[0] && edge.to === pair[1],
        `${id} edge is incorrect`,
      );
      invariant(
        (packages.has(String(edge.from)) ||
          edge.from === "astro-eslint-parser") &&
          (packages.has(String(edge.to)) ||
            ["astro-eslint-parser", "types-react", "types-react-dom"].includes(
              String(edge.to),
            )),
        `${id} edge is not selected`,
      );
      const selectedResolution = version(
        edge.selectedResolution,
        `${id}.selectedResolution`,
      );
      invariant(
        satisfiesRange(
          selectedResolution,
          string(edge.manifestRange, `${id}.manifestRange`),
        ),
        `${id} selected resolution violates manifest range`,
      );
      validateObservation(
        edge.manifestEvidence,
        `${id}.manifestEvidence`,
        "npm-manifest",
      );
      const selectedTarget = packages.get(String(edge.to))?.version ??
        FIXTURE_VERSIONS[String(edge.to)];
      invariant(
        selectedTarget === selectedResolution,
        `${id} selected resolution disagrees with graph`,
      );
    }
  };
  validatePairs(repository.importEdges, IMPORT_PAIRS, "import edges");
  validatePairs(repository.peerEdges, PEER_PAIRS, "peer edges");

  const denoSpecifiers = object(repository.denoSpecifiers, "denoSpecifiers");
  const denoNodes = array(repository.denoLockNodes, "denoLockNodes").map((
    item,
    i,
  ) => object(item, `denoLockNodes[${i}]`));
  const denoKeys = denoNodes.map((node) => string(node.key, "deno node key"));
  invariant(
    new Set(denoKeys).size === denoKeys.length,
    "Deno lock nodes contain duplicates",
  );
  for (const id of DIRECT.deno) {
    const selected = object(packages.get(id), id);
    const key = `npm:${selected.name}@${selected.version}`;
    const node = object(
      denoNodes.find((candidate) => candidate.key === key),
      id,
    );
    invariant(
      node.integrity ===
        object(selected.artifactEvidence, "selected evidence").value,
      `${id} selected Deno root is absent from lock nodes`,
    );
  }
  for (const node of denoNodes) {
    invariant(
      Object.keys(node).every((key) =>
        [
          "key",
          "kind",
          "integrity",
          "dependencies",
          "optionalDependencies",
          "optionalPeers",
          "os",
          "cpu",
          "tarball",
          "deprecated",
          "scripts",
          "bin",
        ].includes(key)
      ) && ["key", "kind", "integrity"].every((key) => key in node),
      "Deno lock node has missing or unknown fields",
    );
    const dependencies = strings(
      node.dependencies ?? [],
      "Deno node dependencies",
    );
    const optionalDependencies = strings(
      node.optionalDependencies ?? [],
      "Deno optional dependencies",
    );
    const optionalPeers = strings(
      node.optionalPeers ?? [],
      "Deno optional peers",
    );
    strings(node.os ?? [], "Deno node os");
    strings(node.cpu ?? [], "Deno node cpu");
    if (node.tarball !== undefined) string(node.tarball, "Deno node tarball");
    for (const flag of ["deprecated", "scripts", "bin"] as const) {
      invariant(
        node[flag] === undefined || typeof node[flag] === "boolean",
        `Deno node ${flag} must be boolean`,
      );
    }
    for (
      const dependency of [
        ...dependencies,
        ...optionalDependencies,
        ...optionalPeers,
      ]
    ) {
      invariant(
        node.kind !== "jsr" ||
          dependency.startsWith("jsr:") || dependency.startsWith("npm:"),
        "JSR dependency tokens must retain their jsr: or npm: kind",
      );
      const request =
        dependency.startsWith("jsr:") || dependency.startsWith("npm:")
          ? dependency
          : `npm:${dependency}`;
      const aliasNpm = /^(?:npm:)?[^@]+@npm:(.+@\d+\.\d+\.\d+)$/.exec(request);
      const exactRequest = aliasNpm ? `npm:${aliasNpm[1]}` : request;
      const resolved = denoSpecifiers[exactRequest] ?? denoSpecifiers[request];
      const targetPrefix = exactRequest.startsWith("jsr:") ? "jsr:" : "npm:";
      const bare = exactRequest.slice(4);
      const hasExactVersion = /@\d+\.\d+\.\d+$/.test(bare);
      const directTarget = `${targetPrefix}${bare}`;
      const requestDelimiter = bare.lastIndexOf("@");
      const requestedName = requestDelimiter > 0
        ? bare.slice(0, requestDelimiter)
        : bare;
      const target = hasExactVersion && denoKeys.includes(directTarget)
        ? `${targetPrefix}${bare}`
        : typeof resolved === "string"
        ? `${targetPrefix}${requestedName}@${resolved}`
        : denoKeys.find((key) =>
          key.startsWith(`${targetPrefix}${requestedName}@`)
        );
      invariant(
        typeof target === "string" && denoKeys.includes(target),
        `${node.key} Deno dependency is absent from complete lock nodes`,
      );
    }
    if (node.kind === "npm") sri(node.integrity, "Deno npm node integrity");
    else {
      invariant(node.kind === "jsr", "Deno lock node kind is invented");
      invariant(
        RAW_SHA256.test(string(node.integrity, "Deno JSR integrity")),
        "Deno JSR integrity must be raw hex",
      );
    }
  }

  const pnpmNodes = array(repository.pnpmLockNodes, "pnpmLockNodes").map((
    item,
    i,
  ) => object(item, `pnpmLockNodes[${i}]`));
  const pnpmIds = pnpmNodes.map((node) => string(node.id, "pnpm node id"));
  invariant(
    new Set(pnpmIds).size === pnpmIds.length,
    "pnpm lock nodes contain duplicates",
  );
  for (const id of DIRECT.pnpm) {
    invariant(
      pnpmIds.includes(id),
      `${id} selected pnpm root is absent from lock nodes`,
    );
  }
  for (const node of pnpmNodes) {
    exactKeys(node, [
      "id",
      "name",
      "version",
      "packageKey",
      "snapshotKey",
      "integrity",
      "dependencies",
      "optionalDependencies",
      "os",
      "cpu",
      "libc",
      "optional",
      "peerResolutions",
      "transitivePeerDependencies",
      "dependencyResolutions",
      "hooks",
    ], "pnpm lock node");
    version(node.version, "pnpm node version");
    sri(node.integrity, "pnpm node integrity");
    const packageKey = string(node.packageKey, "pnpm package key");
    const snapshotKey = string(node.snapshotKey, "pnpm snapshot key");
    invariant(
      packageKey === `${node.name}@${node.version}` &&
        snapshotKey.startsWith(`${node.name}@${node.version}`),
      `${node.id} pnpm node identities disagree with name and version`,
    );
    if (DIRECT.pnpm.includes(String(node.id))) {
      const selected = object(packages.get(String(node.id)), String(node.id));
      invariant(
        node.name === selected.name && node.version === selected.version &&
          node.integrity ===
            object(selected.artifactEvidence, "selected evidence").value,
        `${node.id} pnpm node disagrees with selected package evidence`,
      );
    }
    for (
      const dependency of strings(node.dependencies, "pnpm node dependencies")
    ) {
      invariant(
        pnpmIds.includes(dependency),
        `${node.id} dependency ${dependency} is absent from complete pnpm nodes`,
      );
    }
    for (
      const dependency of strings(
        node.optionalDependencies,
        "pnpm optional dependencies",
      )
    ) {
      invariant(
        pnpmIds.includes(dependency),
        `${node.id} optional dependency is absent`,
      );
    }
    strings(node.os, "pnpm node os");
    strings(node.cpu, "pnpm node cpu");
    strings(node.libc, "pnpm node libc");
    invariant(
      typeof node.optional === "boolean",
      "pnpm node optional flag is invalid",
    );
    strings(
      node.transitivePeerDependencies,
      "pnpm transitive peer dependencies",
    );
    const peerResolutions = object(
      node.peerResolutions,
      "pnpm peer resolutions",
    );
    const suffix = snapshotKey.slice(packageKey.length);
    const parsedPeers = parsePnpmPeerSuffix(suffix);
    exactSet(
      Object.keys(parsedPeers),
      Object.keys(peerResolutions),
      `${node.id} peer suffix names`,
    );
    for (const [peerName, resolution] of Object.entries(peerResolutions)) {
      invariant(
        parsedPeers[peerName] === resolution,
        `${node.id} peer suffix resolution drifted`,
      );
    }
    exactKeys(
      object(node.dependencyResolutions, "pnpm dependency resolutions"),
      [
        ...strings(node.dependencies, "pnpm node dependencies"),
        ...strings(node.optionalDependencies, "pnpm optional dependencies"),
      ],
      "pnpm dependency resolutions",
    );
    for (
      const dependencyId of [
        ...strings(node.dependencies, "pnpm dependencies"),
        ...strings(node.optionalDependencies, "pnpm optional dependencies"),
      ]
    ) {
      const dependency = object(
        pnpmNodes.find((candidate) => candidate.id === dependencyId),
        dependencyId,
      );
      const dependencyName = string(dependency.name, "dependency name");
      const expectedResolution = string(
        dependency.snapshotKey,
        "dependency snapshot key",
      )
        .slice(dependencyName.length + 1);
      invariant(
        object(
          node.dependencyResolutions,
          "dependency resolutions",
        )[dependencyId] ===
          expectedResolution,
        `${node.id} dependency resolution disagrees with target snapshot`,
      );
    }
    array(node.hooks, "pnpm node hooks");
  }
  const lockedEdges = new Set(
    pnpmNodes.flatMap((node) =>
      strings(node.dependencies, "pnpm dependencies").map((dependency) =>
        `${node.id}->${dependency}`
      )
    ),
  );
  for (
    const pair of [...Object.values(IMPORT_PAIRS), ...Object.values(PEER_PAIRS)]
  ) {
    if (DIRECT.pnpm.includes(pair[0]) && DIRECT.pnpm.includes(pair[1])) {
      invariant(
        lockedEdges.has(`${pair[0]}->${pair[1]}`),
        `${pair[0]} to ${pair[1]} declared edge lacks pnpm lock backing`,
      );
    }
  }
  invariant(
    !pnpmNodes.some((node) => node.id === "pnpm"),
    "Corepack pnpm must not be a dependency lock node",
  );
  exactSet(
    strings(repository.lockRoots, "lockRoots"),
    LOCK_ROOTS,
    "root lock files",
  );
  invariant(
    array(repository.successorLockPlans, "successorLockPlans").length === 0,
    "successor locks are forbidden",
  );
  validateRepeatability(repository.repeatability, packages);
}

function validateRepeatability(
  raw: unknown,
  packages?: Map<string, JsonRecord>,
) {
  const repeatability = object(raw, "repeatability");
  exactKeys(
    repeatability,
    ["identities", "runs", "lifecycleExecutions"],
    "repeatability",
  );
  const identities = object(
    repeatability.identities,
    "repeatability.identities",
  );
  exactKeys(
    identities,
    ["deno", "node", "corepack", "pnpm"],
    "repeatability.identities",
  );
  Object.entries(identities).forEach(([id, value]) =>
    version(value, `identity ${id}`)
  );
  if (packages) {
    for (const id of RUNTIMES) {
      invariant(
        identities[id] === packages.get(id)?.version,
        `${id} repeat identity disagrees with selected package`,
      );
    }
  }
  const expected: Array<{
    id: string;
    command: string;
    mode: string;
    cacheState: string;
    cacheRoot: string;
    setEnvironment: JsonRecord;
    unsetEnvironment: string[];
    nodeModulesState: string;
  }> = [
    {
      id: "deno-clean",
      command: "deno ci",
      mode: "networked",
      cacheState: "empty",
      cacheRoot: "C:/fnd003-proof/deno-dir",
      setEnvironment: {
        DENO_DIR: "C:/fnd003-proof/deno-dir",
        DENO_NO_PACKAGE_JSON: "1",
      },
      unsetEnvironment: [],
      nodeModulesState: "absent",
    },
    {
      id: "deno-cached",
      command: "deno install --cached-only --lock=deno.lock --frozen",
      mode: "cached-only",
      cacheState: "warm",
      cacheRoot: "C:/fnd003-proof/deno-dir",
      setEnvironment: {
        DENO_DIR: "C:/fnd003-proof/deno-dir",
        DENO_NO_PACKAGE_JSON: "1",
      },
      unsetEnvironment: [],
      nodeModulesState: "removed-before-run",
    },
    {
      id: "pnpm-clean",
      command:
        "corepack pnpm install --frozen-lockfile --store-dir=C:/fnd003-proof/pnpm-store",
      mode: "networked",
      cacheState: "empty",
      cacheRoot: "C:/fnd003-proof/pnpm-store",
      setEnvironment: {
        COREPACK_HOME: "C:/fnd003-proof/corepack-home",
        COREPACK_DEFAULT_TO_LATEST: "0",
      },
      unsetEnvironment: ["COREPACK_INTEGRITY_KEYS"],
      nodeModulesState: "absent",
    },
    {
      id: "pnpm-offline",
      command:
        "corepack pnpm install --offline --frozen-lockfile --store-dir=C:/fnd003-proof/pnpm-store",
      mode: "offline",
      cacheState: "warm",
      cacheRoot: "C:/fnd003-proof/pnpm-store",
      setEnvironment: {
        COREPACK_HOME: "C:/fnd003-proof/corepack-home",
        COREPACK_DEFAULT_TO_LATEST: "0",
        COREPACK_ENABLE_NETWORK: "0",
      },
      unsetEnvironment: ["COREPACK_INTEGRITY_KEYS"],
      nodeModulesState: "removed-before-run",
    },
  ];
  const runs = array(repeatability.runs, "repeatability.runs").map((item, i) =>
    object(item, `repeatability.runs[${i}]`)
  );
  exactSet(
    runs.map((run) => string(run.id, "repeat run id")),
    expected.map((row) => row.id),
    "repeat runs",
  );
  for (const expectedRun of expected) {
    const { id, command, mode, cacheState, cacheRoot, nodeModulesState } =
      expectedRun;
    const run = object(runs.find((candidate) => candidate.id === id), id);
    exactKeys(run, [
      "id",
      "command",
      "exitCode",
      "mode",
      "cacheState",
      "cacheRoot",
      "setEnvironment",
      "unsetEnvironment",
      "nodeModulesState",
      "denoLockSha256",
      "pnpmLockSha256",
      "lifecycleExecutions",
    ], id);
    invariant(
      run.command === command && run.mode === mode &&
        run.cacheState === cacheState && run.cacheRoot === cacheRoot,
      `${id} executable proof is incomplete`,
    );
    invariant(
      JSON.stringify(run.setEnvironment) ===
          JSON.stringify(expectedRun.setEnvironment) &&
        JSON.stringify(run.unsetEnvironment) ===
          JSON.stringify(expectedRun.unsetEnvironment) &&
        run.nodeModulesState === nodeModulesState,
      `${id} environment or isolation proof is incomplete`,
    );
    invariant(run.exitCode === 0, `${id} did not complete safely`);
    const executions = array(
      run.lifecycleExecutions,
      `${id}.lifecycleExecutions`,
    ).map((raw) => object(raw, `${id} lifecycle execution`));
    for (const execution of executions) {
      exactKeys(execution, [
        "packageName",
        "version",
        "hook",
        "command",
        "run",
        "exitCode",
      ], `${id} lifecycle execution`);
      invariant(
        execution.packageName === "esbuild" &&
          execution.hook === "postinstall" &&
          execution.command === "node install.js" &&
          execution.run === id && execution.exitCode === 0,
        `${id} recorded an unreviewed lifecycle execution`,
      );
    }
    digest(run.denoLockSha256, `${id}.denoLockSha256`);
    digest(run.pnpmLockSha256, `${id}.pnpmLockSha256`);
  }
  const hashes = runs.map((run) =>
    `${run.denoLockSha256}:${run.pnpmLockSha256}`
  );
  invariant(
    new Set(hashes).size === 1,
    "lock hashes changed between repeat runs",
  );
  const allExecutions = array(
    repeatability.lifecycleExecutions,
    "repeatability.lifecycleExecutions",
  );
  exactSet(
    allExecutions.map((raw) =>
      JSON.stringify(object(raw, "lifecycle execution"))
    ),
    runs.flatMap((run) =>
      array(run.lifecycleExecutions, "run lifecycle executions").map((raw) =>
        JSON.stringify(raw)
      )
    ),
    "repeatability lifecycle executions",
  );
}

function validateLifecycle(graph: JsonRecord) {
  const lifecycle = object(graph.lifecycle, "lifecycle");
  exactKeys(lifecycle, ["deno", "pnpm", "hookInventory"], "lifecycle");
  const deno = object(lifecycle.deno, "lifecycle.deno");
  exactKeys(deno, ["allowScripts"], "lifecycle.deno");
  const denoAllow = strings(deno.allowScripts, "lifecycle.deno.allowScripts");
  invariant(
    denoAllow.every((item) => /^npm:.+@[0-9]+\.[0-9]+\.[0-9]+$/.test(item)),
    "Deno allowScripts entries must be exact npm constraints",
  );
  const pnpm = object(lifecycle.pnpm, "lifecycle.pnpm");
  exactKeys(pnpm, [
    "strictDepBuilds",
    "dangerouslyAllowAllBuilds",
    "allowBuilds",
  ], "lifecycle.pnpm");
  invariant(
    pnpm.strictDepBuilds === true && pnpm.dangerouslyAllowAllBuilds === false,
    "pnpm lifecycle policy is permissive",
  );
  const allowBuilds = object(pnpm.allowBuilds, "lifecycle.pnpm.allowBuilds");
  const hooks = array(lifecycle.hookInventory, "hookInventory").map((item, i) =>
    object(item, `hookInventory[${i}]`)
  );
  const nodes = array(
    object(graph.repository, "repository").pnpmLockNodes,
    "pnpm nodes",
  ).map((item) => object(item, "pnpm node"));
  const expectedHooks = nodes.flatMap((node) =>
    array(node.hooks, "node hooks").map((raw) => {
      const hook = object(raw, "node hook");
      exactKeys(hook, ["name", "command", "manifestEvidence"], "node hook");
      validateObservation(
        hook.manifestEvidence,
        "node hook manifestEvidence",
        "npm-manifest",
      );
      return `${node.name}@${node.version}:${hook.name}:${hook.command}`;
    })
  );
  exactSet(
    hooks.map((hook) =>
      `${hook.packageName}@${hook.version}:${hook.hook}:${hook.command}`
    ),
    expectedHooks,
    "transitive hook inventory",
  );
  const allowedMatchers = new Set(
    hooks.flatMap((hook) => [
      String(hook.packageName),
      `${hook.packageName}@${hook.version}`,
    ]),
  );
  invariant(
    Object.keys(allowBuilds).every((matcher) => allowedMatchers.has(matcher)),
    "lifecycle.pnpm.allowBuilds contains unknown package matcher",
  );
  for (const hook of hooks) {
    exactKeys(
      hook,
      [
        "ecosystem",
        "packageName",
        "version",
        "hook",
        "command",
        "manifestEvidence",
        "reviewed",
        "allowed",
      ],
      "hook inventory item",
    );
    validateObservation(
      hook.manifestEvidence,
      "hook manifestEvidence",
      "npm-manifest",
    );
    invariant(
      hook.ecosystem === "pnpm" && hook.reviewed === true,
      "hook owner is misattributed or unreviewed",
    );
    invariant(
      allowBuilds[`${hook.packageName}@${hook.version}`] === hook.allowed ||
        allowBuilds[String(hook.packageName)] === hook.allowed,
      "hook policy and inventory disagree",
    );
    invariant(
      hook.packageName !== "fsevents" || hook.allowed === false,
      "fsevents build must remain denied",
    );
    invariant(
      hook.packageName === "esbuild" || hook.allowed === false,
      "only esbuild may be build-approved",
    );
  }
  invariant(
    denoAllow.length === 0,
    "Deno policy must remain independently empty",
  );
}

function validateCorepack(
  graph: JsonRecord,
  packages: Map<string, JsonRecord>,
) {
  const corepack = object(graph.corepack, "corepack");
  exactKeys(corepack, ["descriptor", "registryIntegrity", "proof"], "corepack");
  const pnpmVersion = packages.get("pnpm")?.version;
  const descriptor = string(corepack.descriptor, "corepack.descriptor");
  const match = /^pnpm@([^+]+)\+sha512\.([0-9a-f]+)$/.exec(descriptor);
  invariant(
    match !== null,
    "Corepack descriptor must contain exact 128-character lowercase hex sha512",
  );
  invariant(
    match[1] === pnpmVersion && COREPACK_SHA512.test(match[2]!),
    "Corepack descriptor must contain exact 128-character lowercase hex sha512",
  );
  sri(corepack.registryIntegrity, "corepack.registryIntegrity");
  invariant(
    corepack.registryIntegrity ===
      object(packages.get("pnpm")?.artifactEvidence, "pnpm evidence").value,
    "Corepack registry integrity disagrees with selected pnpm evidence",
  );
  const registryBytes = Uint8Array.from(
    atob(String(corepack.registryIntegrity).slice(7)),
    (character) => character.charCodeAt(0),
  );
  const registryHex = Array.from(
    registryBytes,
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  invariant(
    match[2] === registryHex,
    "Corepack descriptor checksum disagrees with npm registry SRI bytes",
  );
  const proof = object(corepack.proof, "corepack.proof");
  exactKeys(proof, [
    "setEnvironment",
    "unsetEnvironment",
    "runs",
  ], "corepack.proof");
  const environment = object(
    proof.setEnvironment,
    "corepack.proof.setEnvironment",
  );
  exactKeys(
    environment,
    ["COREPACK_DEFAULT_TO_LATEST"],
    "corepack.proof.setEnvironment",
  );
  invariant(
    environment.COREPACK_DEFAULT_TO_LATEST === "0",
    "Corepack latest lookup must be disabled",
  );
  exactSet(strings(proof.unsetEnvironment, "corepack.proof.unsetEnvironment"), [
    "COREPACK_INTEGRITY_KEYS",
  ], "Corepack unset environment");
  const expectedRuns: Record<string, { command: string; output: string }> = {
    version: {
      command: "corepack --version",
      output: String(packages.get("corepack")?.version),
    },
    use: { command: `corepack use pnpm@${pnpmVersion}`, output: descriptor },
    install: {
      command: "corepack install",
      output: `Adding pnpm@${pnpmVersion} to the cache`,
    },
    execute: {
      command: "corepack pnpm --version",
      output: String(pnpmVersion),
    },
  };
  const proofRuns = array(proof.runs, "corepack.proof.runs").map((raw) =>
    object(raw, "corepack proof run")
  );
  exactSet(
    proofRuns.map((run) => string(run.id, "corepack run id")),
    Object.keys(expectedRuns),
    "Corepack proof runs",
  );
  for (const run of proofRuns) {
    exactKeys(
      run,
      ["id", "command", "output", "exitCode"],
      "Corepack proof run",
    );
    const expected = expectedRuns[String(run.id)]!;
    invariant(
      run.command === expected.command &&
        String(run.output).includes(expected.output) && run.exitCode === 0,
      `${run.id} Corepack executable proof did not pass`,
    );
  }
}

function validateShadcn(graph: JsonRecord) {
  const shadcn = object(graph.shadcn, "shadcn");
  exactKeys(shadcn, [
    "sourceCommit",
    "buttonPath",
    "buttonSourceSha256",
    "buttonDirectImports",
    "cnHelperPath",
    "cnHelperImports",
    "registryInvocation",
    "generatedPayloads",
  ], "shadcn");
  invariant(
    /^[0-9a-f]{40}$/.test(string(shadcn.sourceCommit, "shadcn.sourceCommit")),
    "shadcn source commit must be immutable",
  );
  string(shadcn.buttonPath, "shadcn.buttonPath");
  digest(shadcn.buttonSourceSha256, "shadcn.buttonSourceSha256");
  exactSet(strings(shadcn.buttonDirectImports, "buttonDirectImports"), [
    "base-ui-react",
    "class-variance-authority",
    "cn-helper",
  ], "Button direct imports");
  string(shadcn.cnHelperPath, "shadcn.cnHelperPath");
  exactSet(strings(shadcn.cnHelperImports, "cnHelperImports"), [
    "clsx",
    "tailwind-merge",
  ], "cn helper imports");
  invariant(
    ![
      ...strings(shadcn.buttonDirectImports, "button imports"),
      ...strings(shadcn.cnHelperImports, "cn imports"),
    ].includes("lucide-react"),
    "Button source invents lucide-react",
  );
  invariant(
    shadcn.registryInvocation === null &&
      array(shadcn.generatedPayloads, "generatedPayloads").length === 0,
    "mutable shadcn payload is forbidden",
  );
}

function validateOci(graph: JsonRecord, packages: Map<string, JsonRecord>) {
  const expected: Record<string, [string, string]> = {
    deno: ["denoland/deno", `debian-${packages.get("deno")?.version}`],
    node: ["library/node", `${packages.get("node")?.version}-bookworm-slim`],
    playwright: [
      "mcr.microsoft.com/playwright",
      `v${packages.get("playwright-test")?.version}-noble`,
    ],
    postgres18: ["library/postgres", "18.4-alpine3.23"],
    postgres17: ["library/postgres", "17.10-alpine3.23"],
  };
  const images = array(graph.ociImages, "ociImages").map((item, i) =>
    object(item, `ociImages[${i}]`)
  );
  exactSet(
    images.map((image) => string(image.id, "OCI id")),
    Object.keys(expected),
    "OCI images",
  );
  for (const image of images) {
    exactKeys(image, [
      "id",
      "repository",
      "tag",
      "indexDigest",
      "reference",
      "mediaType",
      "descriptors",
      "descriptorIdentity",
      "source",
      "observedAt",
      "evidenceSha256",
    ], "OCI image");
    const id = string(image.id, "OCI id");
    const declaration = expected[id];
    invariant(declaration !== undefined, `${id} declaration is unknown`);
    invariant(
      image.repository === declaration[0] && image.tag === declaration[1],
      `${id} official repository or tag is incorrect`,
    );
    const indexDigest = digest(image.indexDigest, `${id}.indexDigest`);
    invariant(
      image.reference === `${image.repository}:${image.tag}@${indexDigest}`,
      `${id} reference is not tag plus index digest`,
    );
    invariant(image.mediaType === OCI_INDEX_MEDIA, `${id} is not an OCI index`);
    const descriptors = array(image.descriptors, `${id}.descriptors`).map((
      item,
      i,
    ) => object(item, `${id}.descriptors[${i}]`));
    invariant(
      image.descriptorIdentity === JSON.stringify(descriptors),
      `${id} descriptor set disagrees with captured response identity`,
    );
    invariant(descriptors.length > 0, `${id} descriptor set is empty`);
    const descriptorKeys = descriptors.map((descriptor) =>
      `${descriptor.mediaType}:${descriptor.digest}:${descriptor.size}`
    );
    invariant(
      new Set(descriptorKeys).size === descriptorKeys.length,
      `${id} descriptor set contains duplicates`,
    );
    const platforms = descriptors.filter((descriptor) =>
      descriptor.kind === "runnable"
    );
    const platformIds = platforms.map((platform) =>
      `${platform.os}/${platform.architecture}/${platform.variant ?? ""}`
    );
    invariant(
      new Set(platformIds).size === platformIds.length &&
        platformIds.some((item) => item.startsWith("linux/amd64/")) &&
        platformIds.some((item) => item.startsWith("linux/arm64/")),
      `${id} required platforms are absent or duplicated`,
    );
    for (const descriptor of descriptors) {
      exactKeys(descriptor, [
        "kind",
        "os",
        "architecture",
        "variant",
        "digest",
        "mediaType",
        "size",
        "annotations",
      ], `${id} descriptor`);
      invariant(
        Number.isSafeInteger(descriptor.size) && Number(descriptor.size) > 0,
        `${id} descriptor size is invalid`,
      );
      invariant(
        digest(descriptor.digest, `${id} descriptor digest`) !== indexDigest &&
          descriptor.mediaType === OCI_MANIFEST_MEDIA,
        `${id} descriptor is not a child manifest`,
      );
      const annotations = object(
        descriptor.annotations,
        `${id} descriptor annotations`,
      );
      if (descriptor.kind === "runnable") {
        invariant(
          descriptor.os !== "unknown" && descriptor.architecture !== "unknown",
          `${id} runnable descriptor has unknown platform`,
        );
      } else {
        invariant(
          descriptor.kind === "attestation" && descriptor.os === "unknown" &&
            descriptor.architecture === "unknown",
          `${id} attachment classification is invalid`,
        );
        invariant(
          annotations["vnd.docker.reference.type"] === "attestation-manifest" &&
            typeof annotations["vnd.docker.reference.digest"] === "string",
          `${id} attestation annotations are invalid`,
        );
      }
    }
    invariant(
      image.source ===
        (String(image.repository).startsWith("mcr.microsoft.com/")
          ? `https://mcr.microsoft.com/v2/${
            String(image.repository).slice(18)
          }/manifests/${image.tag}`
          : `https://registry-1.docker.io/v2/${image.repository}/manifests/${image.tag}`),
      `${id} OCI evidence source is not official and exact`,
    );
    instant(image.observedAt, `${id}.observedAt`);
    digest(image.evidenceSha256, `${id}.evidenceSha256`);
  }
}

function validateProofStatus(graph: JsonRecord) {
  const proof = object(graph.proofStatus, "proofStatus");
  exactKeys(proof, [
    "runtimeBehavior",
    "followOns",
    "followOnLockReuse",
    "excludedEarlyDependencies",
  ], "proofStatus");
  invariant(
    proof.runtimeBehavior === "proof-pending",
    "runtime behavior cannot be marked proven",
  );
  const followOns = object(proof.followOns, "followOns");
  exactKeys(followOns, Object.keys(FOLLOW_ONS), "followOns");
  Object.entries(FOLLOW_ONS).forEach(([id, responsibility]) =>
    invariant(followOns[id] === responsibility, `${id} responsibility drifted`)
  );
  const reuse = object(proof.followOnLockReuse, "followOnLockReuse");
  exactKeys(reuse, ["FND-003A", "FND-003B", "FND-003C"], "followOnLockReuse");
  for (const id of Object.keys(reuse)) {
    const item = object(reuse[id], id);
    exactKeys(item, ["locks", "mutation"], id);
    exactSet(strings(item.locks, `${id}.locks`), LOCK_ROOTS, `${id} locks`);
    invariant(
      item.mutation === "forbidden",
      `${id} lock mutation is forbidden`,
    );
  }
  exactSet(
    strings(proof.excludedEarlyDependencies, "excludedEarlyDependencies"),
    [
      "lefthook",
      "mutable-shadcn-generated-payload",
      "atlas-migration-runner",
      "better-auth",
      "@axe-core/playwright",
      "axe-core",
    ],
    "early exclusions",
  );
}

function validateGraph(graph: JsonRecord) {
  exactKeys(graph, [
    "schemaVersion",
    "selection",
    "selectedPackages",
    "repository",
    "corepack",
    "lifecycle",
    "shadcn",
    "ociImages",
    "proofStatus",
  ], "graph");
  invariant(graph.schemaVersion === 2, "graph schemaVersion must equal 2");
  const packages = validateSelected(graph, validateSelection(graph));
  validateEdges(graph, packages);
  validateLifecycle(graph);
  validateCorepack(graph, packages);
  validateShadcn(graph);
  validateOci(graph, packages);
  validateProofStatus(graph);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function sha(seed: string): string {
  return `sha256:${seed.repeat(64).slice(0, 64)}`;
}

const SRI = `sha512-${"A".repeat(86)}==`;

function makeGraph(): JsonRecord {
  const selected = [...RUNTIMES, ...DIRECT.deno, ...DIRECT.pnpm].map(
    (id, index) => {
      const manifest = DIRECT.deno.includes(id)
        ? "deno"
        : DIRECT.pnpm.includes(id)
        ? "pnpm"
        : "runtime";
      return {
        id,
        name: nameOf(id),
        version: fixtureVersion(id),
        publishedAt: "2026-01-01T04:05:06.789Z",
        manifest,
        publicationEvidence: {
          kind: id === "deno" || id === "node"
            ? "official-release-metadata"
            : "npm-packument",
          source: id === "deno"
            ? `https://github.com/denoland/deno/releases/tag/v${
              fixtureVersion(id)
            }`
            : id === "node"
            ? `https://nodejs.org/dist/index.json`
            : `https://registry.npmjs.org/${encodeURIComponent(nameOf(id))}`,
          observedAt: "2026-01-10T04:05:06.789Z",
          contentSha256: sha("9"),
        },
        artifactEvidence: {
          kind: id === "deno" || id === "node"
            ? "release-checksum"
            : "npm-manifest-sri",
          value: id === "deno" || id === "node"
            ? sha(String((index % 9) + 1))
            : SRI,
          source: id === "deno"
            ? `https://github.com/denoland/deno/releases/download/v${
              fixtureVersion(id)
            }/deno-x86_64-pc-windows-msvc.zip.sha256sum`
            : id === "node"
            ? `https://nodejs.org/dist/v${fixtureVersion(id)}/SHASUMS256.txt`
            : `https://registry.npmjs.org/${encodeURIComponent(nameOf(id))}/${
              fixtureVersion(id)
            }`,
          observedAt: "2026-01-10T04:05:06.789Z",
          contentSha256: sha("a"),
        },
        latestStable: {
          version: nextFixtureVersion(id),
          source: id === "deno" || id === "node"
            ? "https://example.invalid/official-release-index"
            : `https://registry.npmjs.org/${encodeURIComponent(nameOf(id))}`,
          contentSha256: sha("8"),
          observedAt: "2026-01-10T04:05:06.789Z",
        },
        newerReleases: [{
          version: nextFixtureVersion(id),
          publishedAt: "2026-01-09T04:05:06.789Z",
          compatible: true,
          reason: "younger-than-cutoff",
          publicationEvidence: {
            kind: id === "deno" || id === "node"
              ? "official-release-metadata"
              : "npm-packument",
            source: "https://example.invalid/publication",
            contentSha256: sha("b"),
            observedAt: "2026-01-10T04:05:06.789Z",
          },
          compatibilityEvidence: {
            kind: "compatibility-evaluation",
            source: "https://example.invalid/manifest",
            contentSha256: sha("c"),
            observedAt: "2026-01-10T04:05:06.789Z",
          },
        }],
      };
    },
  );
  const pnpmNodeIds = [
    ...DIRECT.pnpm,
    "types-react",
    "types-react-dom",
    "astro-eslint-parser",
    "esbuild",
    "fsevents",
  ];
  const pnpmNodes = pnpmNodeIds.map((id) => {
    const declared = [
      ...Object.values(IMPORT_PAIRS),
      ...Object.values(PEER_PAIRS),
    ]
      .filter(([from, to]) => from === id && pnpmNodeIds.includes(to))
      .map(([, to]) => to);
    const dependencies = [
      ...new Set([
        ...(id === "astro" ? ["esbuild"] : []),
        ...declared,
      ]),
    ];
    return {
      id,
      name: nameOf(id),
      version: fixtureVersion(id),
      packageKey: `${nameOf(id)}@${fixtureVersion(id)}`,
      snapshotKey: id === "astro-react"
        ? `${nameOf(id)}@${fixtureVersion(id)}(react@${
          fixtureVersion("react")
        })`
        : `${nameOf(id)}@${fixtureVersion(id)}`,
      integrity: SRI,
      dependencies,
      optionalDependencies: id === "vite" ? ["fsevents"] : [],
      os: id === "fsevents" ? ["darwin"] : [],
      cpu: [],
      libc: [],
      optional: id === "fsevents",
      peerResolutions: id === "astro-react"
        ? { react: fixtureVersion("react") }
        : {},
      transitivePeerDependencies: [],
      dependencyResolutions: Object.fromEntries(
        [...dependencies, ...(id === "vite" ? ["fsevents"] : [])].map((
          dependencyId,
        ) => [dependencyId, fixtureVersion(dependencyId)]),
      ),
      hooks: id === "esbuild"
        ? [{
          name: "postinstall",
          command: "node install.js",
          manifestEvidence: {
            kind: "npm-manifest",
            source: `https://registry.npmjs.org/esbuild/${fixtureVersion(id)}`,
            contentSha256: sha("d"),
            observedAt: "2026-01-10T04:05:06.789Z",
          },
        }]
        : id === "fsevents"
        ? [{
          name: "install",
          command: "node-gyp rebuild",
          manifestEvidence: {
            kind: "npm-manifest",
            source: `https://registry.npmjs.org/fsevents/${fixtureVersion(id)}`,
            contentSha256: sha("e"),
            observedAt: "2026-01-10T04:05:06.789Z",
          },
        }]
        : [],
    };
  });
  for (const node of pnpmNodes) {
    node.dependencyResolutions = Object.fromEntries(
      [...node.dependencies, ...node.optionalDependencies].map(
        (dependencyId) => {
          const dependency = pnpmNodes.find((item) =>
            item.id === dependencyId
          )!;
          return [
            dependencyId,
            dependency.snapshotKey.slice(dependency.name.length + 1),
          ];
        },
      ),
    );
  }
  const runHashes = { denoLockSha256: sha("c"), pnpmLockSha256: sha("d") };
  const runs = [
    {
      id: "deno-clean",
      command: "deno ci",
      mode: "networked",
      cacheState: "empty",
      cacheRoot: "C:/fnd003-proof/deno-dir",
      setEnvironment: {
        DENO_DIR: "C:/fnd003-proof/deno-dir",
        DENO_NO_PACKAGE_JSON: "1",
      },
      unsetEnvironment: [],
      nodeModulesState: "absent",
    },
    {
      id: "deno-cached",
      command: "deno install --cached-only --lock=deno.lock --frozen",
      mode: "cached-only",
      cacheState: "warm",
      cacheRoot: "C:/fnd003-proof/deno-dir",
      setEnvironment: {
        DENO_DIR: "C:/fnd003-proof/deno-dir",
        DENO_NO_PACKAGE_JSON: "1",
      },
      unsetEnvironment: [],
      nodeModulesState: "removed-before-run",
    },
    {
      id: "pnpm-clean",
      command:
        "corepack pnpm install --frozen-lockfile --store-dir=C:/fnd003-proof/pnpm-store",
      mode: "networked",
      cacheState: "empty",
      cacheRoot: "C:/fnd003-proof/pnpm-store",
      setEnvironment: {
        COREPACK_HOME: "C:/fnd003-proof/corepack-home",
        COREPACK_DEFAULT_TO_LATEST: "0",
      },
      unsetEnvironment: ["COREPACK_INTEGRITY_KEYS"],
      nodeModulesState: "absent",
    },
    {
      id: "pnpm-offline",
      command:
        "corepack pnpm install --offline --frozen-lockfile --store-dir=C:/fnd003-proof/pnpm-store",
      mode: "offline",
      cacheState: "warm",
      cacheRoot: "C:/fnd003-proof/pnpm-store",
      setEnvironment: {
        COREPACK_HOME: "C:/fnd003-proof/corepack-home",
        COREPACK_DEFAULT_TO_LATEST: "0",
        COREPACK_ENABLE_NETWORK: "0",
      },
      unsetEnvironment: ["COREPACK_INTEGRITY_KEYS"],
      nodeModulesState: "removed-before-run",
    },
  ].map((run) => ({
    ...run,
    exitCode: 0,
    ...runHashes,
    lifecycleExecutions: run.id === "pnpm-clean"
      ? [{
        packageName: "esbuild",
        version: fixtureVersion("esbuild"),
        hook: "postinstall",
        command: "node install.js",
        run: "pnpm-clean",
        exitCode: 0,
      }]
      : [],
  }));
  const lifecycleExecutions = runs.flatMap((run) => run.lifecycleExecutions);
  const oci = {
    deno: ["denoland/deno", `debian-${fixtureVersion("deno")}`],
    node: ["library/node", `${fixtureVersion("node")}-bookworm-slim`],
    playwright: [
      "mcr.microsoft.com/playwright",
      `v${fixtureVersion("playwright-test")}-noble`,
    ],
    postgres18: ["library/postgres", "18.4-alpine3.23"],
    postgres17: ["library/postgres", "17.10-alpine3.23"],
  } as Record<string, [string, string]>;
  return {
    schemaVersion: 2,
    selection: {
      selectedAt: "2026-01-10T04:05:06.789Z",
      minimumAgeHours: 72,
      eligibleBefore: "2026-01-07T04:05:06.789Z",
    },
    selectedPackages: selected,
    repository: {
      artifacts: REPOSITORY_FILES.map((path, index) => ({
        path,
        sha256: sha(String(index + 1)),
      })),
      directDependencyIds: [...DIRECT.deno, ...DIRECT.pnpm],
      importEdges: Object.entries(IMPORT_PAIRS).map(([id, [from, to]]) => ({
        id,
        from,
        to,
        manifestRange: `^${fixtureVersion(to)}`,
        selectedResolution: fixtureVersion(to),
        manifestEvidence: {
          kind: "npm-manifest",
          source: `https://registry.npmjs.org/${
            encodeURIComponent(nameOf(from))
          }/${fixtureVersion(from)}`,
          contentSha256: sha("6"),
          observedAt: "2026-01-10T04:05:06.789Z",
        },
      })),
      peerEdges: Object.entries(PEER_PAIRS).map(([id, [from, to]]) => ({
        id,
        from,
        to,
        manifestRange: `^${fixtureVersion(to)}`,
        selectedResolution: fixtureVersion(to),
        manifestEvidence: {
          kind: "npm-manifest",
          source: `https://registry.npmjs.org/${
            encodeURIComponent(nameOf(from))
          }/${fixtureVersion(from)}`,
          contentSha256: sha("7"),
          observedAt: "2026-01-10T04:05:06.789Z",
        },
      })),
      denoSpecifiers: Object.fromEntries([
        ...DIRECT.deno.map((
          id,
        ) => [`npm:${nameOf(id)}@${fixtureVersion(id)}`, fixtureVersion(id)]),
        ["jsr:@std/assert@1.0.14", "1.0.14"],
        ["jsr:@std/internal@^1.0.10", "1.0.14"],
      ]),
      denoLockNodes: [
        ...DIRECT.deno.map((id) => ({
          key: `npm:${nameOf(id)}@${fixtureVersion(id)}`,
          kind: "npm",
          integrity: SRI,
          ...(id === "kysely-postgres-js"
            ? {
              dependencies: [
                `kysely@${fixtureVersion("kysely")}`,
                `postgres@${fixtureVersion("postgres")}`,
              ],
            }
            : id === "hono-standard-validator"
            ? {
              dependencies: [
                `hono@${fixtureVersion("hono")}`,
                `@standard-schema/spec@${
                  fixtureVersion("standard-schema-spec")
                }`,
              ],
            }
            : {}),
          ...(id === "hono"
            ? {}
            : { optionalDependencies: [], os: [], cpu: [] }),
        })),
        {
          key: "jsr:@std/assert@1.0.14",
          kind: "jsr",
          integrity: "a".repeat(64),
          dependencies: ["jsr:@std/internal@^1.0.10"],
        },
        {
          key: "jsr:@std/internal@1.0.14",
          kind: "jsr",
          integrity: "b".repeat(64),
        },
      ],
      pnpmLockNodes: pnpmNodes,
      lockRoots: [...LOCK_ROOTS],
      successorLockPlans: [],
      repeatability: {
        identities: {
          deno: fixtureVersion("deno"),
          node: fixtureVersion("node"),
          corepack: fixtureVersion("corepack"),
          pnpm: fixtureVersion("pnpm"),
        },
        runs,
        lifecycleExecutions,
      },
    },
    corepack: {
      descriptor: `pnpm@${fixtureVersion("pnpm")}+sha512.${"00".repeat(64)}`,
      registryIntegrity: SRI,
      proof: {
        setEnvironment: { COREPACK_DEFAULT_TO_LATEST: "0" },
        unsetEnvironment: ["COREPACK_INTEGRITY_KEYS"],
        runs: [
          {
            id: "version",
            command: "corepack --version",
            output: fixtureVersion("corepack"),
            exitCode: 0,
          },
          {
            id: "use",
            command: `corepack use pnpm@${fixtureVersion("pnpm")}`,
            output: `pnpm@${fixtureVersion("pnpm")}+sha512.${"00".repeat(64)}`,
            exitCode: 0,
          },
          {
            id: "install",
            command: "corepack install",
            output: `Adding pnpm@${fixtureVersion("pnpm")} to the cache`,
            exitCode: 0,
          },
          {
            id: "execute",
            command: "corepack pnpm --version",
            output: fixtureVersion("pnpm"),
            exitCode: 0,
          },
        ],
      },
    },
    lifecycle: {
      deno: { allowScripts: [] },
      pnpm: {
        strictDepBuilds: true,
        dangerouslyAllowAllBuilds: false,
        allowBuilds: {
          [`esbuild@${fixtureVersion("esbuild")}`]: true,
          fsevents: false,
        },
      },
      hookInventory: [{
        ecosystem: "pnpm",
        packageName: "esbuild",
        version: fixtureVersion("esbuild"),
        hook: "postinstall",
        command: "node install.js",
        manifestEvidence: {
          kind: "npm-manifest",
          source: `https://registry.npmjs.org/esbuild/${
            fixtureVersion("esbuild")
          }`,
          contentSha256: sha("d"),
          observedAt: "2026-01-10T04:05:06.789Z",
        },
        reviewed: true,
        allowed: true,
      }, {
        ecosystem: "pnpm",
        packageName: "fsevents",
        version: fixtureVersion("fsevents"),
        hook: "install",
        command: "node-gyp rebuild",
        manifestEvidence: {
          kind: "npm-manifest",
          source: `https://registry.npmjs.org/fsevents/${
            fixtureVersion("fsevents")
          }`,
          contentSha256: sha("e"),
          observedAt: "2026-01-10T04:05:06.789Z",
        },
        reviewed: true,
        allowed: false,
      }],
    },
    shadcn: {
      sourceCommit: "a".repeat(40),
      buttonPath: "apps/v4/registry/bases/base/ui/button.tsx",
      buttonSourceSha256: sha("e"),
      buttonDirectImports: [
        "base-ui-react",
        "class-variance-authority",
        "cn-helper",
      ],
      cnHelperPath: "apps/v4/registry/bases/base/lib/utils.ts",
      cnHelperImports: ["clsx", "tailwind-merge"],
      registryInvocation: null,
      generatedPayloads: [],
    },
    ociImages: Object.entries(oci).map(([id, [repository, tag]], index) => {
      const indexDigest = sha(String(index + 2));
      const descriptors = [
        {
          kind: "runnable",
          os: "linux",
          architecture: "amd64",
          variant: null,
          digest: sha("f"),
          mediaType: OCI_MANIFEST_MEDIA,
          size: 1644,
          annotations: {},
        },
        {
          kind: "runnable",
          os: "linux",
          architecture: "arm64",
          variant: "v8",
          digest: sha("1"),
          mediaType: OCI_MANIFEST_MEDIA,
          size: 1644,
          annotations: {},
        },
        ...(id === "postgres18" || id === "postgres17"
          ? [{
            kind: "runnable",
            os: "linux",
            architecture: "arm",
            variant: "v6",
            digest: sha("b"),
            mediaType: OCI_MANIFEST_MEDIA,
            size: 1500,
            annotations: {},
          }, {
            kind: "runnable",
            os: "linux",
            architecture: "arm",
            variant: "v7",
            digest: sha("a"),
            mediaType: OCI_MANIFEST_MEDIA,
            size: 1501,
            annotations: {},
          }]
          : []),
        ...(id === "playwright" ? [] : [{
          kind: "attestation",
          os: "unknown",
          architecture: "unknown",
          variant: null,
          digest: sha("9"),
          mediaType: OCI_MANIFEST_MEDIA,
          size: 900,
          annotations: {
            "vnd.docker.reference.type": "attestation-manifest",
            "vnd.docker.reference.digest": sha("f"),
          },
        }]),
      ];
      return {
        id,
        repository,
        tag,
        indexDigest,
        reference: `${repository}:${tag}@${indexDigest}`,
        mediaType: OCI_INDEX_MEDIA,
        descriptors,
        descriptorIdentity: JSON.stringify(descriptors),
        source: repository.startsWith("mcr.microsoft.com")
          ? `https://mcr.microsoft.com/v2/playwright/manifests/${tag}`
          : `https://registry-1.docker.io/v2/${repository}/manifests/${tag}`,
        observedAt: "2026-01-10T04:05:06.789Z",
        evidenceSha256: sha("3"),
      };
    }),
    proofStatus: {
      runtimeBehavior: "proof-pending",
      followOns: clone(FOLLOW_ONS),
      followOnLockReuse: Object.fromEntries(
        ["FND-003A", "FND-003B", "FND-003C"].map((
          id,
        ) => [id, { locks: [...LOCK_ROOTS], mutation: "forbidden" }]),
      ),
      excludedEarlyDependencies: [
        "lefthook",
        "mutable-shadcn-generated-payload",
        "atlas-migration-runner",
        "better-auth",
        "@axe-core/playwright",
        "axe-core",
      ],
    },
  };
}

function packageAt(graph: JsonRecord, id: string): JsonRecord {
  return object(
    array(graph.selectedPackages, "selectedPackages").find((item) =>
      object(item, "package").id === id
    ),
    id,
  );
}

function expectReject(mutator: (graph: JsonRecord) => void, expected: string) {
  const graph = clone(makeGraph());
  mutator(graph);
  let message = "";
  try {
    validateGraph(graph);
  } catch (error) {
    message = (error as Error).message;
  }
  invariant(
    message.includes(expected),
    `expected '${expected}', observed '${message}'`,
  );
}

function makeRepositoryContents(graph: JsonRecord): Map<string, string> {
  const yamlKey = (key: string) =>
    key.startsWith("@") || key.includes("(") ? `'${key}'` : key;
  const selected = new Map(
    array(graph.selectedPackages, "selectedPackages").map((item) => {
      const record = object(item, "selected package");
      return [String(record.id), record] as const;
    }),
  );
  const imports = Object.fromEntries(
    DIRECT.deno.map((
      id,
    ) => {
      const item = object(selected.get(id), id);
      return [String(item.name), `npm:${item.name}@${item.version}`];
    }),
  );
  const denoNodes = array(
    object(graph.repository, "repository").denoLockNodes,
    "Deno nodes",
  ).map((item) => object(item, "Deno node"));
  const denoLock = {
    version: "5",
    specifiers: object(
      object(graph.repository, "repository").denoSpecifiers,
      "Deno specifiers",
    ),
    npm: Object.fromEntries(
      denoNodes.filter((node) => node.kind === "npm").map((node) => [
        String(node.key).slice(4),
        {
          integrity: node.integrity,
          ...(node.dependencies
            ? { dependencies: strings(node.dependencies, "Deno dependencies") }
            : {}),
          ...(node.optionalDependencies
            ? { optionalDependencies: node.optionalDependencies }
            : {}),
          ...(node.os ? { os: node.os } : {}),
          ...(node.cpu ? { cpu: node.cpu } : {}),
          ...(node.optionalPeers ? { optionalPeers: node.optionalPeers } : {}),
          ...(node.tarball ? { tarball: node.tarball } : {}),
          ...(node.deprecated ? { deprecated: node.deprecated } : {}),
          ...(node.scripts ? { scripts: node.scripts } : {}),
          ...(node.bin ? { bin: node.bin } : {}),
        },
      ]),
    ),
    jsr: Object.fromEntries(
      denoNodes.filter((node) => node.kind === "jsr").map((node) => [
        String(node.key).slice(4),
        {
          integrity: node.integrity,
          ...(node.dependencies ? { dependencies: node.dependencies } : {}),
        },
      ]),
    ),
  };
  const packageJson = {
    private: true,
    type: "module",
    packageManager: object(graph.corepack, "corepack").descriptor,
    engines: {
      node: selected.get("node")?.version,
      pnpm: selected.get("pnpm")?.version,
    },
    devDependencies: Object.fromEntries(
      DIRECT.pnpm.map((id) => {
        const item = object(selected.get(id), id);
        return [String(item.name), item.version];
      }),
    ),
  };
  const graphAllowBuilds = object(
    object(object(graph.lifecycle, "lifecycle").pnpm, "pnpm").allowBuilds,
    "graph allowBuilds",
  );
  const workspace = [
    "packages: []",
    "saveExact: true",
    "minimumReleaseAge: 4320",
    "minimumReleaseAgeStrict: true",
    "minimumReleaseAgeIgnoreMissingTime: false",
    "trustLockfile: false",
    "strictDepBuilds: true",
    "dangerouslyAllowAllBuilds: false",
    "allowBuilds:",
    ...Object.entries(graphAllowBuilds).map(([name, allowed]) =>
      `  ${name}: ${allowed}`
    ),
    "supportedArchitectures:",
    "  os:",
    "    - current",
    "    - linux",
    "  cpu:",
    "    - x64",
    "    - arm64",
    "",
  ].join("\n");
  const pnpmLockNodes = array(
    object(graph.repository, "repository").pnpmLockNodes,
    "nodes",
  ).map((item) => object(item, "node"));
  const pnpmLock = [
    "lockfileVersion: '9.0'",
    "settings:",
    "  autoInstallPeers: false",
    "importers:",
    "  '.':",
    "    devDependencies:",
    ...DIRECT.pnpm.flatMap((id) => {
      const node = object(pnpmLockNodes.find((item) => item.id === id), id);
      return [
        `      ${yamlKey(String(selected.get(id)?.name))}:`,
        `        specifier: ${selected.get(id)?.version}`,
        `        version: ${
          String(node.snapshotKey).slice(String(node.name).length + 1)
        }`,
      ];
    }),
    "packages:",
    ...pnpmLockNodes.flatMap((node) => {
      const lines = [
        `  ${yamlKey(String(node.packageKey))}:`,
        `    resolution: {integrity: ${node.integrity}}`,
      ];
      for (const field of ["os", "cpu", "libc"] as const) {
        const values = strings(node[field], `pnpm ${field}`);
        if (values.length) lines.push(`    ${field}: [${values.join(", ")}]`);
      }
      const peers = object(node.peerResolutions, "peer resolutions");
      if (Object.keys(peers).length) {
        lines.push("    peerDependencies:");
        for (const name of Object.keys(peers)) {
          lines.push(`      ${yamlKey(name)}: '*'`);
        }
      }
      return lines;
    }),
    "snapshots:",
    ...pnpmLockNodes.flatMap((node) => {
      const deps = strings(node.dependencies, "dependencies");
      const lines = deps.length
        ? [`  ${yamlKey(String(node.snapshotKey))}:`]
        : [`  ${yamlKey(String(node.snapshotKey))}: {}`];
      if (deps.length) {
        lines.push(
          "    dependencies:",
          ...deps.map((id) =>
            `      ${yamlKey(nameOf(id))}: ${
              object(node.dependencyResolutions, "resolutions")[id]
            }`
          ),
        );
      }
      const optional = strings(
        node.optionalDependencies,
        "optional dependencies",
      );
      if (optional.length) {
        lines.push(
          "    optionalDependencies:",
          ...optional.map((id) =>
            `      ${yamlKey(nameOf(id))}: ${
              object(node.dependencyResolutions, "resolutions")[id]
            }`
          ),
        );
      }
      if (node.optional === true) lines.push("    optional: true");
      const transitive = strings(
        node.transitivePeerDependencies,
        "transitive peers",
      );
      if (transitive.length) {
        lines.push(
          "    transitivePeerDependencies:",
          ...transitive.map((name) => `      - ${name}`),
        );
      }
      return lines;
    }),
    "",
  ].join("\n");
  const contents = new Map<string, string>([
    [".npmrc", "registry=https://registry.npmjs.org/\n"],
    [
      "deno.json",
      JSON.stringify({
        ...clone(BASE_DENO_CONFIGURATION),
        imports,
        lock: { path: "./deno.lock", frozen: true },
        minimumDependencyAge: "PT72H",
        allowScripts: [],
      }),
    ],
    ["deno.lock", JSON.stringify(denoLock)],
    ["package.json", JSON.stringify(packageJson)],
    ["pnpm-workspace.yaml", workspace],
    ["pnpm-lock.yaml", pnpmLock],
  ]);
  return contents;
}

function oneMatch(
  text: string,
  pattern: RegExp,
  label: string,
): RegExpExecArray {
  const flags = pattern.flags.includes("g")
    ? pattern.flags
    : `${pattern.flags}g`;
  const matches = [...text.matchAll(new RegExp(pattern.source, flags))];
  invariant(matches.length === 1, `${label} must occur exactly once`);
  return matches[0]!;
}

async function sha256Text(text: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return `sha256:${
    Array.from(
      new Uint8Array(hash),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("")
  }`;
}

async function renderReport(graph: JsonRecord): Promise<string> {
  const repository = object(graph.repository, "repository");
  const summary = {
    graphSha256: await sha256Text(JSON.stringify(graph)),
    selection: graph.selection,
    selected: array(graph.selectedPackages, "selectedPackages").map((item) => {
      const selected = object(item, "selected package");
      return { id: selected.id, version: selected.version };
    }),
    ociReferences: array(graph.ociImages, "ociImages").map((item) =>
      object(item, "OCI image").reference
    ),
    lifecycle: graph.lifecycle,
    repeatability: repository.repeatability,
    proofStatus: graph.proofStatus,
  };
  return `# FND-003 immutable runtime graph\n\n${
    JSON.stringify(summary, null, 2)
  }\n`;
}

async function validateRepositoryContents(
  contents: Map<string, string>,
  graph: JsonRecord,
) {
  const selected = new Map(
    array(graph.selectedPackages, "selectedPackages").map((item) => {
      const record = object(item, "selected package");
      return [string(record.id, "selected id"), record] as const;
    }),
  );
  const denoJson = parseJson(
    string(contents.get("deno.json"), "deno.json"),
    "deno.json",
  );
  exactKeys(denoJson, [
    "compilerOptions",
    "fmt",
    "lint",
    "tasks",
    "imports",
    "lock",
    "minimumDependencyAge",
    "allowScripts",
  ], "deno.json");
  for (const key of ["compilerOptions", "fmt", "lint", "tasks"]) {
    invariant(
      JSON.stringify(denoJson[key]) ===
        JSON.stringify(BASE_DENO_CONFIGURATION[key]),
      `deno.json base ${key} configuration drifted`,
    );
  }
  invariant(
    denoJson.minimumDependencyAge === "PT72H",
    "deno minimum age is incorrect",
  );
  const denoLockConfig = object(denoJson.lock, "deno.json.lock");
  invariant(
    denoLockConfig.path === "./deno.lock" && denoLockConfig.frozen === true,
    "deno lock path or frozen policy is incorrect",
  );
  const imports = object(denoJson.imports, "deno.json.imports");
  exactSet(Object.keys(imports), DIRECT.deno.map(nameOf), "Deno imports");
  for (const id of DIRECT.deno) {
    const item = object(selected.get(id), id);
    invariant(
      imports[String(item.name)] === `npm:${item.name}@${item.version}`,
      `${id} import is not exact`,
    );
  }
  const denoAllow = strings(denoJson.allowScripts, "deno.json.allowScripts");
  exactSet(
    denoAllow,
    strings(
      object(graph.lifecycle, "lifecycle").deno &&
        object(object(graph.lifecycle, "lifecycle").deno, "deno").allowScripts,
      "graph Deno allowScripts",
    ),
    "Deno manifest allowScripts",
  );

  const denoLock = parseJson(
    string(contents.get("deno.lock"), "deno.lock"),
    "deno.lock",
  );
  invariant(
    Object.keys(denoLock).every((key) =>
      [
        "version",
        "specifiers",
        "npm",
        "jsr",
        "workspace",
        "remote",
        "redirects",
      ]
        .includes(key)
    ) && ["version", "specifiers", "npm"].every((key) => key in denoLock),
    "deno.lock has missing or unknown fields",
  );
  invariant(denoLock.version === "5", "deno.lock must use version 5");
  const specifiers = object(denoLock.specifiers, "deno.lock.specifiers");
  const npm = object(denoLock.npm, "deno.lock.npm");
  const jsr = object(denoLock.jsr ?? {}, "deno.lock.jsr");
  const graphDenoNodes = array(
    object(graph.repository, "repository").denoLockNodes,
    "graph Deno nodes",
  ).map((item) => object(item, "graph Deno node"));
  exactSet(
    Object.keys(specifiers),
    Object.keys(
      object(
        object(graph.repository, "repository").denoSpecifiers,
        "graph Deno specifiers",
      ),
    ),
    "Deno lock specifiers",
  );
  exactSet(
    [
      ...Object.keys(npm).map((key) => `npm:${key}`),
      ...Object.keys(jsr).map((key) => `jsr:${key}`),
    ],
    graphDenoNodes.map((node) => String(node.key)),
    "Deno file and graph lock nodes",
  );
  for (const id of DIRECT.deno) {
    const item = object(selected.get(id), id);
    const spec = `npm:${item.name}@${item.version}`;
    invariant(
      specifiers[spec] === item.version,
      `${id} Deno specifier is stale or absent`,
    );
    const fileIntegrity = sri(
      object(npm[`${item.name}@${item.version}`], `${id} Deno node`).integrity,
      `${id} Deno integrity`,
    );
    const graphNode = object(
      graphDenoNodes.find((node) => node.key === spec),
      `${id} graph Deno node`,
    );
    invariant(
      graphNode.integrity === fileIntegrity,
      `${id} Deno integrity disagrees with graph`,
    );
  }
  for (const [key, value] of Object.entries(jsr)) {
    invariant(
      RAW_SHA256.test(string(object(value, key).integrity, "JSR integrity")),
      "JSR integrity must be raw hex",
    );
  }
  for (const graphNode of graphDenoNodes) {
    const key = string(graphNode.key, "graph Deno key");
    const fileNode = key.startsWith("npm:")
      ? object(npm[key.slice(4)], key)
      : object(jsr[key.slice(4)], key);
    invariant(
      fileNode.integrity === graphNode.integrity,
      `${key} Deno integrity disagrees with graph`,
    );
    const fileDependencies = strings(
      fileNode.dependencies ?? [],
      "Deno file dependencies",
    );
    const graphDependencies = strings(
      graphNode.dependencies ?? [],
      "graph Deno dependencies",
    );
    exactSet(
      fileDependencies,
      graphDependencies,
      `${key} Deno dependency edges`,
    );
    if (key.startsWith("npm:")) {
      exactSet(
        strings(
          fileNode.optionalDependencies ?? [],
          "Deno file optional dependencies",
        ),
        strings(
          graphNode.optionalDependencies ?? [],
          "graph Deno optional dependencies",
        ),
        `${key} Deno optional dependency edges`,
      );
      exactSet(
        strings(fileNode.os ?? [], "Deno file os"),
        strings(graphNode.os ?? [], "graph Deno os"),
        `${key} Deno os`,
      );
      exactSet(
        strings(fileNode.cpu ?? [], "Deno file cpu"),
        strings(graphNode.cpu ?? [], "graph Deno cpu"),
        `${key} Deno cpu`,
      );
      exactSet(
        strings(fileNode.optionalPeers ?? [], "Deno file optional peers"),
        strings(graphNode.optionalPeers ?? [], "graph Deno optional peers"),
        `${key} Deno optional peers`,
      );
      for (const property of ["tarball", "deprecated", "scripts", "bin"]) {
        invariant(
          fileNode[property] === graphNode[property],
          `${key} Deno ${property} drifted`,
        );
      }
    }
  }

  const packageJson = parseJson(
    string(contents.get("package.json"), "package.json"),
    "package.json",
  );
  exactKeys(packageJson, [
    "private",
    "type",
    "packageManager",
    "engines",
    "devDependencies",
  ], "package.json");
  invariant(
    packageJson.packageManager ===
      object(graph.corepack, "corepack").descriptor,
    "Corepack descriptor disagrees with package.json",
  );
  const engines = object(packageJson.engines, "package.json.engines");
  invariant(
    engines.node === selected.get("node")?.version &&
      engines.pnpm === selected.get("pnpm")?.version,
    "engine declarations disagree with selected runtimes",
  );
  const dependencies = object(
    packageJson.devDependencies,
    "package.json.devDependencies",
  );
  exactSet(
    Object.keys(dependencies),
    DIRECT.pnpm.map(nameOf),
    "pnpm manifest dependencies",
  );
  for (const id of DIRECT.pnpm) {
    invariant(
      dependencies[nameOf(id)] === selected.get(id)?.version,
      `${id} package dependency is not exact`,
    );
  }

  const npmrc = string(contents.get(".npmrc"), ".npmrc");
  invariant(
    npmrc === "registry=https://registry.npmjs.org/\n",
    ".npmrc contains misplaced non-registry policy",
  );
  const workspace = string(
    contents.get("pnpm-workspace.yaml"),
    "pnpm-workspace.yaml",
  );
  exactSet(
    [...workspace.matchAll(/^([A-Za-z][A-Za-z]+):/gm)].map((match) =>
      String(match[1])
    ),
    [
      "packages",
      "saveExact",
      "minimumReleaseAge",
      "minimumReleaseAgeStrict",
      "minimumReleaseAgeIgnoreMissingTime",
      "trustLockfile",
      "strictDepBuilds",
      "dangerouslyAllowAllBuilds",
      "allowBuilds",
      "supportedArchitectures",
    ],
    "pnpm workspace top-level keys",
  );
  oneMatch(workspace, /^packages: \[\]$/m, "root-only pnpm workspace");
  oneMatch(workspace, /^saveExact: true$/m, "pnpm saveExact");
  oneMatch(workspace, /^minimumReleaseAge: 4320$/m, "pnpm minimum age");
  oneMatch(
    workspace,
    /^minimumReleaseAgeStrict: true$/m,
    "pnpm strict minimum age",
  );
  oneMatch(
    workspace,
    /^minimumReleaseAgeIgnoreMissingTime: false$/m,
    "pnpm missing-time denial",
  );
  oneMatch(workspace, /^trustLockfile: false$/m, "pnpm lock trust");
  oneMatch(workspace, /^strictDepBuilds: true$/m, "pnpm strict builds");
  oneMatch(
    workspace,
    /^dangerouslyAllowAllBuilds: false$/m,
    "pnpm deny-all override",
  );
  const graphAllowBuilds = object(
    object(object(graph.lifecycle, "lifecycle").pnpm, "pnpm").allowBuilds,
    "graph allowBuilds",
  );
  const expectedWorkspace = [
    "packages: []",
    "saveExact: true",
    "minimumReleaseAge: 4320",
    "minimumReleaseAgeStrict: true",
    "minimumReleaseAgeIgnoreMissingTime: false",
    "trustLockfile: false",
    "strictDepBuilds: true",
    "dangerouslyAllowAllBuilds: false",
    "allowBuilds:",
    ...Object.entries(graphAllowBuilds).map(([name, allowed]) =>
      `  ${name}: ${allowed}`
    ),
    "supportedArchitectures:",
    "  os:",
    "    - current",
    "    - linux",
    "  cpu:",
    "    - x64",
    "    - arm64",
    "",
  ].join("\n");
  invariant(workspace === expectedWorkspace, "pnpm workspace is not canonical");
  invariant(
    Object.entries(graphAllowBuilds).every(([name, allowed]) =>
      workspace.includes(`  ${name}: ${allowed}`)
    ),
    "pnpm workspace allowBuilds disagrees with graph",
  );
  oneMatch(
    workspace,
    /^supportedArchitectures:\n[ ][ ]os:\n[ ][ ][ ][ ]- current\n[ ][ ][ ][ ]- linux\n[ ][ ]cpu:\n[ ][ ][ ][ ]- x64\n[ ][ ][ ][ ]- arm64$/m,
    "pnpm workspace is not canonical",
  );
  invariant(
    !workspace.includes("onlyBuiltDependencies"),
    "removed pnpm onlyBuiltDependencies field is forbidden",
  );

  const pnpmLock = string(contents.get("pnpm-lock.yaml"), "pnpm-lock.yaml");
  oneMatch(pnpmLock, /^lockfileVersion: '9\.0'$/m, "pnpm lockfile version");
  for (const section of ["settings", "importers", "packages", "snapshots"]) {
    oneMatch(
      pnpmLock,
      new RegExp(`^${section}:$`, "m"),
      `pnpm ${section} section`,
    );
  }
  const importerText = pnpmLock.slice(
    pnpmLock.indexOf("\nimporters:\n") + "\nimporters:\n".length,
    pnpmLock.indexOf("\npackages:\n"),
  );
  exactSet(
    importerText.split("\n").filter((line) =>
      /^ {2}\S.*:(?: \{\})?$/.test(line)
    )
      .map((
        line,
      ) =>
        line.trim().replace(/:(?: \{\})?$/, "").replace(/^['\"]|['\"]$/g, "")
      ),
    ["."],
    "pnpm importer roots",
  );
  const rootImporter = importerText;
  const importerSectionNames = [
    ...rootImporter.matchAll(/^ {4}([A-Za-z]+):$/gm),
  ].map((match) => String(match[1]));
  exactSet(
    importerSectionNames,
    ["devDependencies"],
    "pnpm root importer dependency sections",
  );
  const importerNames = [
    ...rootImporter.matchAll(/^ {6}['\"]?(.+?)['\"]?:$/gm),
  ].map((
    match,
  ) => String(match[1]));
  exactSet(
    importerNames,
    DIRECT.pnpm.map(nameOf),
    "pnpm root importer membership",
  );
  for (const id of DIRECT.pnpm) {
    const selectedVersion = string(selected.get(id)?.version, `${id} version`);
    const graphNode = object(
      array(object(graph.repository, "repository").pnpmLockNodes, "nodes")
        .map((item) => object(item, "node"))
        .find((node) => node.id === id),
      id,
    );
    const importerResolution = string(graphNode.snapshotKey, "snapshot key")
      .slice(string(graphNode.name, "node name").length + 1);
    const escaped = nameOf(id).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    oneMatch(
      pnpmLock,
      new RegExp(
        `^      ['\"]?${escaped}['\"]?:\\n        specifier: ${
          selectedVersion.replaceAll(".", "\\.")
        }\\n        version: ${
          importerResolution.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        }$`,
        "m",
      ),
      `${id} pnpm importer`,
    );
  }
  const nodes = array(
    object(graph.repository, "repository").pnpmLockNodes,
    "pnpmLockNodes",
  ).map((item) => object(item, "pnpm node"));
  const snapshotText = pnpmLock.slice(
    pnpmLock.indexOf("\nsnapshots:\n"),
  );
  const packageText = pnpmLock.slice(
    pnpmLock.indexOf("\npackages:\n") + "\npackages:\n".length,
    pnpmLock.indexOf("\nsnapshots:\n"),
  );
  const blockKeys = (text: string) =>
    text.split("\n").filter((line) =>
      /^[ ][ ]\S.*:(?: \{\})?$/.test(line) && !line.startsWith("    ")
    ).map((line) =>
      line.trim().replace(/:(?: \{\})?$/, "").replace(/^['\"]|['\"]$/g, "")
    );
  exactSet(
    blockKeys(packageText),
    nodes.map((node) => string(node.packageKey, "packageKey")),
    "pnpm file and graph package nodes",
  );
  exactSet(
    blockKeys(snapshotText),
    nodes.map((node) => string(node.snapshotKey, "snapshotKey")),
    "pnpm file and graph snapshot nodes",
  );
  const yamlBlock = (text: string, rawKey: string): string => {
    const candidates = [`  ${rawKey}:`, `  '${rawKey}':`, `  "${rawKey}":`];
    const starts = candidates.map((candidate) => text.indexOf(candidate))
      .filter((value) => value >= 0);
    invariant(
      starts.length === 1,
      `${rawKey} YAML block must occur exactly once`,
    );
    const start = starts[0]!;
    const remainder = text.slice(start + 3);
    const next = /\n[ ][ ]\S[^\n]*:/.exec(remainder);
    return text.slice(start, next ? start + 3 + next.index : undefined);
  };
  for (const node of nodes) {
    const nodeIntegrity = string(node.integrity, "pnpm node integrity");
    const packageKey = string(node.packageKey, "pnpm package key");
    const packageBlock = yamlBlock(packageText, packageKey);
    oneMatch(
      packageBlock,
      new RegExp(
        `^    resolution: \\{integrity: ${
          nodeIntegrity.replace(/[+]/g, "\\+")
        }\\}$`,
        "m",
      ),
      `${node.id} pnpm package node`,
    );
    for (const field of ["os", "cpu", "libc"] as const) {
      const values = strings(node[field], `pnpm node ${field}`);
      const match = new RegExp(`^    ${field}: \\[([^\\]]*)\\]$`, "m").exec(
        packageBlock,
      );
      exactSet(
        match
          ? match[1]!.split(",").map((value) => value.trim()).filter(Boolean)
          : [],
        values,
        `${node.id} package ${field}`,
      );
    }
    const peerSection = packageBlock.indexOf("\n    peerDependencies:\n");
    const filePeerNames = peerSection < 0 ? [] : [
      ...packageBlock.slice(peerSection).matchAll(
        /^ {6}['\"]?(.+?)['\"]?: /gm,
      ),
    ]
      .map((match) => String(match[1]));
    exactSet(
      filePeerNames,
      Object.keys(object(node.peerResolutions, "peer resolutions")),
      `${node.id} package peers`,
    );
    const snapshotKey = string(node.snapshotKey, "pnpm snapshot key");
    const snapshotBlock = yamlBlock(snapshotText, snapshotKey);
    const expectedResolutions = object(
      node.dependencyResolutions,
      "dependency resolutions",
    );
    const sectionEntries = (
      section: "dependencies" | "optionalDependencies",
    ) => {
      const start = snapshotBlock.indexOf(`\n    ${section}:\n`);
      if (start < 0) return [];
      const rest = snapshotBlock.slice(start + section.length + 7);
      const next = /\n[ ][ ][ ][ ]\S[^\n]*:/.exec(rest);
      const body = next ? rest.slice(0, next.index) : rest;
      return [...body.matchAll(/^[ ][ ][ ][ ][ ][ ]['\"]?(.+?)['\"]?: (.+)$/gm)]
        .map((match) => `${match[1]}:${match[2]}`);
    };
    for (const section of ["dependencies", "optionalDependencies"] as const) {
      exactSet(
        sectionEntries(section),
        strings(node[section], `pnpm ${section}`).map((dependencyId) => {
          const dependency = object(
            nodes.find((candidate) => candidate.id === dependencyId),
            dependencyId,
          );
          return `${dependency.name}:${expectedResolutions[dependencyId]}`;
        }),
        `${node.id} snapshot ${section} edges`,
      );
    }
    invariant(
      snapshotBlock.includes("\n    optional: true") ===
        (node.optional === true),
      `${node.id} snapshot optional flag drifted`,
    );
    const transitiveStart = snapshotBlock.indexOf(
      "\n    transitivePeerDependencies:\n",
    );
    const fileTransitivePeers = transitiveStart < 0
      ? []
      : [...snapshotBlock.slice(transitiveStart).matchAll(/^ {6}- (.+)$/gm)]
        .map((match) => String(match[1]));
    exactSet(
      fileTransitivePeers,
      strings(node.transitivePeerDependencies, "transitive peer dependencies"),
      `${node.id} transitive peer dependencies`,
    );
    for (
      const dependencyId of [
        ...strings(node.dependencies, "pnpm dependencies"),
        ...strings(node.optionalDependencies, "pnpm optional dependencies"),
      ]
    ) {
      const dependency = object(
        nodes.find((candidate) => candidate.id === dependencyId),
        dependencyId,
      );
      const dependencyName = string(dependency.name, "dependency name")
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const dependencyResolution = string(
        expectedResolutions[dependencyId],
        "dependency resolution",
      );
      oneMatch(
        snapshotBlock,
        new RegExp(
          `^      ['\"]?${dependencyName}['\"]?: ${
            dependencyResolution.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
          }$`,
          "m",
        ),
        `${node.id} snapshot dependency ${dependencyId}`,
      );
    }
  }
  invariant(
    !pnpmLock.includes(`pnpm@${selected.get("pnpm")?.version}':`),
    "package manager must not be a pnpm lock node",
  );

  const artifacts = array(
    object(graph.repository, "repository").artifacts,
    "artifacts",
  ).map((item) => object(item, "artifact"));
  for (const artifact of artifacts) {
    const path = string(artifact.path, "artifact.path");
    invariant(
      await sha256Text(string(contents.get(path), path)) === artifact.sha256,
      `${path} hash disagrees with graph`,
    );
  }
  const artifactHashes = new Map(
    artifacts.map((
      artifact,
    ) => [String(artifact.path), String(artifact.sha256)]),
  );
  const repeatRuns = array(
    object(
      object(graph.repository, "repository").repeatability,
      "repeatability",
    ).runs,
    "repeatability.runs",
  ).map((item) => object(item, "repeat run"));
  for (const run of repeatRuns) {
    invariant(
      run.denoLockSha256 === artifactHashes.get("deno.lock") &&
        run.pnpmLockSha256 === artifactHashes.get("pnpm-lock.yaml"),
      `${run.id} repeat hashes are not bound to repository locks`,
    );
  }
  invariant(
    contents.get(REPORT_PATH) === await renderReport(graph),
    "runtime graph report is missing or stale",
  );
}

async function syntheticRepository(
  graph = makeGraph(),
): Promise<Map<string, string>> {
  const contents = makeRepositoryContents(graph);
  const artifacts = array(
    object(graph.repository, "repository").artifacts,
    "artifacts",
  ).map((item) => object(item, "artifact"));
  for (const artifact of artifacts) {
    artifact.sha256 = await sha256Text(
      string(contents.get(String(artifact.path)), String(artifact.path)),
    );
  }
  const hashes = new Map(
    artifacts.map((
      artifact,
    ) => [String(artifact.path), String(artifact.sha256)]),
  );
  for (
    const rawRun of array(
      object(
        object(graph.repository, "repository").repeatability,
        "repeatability",
      ).runs,
      "repeat runs",
    )
  ) {
    const run = object(rawRun, "repeat run");
    run.denoLockSha256 = hashes.get("deno.lock");
    run.pnpmLockSha256 = hashes.get("pnpm-lock.yaml");
  }
  contents.set(GRAPH_PATH, JSON.stringify(graph));
  contents.set(REPORT_PATH, await renderReport(graph));
  return contents;
}

async function expectRepositoryReject(
  mutator: (contents: Map<string, string>, graph: JsonRecord) => void,
  expected: string,
) {
  const graph = makeGraph();
  const contents = await syntheticRepository(graph);
  mutator(contents, graph);
  const result = await Promise.allSettled([
    validateRepositoryContents(contents, graph),
  ]);
  const failure = result[0];
  invariant(
    failure?.status === "rejected",
    "repository negative did not reject",
  );
  const message = (failure.reason as Error).message;
  invariant(
    message.includes(expected),
    `repository negative expected '${expected}', observed '${message}'`,
  );
}

Deno.test("realistic runtime graph controls discriminate official representations", async () => {
  validateGraph(makeGraph());
  for (
    const [candidate, range, expected] of [
      ["1.2.3", "*", true],
      ["1.2.3", "1.x", true],
      ["1.2.3", "1.2.x", true],
      ["1.2.3", "1.2", true],
      ["1.2.3", "2.x", false],
      ["1.2.3", "1.3.x", false],
      ["1.2.3", "1.x.3", true],
      ["1.2.3", "1.x.4", false],
      ["1.2.3", "1.2.3", true],
      ["1.2.3", "=1.2.3", true],
      ["1.2.3", ">1.2.2", true],
      ["1.2.3", ">=1.2.3", true],
      ["1.2.3", "<2", true],
      ["1.2.3", "<=1.2.3", true],
      ["1.2.3", "~1.2.0", true],
      ["1.2.3", "^1.0.0", true],
      ["0.2.3", "^0.2.0", true],
      ["0.0.3", "^0.0.3", true],
      ["1.2.3", "1.0.0 - 1.2.3", true],
      ["1.2.3", "<1 || >=1.2.3", true],
    ] as const
  ) {
    invariant(
      satisfiesRange(candidate, range) === expected,
      `semver fixture ${candidate} / ${range} was evaluated incorrectly`,
    );
  }
  exactSet(
    Object.keys(
      parsePnpmPeerSuffix(
        "(react-dom@19.2.0(react@19.2.0))(@types/react@19.2.7)",
      ),
    ),
    ["react-dom", "@types/react"],
    "nested pnpm peer suffix",
  );
  const selectedLatestGraph = makeGraph();
  const selectedLatest = packageAt(selectedLatestGraph, "clsx");
  object(selectedLatest.latestStable, "latest").version =
    selectedLatest.version;
  selectedLatest.newerReleases = [];
  validateGraph(selectedLatestGraph);
  expectReject(
    (graph) =>
      object(graph.selection, "selection").selectedAt = "2026-01-10T04:05:06Z",
    "preserve RFC3339",
  );
  expectReject(
    (graph) => packageAt(graph, "astro").version = "latest",
    "exact stable",
  );
  expectReject((graph) => {
    const astro = packageAt(graph, "astro");
    astro.newerReleases = [];
  }, "incomplete or vacuous");
  expectReject((graph) => {
    const newer = array(packageAt(graph, "astro").newerReleases, "newer");
    newer.push(clone(newer[0]));
  }, "strictly ordered");
  expectReject((graph) => {
    const edge = object(
      array(object(graph.repository, "repository").peerEdges, "peers")[0],
      "peer",
    );
    edge.manifestRange = "<1.0.0";
  }, "violates manifest range");
  expectReject((graph) => {
    const jsrNode = array(
      object(graph.repository, "repository").denoLockNodes,
      "Deno nodes",
    ).map((item) => object(item, "Deno node")).find((node) =>
      node.kind === "jsr" && Array.isArray(node.dependencies)
    );
    invariant(jsrNode, "JSR dependency fixture is absent");
    jsrNode.dependencies = ["@std/internal"];
  }, "JSR dependency tokens must retain");
  for (
    const forbidden of [
      "atlas",
      "better-auth",
      "@axe-core/playwright",
      "axe-core",
    ]
  ) {
    expectReject((graph) => {
      const inserted = clone(packageAt(graph, "astro"));
      inserted.id = forbidden;
      inserted.name = forbidden;
      array(graph.selectedPackages, "selectedPackages").push(inserted);
    }, "selected packages membership");
  }
  expectReject(
    (graph) =>
      packageAt(graph, "astro").publishedAt = "2026-01-08T04:05:06.789Z",
    "too young",
  );
  expectReject(
    (graph) => {
      const item = packageAt(graph, "typescript");
      item.version = "7.0.0";
      object(item.latestStable, "latest").version = "7.0.1";
      object(array(item.newerReleases, "newer")[0], "newer").version = "7.0.1";
      object(item.artifactEvidence, "evidence").source =
        "https://registry.npmjs.org/typescript/7.0.0";
    },
    "TypeScript 7",
  );
  expectReject((graph) => {
    const item = packageAt(graph, "eslint-plugin-astro");
    item.version = "3.1.0";
    object(item.latestStable, "latest").version = "3.1.1";
    object(array(item.newerReleases, "newer")[0], "newer").version = "3.1.1";
    object(item.artifactEvidence, "evidence").source =
      "https://registry.npmjs.org/eslint-plugin-astro/3.1.0";
  }, "ESLint plugin peer ranges are incompatible");
  expectReject(
    (graph) =>
      object(graph.repository, "repository").importEdges = array(
        object(graph.repository, "repository").importEdges,
        "edges",
      ).filter((item) => object(item, "edge").id !== "kysely-dialect"),
    "import edges membership",
  );
  expectReject(
    (graph) =>
      object(packageAt(graph, "deno").artifactEvidence, "evidence").kind =
        "npm-sri",
    "runtime release checksum",
  );
  expectReject(
    (graph) =>
      object(packageAt(graph, "astro").artifactEvidence, "evidence").source =
        "https://registry.npmjs.org/react/1.2.3",
    "selected manifest source is not exact",
  );
  expectReject(
    (graph) =>
      object(graph.corepack, "corepack").descriptor = `pnpm@1.2.3+sha512.${
        SRI.slice(7)
      }`,
    "128-character lowercase hex",
  );
  expectReject(
    (graph) => object(graph.corepack, "corepack").descriptor = "pnpm@1.2.3",
    "128-character lowercase hex",
  );
  expectReject(
    (graph) =>
      object(object(graph.corepack, "corepack").proof, "proof")
        .unsetEnvironment = [],
    "Corepack unset environment membership",
  );
  expectReject(
    (graph) =>
      object(graph.corepack, "corepack").registryIntegrity = `sha512-${
        "B".repeat(86)
      }==`,
    "disagrees with selected pnpm evidence",
  );
  const knownCorepackSri =
    "sha512-UhcFvOaJkk6scvWjWHEi82JonvZXHlW6gAdv1jfBETLs/62ib61Op5xIW/3b/T1aKlsFgFp36JPeceyKbMo7sQ==";
  const knownBytes = Uint8Array.from(
    atob(knownCorepackSri.slice(7)),
    (character) => character.charCodeAt(0),
  );
  invariant(
    Array.from(knownBytes, (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    ) ===
      "521705bce689924eac72f5a3587122f362689ef6571e55ba80076fd637c11132ecffada26fad4ea79c485bfddbfd3d5a2a5b05805a77e893de71ec8a6cca3bb1",
    "Corepack known SRI-to-hex conversion drifted",
  );
  expectReject(
    (graph) =>
      object(
        object(graph.repository, "repository").repeatability,
        "repeatability",
      ).identities = {
        deno: "1.2.2",
        node: "1.2.3",
        corepack: "1.2.3",
        pnpm: "1.2.3",
      },
    "repeat identity disagrees",
  );
  expectReject(
    (graph) =>
      object(object(graph.lifecycle, "lifecycle").deno, "deno").allowScripts = [
        "esbuild@1.2.3",
      ],
    "exact npm constraints",
  );
  expectReject(
    (graph) =>
      object(object(graph.lifecycle, "lifecycle").pnpm, "pnpm").allowBuilds =
        {},
    "hook policy and inventory disagree",
  );
  expectReject(
    (graph) =>
      object(object(graph.lifecycle, "lifecycle").pnpm, "pnpm")
        .dangerouslyAllowAllBuilds = true,
    "lifecycle policy is permissive",
  );
  expectReject(
    (graph) =>
      object(
        array(object(graph.lifecycle, "lifecycle").hookInventory, "hooks")[0],
        "hook",
      ).reviewed = false,
    "unreviewed",
  );
  expectReject((graph) => {
    object(object(graph.lifecycle, "lifecycle").pnpm, "pnpm").allowBuilds = {
      [`esbuild@${fixtureVersion("esbuild")}`]: true,
      fsevents: true,
    };
    object(
      array(object(graph.lifecycle, "lifecycle").hookInventory, "hooks")[1],
      "fsevents",
    ).allowed = true;
  }, "fsevents build must remain denied");
  expectReject(
    (graph) =>
      object(object(graph.lifecycle, "lifecycle").deno, "deno").allowScripts = [
        "npm:esbuild@1.2.3",
      ],
    "independently empty",
  );
  expectReject(
    (graph) =>
      object(packageAt(graph, "astro-react").artifactEvidence, "evidence")
        .value = sha(
          "a",
        ),
    "npm sha512 SRI",
  );
  expectReject(
    (graph) =>
      array(object(graph.repository, "repository").pnpmLockNodes, "nodes")
        .pop(),
    "optional dependency is absent",
  );
  expectReject(
    (graph) =>
      array(object(graph.repository, "repository").peerEdges, "peers").pop(),
    "peer edges membership",
  );
  expectReject(
    (graph) =>
      object(graph.repository, "repository").importEdges = array(
        object(graph.repository, "repository").importEdges,
        "edges",
      ).filter((item) => object(item, "edge").id !== "astro-eslint-a11y"),
    "import edges membership",
  );
  expectReject(
    (graph) =>
      object(
        array(object(graph.lifecycle, "lifecycle").hookInventory, "hooks")[0],
        "hook",
      ).packageName = "astro",
    "transitive hook inventory membership",
  );
  expectReject(
    (graph) =>
      object(
        array(object(graph.lifecycle, "lifecycle").hookInventory, "hooks")[0],
        "hook",
      ).packageName = "fsevents",
    "transitive hook inventory membership",
  );
  expectReject(
    (graph) =>
      object(graph.shadcn, "shadcn").buttonDirectImports = [
        "base-ui-react",
        "class-variance-authority",
        "cn-helper",
        "lucide-react",
      ],
    "Button direct imports membership",
  );
  expectReject(
    (graph) => object(graph.shadcn, "shadcn").cnHelperImports = ["clsx"],
    "cn helper imports membership",
  );
  expectReject(
    (graph) => object(graph.shadcn, "shadcn").sourceCommit = "main",
    "source commit must be immutable",
  );
  expectReject(
    (graph) =>
      object(graph.shadcn, "shadcn").registryInvocation =
        "pnpm dlx shadcn@latest add button",
    "mutable shadcn payload",
  );
  expectReject(
    (graph) =>
      object(graph.shadcn, "shadcn").generatedPayloads = ["button.tsx"],
    "mutable shadcn payload",
  );
  expectReject(
    (graph) =>
      object(graph.repository, "repository").lockRoots = [
        "deno.lock",
        "pnpm.lock",
      ],
    "root lock files membership",
  );
  expectReject(
    (graph) =>
      object(graph.repository, "repository").repeatability = {
        identities: {},
        runs: [],
        lifecycleExecutions: 0,
      },
    "missing or unknown fields",
  );
  expectReject(
    (graph) =>
      object(
        array(
          object(
            object(graph.repository, "repository").repeatability,
            "repeatability",
          ).runs,
          "runs",
        )[0],
        "run",
      ).command = "compare hashes",
    "executable proof",
  );
  expectReject(
    (graph) => {
      const run = object(
        array(
          object(
            object(graph.repository, "repository").repeatability,
            "repeatability",
          ).runs,
          "runs",
        )[0],
        "run",
      );
      object(run.setEnvironment, "setEnvironment").DENO_NO_PACKAGE_JSON =
        "false";
    },
    "environment or isolation proof",
  );
  expectReject(
    (graph) => {
      const run = object(
        array(
          object(
            object(graph.repository, "repository").repeatability,
            "repeatability",
          ).runs,
          "runs",
        )[1],
        "run",
      );
      delete object(run.setEnvironment, "setEnvironment").DENO_NO_PACKAGE_JSON;
    },
    "environment or isolation proof",
  );
  expectReject(
    (graph) => {
      const run = object(
        array(
          object(
            object(graph.repository, "repository").repeatability,
            "repeatability",
          ).runs,
          "runs",
        )[0],
        "run",
      );
      run.command = "deno ci --frozen";
    },
    "executable proof",
  );
  expectReject(
    (graph) => {
      const run = object(
        array(
          object(
            object(graph.repository, "repository").repeatability,
            "repeatability",
          ).runs,
          "runs",
        )[2],
        "run",
      );
      run.command = "corepack pnpm install --frozen-lockfile";
    },
    "executable proof",
  );
  expectReject(
    (graph) => {
      const run = object(
        array(
          object(
            object(graph.repository, "repository").repeatability,
            "repeatability",
          ).runs,
          "runs",
        )[3],
        "run",
      );
      delete object(run.setEnvironment, "setEnvironment")
        .COREPACK_ENABLE_NETWORK;
    },
    "environment or isolation proof",
  );
  expectReject(
    (graph) =>
      object(array(graph.ociImages, "images")[0], "image").tag = "latest",
    "official repository or tag",
  );
  expectReject(
    (graph) =>
      object(array(graph.ociImages, "images")[0], "image").mediaType =
        OCI_MANIFEST_MEDIA,
    "not an OCI index",
  );
  expectReject(
    (graph) => {
      const image = object(array(graph.ociImages, "images")[0], "image");
      array(image.descriptors, "platforms").splice(1, 1);
      image.descriptorIdentity = JSON.stringify(image.descriptors);
    },
    "required platforms",
  );
  expectReject((graph) => {
    const image = object(array(graph.ociImages, "images")[3], "postgres");
    object(array(image.descriptors, "descriptors")[2], "arm").variant = "v7";
    image.descriptorIdentity = JSON.stringify(image.descriptors);
  }, "required platforms are absent or duplicated");
  expectReject((graph) => {
    const image = object(array(graph.ociImages, "images")[1], "node");
    image.repository = "node";
  }, "official repository or tag");
  expectReject((graph) => {
    const image = object(array(graph.ociImages, "images")[2], "playwright");
    array(image.descriptors, "descriptors").push({
      kind: "runnable",
      os: "linux",
      architecture: "s390x",
      variant: null,
      digest: sha("8"),
      mediaType: OCI_MANIFEST_MEDIA,
      size: 1200,
      annotations: {},
    });
  }, "descriptor set disagrees");
  expectReject(
    (graph) => object(graph.proofStatus, "proof").runtimeBehavior = "proven",
    "cannot be marked proven",
  );
  expectReject(
    (graph) =>
      object(
        object(
          object(graph.proofStatus, "proof").followOnLockReuse,
          "reuse",
        )["FND-003B"],
        "FND-003B",
      ).mutation = "allowed",
    "lock mutation is forbidden",
  );

  const graph = makeGraph();
  const contents = await syntheticRepository(graph);
  validateGraph(graph);
  await validateRepositoryContents(contents, graph);
  const optionalDenoGraph = makeGraph();
  const optionalDenoNode = array(
    object(optionalDenoGraph.repository, "repository").denoLockNodes,
    "Deno nodes",
  ).map((item) => object(item, "Deno node")).find((node) =>
    node.key === `npm:hono@${fixtureVersion("hono")}`
  );
  invariant(optionalDenoNode, "hono Deno fixture is absent");
  optionalDenoNode.optionalPeers = [
    "hono",
    `legacy-hono@npm:hono@${fixtureVersion("hono")}`,
    `hono@${fixtureVersion("hono")}`,
  ];
  optionalDenoNode.tarball =
    "https://registry.npmjs.org/hono/-/hono-4.10.6.tgz";
  optionalDenoNode.deprecated = true;
  optionalDenoNode.scripts = true;
  optionalDenoNode.bin = true;
  validateGraph(optionalDenoGraph);
  const optionalDenoContents = await syntheticRepository(optionalDenoGraph);
  await validateRepositoryContents(optionalDenoContents, optionalDenoGraph);
  const transitivePeerGraph = makeGraph();
  const transitivePeerNode = array(
    object(transitivePeerGraph.repository, "repository").pnpmLockNodes,
    "pnpm nodes",
  ).map((item) => object(item, "pnpm node")).find((node) =>
    Object.keys(object(node.peerResolutions, "peer resolutions")).length > 0
  );
  invariant(transitivePeerNode, "peer-qualified pnpm fixture is absent");
  transitivePeerNode.transitivePeerDependencies = ["@types/react"];
  validateGraph(transitivePeerGraph);
  const transitivePeerContents = await syntheticRepository(transitivePeerGraph);
  await validateRepositoryContents(transitivePeerContents, transitivePeerGraph);
  oneMatch("covered", /covered/g, "global match fixture");
  await validateRepositoryGraph((path) =>
    Promise.resolve(string(contents.get(path), path))
  );
  const noJsrGraph = makeGraph();
  object(noJsrGraph.repository, "repository").denoLockNodes = array(
    object(noJsrGraph.repository, "repository").denoLockNodes,
    "nodes",
  ).filter((item) => object(item, "node").kind !== "jsr");
  const noJsrContents = await syntheticRepository(noJsrGraph);
  const noJsrLock = JSON.parse(
    string(noJsrContents.get("deno.lock"), "deno.lock"),
  );
  delete noJsrLock.jsr;
  noJsrContents.set("deno.lock", JSON.stringify(noJsrLock));
  for (
    const artifact of array(
      object(noJsrGraph.repository, "repository").artifacts,
      "artifacts",
    )
  ) {
    const record = object(artifact, "artifact");
    if (record.path === "deno.lock") {
      record.sha256 = await sha256Text(String(noJsrContents.get("deno.lock")));
    }
  }
  for (
    const run of array(
      object(
        object(noJsrGraph.repository, "repository").repeatability,
        "repeat",
      )
        .runs,
      "runs",
    )
  ) {
    object(run, "run").denoLockSha256 = array(
      object(noJsrGraph.repository, "repository").artifacts,
      "artifacts",
    ).map((item) => object(item, "artifact")).find((item) =>
      item.path === "deno.lock"
    )?.sha256;
  }
  noJsrContents.set(REPORT_PATH, await renderReport(noJsrGraph));
  await validateRepositoryContents(noJsrContents, noJsrGraph);
  let malformed = "";
  try {
    parseJson("{", "malformed fixture");
  } catch (error) {
    malformed = (error as Error).message;
  }
  invariant(
    malformed.includes("valid JSON"),
    "malformed JSON must fail closed",
  );
  let duplicate = "";
  try {
    parseJson('{"outer":{"value":1,"value":2}}', "duplicate fixture");
  } catch (error) {
    duplicate = (error as Error).message;
  }
  invariant(
    duplicate.includes("duplicate key"),
    "duplicate JSON must fail closed",
  );
  parseJson(
    '{"escaped\\u002dkey" : "value", "nested": [1]}',
    "escaped fixture",
  );
  const readResult = await Promise.allSettled([
    readRepositoryInputs(() => {
      throw new Error("synthetic read failure");
    }),
  ]);
  const readRejection = readResult[0];
  invariant(
    readRejection?.status === "rejected",
    "synthetic read must reject",
  );
  const readFailure = (readRejection.reason as Error).message;
  invariant(
    readFailure === "synthetic read failure",
    "unexpected reads must propagate",
  );
  await expectRepositoryReject((files) => {
    const packageJson = JSON.parse(
      string(files.get("package.json"), "package.json"),
    );
    packageJson.devDependencies.astro = "^5.15.5";
    files.set("package.json", JSON.stringify(packageJson));
  }, "package dependency is not exact");
  await expectRepositoryReject((files) => {
    const denoJson = JSON.parse(string(files.get("deno.json"), "deno.json"));
    denoJson.compilerOptions.strict = false;
    files.set("deno.json", JSON.stringify(denoJson));
  }, "base compilerOptions configuration drifted");
  await expectRepositoryReject(
    (files) =>
      files.set(
        "deno.lock",
        string(files.get("deno.lock"), "deno.lock").replace(
          '"npm:hono@4.10.6":"4.10.6",',
          "",
        ),
      ),
    "Deno lock specifiers membership",
  );
  await expectRepositoryReject(
    (files) =>
      files.set(
        "deno.lock",
        string(files.get("deno.lock"), "deno.lock").replace(
          '"dependencies":["kysely@0.28.8","postgres@3.4.7"]',
          '"dependencies":["kysely@0.28.8"]',
        ),
      ),
    "Deno dependency edges membership",
  );
  await expectRepositoryReject(
    (files) =>
      files.set(
        "deno.lock",
        string(files.get("deno.lock"), "deno.lock").replace(
          '"dependencies":["kysely@0.28.8","postgres@3.4.7"]',
          '"dependencies":["kysely@0.28.8","postgres@3.4.7","extra"]',
        ),
      ),
    "Deno dependency edges membership",
  );
  await expectRepositoryReject(
    (files) =>
      files.set(
        "deno.lock",
        string(files.get("deno.lock"), "deno.lock").replace(
          '"kysely@0.28.8":{"integrity"',
          '"kysely@0.28.7":{"integrity"',
        ),
      ),
    "Deno file and graph lock nodes membership",
  );
  await expectRepositoryReject(
    (files) =>
      files.set(
        "pnpm-workspace.yaml",
        string(files.get("pnpm-workspace.yaml"), "workspace").replace(
          `allowBuilds:\n  esbuild@${
            fixtureVersion("esbuild")
          }: true\n  fsevents: false`,
          "onlyBuiltDependencies:\n  - esbuild",
        ),
      ),
    "pnpm workspace top-level keys membership",
  );
  await expectRepositoryReject(
    (files) =>
      files.set(
        ".npmrc",
        "registry=https://registry.npmjs.org/\nsave-exact=true\n",
      ),
    "misplaced non-registry policy",
  );
  await expectRepositoryReject((files) => {
    const denoJson = JSON.parse(string(files.get("deno.json"), "deno.json"));
    denoJson.imports.astro = "npm:astro@1.2.3";
    files.set("deno.json", JSON.stringify(denoJson));
  }, "Deno imports membership");
  await expectRepositoryReject((files) => {
    const denoLock = JSON.parse(string(files.get("deno.lock"), "deno.lock"));
    denoLock.npm["astro@1.2.3"] = { integrity: SRI };
    files.set("deno.lock", JSON.stringify(denoLock));
  }, "Deno file and graph lock nodes membership");
  await expectRepositoryReject(
    (files) =>
      files.set(
        "pnpm-workspace.yaml",
        string(files.get("pnpm-workspace.yaml"), "workspace").replace(
          "    - arm64\n",
          "",
        ),
      ),
    "pnpm workspace is not canonical",
  );
  await expectRepositoryReject(
    (files) =>
      files.set(
        ".npmrc",
        "registry=https://registry.npmjs.org/\nsupported-architectures=linux\n",
      ),
    "misplaced non-registry policy",
  );
  await expectRepositoryReject(
    (files) =>
      files.set(
        "pnpm-lock.yaml",
        string(files.get("pnpm-lock.yaml"), "lock").replace(
          "lockfileVersion: '9.0'",
          "lockfileVersion: '8.0'",
        ),
      ),
    "pnpm lockfile version",
  );
  await expectRepositoryReject(
    (files) =>
      files.set(
        "pnpm-lock.yaml",
        string(files.get("pnpm-lock.yaml"), "lock").replace(
          "        version: 5.15.5",
          "        version: 5.15.4",
        ),
      ),
    "pnpm importer",
  );
  await expectRepositoryReject(
    (files) =>
      files.set(
        "pnpm-lock.yaml",
        string(files.get("pnpm-lock.yaml"), "lock").replace(
          "importers:\n  '.':",
          "importers:\n  extra: {}\n  '.':",
        ),
      ),
    "pnpm importer roots membership",
  );
  await expectRepositoryReject(
    (files) =>
      files.set(
        "pnpm-lock.yaml",
        string(files.get("pnpm-lock.yaml"), "lock").replace(
          "    optionalDependencies:\n      fsevents: 2.3.3",
          "    dependencies:\n      fsevents: 2.3.3",
        ),
      ),
    "snapshot optionalDependencies edges membership",
  );
  await expectRepositoryReject(
    (files) =>
      files.set(
        "pnpm-lock.yaml",
        string(files.get("pnpm-lock.yaml"), "lock").replace(
          "    os: [darwin]",
          "    os: [linux]",
        ),
      ),
    "package os membership",
  );
  await expectRepositoryReject(
    (files) =>
      files.set(
        "pnpm-lock.yaml",
        string(files.get("pnpm-lock.yaml"), "lock").replace(
          "      esbuild: 0.25.12",
          "      esbuild: 0.25.11",
        ),
      ),
    "snapshot dependencies edges membership",
  );
  await expectRepositoryReject(
    (files) =>
      files.set(
        "pnpm-lock.yaml",
        string(files.get("pnpm-lock.yaml"), "lock").replace(
          `resolution: {integrity: ${SRI}}`,
          `resolution: {integrity: sha512-${"B".repeat(86)}==}`,
        ),
      ),
    "pnpm package node",
  );
  await expectRepositoryReject(
    (files) =>
      files.set(
        "pnpm-lock.yaml",
        string(files.get("pnpm-lock.yaml"), "lock").replace(
          "\nsnapshots:\n",
          "\nflatSnapshots:\n",
        ),
      ),
    "pnpm snapshots section",
  );
  await expectRepositoryReject(
    (files) =>
      files.set(
        "pnpm-lock.yaml",
        string(files.get("pnpm-lock.yaml"), "lock").replace(
          "\nsnapshots:\n",
          `\n  'unmirrored@9.9.9':\n    resolution: {integrity: ${SRI}}\nsnapshots:\n`,
        ),
      ),
    "pnpm file and graph package nodes membership",
  );
  await expectRepositoryReject(
    (files) =>
      files.set(
        "pnpm-lock.yaml",
        string(files.get("pnpm-lock.yaml"), "lock").replace(
          "      esbuild: 0.25.12",
          "      esbuild: 0.25.12\n      unmirrored: 9.9.9",
        ),
      ),
    "snapshot dependencies edges membership",
  );
  await expectRepositoryReject(
    (files) =>
      files.set(
        "pnpm-workspace.yaml",
        `${
          string(files.get("pnpm-workspace.yaml"), "workspace")
        }trustLockfile: true\n`,
      ),
    "pnpm workspace top-level keys membership",
  );
  await expectRepositoryReject(
    (_files, syntheticGraph) =>
      object(
        array(
          object(syntheticGraph.repository, "repository").artifacts,
          "artifacts",
        )[0],
        "artifact",
      ).sha256 = sha("9"),
    "hash disagrees",
  );
  const staleReport = new Map(contents);
  staleReport.set(REPORT_PATH, "# stale\n");
  const reportResult = await Promise.allSettled([
    validateRepositoryContents(staleReport, graph),
  ]);
  invariant(
    reportResult[0]?.status === "rejected" &&
      (reportResult[0].reason as Error).message.includes(
        "report is missing or stale",
      ),
    "stale report must be rejected",
  );
});

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
) {
  const reader = readTextFile ?? Deno.readTextFile;
  const contents = await readRepositoryInputs(reader);
  const graph = parseJson(
    string(contents.get(GRAPH_PATH), GRAPH_PATH),
    GRAPH_PATH,
  );
  contents.set(REPORT_PATH, await reader(REPORT_PATH));
  validateGraph(graph);
  await validateRepositoryContents(contents, graph);
}

Deno.test("repository supplies the immutable FND-003 runtime graph", async () => {
  await validateRepositoryGraph();
});
