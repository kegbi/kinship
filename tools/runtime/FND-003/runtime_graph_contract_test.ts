// FND-003 freezes this dependency-free contract test before repository inputs exist.

import { createHash } from "node:crypto";

type JsonRecord = Record<string, unknown>;
type YamlValue = string | number | boolean | null | YamlValue[] | YamlRecord;
type YamlRecord = { [key: string]: YamlValue };

const GRAPH_PATH = "docs/validation/runtime-graph-fnd003.json";
const REPORT_PATH = "docs/validation/runtime-graph-fnd003.md";
const PROVENANCE_ROOT = "tools/runtime/FND-003/provenance/";
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
const MAX_COMPRESSED_EVIDENCE_BYTES = 32 * 1024 * 1024;
const MAX_DECOMPRESSED_EVIDENCE_BYTES = 64 * 1024 * 1024;

type EvidenceReader = (
  path: string,
) => Promise<ReadableStream<Uint8Array>>;

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

const DIRECT = {
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
} as const;
const RUNTIMES = ["deno", "node", "corepack", "pnpm"] as const;
const NAMES: Record<string, string> = {
  "astro-react": "@astrojs/react",
  "astro-node": "@astrojs/node",
  "astro-check": "@astrojs/check",
  "tailwind-vite": "@tailwindcss/vite",
  "hono-standard-validator": "@hono/standard-validator",
  "standard-schema-spec": "@standard-schema/spec",
  "coverage-v8": "@vitest/coverage-v8",
  "playwright-test": "@playwright/test",
  "base-ui-react": "@base-ui/react",
  "types-react": "@types/react",
  "types-react-dom": "@types/react-dom",
  "typescript-eslint-parser": "@typescript-eslint/parser",
  "scope-runtime": "@scope/runtime",
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
  "vitest-vite-dependency": ["vitest", "vite"],
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
  "astro-react-peer-astro": ["astro-react", "astro"],
  "astro-react-peer-react": ["astro-react", "react"],
  "astro-react-peer-react-dom": ["astro-react", "react-dom"],
  "astro-react-peer-types-react": ["astro-react", "types-react"],
  "astro-react-peer-types-react-dom": ["astro-react", "types-react-dom"],
  "react-dom-peer-react": ["react-dom", "react"],
  "astro-check-peer-typescript": ["astro-check", "typescript"],
  "validator-peer-hono": ["hono-standard-validator", "hono"],
  "dialect-peer-kysely": ["kysely-postgres-js", "kysely"],
  "coverage-peer-vitest": ["coverage-v8", "vitest"],
  "base-ui-peer-react": ["base-ui-react", "react"],
  "base-ui-peer-react-dom": ["base-ui-react", "react-dom"],
  "astro-node-peer-astro": ["astro-node", "astro"],
  "astro-eslint-peer-eslint": ["eslint-plugin-astro", "eslint"],
  "jsx-a11y-peer-eslint": ["eslint-plugin-jsx-a11y", "eslint"],
  "react-hooks-peer-eslint": ["eslint-plugin-react-hooks", "eslint"],
  "typescript-eslint-peer-eslint": ["typescript-eslint-parser", "eslint"],
  "typescript-eslint-peer-typescript": [
    "typescript-eslint-parser",
    "typescript",
  ],
};
const MANIFEST_RELATIONS: Record<
  string,
  "dependencies" | "optionalDependencies" | "peerDependencies"
> = {
  "astro-react-peer-astro": "peerDependencies",
  "astro-check-typescript": "peerDependencies",
  "validator-peer-hono": "peerDependencies",
  "dialect-peer-kysely": "peerDependencies",
  "astro-react-peer-react": "peerDependencies",
  "astro-react-peer-react-dom": "peerDependencies",
  "astro-react-peer-types-react": "peerDependencies",
  "astro-react-peer-types-react-dom": "peerDependencies",
  "react-dom-peer-react": "peerDependencies",
  "validator-standard-schema": "peerDependencies",
  "dialect-postgres": "peerDependencies",
  "tailwind-vite": "peerDependencies",
  "vitest-vite-dependency": "dependencies",
  "vitest-dom": "peerDependencies",
  "coverage-peer-vitest": "peerDependencies",
  "base-ui-peer-react": "peerDependencies",
  "base-ui-peer-react-dom": "peerDependencies",
  "astro-node-peer-astro": "peerDependencies",
  "astro-eslint-parser": "dependencies",
  "astro-eslint-peer-eslint": "peerDependencies",
  "jsx-a11y-peer-eslint": "peerDependencies",
  "react-hooks-peer-eslint": "peerDependencies",
  "typescript-eslint-peer-eslint": "peerDependencies",
  "typescript-eslint-peer-typescript": "peerDependencies",
};
const MANIFEST_RANGES: Record<string, string> = {
  "astro-react-peer-astro": "^5.0.0",
  "astro-react-peer-react": "^17.0.2 || ^18.0.0 || ^19.0.0",
  "astro-react-peer-react-dom": "^17.0.2 || ^18.0.0 || ^19.0.0",
  "astro-react-peer-types-react": "^17.0.50 || ^18.0.21 || ^19.0.0",
  "astro-react-peer-types-react-dom": "^17.0.17 || ^18.0.6 || ^19.0.0",
  "react-dom-peer-react": "^19.2.0",
  "astro-check-typescript": "^5.0.0",
  "validator-peer-hono": ">=3.9.0",
  "validator-standard-schema": "1.0.0",
  "dialect-peer-kysely": ">= 0.24.0 < 1",
  "dialect-postgres": "^3.4.0",
  "tailwind-vite": "^5.2.0 || ^6 || ^7",
  "vitest-vite-dependency": "^6.0.0 || ^7.0.0",
  "vitest-dom": "*",
  "coverage-peer-vitest": "4.0.8",
  "base-ui-peer-react": "^17 || ^18 || ^19",
  "base-ui-peer-react-dom": "^17 || ^18 || ^19",
  "astro-node-peer-astro": "^5.7.0",
  "astro-eslint-parser": "^1.3.0",
  "astro-eslint-peer-eslint": ">=8.57.0",
  "jsx-a11y-peer-eslint": "^3 || ^4 || ^5 || ^6 || ^7 || ^8 || ^9",
  "react-hooks-peer-eslint":
    "^3.0.0 || ^4.0.0 || ^5.0.0 || ^6.0.0 || ^7.0.0 || ^8.0.0-0 || ^9.0.0 || ^10.0.0",
  "typescript-eslint-peer-eslint": "^8.57.0 || ^9.0.0 || ^10.0.0",
  "typescript-eslint-peer-typescript": ">=4.8.4 <6.1.0",
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
  typescript: "5.9.3",
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
  "scope-runtime": "1.2.3",
  scheduler: "1.0.0",
};
const fixtureVersion = (id: string): string => FIXTURE_VERSIONS[id]!;

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

function strings(value: unknown, label: string): string[] {
  const result = array(value, label).map((item, index) =>
    string(item, `${label}[${index}]`)
  );
  invariant(new Set(result).size === result.length, `${label} has duplicates`);
  return result;
}

function exactKeys(
  value: JsonRecord,
  expected: readonly string[],
  label: string,
) {
  exactSet(Object.keys(value), expected, `${label} fields`);
}

function exactSet(
  actual: readonly string[],
  expected: readonly string[],
  label: string,
) {
  invariant(
    JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort()),
    `${label} membership is not exact`,
  );
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as JsonRecord).sort(([left], [right]) =>
        left.localeCompare(right)
      ).map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

function exactValue(actual: unknown, expected: unknown, label: string) {
  invariant(
    JSON.stringify(canonical(actual)) === JSON.stringify(canonical(expected)),
    `${label} disagrees with captured structure`,
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

interface ExactInstant {
  canonical: string;
  epochNanoseconds: bigint;
}

function instant(value: unknown, label: string): ExactInstant {
  const result = string(value, label);
  const match = RFC3339_UTC.exec(result);
  invariant(match, `${label} must preserve RFC3339 UTC precision`);
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{1,9})Z$/
    .exec(result)!;
  const [year, month, day, hour, minute, second] = parts.slice(1, 7).map(
    Number,
  );
  invariant(
    month! >= 1 && month! <= 12 && day! >= 1 && day! <= 31 && hour! <= 23 &&
      minute! <= 59 && second! <= 59,
    `${label} is not a valid instant`,
  );
  const epochMilliseconds = Date.UTC(
    year!,
    month! - 1,
    day!,
    hour!,
    minute!,
    second!,
  );
  const check = new Date(epochMilliseconds);
  invariant(
    check.getUTCFullYear() === year && check.getUTCMonth() === month! - 1 &&
      check.getUTCDate() === day && check.getUTCHours() === hour &&
      check.getUTCMinutes() === minute && check.getUTCSeconds() === second,
    `${label} is not a valid instant`,
  );
  const nanoseconds = BigInt(parts[7]!.padEnd(9, "0"));
  return {
    canonical: result,
    epochNanoseconds: BigInt(epochMilliseconds / 1000) * 1_000_000_000n +
      nanoseconds,
  };
}

function compareInstants(left: ExactInstant, right: ExactInstant): number {
  return left.epochNanoseconds < right.epochNanoseconds
    ? -1
    : left.epochNanoseconds > right.epochNanoseconds
    ? 1
    : 0;
}

function instantDate(value: ExactInstant): string {
  return value.canonical.slice(0, 10);
}

function parseJsonValue(text: string, label: string): unknown {
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
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
}

function parseJson(text: string, label: string): JsonRecord {
  return object(parseJsonValue(text, label), label);
}

interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease: Array<number | string>;
}

function parseSemVer(raw: string, label: string): SemVer {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/
      .exec(raw);
  invariant(match, `${label} contains unsupported semver ${raw}`);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]
      ? match[4].split(".").map((part) =>
        /^\d+$/.test(part) ? Number(part) : part
      )
      : [],
  };
}

function compareSemVer(left: SemVer, right: SemVer): number {
  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] !== right[key]) return Math.sign(left[key] - right[key]);
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return left.prerelease.length === right.prerelease.length
      ? 0
      : left.prerelease.length === 0
      ? 1
      : -1;
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index++) {
    const a = left.prerelease[index];
    const b = right.prerelease[index];
    if (a === undefined || b === undefined) return a === undefined ? -1 : 1;
    if (a === b) continue;
    if (typeof a === "number" && typeof b === "number") return Math.sign(a - b);
    if (typeof a === "number") return -1;
    if (typeof b === "number") return 1;
    return a < b ? -1 : 1;
  }
  return 0;
}

function compareVersions(left: string, right: string): number {
  return compareSemVer(
    parseSemVer(left, "left version"),
    parseSemVer(right, "right version"),
  );
}

interface PartialVersion {
  values: [number, number | null, number | null];
  prerelease: Array<number | string>;
}

function parsePartial(raw: string): PartialVersion {
  const match =
    /^(0|[1-9]\d*|x|\*)(?:\.(0|[1-9]\d*|x|\*))?(?:\.(0|[1-9]\d*|x|\*))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/i
      .exec(raw);
  invariant(match, `unsupported manifest range comparator ${raw}`);
  invariant(
    !/^(x|\*)$/i.test(match[1]!),
    `unsupported manifest range comparator ${raw}`,
  );
  const part = (value: string | undefined): number | null =>
    value === undefined || /^(x|\*)$/i.test(value) ? null : Number(value);
  return {
    values: [Number(match[1]), part(match[2]), part(match[3])],
    prerelease: match[4]
      ? match[4].split(".").map((value) =>
        /^\d+$/.test(value) ? Number(value) : value
      )
      : [],
  };
}

function boundary(partial: PartialVersion): SemVer {
  return {
    major: partial.values[0],
    minor: partial.values[1] ?? 0,
    patch: partial.values[2] ?? 0,
    prerelease: partial.prerelease,
  };
}

function evaluateComparator(candidate: SemVer, raw: string): boolean {
  if (raw === "" || raw === "*" || raw.toLowerCase() === "x") return true;
  const match = /^(\^|~|>=|<=|>|<|=)?(.+)$/.exec(raw);
  invariant(match, `unsupported manifest range comparator ${raw}`);
  const operator = match[1] ?? "=";
  const partial = parsePartial(match[2]!);
  const low = boundary(partial);
  const comparison = compareSemVer(candidate, low);
  if (operator === ">") return comparison > 0;
  if (operator === ">=") return comparison >= 0;
  if (operator === "<") return comparison < 0;
  if (operator === "<=") return comparison <= 0;
  if (operator === "=") {
    const [major, minor, patch] = partial.values;
    return candidate.major === major &&
      (minor === null || candidate.minor === minor) &&
      (patch === null || candidate.patch === patch) &&
      (partial.prerelease.length === 0 || comparison === 0);
  }
  const upper = operator === "~"
    ? { major: low.major, minor: low.minor + 1, patch: 0, prerelease: [] }
    : low.major > 0
    ? { major: low.major + 1, minor: 0, patch: 0, prerelease: [] }
    : low.minor > 0
    ? { major: 0, minor: low.minor + 1, patch: 0, prerelease: [] }
    : { major: 0, minor: 0, patch: low.patch + 1, prerelease: [] };
  return comparison >= 0 && compareSemVer(candidate, upper) < 0;
}

function tokenizeComparators(raw: string): string[] {
  const normalized = raw.trim().replace(/(>=|<=|>|<|=)\s+/g, "$1");
  const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(normalized);
  if (hyphen) return [`>=${hyphen[1]}`, `<=${hyphen[2]}`];
  const tokens = normalized.split(/\s+/);
  invariant(
    tokens.every((token) => token.length > 0),
    "manifest range is ambiguous",
  );
  return tokens;
}

function satisfiesRange(candidateRaw: string, range: string): boolean {
  string(range, "manifest range");
  const candidate = parseSemVer(candidateRaw, "candidate version");
  const alternatives = range.split("||").map(tokenizeComparators);
  invariant(alternatives.length > 0, "manifest range has no alternatives");
  return alternatives.map((tokens) =>
    tokens.every((token) => evaluateComparator(candidate, token))
  ).some(Boolean);
}

function splitInline(raw: string): string[] {
  const result: string[] = [];
  let start = 0;
  let quote = "";
  let depth = 0;
  for (let index = 0; index < raw.length; index++) {
    const character = raw[index]!;
    if (quote) {
      if (character === quote && raw[index - 1] !== "\\") quote = "";
    } else if (character === '"' || character === "'") quote = character;
    else if (character === "{" || character === "[") depth++;
    else if (character === "}" || character === "]") depth--;
    else if (character === "," && depth === 0) {
      result.push(raw.slice(start, index).trim());
      start = index + 1;
    }
  }
  invariant(!quote && depth === 0, "YAML inline value is unbalanced");
  result.push(raw.slice(start).trim());
  return result.filter((item) => item.length > 0);
}

function yamlColon(raw: string): number {
  let quote = "";
  let depth = 0;
  for (let index = 0; index < raw.length; index++) {
    const character = raw[index]!;
    if (quote) {
      if (character === quote && raw[index - 1] !== "\\") quote = "";
    } else if (character === '"' || character === "'") quote = character;
    else if (character === "{" || character === "[") depth++;
    else if (character === "}" || character === "]") depth--;
    else if (character === ":" && depth === 0) return index;
  }
  return -1;
}

function parseYamlScalar(raw: string): YamlValue {
  const value = raw.trim();
  invariant(value.length > 0, "YAML scalar is empty");
  invariant(
    !/^(?:[!&*]|<<\s*:)/.test(value),
    "YAML aliases, tags, anchors, and merge keys are forbidden",
  );
  if (value === "{}") return {};
  if (value === "[]") return [];
  if (value.startsWith("{") && value.endsWith("}")) {
    const result: YamlRecord = {};
    for (const entry of splitInline(value.slice(1, -1))) {
      const delimiter = yamlColon(entry);
      invariant(delimiter > 0, "YAML inline map entry is malformed");
      const key = String(parseYamlScalar(entry.slice(0, delimiter)));
      invariant(!(key in result), `YAML contains duplicate key ${key}`);
      result[key] = parseYamlScalar(entry.slice(delimiter + 1));
    }
    return result;
  }
  if (value.startsWith("[") && value.endsWith("]")) {
    return splitInline(value.slice(1, -1)).map(parseYamlScalar);
  }
  if (value.startsWith('"')) {
    invariant(value.endsWith('"'), "YAML double-quoted scalar is malformed");
    return JSON.parse(value) as string;
  }
  if (value.startsWith("'")) {
    invariant(value.endsWith("'"), "YAML single-quoted scalar is malformed");
    return value.slice(1, -1).replaceAll("''", "'");
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~") return null;
  if (/^-?(?:0|[1-9]\d*)$/.test(value)) return Number(value);
  invariant(
    !/[\[\]{}]/.test(value),
    "YAML plain scalar contains unsupported syntax",
  );
  return value;
}

interface YamlLine {
  indent: number;
  text: string;
}

function parseYaml(text: string, label: string): JsonRecord {
  invariant(text.length <= 2_000_000, `${label} exceeds size limit`);
  invariant(
    !text.includes("\r") || !text.replaceAll("\r\n", "").includes("\r"),
    `${label} contains a lone carriage return`,
  );
  invariant(
    ![...text].some((character) => {
      const code = character.charCodeAt(0);
      return code === 0x7f || code < 0x09 || code === 0x0b || code === 0x0c ||
        (code >= 0x0e && code <= 0x1f);
    }),
    `${label} contains a control character`,
  );
  invariant(!text.includes("\t"), `${label} contains a tab`);
  const lines: YamlLine[] = text.replaceAll("\r\n", "\n").split("\n")
    .filter((line) => line.trim().length > 0).map((line) => {
      const indent = line.length - line.trimStart().length;
      invariant(indent % 2 === 0, `${label} indentation is unsupported`);
      const body = line.slice(indent);
      invariant(
        !/^(?:---|\.\.\.|%|#|[>|?])/.test(body) && !body.includes(" #"),
        `${label} contains unsupported YAML construct`,
      );
      return { indent, text: body };
    });
  invariant(
    lines.length > 0 && lines.length <= 100_000,
    `${label} is empty or exceeds line limit`,
  );
  let cursor = 0;
  const parseBlock = (indent: number): YamlValue => {
    const isList = lines[cursor]?.indent === indent &&
      lines[cursor]?.text.startsWith("- ");
    if (isList) {
      const result: YamlValue[] = [];
      while (
        cursor < lines.length && lines[cursor]!.indent === indent &&
        lines[cursor]!.text.startsWith("- ")
      ) {
        result.push(parseYamlScalar(lines[cursor]!.text.slice(2)));
        cursor++;
      }
      return result;
    }
    const result: YamlRecord = {};
    while (
      cursor < lines.length && lines[cursor]!.indent === indent &&
      !lines[cursor]!.text.startsWith("- ")
    ) {
      const line = lines[cursor]!;
      const delimiter = yamlColon(line.text);
      invariant(delimiter > 0, `${label} map entry is malformed`);
      const keyValue = parseYamlScalar(line.text.slice(0, delimiter));
      invariant(typeof keyValue === "string", `${label} key must be a string`);
      invariant(keyValue !== "<<", `${label} merge keys are forbidden`);
      invariant(
        !(keyValue in result),
        `${label} contains duplicate key ${keyValue}`,
      );
      const remainder = line.text.slice(delimiter + 1).trim();
      cursor++;
      if (remainder) result[keyValue] = parseYamlScalar(remainder);
      else if (cursor < lines.length && lines[cursor]!.indent > indent) {
        invariant(
          lines[cursor]!.indent === indent + 2,
          `${label} indentation jumped levels`,
        );
        result[keyValue] = parseBlock(indent + 2);
      } else result[keyValue] = null;
    }
    return result;
  };
  const parsed = parseBlock(lines[0]!.indent);
  invariant(cursor === lines.length, `${label} has a stray or malformed block`);
  return object(parsed, label);
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  invariant(
    bytes.buffer instanceof ArrayBuffer,
    "hash input must be ArrayBuffer-backed",
  );
  const hash = await crypto.subtle.digest(
    "SHA-256",
    bytes as Uint8Array<ArrayBuffer>,
  );
  return `sha256:${
    Array.from(
      new Uint8Array(hash),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("")
  }`;
}

async function sha256Text(text: string): Promise<string> {
  return await sha256Bytes(new TextEncoder().encode(text));
}

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(
    new CompressionStream("gzip"),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function byteStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function sizedByteStream(size: number): ReadableStream<Uint8Array> {
  let remaining = size;
  return new ReadableStream({
    pull(controller) {
      if (remaining === 0) {
        controller.close();
        return;
      }
      const length = Math.min(1024 * 1024, remaining);
      controller.enqueue(new Uint8Array(length).fill(120));
      remaining -= length;
    },
  });
}

async function readBounded(
  stream: ReadableStream<Uint8Array>,
  maximum: number,
  label: string,
  allocate: (size: number) => Uint8Array = (size) => new Uint8Array(size),
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const bytes = allocate(maximum);
  invariant(
    bytes.byteLength === maximum,
    `${label} allocator returned an invalid backing buffer`,
  );
  let size = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      invariant(
        result.value.byteLength <= maximum - size,
        `${label} exceeds ${maximum} byte limit`,
      );
      bytes.set(result.value, size);
      size += result.value.byteLength;
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  return bytes.subarray(0, size);
}

function sharedViewStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset === bytes.byteLength) {
        controller.close();
        return;
      }
      const end = Math.min(offset + 64 * 1024, bytes.byteLength);
      controller.enqueue(bytes.subarray(offset, end));
      offset = end;
    },
  });
}

async function gunzipBoundedBytes(
  bytes: Uint8Array,
  allocate?: (size: number) => Uint8Array,
): Promise<Uint8Array> {
  const stream = sharedViewStream(bytes).pipeThrough(
    new DecompressionStream("gzip") as TransformStream<Uint8Array, Uint8Array>,
  );
  return await readBounded(
    stream,
    MAX_DECOMPRESSED_EVIDENCE_BYTES,
    "decompressed provenance artifact",
    allocate,
  );
}

async function gunzipBounded(bytes: Uint8Array): Promise<string> {
  const body = await gunzipBoundedBytes(bytes);
  return new TextDecoder("utf-8", { fatal: true }).decode(body);
}

function safeEvidenceUrl(kind: string, raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("provenance source URL is invalid");
  }
  invariant(
    url.protocol === "https:" && url.username === "" && url.password === "" &&
      url.search === "" && url.hash === "",
    "provenance source URL must be credential-free exact HTTPS",
  );
  invariant(
    !url.pathname.split("/").includes("latest"),
    "provenance source URL contains a mutable latest path",
  );
  const allowed = kind === "npm-packument"
    ? url.origin === "https://registry.npmjs.org" &&
      /^\/(?:%40[^/]+%2F[^/]+|@[^/]+%2F[^/]+|[^/]+)$/.test(url.pathname)
    : kind === "official-release-index"
    ? (url.href === "https://api.github.com/repos/denoland/deno/releases" ||
      url.href === "https://api.github.com/repos/nodejs/node/releases" ||
      url.href === "https://nodejs.org/dist/index.json")
    : kind === "official-release-detail"
    ? url.origin === "https://api.github.com" &&
      /^\/repos\/nodejs\/node\/releases\/tags\/v\d+\.\d+\.\d+$/.test(
        url.pathname,
      )
    : kind === "release-checksum"
    ? (url.origin === "https://github.com" &&
      /^\/denoland\/deno\/releases\/download\/v\d+\.\d+\.\d+\/deno-x86_64-pc-windows-msvc\.zip\.sha256sum$/
        .test(
          url.pathname,
        )) ||
      (url.origin === "https://nodejs.org" &&
        /^\/dist\/v\d+\.\d+\.\d+\/SHASUMS256\.txt$/.test(url.pathname))
    : kind === "immutable-source"
    ? url.origin === "https://raw.githubusercontent.com" &&
      /^\/shadcn-ui\/ui\/[0-9a-f]{40}\/.+/.test(url.pathname)
    : kind === "oci-index-response"
    ? (url.origin === "https://registry-1.docker.io" ||
      url.origin === "https://mcr.microsoft.com") &&
      /^\/v2\/.+\/manifests\/[^/]+$/.test(url.pathname)
    : false;
  invariant(allowed, "provenance source origin or path is not allowlisted");
  return url;
}

interface EvidenceAuthority {
  descriptor(id: string): JsonRecord;
  npmPackument(id: string): JsonRecord;
  releaseIndex(id: string): JsonRecord[];
  releaseDetail(id: string): JsonRecord;
  checksumRows(id: string): string[][];
  sourceImports(id: string): string[];
  ociIndex(id: string): JsonRecord;
  assertAllUsed(): void;
}

interface EvidenceUseSets {
  metadata: Set<string>;
  claims: Set<string>;
}

interface EvidenceIngestionEvent {
  descriptorId: string;
  action: "acquire" | "retain" | "release" | "cancel";
  representation: "decoded" | "normalized";
  bytes: number;
}

interface EvidenceLoadOptions {
  observe?: (event: EvidenceIngestionEvent) => void;
  compressedLimit?: number;
  decompressedLimit?: number;
  rawLeaseFactory?: RawLeaseFactory;
}

interface NormalizedEvidence {
  kind: string;
  value: unknown;
}

type RawRepresentation = "compressed" | "decompressed" | "decoded";

interface RawLease<T> {
  withValue<R>(use: (value: T) => R): R;
  update(change: (value: T) => T): void;
  retain(): RawLease<T>;
  release(): void;
}

interface RawLeaseProbe {
  readonly kind: RawRepresentation;
  readonly identity: symbol;
  retain(): RawLeaseProbe;
  release(): void;
}

interface RawLeaseScope {
  acquire<T>(kind: RawRepresentation, value: T): RawLease<T>;
}

interface RawLeaseFactory {
  run<T>(
    descriptorId: string,
    work: (scope: RawLeaseScope) => Promise<T>,
  ): Promise<T>;
}

interface TrackedRawLeaseFactory extends RawLeaseFactory {
  assertIdle(): void;
  startedDescriptorIds(): string[];
}

interface RawLeaseFactoryOptions {
  // The control owns lease capabilities. It does not claim visibility into V8
  // garbage collection, native stream queues, or arbitrary primitive copies.
  onAcquire?: (
    descriptorId: string,
    kind: RawRepresentation,
    lease: RawLeaseProbe,
  ) => void;
}

const RAW_RELEASED = Symbol("raw lease released");

function createTrackedRawLeaseFactory(
  options: RawLeaseFactoryOptions = {},
): TrackedRawLeaseFactory {
  interface Cell {
    kind: RawRepresentation;
    identity: symbol;
    value: unknown | typeof RAW_RELEASED;
    references: number;
  }
  interface Token {
    active: boolean;
    cell: Cell;
  }
  interface Group {
    descriptorId: string;
    cells: Set<Cell>;
    tokens: Set<Token>;
  }
  let active: Group | undefined;
  const started: string[] = [];

  const run = async <T>(
    descriptorId: string,
    work: (scope: RawLeaseScope) => Promise<T>,
  ): Promise<T> => {
    invariant(
      active === undefined,
      "a raw descriptor lease is already active",
    );
    const group: Group = {
      descriptorId,
      cells: new Set(),
      tokens: new Set(),
    };
    active = group;
    started.push(descriptorId);

    const makeToken = (cell: Cell): Token => {
      const token: Token = { active: true, cell };
      cell.references += 1;
      group.tokens.add(token);
      return token;
    };
    const liveValue = <T>(token: Token): T => {
      invariant(
        token.active && token.cell.value !== RAW_RELEASED,
        "raw lease is no longer active",
      );
      return token.cell.value as T;
    };
    const releaseToken = (token: Token): void => {
      liveValue(token);
      token.active = false;
      group.tokens.delete(token);
      token.cell.references -= 1;
      if (token.cell.references === 0) token.cell.value = RAW_RELEASED;
    };
    const makeProbe = (
      cell: Cell,
      token: Token = makeToken(cell),
    ): RawLeaseProbe => ({
      kind: cell.kind,
      identity: cell.identity,
      retain(): RawLeaseProbe {
        liveValue(token);
        return makeProbe(cell);
      },
      release(): void {
        releaseToken(token);
      },
    });
    const makeLease = <T>(cell: Cell): RawLease<T> => {
      const token = makeToken(cell);
      return {
        withValue<R>(use: (value: T) => R): R {
          return use(liveValue(token));
        },
        update(change: (value: T) => T): void {
          cell.value = change(liveValue(token));
        },
        retain(): RawLease<T> {
          liveValue(token);
          return makeLease<T>(cell);
        },
        release(): void {
          releaseToken(token);
        },
      };
    };
    const scope: RawLeaseScope = {
      acquire<T>(kind: RawRepresentation, value: T): RawLease<T> {
        const cell: Cell = {
          kind,
          identity: Symbol(`${descriptorId}:${kind}`),
          value,
          references: 0,
        };
        group.cells.add(cell);
        const lease = makeLease<T>(cell);
        const probeToken = makeToken(cell);
        const probe = makeProbe(cell, probeToken);
        try {
          options.onAcquire?.(descriptorId, kind, probe);
        } finally {
          if (probeToken.active) releaseToken(probeToken);
        }
        return lease;
      },
    };

    let result: T | undefined;
    let failure: unknown;
    let failed = false;
    try {
      result = await work(scope);
    } catch (error) {
      failed = true;
      failure = error;
    }
    const leakedKinds = [...group.tokens]
      .filter((token) => token.active)
      .map((token) => token.cell.kind)
      .sort();
    for (const token of group.tokens) token.active = false;
    for (const cell of group.cells) cell.value = RAW_RELEASED;
    group.tokens.clear();
    active = undefined;
    if (leakedKinds.length > 0) {
      const leak = `${descriptorId} retained raw lease(s): ${
        leakedKinds.join(", ")
      }`;
      if (failed) throw new Error(`${String(failure)}; ${leak}`);
      throw new Error(leak);
    }
    if (failed) throw failure;
    return result as T;
  };

  return {
    run,
    assertIdle(): void {
      invariant(active === undefined, "raw lease factory is not idle");
    },
    startedDescriptorIds(): string[] {
      return [...started];
    },
  };
}

function assertNormalizedEvidenceValue(value: unknown, label: string): void {
  invariant(
    value === null || ["string", "number", "boolean"].includes(typeof value) ||
      Array.isArray(value) ||
      (typeof value === "object" &&
        Object.getPrototypeOf(value) === Object.prototype),
    `${label} retained a raw or executable evidence holder`,
  );
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertNormalizedEvidenceValue(item, `${label}[${index}]`)
    );
  } else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      assertNormalizedEvidenceValue(item, `${label}.${key}`);
    }
  }
}

function presentFields(
  value: JsonRecord,
  fields: readonly string[],
): JsonRecord {
  return Object.fromEntries(
    fields.filter((field) => Object.hasOwn(value, field)).map((field) => [
      field,
      clone(value[field]),
    ]),
  );
}

function normalizeNpmPackument(value: unknown): JsonRecord {
  const packument = object(value, "npm packument");
  const versions = object(packument.versions, "npm packument versions");
  return {
    ...presentFields(packument, ["_id", "_rev", "name", "dist-tags", "time"]),
    versions: Object.fromEntries(
      Object.entries(versions).map(([itemVersion, raw]) => [
        itemVersion,
        presentFields(object(raw, `${itemVersion} manifest`), [
          "name",
          "version",
          "dist",
          "dependencies",
          "optionalDependencies",
          "peerDependencies",
          "peerDependenciesMeta",
          "scripts",
          "engines",
          "os",
          "cpu",
          "libc",
          "deprecated",
          "bundledDependencies",
          "bin",
        ]),
      ]),
    ),
  };
}

function normalizedJsonRows(
  value: unknown,
  fields: readonly string[],
  label: string,
): JsonRecord[] {
  return array(value, label).map((raw, index) =>
    presentFields(object(raw, `${label}[${index}]`), fields)
  );
}

const NODE_INDEX_FIELDS = [
  "version",
  "date",
  "files",
  "npm",
  "v8",
  "uv",
  "zlib",
  "openssl",
  "modules",
  "lts",
  "security",
] as const;

function normalizeNodeIndex(value: unknown): JsonRecord[] {
  return array(value, "Node index").map((raw, index) => {
    const row = object(raw, `Node index row[${index}]`);
    invariant(
      ["version", "date", "files", "lts"].every((key) => key in row) &&
        Object.keys(row).every((key) =>
          NODE_INDEX_FIELDS.includes(
            key as (typeof NODE_INDEX_FIELDS)[number],
          )
        ),
      "Node index row fields membership is not exact",
    );
    return presentFields(row, NODE_INDEX_FIELDS);
  });
}

function normalizeOciIndex(value: unknown): JsonRecord {
  const index = object(value, "OCI index response");
  exactKeys(
    index,
    ["schemaVersion", "mediaType", "manifests"],
    "OCI index",
  );
  return {
    ...presentFields(index, ["schemaVersion", "mediaType"]),
    manifests: array(index.manifests, "OCI index manifests").map(
      (raw, descriptorIndex) => {
        const descriptor = object(
          raw,
          `OCI index manifests[${descriptorIndex}]`,
        );
        invariant(
          ["mediaType", "digest", "size", "platform"].every((key) =>
            key in descriptor
          ) && Object.keys(descriptor).every((key) =>
            ["mediaType", "digest", "size", "platform", "annotations"]
              .includes(key)
          ),
          "OCI descriptor fields membership is not exact",
        );
        const platform = object(
          descriptor.platform,
          `OCI index manifests[${descriptorIndex}].platform`,
        );
        invariant(
          ["os", "architecture"].every((key) => key in platform) &&
            Object.keys(platform).every((key) =>
              ["os", "architecture", "variant"].includes(key)
            ),
          "OCI descriptor platform fields membership is not exact",
        );
        return presentFields(descriptor, [
          "mediaType",
          "digest",
          "size",
          "platform",
          "annotations",
        ]);
      },
    ),
  };
}

function normalizeEvidenceBody(
  descriptor: JsonRecord,
  body: string,
): NormalizedEvidence {
  const kind = string(descriptor.kind, "provenance kind");
  if (kind === "npm-packument") {
    return {
      kind,
      value: normalizeNpmPackument(
        parseJsonValue(body, "npm packument response"),
      ),
    };
  }
  if (kind === "official-release-index") {
    const source = string(descriptor.sourceUrl, "release index source");
    const parsed = parseJsonValue(body, "official release index");
    return {
      kind,
      value: source === "https://nodejs.org/dist/index.json"
        ? normalizeNodeIndex(parsed)
        : normalizedJsonRows(
          parsed,
          ["tag_name", "published_at", "draft", "prerelease"],
          "official release index",
        ),
    };
  }
  if (kind === "official-release-detail") {
    return {
      kind,
      value: presentFields(
        parseJson(body, "official release detail"),
        ["tag_name", "published_at", "draft", "prerelease"],
      ),
    };
  }
  if (kind === "release-checksum") {
    return {
      kind,
      value: body.trim().split(/\r?\n/).map((line) => line.trim().split(/\s+/)),
    };
  }
  if (kind === "immutable-source") {
    return { kind, value: packageImports(body) };
  }
  if (kind === "oci-index-response") {
    return {
      kind,
      value: normalizeOciIndex(parseJson(body, "OCI index response")),
    };
  }
  throw new Error(`${kind} evidence kind has no normalizer`);
}

function incrementalSha256() {
  const hash = createHash("sha256");
  return {
    update(bytes: Uint8Array): void {
      hash.update(bytes);
    },
    digest(): string {
      return `sha256:${hash.digest("hex")}`;
    },
  };
}

function countedHashingStream(
  maximum: number,
  label: string,
  hash: ReturnType<typeof incrementalSha256>,
  count: { value: number },
): TransformStream<Uint8Array, Uint8Array> {
  return new TransformStream({
    transform(chunk, controller) {
      invariant(
        chunk.byteLength <= maximum - count.value,
        `${label} exceeds ${maximum} byte limit`,
      );
      hash.update(chunk);
      count.value += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
}

async function loadEvidence(
  graph: JsonRecord,
  readEvidence: EvidenceReader,
  selectedAt: ExactInstant,
  options: EvidenceLoadOptions = {},
): Promise<EvidenceAuthority> {
  const descriptors = array(graph.provenance, "provenance").map((raw, index) =>
    object(raw, `provenance[${index}]`)
  );
  const byId = new Map<string, JsonRecord>();
  const claims = new Map<string, NormalizedEvidence>();
  const paths = new Set<string>();
  const used: EvidenceUseSets = {
    metadata: new Set<string>(),
    claims: new Set<string>(),
  };
  const compressedLimit = options.compressedLimit ??
    MAX_COMPRESSED_EVIDENCE_BYTES;
  const decompressedLimit = options.decompressedLimit ??
    MAX_DECOMPRESSED_EVIDENCE_BYTES;
  invariant(
    compressedLimit > 0 && decompressedLimit > 0,
    "evidence limits must be positive",
  );
  const rawLeaseFactory = options.rawLeaseFactory ??
    createTrackedRawLeaseFactory();
  let latestRetrieval: ExactInstant | undefined;
  for (const descriptor of descriptors) {
    exactKeys(descriptor, [
      "id",
      "kind",
      "path",
      "compression",
      "sourceUrl",
      "retrievedAt",
      "contentSha256",
      "artifactSha256",
    ], "provenance descriptor");
    const id = string(descriptor.id, "provenance id");
    invariant(!byId.has(id), "provenance IDs must be unique");
    const path = string(descriptor.path, `${id}.path`);
    invariant(
      path.startsWith(PROVENANCE_ROOT) && path.endsWith(".gz") &&
        !path.includes("\\") && !path.split("/").includes(".."),
      `${id} provenance path is unsafe`,
    );
    invariant(!paths.has(path), "provenance artifact paths must be unique");
    paths.add(path);
    invariant(
      descriptor.compression === "gzip",
      `${id} provenance compression is unsupported`,
    );
    safeEvidenceUrl(
      string(descriptor.kind, `${id}.kind`),
      string(descriptor.sourceUrl, `${id}.sourceUrl`),
    );
    const retrievedAt = instant(descriptor.retrievedAt, `${id}.retrievedAt`);
    invariant(
      compareInstants(retrievedAt, selectedAt) <= 0 &&
        selectedAt.epochNanoseconds - retrievedAt.epochNanoseconds <=
          30n * 60n * 1_000_000_000n,
      `${id} retrieval is outside the 30-minute capture window`,
    );
    if (!latestRetrieval || compareInstants(retrievedAt, latestRetrieval) > 0) {
      latestRetrieval = retrievedAt;
    }
    await rawLeaseFactory.run(id, async (scope) => {
      let decodedBytes = 0;
      const compressedCount = { value: 0 };
      const decompressedCount = { value: 0 };
      options.observe?.({
        descriptorId: id,
        action: "acquire",
        representation: "decoded",
        bytes: 0,
      });
      const decodedLease = scope.acquire("decoded", "");
      try {
        const compressedHash = incrementalSha256();
        const contentHash = incrementalSha256();
        const decoded = (await readEvidence(path)).pipeThrough(
          countedHashingStream(
            compressedLimit,
            `${id} compressed provenance artifact`,
            compressedHash,
            compressedCount,
          ),
        ).pipeThrough(
          new DecompressionStream("gzip") as TransformStream<
            Uint8Array,
            Uint8Array
          >,
        ).pipeThrough(
          countedHashingStream(
            decompressedLimit,
            `${id} decompressed provenance artifact`,
            contentHash,
            decompressedCount,
          ),
        ).pipeThrough(new TextDecoderStream("utf-8", { fatal: true }));
        const reader = decoded.getReader();
        try {
          while (true) {
            const result = await reader.read();
            if (result.done) break;
            decodedLease.update((body) => body + result.value);
            decodedBytes = decompressedCount.value;
          }
          invariant(
            compressedHash.digest() ===
              digest(descriptor.artifactSha256, `${id}.artifactSha256`),
            `${id} compressed artifact hash drifted`,
          );
          invariant(
            contentHash.digest() ===
              digest(descriptor.contentSha256, `${id}.contentSha256`),
            `${id} official response content hash drifted`,
          );
          const normalized = decodedLease.withValue((body) =>
            normalizeEvidenceBody(descriptor, body)
          );
          assertNormalizedEvidenceValue(
            normalized.value,
            `${id} normalized claim`,
          );
          claims.set(id, normalized);
          options.observe?.({
            descriptorId: id,
            action: "retain",
            representation: "normalized",
            bytes: 0,
          });
          byId.set(id, clone(descriptor));
        } catch (error) {
          await reader.cancel(error).catch(() => undefined);
          throw error;
        } finally {
          reader.releaseLock();
        }
      } catch (error) {
        decodedBytes = decompressedCount.value;
        options.observe?.({
          descriptorId: id,
          action: "cancel",
          representation: "decoded",
          bytes: decodedBytes,
        });
        throw error;
      } finally {
        decodedLease.release();
        options.observe?.({
          descriptorId: id,
          action: "release",
          representation: "decoded",
          bytes: decodedBytes,
        });
      }
    });
  }
  invariant(
    latestRetrieval?.canonical === selectedAt.canonical,
    "selection time must equal the latest provenance retrieval",
  );
  return {
    descriptor(id: string): JsonRecord {
      const descriptor = object(byId.get(id), `provenance ${id}`);
      used.metadata.add(id);
      return descriptor;
    },
    npmPackument(id: string): JsonRecord {
      return object(
        normalizedClaim(claims, used.claims, id, "npm-packument"),
        id,
      );
    },
    releaseIndex(id: string): JsonRecord[] {
      return array(
        normalizedClaim(claims, used.claims, id, "official-release-index"),
        id,
      ).map((raw) => object(raw, `${id} row`));
    },
    releaseDetail(id: string): JsonRecord {
      return object(
        normalizedClaim(claims, used.claims, id, "official-release-detail"),
        id,
      );
    },
    checksumRows(id: string): string[][] {
      return array(
        normalizedClaim(claims, used.claims, id, "release-checksum"),
        id,
      ).map((raw, index) => strings(raw, `${id}[${index}]`));
    },
    sourceImports(id: string): string[] {
      return strings(
        normalizedClaim(claims, used.claims, id, "immutable-source"),
        id,
      );
    },
    ociIndex(id: string): JsonRecord {
      return object(
        normalizedClaim(claims, used.claims, id, "oci-index-response"),
        id,
      );
    },
    assertAllUsed(): void {
      exactSet(
        [...used.metadata],
        [...byId.keys()],
        "provenance metadata membership",
      );
      exactSet(
        [...used.claims],
        [...byId.keys()],
        "provenance claim membership",
      );
    },
  };
}

function normalizedClaim(
  claims: Map<string, NormalizedEvidence>,
  used: Set<string>,
  id: string,
  kind: string,
): unknown {
  const claim = claims.get(id);
  invariant(claim, `normalized provenance claim ${id} is absent`);
  invariant(claim.kind === kind, `${id} normalized evidence kind is incorrect`);
  used.add(id);
  return claim.value;
}

function evidenceKind(
  authority: EvidenceAuthority,
  id: string,
  kind: string,
): JsonRecord {
  const descriptor = authority.descriptor(id);
  invariant(descriptor.kind === kind, `${id} evidence kind is incorrect`);
  return descriptor;
}

function npmManifest(
  authority: EvidenceAuthority,
  evidenceId: string,
  packageName: string,
  selectedVersion: string,
): JsonRecord {
  const descriptor = evidenceKind(authority, evidenceId, "npm-packument");
  invariant(
    descriptor.sourceUrl ===
      `https://registry.npmjs.org/${encodeURIComponent(packageName)}`,
    `${packageName} packument source is not exact`,
  );
  const packument = object(
    authority.npmPackument(evidenceId),
    `${packageName} packument`,
  );
  invariant(
    packument.name === packageName && packument._id === packageName &&
      typeof packument._rev === "string" && packument._rev.length > 0,
    `${packageName} full packument identity drifted`,
  );
  const times = object(packument.time, `${packageName} publication times`);
  const retrievedAt = instant(
    descriptor.retrievedAt,
    `${packageName} retrievedAt`,
  );
  for (const [event, rawTime] of Object.entries(times)) {
    const observed = instant(rawTime, `${packageName} packument ${event}`);
    invariant(
      compareInstants(observed, retrievedAt) <= 0,
      `${packageName} packument event occurs after retrieval`,
    );
  }
  const manifest = object(
    object(packument.versions, `${packageName} versions`)[selectedVersion],
    `${packageName}@${selectedVersion} manifest`,
  );
  invariant(
    manifest.name === packageName && manifest.version === selectedVersion,
    `${packageName}@${selectedVersion} manifest identity drifted`,
  );
  const dist = object(manifest.dist, `${packageName} dist`);
  sri(dist.integrity, `${packageName} integrity`);
  invariant(
    /^[0-9a-f]{40}$/.test(string(dist.shasum, `${packageName} shasum`)),
    `${packageName} shasum is invalid`,
  );
  const fileName = `${packageName.split("/").at(-1)}-${selectedVersion}.tgz`;
  invariant(
    dist.tarball ===
      `https://registry.npmjs.org/${packageName}/-/${fileName}`,
    `${packageName} tarball source is not exact`,
  );
  const peerMeta = object(
    manifest.peerDependenciesMeta ?? {},
    `${packageName} peer metadata`,
  );
  const peers = object(
    manifest.peerDependencies ?? {},
    `${packageName} peer dependencies`,
  );
  invariant(
    Object.keys(peerMeta).every((name) => name in peers),
    `${packageName} peer metadata is not a peer subset`,
  );
  return manifest;
}

function stableVersions(packument: JsonRecord): string[] {
  return Object.keys(object(packument.versions, "packument versions"))
    .filter((item) => EXACT_VERSION.test(item))
    .sort(compareVersions);
}

interface SelectionWindow {
  selectedAt: ExactInstant;
  cutoff: ExactInstant;
}

function validateSelection(graph: JsonRecord): SelectionWindow {
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
    selected.epochNanoseconds - cutoff.epochNanoseconds ===
      72n * 60n * 60n * 1_000_000_000n,
    "cutoff must be exactly 72 hours",
  );
  return { selectedAt: selected, cutoff };
}

function validateNewerReleases(
  item: JsonRecord,
  officialVersions: string[],
  officialTimes: JsonRecord,
  cutoff: ExactInstant,
  label: string,
  expectedFailures: (candidateVersion: string) => JsonRecord[] = () => [],
) {
  const selectedVersion = version(item.version, `${label}.version`);
  const latest = version(item.latestStable, `${label}.latestStable`);
  invariant(
    officialVersions.includes(selectedVersion) &&
      officialVersions.includes(latest),
    `${label} selection or latest stable is absent from official bytes`,
  );
  const expectedNewer = officialVersions.filter((candidate) =>
    compareVersions(candidate, selectedVersion) > 0 &&
    compareVersions(candidate, latest) <= 0
  );
  const declared = array(item.newerReleases, `${label}.newerReleases`).map((
    raw,
    index,
  ) => object(raw, `${label}.newerReleases[${index}]`));
  exactSet(
    declared.map((release) =>
      version(release.version, `${label} newer version`)
    ),
    expectedNewer,
    `${label} complete newer stable interval`,
  );
  let previous = selectedVersion;
  for (const release of declared) {
    exactKeys(release, [
      "version",
      "publishedAt",
      "compatible",
      "reason",
      "failingEdges",
    ], `${label} newer release`);
    const releaseVersion = version(release.version, `${label} newer version`);
    invariant(
      compareVersions(releaseVersion, previous) > 0,
      `${label} newer releases are misordered`,
    );
    previous = releaseVersion;
    const officialTime = string(
      officialTimes[releaseVersion],
      `${label} official publication time`,
    );
    invariant(
      release.publishedAt === officialTime,
      `${label} newer publication time drifted from official bytes`,
    );
    const published = instant(
      release.publishedAt,
      `${label} newer publishedAt`,
    );
    invariant(
      typeof release.compatible === "boolean",
      `${label} compatibility result is missing`,
    );
    const failingEdges = array(
      release.failingEdges,
      `${label} newer failingEdges`,
    );
    exactValue(
      failingEdges,
      expectedFailures(releaseVersion),
      `${label} machine-derived incompatibility edges`,
    );
    invariant(
      release.compatible === (failingEdges.length === 0),
      `${label} compatibility result is not machine-derived`,
    );
    if (compareInstants(published, cutoff) > 0) {
      invariant(
        release.reason === "younger-than-cutoff",
        `${label} age-ineligible release has a non-temporal exclusion`,
      );
    } else {
      invariant(
        release.compatible === false &&
          release.reason === "incompatible-retained-manifest",
        `${label} omitted an eligible compatible release`,
      );
    }
  }
  invariant(
    latest === selectedVersion
      ? declared.length === 0
      : declared.at(-1)?.version === latest,
    `${label} newer release evidence is incomplete or vacuous`,
  );
}

function retainedManifestRows(
  graph: JsonRecord,
  authority: EvidenceAuthority,
): JsonRecord[] {
  const rows: JsonRecord[] = [];
  for (const raw of array(graph.selectedPackages, "selectedPackages")) {
    const item = object(raw, "selected package");
    if (item.id === "deno" || item.id === "node") continue;
    rows.push({
      name: item.name,
      version: item.version,
      evidenceId: item.artifactEvidenceId,
      contentSha256: authority.descriptor(
        string(item.artifactEvidenceId, "artifactEvidenceId"),
      ).contentSha256,
      manifest: npmManifest(
        authority,
        string(item.artifactEvidenceId, "artifactEvidenceId"),
        string(item.name, "selected package name"),
        version(item.version, "selected package version"),
      ),
    });
  }
  const pnpm = object(
    object(graph.repository, "repository").pnpm,
    "repository.pnpm",
  );
  for (const raw of array(pnpm.packages, "pnpm packages")) {
    const item = object(raw, "pnpm package");
    const name = string(item.name, "pnpm package name");
    const itemVersion = version(item.version, "pnpm package version");
    if (rows.some((row) => row.name === name && row.version === itemVersion)) {
      continue;
    }
    rows.push({
      name,
      version: itemVersion,
      evidenceId: item.manifestEvidenceId,
      contentSha256: item.manifestContentSha256,
      manifest: npmManifest(
        authority,
        string(item.manifestEvidenceId, "manifestEvidenceId"),
        name,
        itemVersion,
      ),
    });
  }
  return rows;
}

function requiredManifestRanges(
  manifest: JsonRecord,
): Array<{ relation: string; name: string; range: string }> {
  const result: Array<{ relation: string; name: string; range: string }> = [];
  for (const relation of ["dependencies", "peerDependencies"] as const) {
    const ranges = object(manifest[relation] ?? {}, relation);
    const optionalDependencies = object(
      manifest.optionalDependencies ?? {},
      "optional dependencies",
    );
    const meta = object(manifest.peerDependenciesMeta ?? {}, "peer metadata");
    for (const [name, rawRange] of Object.entries(ranges)) {
      const optional = relation === "dependencies"
        ? name in optionalDependencies
        : object(meta[name] ?? {}, `${name} peer metadata`).optional === true;
      if (!optional) {
        result.push({
          relation,
          name,
          range: string(rawRange, `${name} range`),
        });
      }
    }
  }
  return result;
}

function compatibilityFailures(
  graph: JsonRecord,
  authority: EvidenceAuthority,
  candidateName: string,
  candidateVersion: string,
  candidateManifest: JsonRecord,
  candidateEvidenceId: string,
): JsonRecord[] {
  const rows = retainedManifestRows(graph, authority);
  const selectedByName = new Map<string, string>();
  for (const row of rows) {
    if (!selectedByName.has(String(row.name))) {
      selectedByName.set(String(row.name), String(row.version));
    }
  }
  selectedByName.set(candidateName, candidateVersion);
  const failures: JsonRecord[] = [];
  for (const requirement of requiredManifestRanges(candidateManifest)) {
    const resolution = selectedByName.get(requirement.name);
    if (!resolution || !satisfiesRange(resolution, requirement.range)) {
      failures.push({
        direction: "forward",
        owner: candidateName,
        ownerVersion: candidateVersion,
        kind: requirement.relation,
        target: requirement.name,
        range: requirement.range,
        actualResolution: resolution ?? null,
        optional: false,
        manifestEvidenceId: candidateEvidenceId,
        manifestContentSha256:
          authority.descriptor(candidateEvidenceId).contentSha256,
      });
    }
  }
  for (const row of rows) {
    if (row.name === candidateName) continue;
    for (
      const requirement of requiredManifestRanges(
        object(row.manifest, `${row.name} manifest`),
      )
    ) {
      if (
        requirement.name === candidateName &&
        !satisfiesRange(candidateVersion, requirement.range)
      ) {
        failures.push({
          direction: "reverse",
          owner: row.name,
          ownerVersion: row.version,
          kind: requirement.relation,
          target: candidateName,
          range: requirement.range,
          actualResolution: candidateVersion,
          optional: false,
          manifestEvidenceId: row.evidenceId,
          manifestContentSha256: row.contentSha256,
        });
      }
    }
  }
  return failures.sort((left, right) =>
    JSON.stringify(canonical(left)).localeCompare(
      JSON.stringify(canonical(right)),
    )
  );
}

function runtimeReleaseRows(
  authority: EvidenceAuthority,
  evidenceId: string,
): JsonRecord[] {
  const descriptor = evidenceKind(
    authority,
    evidenceId,
    "official-release-index",
  );
  const expectedSource = "https://api.github.com/repos/denoland/deno/releases";
  invariant(
    descriptor.sourceUrl === expectedSource,
    "deno release source is not exact",
  );
  return authority.releaseIndex(evidenceId).map((raw) =>
    object(raw, "deno release")
  );
}

function validateRuntimeSelection(
  item: JsonRecord,
  authority: EvidenceAuthority,
  cutoff: ExactInstant,
  runtimeId: "deno" | "node",
) {
  const publicationId = string(
    item.publicationEvidenceId,
    `${runtimeId}.publicationEvidenceId`,
  );
  let considered: JsonRecord[];
  let times: JsonRecord;
  if (runtimeId === "node") {
    const ltsIndexId = string(
      item.ltsIndexEvidenceId,
      "node.ltsIndexEvidenceId",
    );
    const indexDescriptor = evidenceKind(
      authority,
      ltsIndexId,
      "official-release-index",
    );
    invariant(
      indexDescriptor.sourceUrl === "https://nodejs.org/dist/index.json",
      "Node LTS index source is not exact",
    );
    const indexRows = authority.releaseIndex(ltsIndexId).map((raw) =>
      object(raw, "Node LTS index row")
    );
    const nodeKnownFields = [
      "version",
      "date",
      "files",
      "npm",
      "v8",
      "uv",
      "zlib",
      "openssl",
      "modules",
      "lts",
      "security",
    ];
    const retrievedAt = instant(
      indexDescriptor.retrievedAt,
      "Node LTS index retrievedAt",
    );
    for (const row of indexRows) {
      invariant(
        Object.keys(row).every((key) => nodeKnownFields.includes(key)) &&
          ["version", "date", "files", "lts"].every((key) => key in row) &&
          /^v\d+\.\d+\.\d+$/.test(string(row.version, "Node index version")) &&
          /^\d{4}-\d{2}-\d{2}$/.test(string(row.date, "Node index date")) &&
          (row.lts === false ||
            (typeof row.lts === "string" && row.lts.length > 0)),
        "Node LTS index row has an invalid identity",
      );
      strings(row.files, "Node index files");
      invariant(
        String(row.date) <= instantDate(retrievedAt),
        "Node index row occurs after retrieval",
      );
      for (const field of ["npm", "v8", "uv", "zlib", "openssl", "modules"]) {
        if (row[field] !== undefined) string(row[field], `Node index ${field}`);
      }
      if (row.security !== undefined) {
        invariant(
          typeof row.security === "boolean",
          "Node index security must be boolean when present",
        );
      }
    }
    const releaseEvidenceIds = object(
      item.releaseEvidenceIds,
      "node.releaseEvidenceIds",
    );
    const newestLtsMajor = Math.max(
      ...indexRows.filter((row) =>
        typeof row.lts === "string" && row.lts.trim().length > 0
      ).map((row) => Number(String(row.version).slice(1).split(".")[0])),
    );
    const currentLine = indexRows.filter((row) =>
      typeof row.lts === "string" && row.lts.trim().length > 0 &&
      Number(String(row.version).slice(1).split(".")[0]) === newestLtsMajor
    );
    const cutoffDate = instantDate(cutoff);
    const safelyEligible = currentLine.filter((row) =>
      String(row.date) < cutoffDate
    ).sort((left, right) =>
      compareVersions(
        String(left.version).slice(1),
        String(right.version).slice(1),
      )
    );
    invariant(
      safelyEligible.length > 0,
      "Node current LTS line has no age-eligible release",
    );
    const boundaryTags = currentLine.filter((row) =>
      String(row.date) >= cutoffDate
    ).map((row) => String(row.version));
    const selectedSafeTag = String(safelyEligible.at(-1)!.version);
    const preciseTags = [...new Set([selectedSafeTag, ...boundaryTags])];
    exactSet(
      Object.keys(releaseEvidenceIds),
      preciseTags,
      "Node precise release evidence membership",
    );
    const releaseByVersion = new Map<string, JsonRecord>();
    for (const tag of preciseTags) {
      const evidenceId = string(releaseEvidenceIds[tag], `${tag} evidence ID`);
      const descriptor = evidenceKind(
        authority,
        evidenceId,
        "official-release-detail",
      );
      invariant(
        descriptor.sourceUrl ===
          `https://api.github.com/repos/nodejs/node/releases/tags/${tag}`,
        `${tag} precise Node release source is not exact`,
      );
      const release = object(
        authority.releaseDetail(evidenceId),
        `${tag} release`,
      );
      invariant(
        release.tag_name === tag && release.draft === false &&
          release.prerelease === false,
        `${tag} precise Node release identity is invalid`,
      );
      const published = instant(release.published_at, `${tag} published_at`);
      const releaseRetrievedAt = instant(
        descriptor.retrievedAt,
        `${tag} retrievedAt`,
      );
      invariant(
        instantDate(published) ===
            String(indexRows.find((row) => row.version === tag)?.date) &&
          compareInstants(published, releaseRetrievedAt) <= 0,
        `${tag} Node index date disagrees with precise release evidence`,
      );
      releaseByVersion.set(tag, release);
    }
    invariant(
      new Set(currentLine.map((release) => String(release.lts))).size === 1,
      "Node current LTS major has inconsistent codenames",
    );
    considered = preciseTags.map((tag) =>
      object(releaseByVersion.get(tag), tag)
    );
    const latestLts = currentLine.map((release) =>
      String(release.version).slice(1)
    ).sort(compareVersions).at(-1);
    const eligible = preciseTags.filter((tag) =>
      compareInstants(
        instant(
          object(releaseByVersion.get(tag), "Node release").published_at,
          "Node published_at",
        ),
        cutoff,
      ) <= 0
    ).map((tag) => tag.slice(1)).sort(compareVersions);
    invariant(
      eligible.length > 0,
      "Node current LTS line has no age-eligible release",
    );
    const selectedVersion = eligible.at(-1);
    const selectedIndexRow = currentLine.find((release) =>
      release.version === `v${selectedVersion}`
    );
    const globalLatest = indexRows.map((row) => String(row.version).slice(1))
      .sort(compareVersions).at(-1);
    invariant(
      item.version === selectedVersion && selectedIndexRow &&
        item.lts === selectedIndexRow.lts && item.latestLts === latestLts &&
        item.latestStable === globalLatest &&
        publicationId === releaseEvidenceIds[`v${selectedVersion}`],
      "Node graph drifted from the newest official LTS line",
    );
    times = Object.fromEntries(considered.map((release) => [
      String(release.tag_name).slice(1),
      string(release.published_at, "node published_at"),
    ]));
    validateNewerReleases(
      { ...item, latestStable: item.latestLts },
      Object.keys(times).sort(compareVersions),
      times,
      cutoff,
      runtimeId,
    );
  } else {
    const publicationDescriptor = authority.descriptor(publicationId);
    const retrievedAt = instant(
      publicationDescriptor.retrievedAt,
      "deno releases retrievedAt",
    );
    considered = runtimeReleaseRows(authority, publicationId)
      .filter((release) =>
        release.draft === false && release.prerelease === false &&
        typeof release.tag_name === "string" &&
        /^v\d+\.\d+\.\d+$/.test(release.tag_name)
      );
    for (const release of considered) {
      invariant(
        compareInstants(
          instant(release.published_at, "deno published_at"),
          retrievedAt,
        ) <= 0,
        "deno release occurs after retrieval",
      );
    }
    times = Object.fromEntries(considered.map((release) => [
      String(release.tag_name).slice(1),
      string(release.published_at, `${runtimeId} published_at`),
    ]));
    validateNewerReleases(
      item,
      Object.keys(times).sort(compareVersions),
      times,
      cutoff,
      runtimeId,
    );
  }
  const selectedVersion = version(item.version, `${runtimeId}.version`);
  invariant(
    item.publishedAt === times[selectedVersion],
    `${runtimeId} publication time drifted from official bytes`,
  );
  invariant(
    compareInstants(
      instant(item.publishedAt, `${runtimeId}.publishedAt`),
      cutoff,
    ) <= 0,
    `${runtimeId} is too young`,
  );
  const artifactId = string(
    item.artifactEvidenceId,
    `${runtimeId}.artifactEvidenceId`,
  );
  const checksumDescriptor = evidenceKind(
    authority,
    artifactId,
    "release-checksum",
  );
  const expectedSource = runtimeId === "deno"
    ? `https://github.com/denoland/deno/releases/download/v${selectedVersion}/deno-x86_64-pc-windows-msvc.zip.sha256sum`
    : `https://nodejs.org/dist/v${selectedVersion}/SHASUMS256.txt`;
  invariant(
    checksumDescriptor.sourceUrl === expectedSource,
    `${runtimeId} checksum source is not exact`,
  );
  const filename = runtimeId === "deno"
    ? `deno-x86_64-pc-windows-msvc.zip`
    : `node-v${selectedVersion}-win-x64.zip`;
  const checksumRows = authority.checksumRows(artifactId);
  const matching = checksumRows.filter((row) => row.at(-1) === filename);
  invariant(
    matching.length === 1 && RAW_SHA256.test(matching[0]![0]!),
    `${runtimeId} checksum bytes do not identify the selected artifact`,
  );
  invariant(
    item.artifactValue === `sha256:${matching[0]![0]}`,
    `${runtimeId} checksum claim drifted from official bytes`,
  );
}

function validateNpmSelection(
  graph: JsonRecord,
  item: JsonRecord,
  authority: EvidenceAuthority,
  cutoff: ExactInstant,
  label: string,
) {
  const evidenceId = string(
    item.publicationEvidenceId,
    `${label}.publicationEvidenceId`,
  );
  invariant(
    item.artifactEvidenceId === evidenceId,
    `${label} npm publication and manifest must bind one complete packument`,
  );
  const descriptor = evidenceKind(authority, evidenceId, "npm-packument");
  const packageName = string(item.name, `${label}.name`);
  invariant(
    descriptor.sourceUrl ===
      `https://registry.npmjs.org/${encodeURIComponent(packageName)}`,
    `${label} packument source is not exact`,
  );
  const packument = object(
    authority.npmPackument(evidenceId),
    `${label} packument`,
  );
  invariant(packument.name === packageName, `${label} packument name drifted`);
  const tags = object(packument["dist-tags"], `${label} dist-tags`);
  exactValue(item.distTags, tags, `${label} dist-tags`);
  const officialStableVersions = stableVersions(packument);
  const latestStable = officialStableVersions.at(-1);
  invariant(
    item.latestStable === latestStable &&
      typeof tags.latest === "string" &&
      object(packument.versions, `${label} versions`)[String(tags.latest)] !==
        undefined,
    `${label} latest stable was not derived from all captured stable versions`,
  );
  const selectedVersion = version(item.version, `${label}.version`);
  const times = object(packument.time, `${label} publication times`);
  invariant(
    item.publishedAt === times[selectedVersion],
    `${label} publication time drifted from official bytes`,
  );
  invariant(
    compareInstants(
      instant(item.publishedAt, `${label}.publishedAt`),
      cutoff,
    ) <= 0,
    `${label} is too young`,
  );
  const manifest = npmManifest(
    authority,
    evidenceId,
    packageName,
    selectedVersion,
  );
  invariant(
    manifest.name === packageName && manifest.version === selectedVersion,
    `${label} selected manifest identity drifted`,
  );
  const integrity = sri(
    object(manifest.dist, `${label} dist`).integrity,
    `${label} integrity`,
  );
  invariant(
    item.artifactValue === integrity,
    `${label} integrity drifted from official bytes`,
  );
  validateNewerReleases(
    item,
    officialStableVersions,
    times,
    cutoff,
    label,
    (candidateVersion) =>
      compatibilityFailures(
        graph,
        authority,
        packageName,
        candidateVersion,
        object(
          object(packument.versions, `${label} versions`)[candidateVersion],
          `${label}@${candidateVersion} manifest`,
        ),
        evidenceId,
      ),
  );
}

function validateSelected(
  graph: JsonRecord,
  authority: EvidenceAuthority,
  cutoff: ExactInstant,
): Map<string, JsonRecord> {
  const expected = [...RUNTIMES, ...DIRECT.deno, ...DIRECT.pnpm];
  const items = array(graph.selectedPackages, "selectedPackages").map((
    raw,
    index,
  ) => object(raw, `selectedPackages[${index}]`));
  exactSet(
    items.map((item) => string(item.id, "selected id")),
    expected,
    "selected packages",
  );
  const result = new Map<string, JsonRecord>();
  for (const item of items) {
    const selectedFields = [
      "id",
      "name",
      "version",
      "publishedAt",
      "manifest",
      "publicationEvidenceId",
      "artifactEvidenceId",
      "artifactValue",
      "latestStable",
      "newerReleases",
    ];
    if (item.id === "node") {
      selectedFields.push(
        "lts",
        "latestLts",
        "ltsIndexEvidenceId",
        "releaseEvidenceIds",
      );
    }
    if (item.id !== "deno" && item.id !== "node") {
      selectedFields.push("distTags");
    }
    exactKeys(item, selectedFields, "selected package");
    const id = string(item.id, "selected id");
    invariant(!result.has(id), "selected package IDs must be unique");
    invariant(item.name === nameOf(id), `${id} name is incorrect`);
    invariant(
      item.manifest ===
        (DIRECT.deno.includes(id as never)
          ? "deno"
          : DIRECT.pnpm.includes(id as never)
          ? "pnpm"
          : "runtime"),
      `${id} manifest ownership is incorrect`,
    );
    if (id === "deno" || id === "node") {
      validateRuntimeSelection(item, authority, cutoff, id);
    } else validateNpmSelection(graph, item, authority, cutoff, id);
    result.set(id, item);
  }
  return result;
}

function packageAt(graph: JsonRecord, id: string): JsonRecord {
  return object(
    array(graph.selectedPackages, "selectedPackages").find((raw) =>
      object(raw, "selected package").id === id
    ),
    id,
  );
}

function packageVersion(graph: JsonRecord, id: string): string {
  const selected = array(graph.selectedPackages, "selectedPackages").map((
    raw,
  ) => object(raw, "selected package"))
    .find((item) => item.id === id);
  if (selected) return version(selected.version, `${id}.version`);
  const packages = array(
    object(object(graph.repository, "repository").pnpm, "pnpm graph").packages,
    "pnpm packages",
  )
    .map((raw) => object(raw, "pnpm package"));
  return version(
    packages.find((item) => item.id === id)?.version,
    `${id}.version`,
  );
}

function packageEvidenceId(graph: JsonRecord, id: string): string {
  return string(
    packageAt(graph, id).artifactEvidenceId,
    `${id}.artifactEvidenceId`,
  );
}

function validateEdges(graph: JsonRecord, authority: EvidenceAuthority) {
  const repository = object(graph.repository, "repository");
  const validateCollection = (
    raw: unknown,
    contracts: Record<string, [string, string]>,
    label: string,
  ) => {
    const edges = array(raw, label).map((item) =>
      object(item, `${label} edge`)
    );
    exactSet(
      edges.map((edge) => string(edge.id, `${label}.id`)),
      Object.keys(contracts),
      label,
    );
    for (const edge of edges) {
      exactKeys(edge, [
        "id",
        "from",
        "to",
        "authority",
        "relation",
        "manifestRange",
        "selectedResolution",
        "evidenceId",
      ], `${label} edge`);
      const id = string(edge.id, `${label}.id`);
      const pair = contracts[id];
      invariant(
        pair && edge.from === pair[0] && edge.to === pair[1],
        `${id} edge is incorrect`,
      );
      const selectedResolution = packageVersion(graph, String(edge.to));
      invariant(
        edge.selectedResolution === selectedResolution,
        `${id} selected resolution disagrees with graph`,
      );
      const relation = MANIFEST_RELATIONS[id];
      if (relation) {
        invariant(
          edge.authority === "npm-manifest" && edge.relation === relation,
          `${id} manifest relation is misclassified`,
        );
        const evidenceId = packageEvidenceId(graph, String(edge.from));
        invariant(
          edge.evidenceId === evidenceId,
          `${id} manifest evidence is not bound to its owner`,
        );
        const manifest = npmManifest(
          authority,
          evidenceId,
          nameOf(String(edge.from)),
          packageVersion(graph, String(edge.from)),
        );
        const ranges = object(manifest[relation] ?? {}, `${id} ${relation}`);
        const officialRange = string(
          ranges[nameOf(String(edge.to))],
          `${id} official manifest range`,
        );
        invariant(
          edge.manifestRange === officialRange,
          `${id} manifest range drifted from official bytes`,
        );
        invariant(
          satisfiesRange(selectedResolution, officialRange),
          `${id} selected resolution violates manifest range`,
        );
      } else {
        invariant(
          (edge.authority === "successor-import" ||
            edge.authority === "immutable-source") &&
            edge.relation === null && edge.manifestRange === null &&
            edge.evidenceId === null,
          `${id} source/application edge invents an npm manifest range`,
        );
      }
    }
  };
  validateCollection(repository.importEdges, IMPORT_PAIRS, "import edges");
  validateCollection(repository.peerEdges, PEER_PAIRS, "peer edges");
}

function npmRequestName(raw: string): string {
  const request = raw.startsWith("npm:") ? raw.slice(4) : raw;
  const alias = request.indexOf("@npm:");
  const target = alias >= 0 ? request.slice(alias + 5) : request;
  const delimiter = target.lastIndexOf("@");
  if (target.startsWith("@")) {
    return delimiter > target.indexOf("/")
      ? target.slice(0, delimiter)
      : target;
  }
  return delimiter > 0 ? target.slice(0, delimiter) : target;
}

function exactNpmTarget(raw: string): string | null {
  const request = raw.startsWith("npm:") ? raw.slice(4) : raw;
  const alias = request.indexOf("@npm:");
  const target = alias >= 0 ? request.slice(alias + 5) : request;
  const delimiter = target.lastIndexOf("@");
  const versionPart = delimiter > 0 ? target.slice(delimiter + 1) : "";
  return EXACT_VERSION.test(versionPart) ? `npm:${target}` : null;
}

function resolveDenoSpecifier(
  request: string,
  resolution: unknown,
  nodeKeys: readonly string[],
): string {
  const kind = request.startsWith("jsr:") ? "jsr" : "npm";
  invariant(
    request.startsWith(`${kind}:`),
    "Deno specifier kind is unsupported",
  );
  if (kind === "npm") {
    const name = npmRequestName(request);
    const value = string(resolution, `${request} resolution`);
    const target = value.startsWith(`${name}@`)
      ? `npm:${value}`
      : `npm:${name}@${value}`;
    invariant(
      nodeKeys.includes(target),
      `${request} specifier target is absent`,
    );
    return target;
  }
  const bare = request.slice(4);
  const delimiter = bare.lastIndexOf("@");
  const name = delimiter > bare.indexOf("/") ? bare.slice(0, delimiter) : bare;
  const value = string(resolution, `${request} resolution`);
  const target = value.startsWith("@")
    ? `jsr:${value}`
    : `jsr:${name}@${value}`;
  invariant(nodeKeys.includes(target), `${request} specifier target is absent`);
  return target;
}

function resolveDenoDependency(
  token: string,
  specifiers: JsonRecord,
  nodeKeys: readonly string[],
): string {
  if (token.startsWith("jsr:")) {
    const exact = /^jsr:.+@\d+\.\d+\.\d+$/.test(token) ? token : null;
    if (exact && nodeKeys.includes(exact)) return exact;
    const resolution = specifiers[token];
    invariant(
      resolution !== undefined,
      `${token} JSR dependency has no specifier binding`,
    );
    return resolveDenoSpecifier(token, resolution, nodeKeys);
  }
  const request = token.startsWith("npm:") ? token : `npm:${token}`;
  const requestedName = npmRequestName(request);
  const alias = request.includes("@npm:");
  const explicit = exactNpmTarget(request);
  const candidates = nodeKeys.filter((key) => {
    if (!key.startsWith("npm:")) return false;
    const identity = denoNpmIdentity(key);
    if (identity.name !== requestedName) return false;
    return explicit === null || key.startsWith(`${explicit}_`) ||
      key === explicit;
  });
  if (alias && candidates.length === 1) return candidates[0]!;
  invariant(
    candidates.length === 1,
    `${token} Deno dependency is ambiguously or incompletely bound`,
  );
  return candidates[0]!;
}

function denoNpmIdentity(key: string): { name: string; version: string } {
  invariant(key.startsWith("npm:"), `${key} is not an npm lock key`);
  const raw = key.slice(4);
  const delimiter = raw.lastIndexOf(
    "@",
    raw.indexOf("_") < 0 ? undefined : raw.indexOf("_"),
  );
  invariant(delimiter > 0, `${key} npm lock identity is malformed`);
  const name = raw.slice(0, delimiter);
  const itemVersion = raw.slice(delimiter + 1).split("_")[0]!;
  version(itemVersion, `${key} npm lock version`);
  return { name, version: itemVersion };
}

function validateDenoGraph(
  graph: JsonRecord,
  authority: EvidenceAuthority,
) {
  const repository = object(graph.repository, "repository");
  const specifiers = object(repository.denoSpecifiers, "denoSpecifiers");
  const nodes = array(repository.denoLockNodes, "denoLockNodes").map((raw) =>
    object(raw, "Deno lock node")
  );
  const keys = nodes.map((node) => string(node.key, "Deno node key"));
  invariant(
    new Set(keys).size === keys.length,
    "Deno lock nodes contain duplicates",
  );
  for (const [request, resolution] of Object.entries(specifiers)) {
    resolveDenoSpecifier(request, resolution, keys);
  }
  for (const node of nodes) {
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
          "manifestEvidenceId",
          "manifestContentSha256",
        ].includes(key)
      ) && ["key", "kind", "integrity"].every((key) => key in node),
      "Deno lock node has missing or unknown fields",
    );
    const key = string(node.key, "Deno node key");
    invariant(
      key.startsWith(`${node.kind}:`),
      `${key} Deno node kind disagrees with key`,
    );
    if (node.kind === "npm") sri(node.integrity, `${key} integrity`);
    else {
      invariant(node.kind === "jsr", "Deno lock node kind is invented");
      invariant(
        RAW_SHA256.test(string(node.integrity, `${key} integrity`)),
        "Deno JSR integrity must be raw hex",
      );
    }
    const dependencies = [
      ...strings(node.dependencies ?? [], `${key} dependencies`),
      ...strings(
        node.optionalDependencies ?? [],
        `${key} optionalDependencies`,
      ),
      ...strings(node.optionalPeers ?? [], `${key} optionalPeers`),
    ];
    for (const dependency of dependencies) {
      resolveDenoDependency(dependency, specifiers, keys);
    }
    if (node.kind === "npm") {
      const identity = denoNpmIdentity(key);
      const packageName = identity.name;
      const itemVersion = identity.version;
      const evidenceId = string(
        node.manifestEvidenceId,
        `${key}.manifestEvidenceId`,
      );
      const manifest = npmManifest(
        authority,
        evidenceId,
        packageName,
        itemVersion,
      );
      invariant(
        node.manifestContentSha256 ===
          authority.descriptor(evidenceId).contentSha256,
        `${key} manifest hash is not bound end to end`,
      );
      const required = object(
        manifest.dependencies ?? {},
        `${key} dependencies`,
      );
      const optional = object(
        manifest.optionalDependencies ?? {},
        `${key} optional dependencies`,
      );
      const peers = object(manifest.peerDependencies ?? {}, `${key} peers`);
      const peerMeta = object(
        manifest.peerDependenciesMeta ?? {},
        `${key} peer metadata`,
      );
      const requiredRanges: JsonRecord = {
        ...required,
        ...Object.fromEntries(
          Object.entries(peers).filter(([name]) =>
            object(peerMeta[name] ?? {}, `${name} peer metadata`).optional !==
              true
          ),
        ),
      };
      for (const name of Object.keys(optional)) delete requiredRanges[name];
      const optionalPeerRanges = Object.fromEntries(
        Object.entries(peers).filter(([name]) =>
          object(peerMeta[name] ?? {}, `${name} peer metadata`).optional ===
            true
        ),
      );
      const resolvedOptionalPeerNames = strings(
        node.optionalPeers ?? [],
        `${key} optionalPeers`,
      ).map(npmRequestName);
      invariant(
        resolvedOptionalPeerNames.every((name) => name in optionalPeerRanges),
        `${key} optional peer marker is absent from retained manifest`,
      );
      for (const name of resolvedOptionalPeerNames) {
        requiredRanges[name] = optionalPeerRanges[name]!;
      }
      const validateManifestTokens = (
        rawTokens: unknown,
        ranges: JsonRecord,
        section: string,
      ) => {
        const tokens = strings(rawTokens ?? [], `${key} ${section}`);
        exactSet(
          tokens.map(npmRequestName),
          Object.keys(ranges),
          `${key} retained-manifest ${section}`,
        );
        for (const token of tokens) {
          const target = resolveDenoDependency(token, specifiers, keys);
          const targetVersion = target.slice(target.lastIndexOf("@") + 1);
          invariant(
            satisfiesRange(
              targetVersion,
              string(ranges[npmRequestName(token)], `${token} manifest range`),
            ),
            `${key} ${section} resolution violates retained manifest`,
          );
        }
      };
      validateManifestTokens(node.dependencies, requiredRanges, "dependencies");
      validateManifestTokens(
        node.optionalDependencies,
        optional,
        "optionalDependencies",
      );
      exactSet(
        resolvedOptionalPeerNames,
        Object.keys(optionalPeerRanges).filter((name) =>
          resolvedOptionalPeerNames.includes(name)
        ),
        `${key} optional peer markers`,
      );
    } else {
      invariant(
        node.manifestEvidenceId === undefined &&
          node.manifestContentSha256 === undefined,
        `${key} JSR node cannot claim an npm manifest`,
      );
    }
    strings(node.os ?? [], `${key} os`);
    strings(node.cpu ?? [], `${key} cpu`);
    if (node.tarball !== undefined) string(node.tarball, `${key} tarball`);
    for (const flag of ["deprecated", "scripts", "bin"] as const) {
      invariant(
        node[flag] === undefined || typeof node[flag] === "boolean",
        `${key} ${flag} must be boolean`,
      );
    }
  }
  for (const id of DIRECT.deno) {
    const selected = packageAt(graph, id);
    const request = `npm:${selected.name}@${selected.version}`;
    const key = resolveDenoSpecifier(
      request,
      specifiers[request],
      keys,
    );
    const node = object(nodes.find((candidate) => candidate.key === key), id);
    invariant(
      node.integrity === selected.artifactValue &&
        denoNpmIdentity(key).name === selected.name &&
        denoNpmIdentity(key).version === selected.version,
      `${id} selected Deno root is absent or stale`,
    );
  }
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

function packageKeyFromSnapshot(snapshotKey: string): string {
  const suffix = snapshotKey.indexOf("(");
  return suffix < 0 ? snapshotKey : snapshotKey.slice(0, suffix);
}

function snapshotIdentity(
  snapshotKey: string,
): { packageKey: string; name: string; version: string } {
  const packageKey = packageKeyFromSnapshot(snapshotKey);
  const delimiter = packageKey.lastIndexOf("@");
  invariant(delimiter > 0, "pnpm snapshot package identity is malformed");
  const name = packageKey.slice(0, delimiter);
  const itemVersion = packageKey.slice(delimiter + 1);
  version(itemVersion, `${snapshotKey} snapshot version`);
  return { packageKey, name, version: itemVersion };
}

function keyedCollection(raw: unknown, label: string): JsonRecord[] {
  const rows = array(raw, label).map((item) => object(item, `${label} row`));
  const keys = rows.map((row) => string(row.key ?? row.id, `${label} key`));
  invariant(
    new Set(keys).size === keys.length,
    `${label} contains duplicate identities`,
  );
  return rows;
}

function collectionValue(
  rows: JsonRecord[],
  keyField: "key" | "id",
): JsonRecord {
  return Object.fromEntries(rows.map((row) => [
    string(row[keyField], `${keyField}`),
    row.value,
  ]));
}

function dependencyEntry(value: unknown, label: string): JsonRecord {
  const entry = object(value, label);
  exactKeys(entry, ["specifier", "version"], label);
  version(entry.specifier, `${label}.specifier`);
  string(entry.version, `${label}.version`);
  return entry;
}

function validatePnpmGraph(
  graph: JsonRecord,
  authority: EvidenceAuthority,
  parsedLock?: JsonRecord,
) {
  const pnpm = object(
    object(graph.repository, "repository").pnpm,
    "repository.pnpm",
  );
  exactKeys(pnpm, ["importers", "packages", "snapshots"], "repository.pnpm");
  const importers = keyedCollection(pnpm.importers, "pnpm importers");
  const packages = keyedCollection(pnpm.packages, "pnpm packages");
  const snapshots = keyedCollection(pnpm.snapshots, "pnpm snapshots");
  if (parsedLock) {
    exactValue(
      parsedLock.importers,
      collectionValue(importers, "id"),
      "pnpm importers",
    );
    exactValue(
      parsedLock.packages,
      collectionValue(packages, "key"),
      "pnpm packages",
    );
    exactValue(
      parsedLock.snapshots,
      collectionValue(snapshots, "key"),
      "pnpm snapshots",
    );
  }
  const packageKeys = packages.map((item) =>
    string(item.key, "pnpm package key")
  );
  const snapshotKeys = snapshots.map((item) =>
    string(item.key, "pnpm snapshot key")
  );
  for (const item of packages) {
    exactKeys(item, [
      "id",
      "resolutionId",
      "key",
      "name",
      "version",
      "manifestEvidenceId",
      "manifestContentSha256",
      "value",
    ], "pnpm package record");
    const id = string(item.id, "pnpm package id");
    const name = string(item.name, `${id}.name`);
    const itemVersion = version(item.version, `${id}.version`);
    invariant(
      item.key === `${name}@${itemVersion}`,
      `${id} package identity drifted`,
    );
    invariant(
      item.resolutionId === `pnpm:${item.key}`,
      `${id} exact package resolution ID drifted`,
    );
    const evidenceId = string(
      item.manifestEvidenceId,
      `${id}.manifestEvidenceId`,
    );
    const manifest = npmManifest(authority, evidenceId, name, itemVersion);
    invariant(
      item.manifestContentSha256 ===
        authority.descriptor(evidenceId).contentSha256,
      `${id} manifest hash is not bound end to end`,
    );
    const value = object(item.value, `${id}.packageValue`);
    const resolution = object(value.resolution, `${id}.resolution`);
    invariant(
      resolution.integrity === object(manifest.dist, `${id}.dist`).integrity,
      `${id} lock integrity drifted from retained manifest`,
    );
    invariant(
      value.hasBin === undefined || value.hasBin === true,
      `${id}.hasBin must be true when emitted`,
    );
    const expected: JsonRecord = {
      resolution: { integrity: resolution.integrity },
    };
    for (
      const field of [
        "engines",
        "peerDependencies",
        "peerDependenciesMeta",
      ] as const
    ) {
      const fieldValue = manifest[field];
      if (
        fieldValue !== undefined &&
        Object.keys(object(fieldValue, `${id}.${field}`)).length > 0
      ) {
        expected[field] = fieldValue;
      }
    }
    for (const field of ["os", "cpu", "libc", "bundledDependencies"] as const) {
      const fieldValue = manifest[field];
      if (
        fieldValue !== undefined &&
        strings(fieldValue, `${id}.${field}`).length > 0
      ) {
        expected[field] = fieldValue;
      }
    }
    if (
      manifest.bin !== undefined &&
      Object.keys(object(manifest.bin, `${id}.bin`)).length > 0
    ) {
      expected.hasBin = true;
    }
    if (manifest.deprecated !== undefined) {
      expected.deprecated = string(manifest.deprecated, `${id}.deprecated`);
    }
    exactValue(value, expected, `${id} package emitted metadata`);
  }
  const packageSnapshotCounts = new Map<string, number>();
  for (const snapshot of snapshots) {
    exactKeys(snapshot, [
      "id",
      "key",
      "packageKey",
      "value",
      "dependencyIds",
      "optionalDependencyIds",
      "peerIds",
      "transitivePeerIds",
      "transitivePeerResolutions",
    ], "pnpm snapshot record");
    const key = string(snapshot.key, "pnpm snapshot key");
    const packageKey = string(snapshot.packageKey, "pnpm snapshot packageKey");
    invariant(
      packageKeyFromSnapshot(key) === packageKey &&
        packageKeys.includes(packageKey),
      `${key} snapshot lacks an exact package record`,
    );
    packageSnapshotCounts.set(
      packageKey,
      (packageSnapshotCounts.get(packageKey) ?? 0) + 1,
    );
    const value = object(snapshot.value, `${key}.value`);
    invariant(
      value.optional === undefined || value.optional === true,
      `${key}.optional must be true when emitted`,
    );
    invariant(!("dev" in value), `${key} snapshot contains invented dev field`);
    invariant(
      Object.keys(value).every((field) =>
        [
          "dependencies",
          "optionalDependencies",
          "transitivePeerDependencies",
          "optional",
          "id",
        ].includes(field)
      ),
      `${key} snapshot contains unsupported emitted field`,
    );
    strings(
      value.transitivePeerDependencies ?? [],
      `${key}.transitivePeerDependencies`,
    );
    const validateDependencyMap = (
      section: "dependencies" | "optionalDependencies",
      idField: "dependencyIds" | "optionalDependencyIds",
    ) => {
      const dependencies = object(value[section] ?? {}, `${key}.${section}`);
      const ids = object(snapshot[idField], `${key}.${idField}`);
      exactSet(
        Object.keys(ids),
        Object.keys(dependencies),
        `${key} ${section} ID binding`,
      );
      for (const [name, resolution] of Object.entries(dependencies)) {
        const targetId = string(ids[name], `${key} target ID`);
        const targetPackage = object(
          packages.find((row) => row.resolutionId === targetId),
          targetId,
        );
        invariant(
          targetPackage.name === name,
          `${key} dependency name is misbound`,
        );
        const targetSnapshot = `${name}@${
          string(resolution, `${key} resolution`)
        }`;
        const targetIdentity = snapshotIdentity(targetSnapshot);
        invariant(
          snapshotKeys.includes(targetSnapshot) &&
            targetIdentity.packageKey === targetPackage.key &&
            targetIdentity.name === targetPackage.name &&
            targetIdentity.version === targetPackage.version,
          `${key} dependency resolution is not bound to its exact package and snapshot`,
        );
      }
    };
    validateDependencyMap("dependencies", "dependencyIds");
    validateDependencyMap("optionalDependencies", "optionalDependencyIds");
    const suffix = key.slice(packageKey.length);
    const peers = parsePnpmPeerSuffix(suffix);
    const peerIds = object(snapshot.peerIds, `${key}.peerIds`);
    exactSet(
      Object.keys(peerIds),
      Object.keys(peers),
      `${key} peer ID binding`,
    );
    const packageRecord = object(
      packages.find((row) => row.key === packageKey),
      packageKey,
    );
    const manifest = npmManifest(
      authority,
      string(
        packageRecord.manifestEvidenceId,
        `${packageKey}.manifestEvidenceId`,
      ),
      string(packageRecord.name, `${packageKey}.name`),
      version(packageRecord.version, `${packageKey}.version`),
    );
    const manifestPeers = object(
      manifest.peerDependencies ?? {},
      `${packageKey}.peerDependencies`,
    );
    const peerMeta = object(
      manifest.peerDependenciesMeta ?? {},
      `${packageKey}.peerDependenciesMeta`,
    );
    const requiredPeers = Object.keys(manifestPeers).filter((peerName) =>
      object(peerMeta[peerName] ?? {}, `${peerName} peer metadata`).optional !==
        true
    );
    invariant(
      requiredPeers.every((peerName) => peerName in peers),
      `${key} peer suffix omits a required retained-manifest peer`,
    );
    for (const [peerName, peerResolution] of Object.entries(peers)) {
      const peerVersion = string(peerResolution, `${key} peer resolution`)
        .split("(")[0]!;
      invariant(
        peerName in manifestPeers &&
          satisfiesRange(
            peerVersion,
            string(manifestPeers[peerName], `${peerName} range`),
          ),
        `${key} peer suffix is not backed by its retained manifest`,
      );
      const peerPackageKey = `${peerName}@${peerVersion}`;
      const peerPackage = object(
        packages.find((row) => row.key === peerPackageKey),
        peerPackageKey,
      );
      invariant(
        packageKeys.includes(peerPackageKey) &&
          peerIds[peerName] === peerPackage.resolutionId,
        `${key} peer suffix lacks a backing package identity`,
      );
      invariant(
        snapshotKeys.includes(`${peerName}@${peerResolution}`),
        `${key} peer suffix lacks a backing snapshot identity`,
      );
    }
    const transitivePeerNames = strings(
      value.transitivePeerDependencies ?? [],
      `${key}.transitivePeerDependencies`,
    );
    const transitivePeerIds = object(
      snapshot.transitivePeerIds,
      `${key}.transitivePeerIds`,
    );
    const transitivePeerResolutions = object(
      snapshot.transitivePeerResolutions,
      `${key}.transitivePeerResolutions`,
    );
    exactSet(
      Object.keys(transitivePeerIds),
      transitivePeerNames,
      `${key} transitive peer ID binding`,
    );
    exactSet(
      Object.keys(transitivePeerResolutions),
      transitivePeerNames,
      `${key} transitive peer resolution binding`,
    );
    for (const peerName of transitivePeerNames) {
      const resolution = string(
        transitivePeerResolutions[peerName],
        `${key} transitive peer resolution`,
      );
      const identity = snapshotIdentity(`${peerName}@${resolution}`);
      const peerPackage = object(
        packages.find((row) =>
          row.resolutionId === transitivePeerIds[peerName]
        ),
        `${key} transitive peer package`,
      );
      invariant(
        identity.packageKey === peerPackage.key &&
          snapshotKeys.includes(`${peerName}@${resolution}`),
        `${key} transitive peer is not bound to an exact package and snapshot`,
      );
    }
  }
  invariant(
    [...packageSnapshotCounts.values()].some((count) => count >= 2),
    "pnpm graph must retain multiple peer-qualified snapshots for one package",
  );
  const root = object(
    importers.find((item) => item.id === ".")?.value,
    "root importer",
  );
  const rootRecord = object(
    importers.find((item) => item.id === "."),
    "root importer record",
  );
  exactKeys(rootRecord, [
    "id",
    "value",
    "dependencyIds",
    "devDependencyIds",
    "optionalDependencyIds",
  ], "root importer record");
  for (
    const section of [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
    ] as const
  ) {
    object(root[section] ?? {}, `root importer ${section}`);
  }
  const directEntries = object(root.devDependencies, "root devDependencies");
  exactSet(
    Object.keys(directEntries),
    DIRECT.pnpm.map(nameOf),
    "pnpm root direct dependencies",
  );
  for (const id of DIRECT.pnpm) {
    const entry = dependencyEntry(
      directEntries[nameOf(id)],
      `${id} importer entry`,
    );
    invariant(
      entry.specifier === packageVersion(graph, id),
      `${id} importer specifier is not exact`,
    );
    const targetSnapshot = `${nameOf(id)}@${entry.version}`;
    const targetPackage = object(
      packages.find((row) => row.id === id),
      `${id} package`,
    );
    invariant(
      snapshotKeys.includes(targetSnapshot) &&
        snapshotIdentity(targetSnapshot).packageKey === targetPackage.key &&
        object(
            rootRecord.devDependencyIds,
            "root devDependencyIds",
          )[nameOf(id)] ===
          targetPackage.resolutionId,
      `${id} importer resolution is not bound to its exact package and snapshot`,
    );
  }
  exactSet(
    Object.keys(object(rootRecord.devDependencyIds, "root devDependencyIds")),
    DIRECT.pnpm.map(nameOf),
    "root dev dependency ID binding",
  );
  exactSet(
    Object.keys(object(rootRecord.dependencyIds, "root dependencyIds")),
    Object.keys(object(root.dependencies ?? {}, "root dependencies")),
    "root dependency ID binding",
  );
  exactSet(
    Object.keys(
      object(rootRecord.optionalDependencyIds, "root optionalDependencyIds"),
    ),
    Object.keys(
      object(root.optionalDependencies ?? {}, "root optionalDependencies"),
    ),
    "root optional dependency ID binding",
  );
  invariant(
    !packageKeys.some((key) => key.startsWith("pnpm@")),
    "Corepack pnpm must not be a dependency lock node",
  );
}

function expectedRepeatRuns(graph: JsonRecord): JsonRecord[] {
  const selected = Object.fromEntries(
    RUNTIMES.map((id) => [id, packageVersion(graph, id)]),
  );
  return [
    {
      id: "deno-clean",
      runtime: "deno",
      runtimeVersion: selected.deno,
      command: "deno ci",
      mode: "networked",
      cacheState: "empty",
      setEnvironment: { DENO_DIR: "isolated:deno", DENO_NO_PACKAGE_JSON: "1" },
      unsetEnvironment: [],
      nodeModulesState: "absent",
    },
    {
      id: "deno-cached",
      runtime: "deno",
      runtimeVersion: selected.deno,
      command: "deno install --cached-only --lock=deno.lock --frozen",
      mode: "cached-only",
      cacheState: "warm",
      setEnvironment: { DENO_DIR: "isolated:deno", DENO_NO_PACKAGE_JSON: "1" },
      unsetEnvironment: [],
      nodeModulesState: "removed-before-run",
    },
    {
      id: "pnpm-clean",
      runtime: "pnpm",
      runtimeVersion: selected.pnpm,
      nodeVersion: selected.node,
      corepackVersion: selected.corepack,
      command:
        "corepack pnpm install --frozen-lockfile --store-dir=isolated:pnpm-store",
      mode: "networked",
      cacheState: "empty",
      setEnvironment: {
        COREPACK_HOME: "isolated:corepack",
        COREPACK_DEFAULT_TO_LATEST: "0",
      },
      unsetEnvironment: ["COREPACK_INTEGRITY_KEYS"],
      nodeModulesState: "absent",
    },
    {
      id: "pnpm-offline",
      runtime: "pnpm",
      runtimeVersion: selected.pnpm,
      nodeVersion: selected.node,
      corepackVersion: selected.corepack,
      command:
        "corepack pnpm install --offline --frozen-lockfile --store-dir=isolated:pnpm-store",
      mode: "offline",
      cacheState: "warm",
      setEnvironment: {
        COREPACK_HOME: "isolated:corepack",
        COREPACK_DEFAULT_TO_LATEST: "0",
        COREPACK_ENABLE_NETWORK: "0",
      },
      unsetEnvironment: ["COREPACK_INTEGRITY_KEYS"],
      nodeModulesState: "removed-before-run",
    },
  ];
}

function validateRepeatability(graph: JsonRecord) {
  const repeatability = object(
    object(graph.repository, "repository").repeatability,
    "repeatability",
  );
  exactKeys(
    repeatability,
    ["identities", "runs", "lifecycleExecutions"],
    "repeatability",
  );
  const identities = object(
    repeatability.identities,
    "repeatability.identities",
  );
  exactKeys(identities, RUNTIMES, "repeat identities");
  for (const id of RUNTIMES) {
    invariant(
      identities[id] === packageVersion(graph, id),
      `${id} repeat identity disagrees with selected package`,
    );
  }
  const runs = array(repeatability.runs, "repeatability.runs").map((raw) =>
    object(raw, "repeat run")
  );
  const expected = expectedRepeatRuns(graph);
  exactSet(
    runs.map((run) => string(run.id, "repeat run id")),
    expected.map((run) => String(run.id)),
    "repeat runs",
  );
  for (const expectedRun of expected) {
    const run = object(
      runs.find((candidate) => candidate.id === expectedRun.id),
      String(expectedRun.id),
    );
    const expectedFields = [
      ...Object.keys(expectedRun),
      "exitCode",
      "denoLockSha256",
      "pnpmLockSha256",
      "lifecycleExecutions",
      "runId",
    ];
    exactKeys(run, expectedFields, `${run.id} repeat run`);
    for (const [key, value] of Object.entries(expectedRun)) {
      exactValue(run[key], value, `${run.id}.${key}`);
    }
    assertRedactedProjection(run, `${run.id} structured executable proof`);
    invariant(run.exitCode === 0, `${run.id} did not complete safely`);
    invariant(
      /^fnd003-(?:deno|pnpm)-[a-z]+-\d+$/.test(
        string(run.runId, `${run.id}.runId`),
      ),
      `${run.id} lacks an exact execution identity`,
    );
    digest(run.denoLockSha256, `${run.id}.denoLockSha256`);
    digest(run.pnpmLockSha256, `${run.id}.pnpmLockSha256`);
    array(run.lifecycleExecutions, `${run.id}.lifecycleExecutions`);
  }
  const hashes = runs.map((run) =>
    `${run.denoLockSha256}:${run.pnpmLockSha256}`
  );
  invariant(
    new Set(hashes).size === 1,
    "lock hashes changed between repeat runs",
  );
  exactSet(
    array(repeatability.lifecycleExecutions, "repeat lifecycle executions").map(
      (raw) => JSON.stringify(canonical(raw)),
    ),
    runs.flatMap((run) =>
      array(run.lifecycleExecutions, "run lifecycle executions").map((raw) =>
        JSON.stringify(canonical(raw))
      )
    ),
    "repeatability lifecycle executions",
  );
}

function validateLifecycle(graph: JsonRecord, authority: EvidenceAuthority) {
  const lifecycle = object(graph.lifecycle, "lifecycle");
  exactKeys(lifecycle, ["deno", "pnpm", "hookInventory"], "lifecycle");
  const deno = object(lifecycle.deno, "lifecycle.deno");
  exactKeys(deno, ["allowScripts"], "lifecycle.deno");
  const denoAllow = strings(deno.allowScripts, "lifecycle.deno.allowScripts");
  invariant(
    denoAllow.every((item) => /^npm:.+@\d+\.\d+\.\d+$/.test(item)),
    "Deno allowScripts entries must be exact npm constraints",
  );
  invariant(
    denoAllow.length === 0,
    "Deno policy must remain independently empty",
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
  const packages = array(
    object(object(graph.repository, "repository").pnpm, "pnpm").packages,
    "pnpm packages",
  )
    .map((raw) => object(raw, "pnpm package"));
  const expectedHooks: JsonRecord[] = [];
  for (const item of packages) {
    const id = string(item.id, "package id");
    const evidenceId = string(
      item.manifestEvidenceId,
      `${id}.manifestEvidenceId`,
    );
    const manifestHash = string(
      item.manifestContentSha256,
      `${id}.manifestContentSha256`,
    );
    const manifest = npmManifest(
      authority,
      evidenceId,
      string(item.name, `${id}.name`),
      version(item.version, `${id}.version`),
    );
    const scripts = object(manifest.scripts ?? {}, `${id}.scripts`);
    for (const hookName of ["preinstall", "install", "postinstall"] as const) {
      if (scripts[hookName] !== undefined) {
        expectedHooks.push({
          ecosystem: "pnpm",
          packageName: item.name,
          version: item.version,
          hook: hookName,
          command: string(scripts[hookName], `${id}.${hookName}`),
          manifestEvidenceId: evidenceId,
          manifestContentSha256: manifestHash,
        });
      }
    }
  }
  const hooks = array(lifecycle.hookInventory, "hookInventory").map((raw) =>
    object(raw, "hook inventory item")
  );
  exactSet(
    hooks.map((hook) =>
      `${hook.packageName}@${hook.version}:${hook.hook}:${hook.command}`
    ),
    expectedHooks.map((hook) =>
      `${hook.packageName}@${hook.version}:${hook.hook}:${hook.command}`
    ),
    "transitive hook inventory",
  );
  const exactMatchers = expectedHooks.map((hook) =>
    `${hook.packageName}@${hook.version}`
  );
  exactSet(
    Object.keys(allowBuilds),
    exactMatchers,
    "pnpm exact hook-owner approvals",
  );
  for (const hook of hooks) {
    exactKeys(hook, [
      "ecosystem",
      "packageName",
      "version",
      "hook",
      "command",
      "manifestEvidenceId",
      "manifestContentSha256",
      "reviewed",
      "allowed",
      "approvedMatcher",
    ], "hook inventory item");
    const expected = object(
      expectedHooks.find((candidate) =>
        candidate.packageName === hook.packageName &&
        candidate.version === hook.version && candidate.hook === hook.hook
      ),
      "expected hook",
    );
    for (
      const key of [
        "ecosystem",
        "packageName",
        "version",
        "hook",
        "command",
        "manifestEvidenceId",
        "manifestContentSha256",
      ]
    ) {
      invariant(
        hook[key] === expected[key],
        "hook inventory is not bound to retained manifest bytes",
      );
    }
    invariant(hook.reviewed === true, "hook owner is unreviewed");
    const matcher = `${hook.packageName}@${hook.version}`;
    invariant(
      hook.approvedMatcher === matcher && allowBuilds[matcher] === hook.allowed,
      "hook policy and inventory disagree on exact matcher",
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
  const repeatability = object(
    object(graph.repository, "repository").repeatability,
    "repeatability",
  );
  const runs = array(repeatability.runs, "repeat runs").map((raw) =>
    object(raw, "repeat run")
  );
  const allExecutions = runs.flatMap((run) =>
    array(run.lifecycleExecutions, `${run.id}.lifecycleExecutions`).map((raw) =>
      object(raw, "execution")
    )
  );
  for (const execution of allExecutions) {
    exactKeys(execution, [
      "packageName",
      "version",
      "hook",
      "command",
      "manifestEvidenceId",
      "manifestContentSha256",
      "approvedMatcher",
      "pnpmRunId",
      "exitCode",
    ], "lifecycle execution");
    const run = object(
      runs.find((candidate) => candidate.runId === execution.pnpmRunId),
      "execution run",
    );
    invariant(
      run.runtime === "pnpm",
      "lifecycle execution was attributed to a Deno run",
    );
    const hook = object(
      hooks.find((candidate) =>
        candidate.packageName === execution.packageName &&
        candidate.version === execution.version &&
        candidate.hook === execution.hook
      ),
      "executed hook",
    );
    for (
      const key of [
        "packageName",
        "version",
        "hook",
        "command",
        "manifestEvidenceId",
        "manifestContentSha256",
        "approvedMatcher",
      ]
    ) {
      invariant(
        execution[key] === hook[key],
        "lifecycle execution is not bound to approved manifest hook",
      );
    }
    invariant(
      hook.allowed === true && execution.exitCode === 0,
      "lifecycle execution was not exactly approved and successful",
    );
  }
  for (const hook of hooks) {
    const executions = allExecutions.filter((execution) =>
      execution.packageName === hook.packageName &&
      execution.version === hook.version && execution.hook === hook.hook
    );
    invariant(
      executions.length === (hook.allowed === true ? 1 : 0),
      "required or denied lifecycle execution count drifted",
    );
  }
}

function validateCorepack(graph: JsonRecord, authority: EvidenceAuthority) {
  const corepack = object(graph.corepack, "corepack");
  exactKeys(corepack, ["descriptor", "registryIntegrity", "proof"], "corepack");
  const pnpmVersion = packageVersion(graph, "pnpm");
  const descriptor = string(corepack.descriptor, "corepack.descriptor");
  const match = /^pnpm@([^+]+)\+sha512\.([0-9a-f]+)$/.exec(descriptor);
  invariant(
    match && match[1] === pnpmVersion && COREPACK_SHA512.test(match[2]!),
    "Corepack descriptor must contain exact 128-character lowercase hex sha512",
  );
  const pnpmEvidence = packageEvidenceId(graph, "pnpm");
  const manifest = npmManifest(authority, pnpmEvidence, "pnpm", pnpmVersion);
  const registryIntegrity = sri(
    object(manifest.dist, "pnpm dist").integrity,
    "pnpm registry integrity",
  );
  invariant(
    corepack.registryIntegrity === registryIntegrity,
    "Corepack registry integrity drifted from retained packument",
  );
  const bytes = Uint8Array.from(
    atob(registryIntegrity.slice(7)),
    (character) => character.charCodeAt(0),
  );
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  invariant(
    match[2] === hex,
    "Corepack descriptor checksum disagrees with npm registry SRI bytes",
  );
  const proof = object(corepack.proof, "corepack.proof");
  exactKeys(
    proof,
    ["setEnvironment", "unsetEnvironment", "runs"],
    "corepack.proof",
  );
  exactValue(
    proof.setEnvironment,
    { COREPACK_DEFAULT_TO_LATEST: "0" },
    "Corepack proof environment",
  );
  exactSet(strings(proof.unsetEnvironment, "Corepack unset environment"), [
    "COREPACK_INTEGRITY_KEYS",
  ], "Corepack unset environment");
  const expected: Record<string, JsonRecord> = {
    version: {
      commandIdentity: "corepack-version",
      toolVersion: packageVersion(graph, "corepack"),
      statusToken: "exact-version-confirmed",
    },
    install: {
      commandIdentity: "corepack-cache-exact-package-manager",
      toolVersion: packageVersion(graph, "corepack"),
      statusToken: "package-manager-cached",
    },
    execute: {
      commandIdentity: "corepack-execute-pnpm-version",
      toolVersion: pnpmVersion,
      statusToken: "exact-version-confirmed",
    },
  };
  const runs = array(proof.runs, "corepack runs").map((raw) =>
    object(raw, "corepack run")
  );
  exactSet(
    runs.map((run) => string(run.id, "corepack run id")),
    Object.keys(expected),
    "Corepack proof runs",
  );
  for (const run of runs) {
    exactKeys(
      run,
      [
        "id",
        "commandIdentity",
        "toolVersion",
        "statusToken",
        "exitCode",
        "runId",
      ],
      "Corepack proof run",
    );
    const row = expected[String(run.id)]!;
    assertRedactedProjection(run, `${run.id} Corepack proof`);
    invariant(
      run.commandIdentity === row.commandIdentity &&
        run.toolVersion === row.toolVersion &&
        run.statusToken === row.statusToken && run.exitCode === 0 &&
        /^fnd003-corepack-[a-z-]+-\d+$/.test(
          string(run.runId, `${run.id}.runId`),
        ),
      `${run.id} Corepack executable proof did not pass`,
    );
  }
}

function assertRedactedProjection(value: unknown, label: string) {
  const encoded = JSON.stringify(value);
  invariant(
    !/(?:authorization|bearer|password|passwd|secret|api[-_]?key|token)\s*[:=]/i
      .test(encoded) &&
      !/[A-Za-z]:(?:\\\\)+(?:Users|Documents and Settings)(?:\\\\)+/i
        .test(encoded) &&
      !/(?:^|["'\s])\/(?:home|Users|root)\//.test(encoded),
    `${label} contains secret-bearing or physical-path text`,
  );
}

function packageImports(source: string): string[] {
  return [...source.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((match) =>
    match[1]!
  ).map((specifier) => {
    if (specifier.startsWith("@/")) return "cn-helper";
    if (specifier.startsWith("@")) {
      return specifier.split("/").slice(0, 2).join("/");
    }
    return specifier.split("/")[0]!;
  });
}

function validateShadcn(graph: JsonRecord, authority: EvidenceAuthority) {
  const shadcn = object(graph.shadcn, "shadcn");
  exactKeys(shadcn, [
    "sourceCommit",
    "buttonPath",
    "buttonEvidenceId",
    "buttonDirectImports",
    "cnHelperPath",
    "cnHelperEvidenceId",
    "cnHelperImports",
    "registryInvocation",
    "generatedPayloads",
  ], "shadcn");
  const commit = string(shadcn.sourceCommit, "shadcn.sourceCommit");
  invariant(
    /^[0-9a-f]{40}$/.test(commit),
    "shadcn source commit must be immutable",
  );
  const buttonPath = string(shadcn.buttonPath, "shadcn.buttonPath");
  const buttonId = string(shadcn.buttonEvidenceId, "shadcn.buttonEvidenceId");
  const buttonDescriptor = evidenceKind(
    authority,
    buttonId,
    "immutable-source",
  );
  invariant(
    buttonDescriptor.sourceUrl ===
      `https://raw.githubusercontent.com/shadcn-ui/ui/${commit}/${buttonPath}`,
    "Button source URL is mutable or misbound",
  );
  const expectedButton = [
    "@base-ui/react",
    "class-variance-authority",
    "cn-helper",
  ];
  exactSet(
    authority.sourceImports(buttonId),
    expectedButton,
    "Button retained source imports",
  );
  exactSet(
    strings(shadcn.buttonDirectImports, "buttonDirectImports"),
    expectedButton.map((name) =>
      name === "@base-ui/react" ? "base-ui-react" : name
    ),
    "Button graph imports",
  );
  const cnPath = string(shadcn.cnHelperPath, "shadcn.cnHelperPath");
  const cnId = string(shadcn.cnHelperEvidenceId, "shadcn.cnHelperEvidenceId");
  const cnDescriptor = evidenceKind(authority, cnId, "immutable-source");
  invariant(
    cnDescriptor.sourceUrl ===
      `https://raw.githubusercontent.com/shadcn-ui/ui/${commit}/${cnPath}`,
    "cn helper source URL is mutable or misbound",
  );
  const cnImports = authority.sourceImports(cnId);
  exactSet(cnImports, ["clsx", "tailwind-merge"], "cn retained source imports");
  exactSet(
    strings(shadcn.cnHelperImports, "cnHelperImports"),
    cnImports,
    "cn graph imports",
  );
  invariant(
    !authority.sourceImports(buttonId).includes("lucide-react"),
    "Button source invents lucide-react",
  );
  invariant(
    shadcn.registryInvocation === null &&
      array(shadcn.generatedPayloads, "generatedPayloads").length === 0,
    "mutable shadcn payload is forbidden",
  );
}

function normalizeOciDescriptor(raw: unknown): JsonRecord {
  const descriptor = object(raw, "OCI descriptor");
  invariant(
    Object.keys(descriptor).every((key) =>
      ["mediaType", "digest", "size", "platform", "annotations"].includes(key)
    ) &&
      ["mediaType", "digest", "size", "platform"].every((key) =>
        key in descriptor
      ),
    "OCI descriptor fields are incomplete or unknown",
  );
  const platform = object(descriptor.platform, "OCI descriptor platform");
  invariant(
    ["os", "architecture"].every((key) => key in platform) &&
      Object.keys(platform).every((key) =>
        ["os", "architecture", "variant"].includes(key)
      ),
    "OCI platform fields are incomplete",
  );
  const annotations = object(
    descriptor.annotations ?? {},
    "OCI descriptor annotations",
  );
  const attestation = platform.os === "unknown" &&
    platform.architecture === "unknown" &&
    annotations["vnd.docker.reference.type"] === "attestation-manifest" &&
    typeof annotations["vnd.docker.reference.digest"] === "string";
  return {
    kind: attestation ? "attestation" : "runnable",
    mediaType: descriptor.mediaType,
    digest: descriptor.digest,
    size: descriptor.size,
    os: platform.os,
    architecture: platform.architecture,
    variant: platform.variant ?? null,
    annotations,
  };
}

function validateOci(graph: JsonRecord, authority: EvidenceAuthority) {
  const expected: Record<string, [string, string]> = {
    deno: ["denoland/deno", `debian-${packageVersion(graph, "deno")}`],
    node: ["library/node", `${packageVersion(graph, "node")}-bookworm-slim`],
    playwright: [
      "mcr.microsoft.com/playwright",
      `v${packageVersion(graph, "playwright-test")}-noble`,
    ],
    postgres18: ["library/postgres", "18.4-alpine3.23"],
    postgres17: ["library/postgres", "17.10-alpine3.23"],
  };
  const images = array(graph.ociImages, "ociImages").map((raw) =>
    object(raw, "OCI image")
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
      "evidenceId",
    ], "OCI image");
    const id = string(image.id, "OCI id");
    const declaration = expected[id]!;
    invariant(
      image.repository === declaration[0] && image.tag === declaration[1],
      `${id} official repository or tag is incorrect`,
    );
    const evidenceId = string(image.evidenceId, `${id}.evidenceId`);
    const descriptor = evidenceKind(
      authority,
      evidenceId,
      "oci-index-response",
    );
    const expectedSource =
      String(image.repository).startsWith("mcr.microsoft.com/")
        ? `https://mcr.microsoft.com/v2/${
          String(image.repository).slice(18)
        }/manifests/${image.tag}`
        : `https://registry-1.docker.io/v2/${image.repository}/manifests/${image.tag}`;
    invariant(
      descriptor.sourceUrl === expectedSource,
      `${id} OCI evidence source is not exact`,
    );
    const rawDigest = string(
      descriptor.contentSha256,
      `${id} OCI response digest`,
    );
    invariant(
      image.indexDigest === rawDigest && descriptor.contentSha256 === rawDigest,
      `${id} index digest drifted from raw response bytes`,
    );
    invariant(
      image.reference === `${image.repository}:${image.tag}@${rawDigest}`,
      `${id} reference is not tag plus raw index digest`,
    );
    const index = object(
      authority.ociIndex(evidenceId),
      `${id} index response`,
    );
    invariant(
      index.schemaVersion === 2 && index.mediaType === OCI_INDEX_MEDIA &&
        image.mediaType === index.mediaType,
      `${id} is not an OCI index`,
    );
    const official = array(index.manifests, `${id} manifests`).map(
      normalizeOciDescriptor,
    );
    const declared = array(image.descriptors, `${id} descriptors`).map((raw) =>
      object(raw, `${id} descriptor`)
    );
    exactValue(declared, official, `${id} complete descriptor set`);
    const identities = official.map((row) =>
      `${row.mediaType}:${row.digest}:${row.size}`
    );
    invariant(
      new Set(identities).size === identities.length,
      `${id} descriptor set contains duplicates`,
    );
    const runnable = official.filter((row) => row.kind === "runnable");
    const platforms = runnable.map((row) =>
      `${row.os}/${row.architecture}/${row.variant ?? ""}`
    );
    invariant(
      new Set(platforms).size === platforms.length &&
        platforms.includes("linux/amd64/") && platforms.some((platform) =>
          platform.startsWith("linux/arm64/")
        ),
      `${id} required platforms are absent or duplicated`,
    );
    for (const row of official) {
      invariant(
        Number.isSafeInteger(row.size) && Number(row.size) > 0,
        `${id} descriptor size is invalid`,
      );
      invariant(
        digest(row.digest, `${id} child digest`) !== rawDigest &&
          row.mediaType === OCI_MANIFEST_MEDIA,
        `${id} descriptor is not a child manifest`,
      );
      if (row.kind === "runnable") {
        invariant(
          row.os !== "unknown" && row.architecture !== "unknown",
          `${id} runnable descriptor has unknown platform`,
        );
      } else {
        invariant(
          row.os === "unknown" && row.architecture === "unknown",
          `${id} attestation platform is invalid`,
        );
      }
    }
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
  exactValue(proof.followOns, FOLLOW_ONS, "follow-on ownership");
  const reuse = object(proof.followOnLockReuse, "followOnLockReuse");
  exactKeys(reuse, ["FND-003A", "FND-003B", "FND-003C"], "followOnLockReuse");
  for (const [id, raw] of Object.entries(reuse)) {
    const item = object(raw, id);
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

async function validateGraph(
  graph: JsonRecord,
  readEvidence: EvidenceReader,
  evidenceOptions: EvidenceLoadOptions = {},
): Promise<EvidenceAuthority> {
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
    "provenance",
  ], "graph");
  invariant(graph.schemaVersion === 3, "graph schemaVersion must equal 3");
  const repository = object(graph.repository, "repository");
  exactKeys(repository, [
    "artifacts",
    "directDependencyIds",
    "importEdges",
    "peerEdges",
    "denoSpecifiers",
    "denoLockNodes",
    "pnpm",
    "lockRoots",
    "successorLockPlans",
    "repeatability",
  ], "repository");
  exactSet(strings(repository.directDependencyIds, "directDependencyIds"), [
    ...DIRECT.deno,
    ...DIRECT.pnpm,
  ], "direct dependencies");
  exactSet(
    strings(repository.lockRoots, "lockRoots"),
    LOCK_ROOTS,
    "root lock files",
  );
  invariant(
    array(repository.successorLockPlans, "successorLockPlans").length === 0,
    "successor locks are forbidden",
  );
  const artifacts = array(repository.artifacts, "repository.artifacts").map((
    raw,
  ) => object(raw, "repository artifact"));
  exactSet(
    artifacts.map((item) => string(item.path, "artifact path")),
    REPOSITORY_FILES,
    "repository artifacts",
  );
  for (const artifact of artifacts) {
    exactKeys(artifact, ["path", "sha256"], "repository artifact");
    digest(artifact.sha256, "repository artifact sha256");
  }
  const selection = validateSelection(graph);
  const authority = await loadEvidence(
    graph,
    readEvidence,
    selection.selectedAt,
    evidenceOptions,
  );
  await validateSelected(graph, authority, selection.cutoff);
  validateEdges(graph, authority);
  validateDenoGraph(graph, authority);
  validatePnpmGraph(graph, authority);
  validateRepeatability(graph);
  validateLifecycle(graph, authority);
  validateCorepack(graph, authority);
  validateShadcn(graph, authority);
  validateOci(graph, authority);
  validateProofStatus(graph);
  authority.assertAllUsed();
  return authority;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const SRI = `sha512-${"A".repeat(86)}==`;
const PNPM_SRI =
  "sha512-UhcFvOaJkk6scvWjWHEi82JonvZXHlW6gAdv1jfBETLs/62ib61Op5xIW/3b/T1aKlsFgFp36JPeceyKbMo7sQ==";

function rawDigest(seed: string): string {
  const alphabet = "0123456789abcdef";
  const index =
    [...seed].reduce((sum, character) => sum + character.charCodeAt(0), 0) %
    alphabet.length;
  return alphabet[index]!.repeat(64);
}

function nextVersion(id: string, increment = 1): string {
  const [major, minor, patch] = fixtureVersion(id).split(".").map(Number);
  return `${major}.${minor}.${patch! + increment}`;
}

function fixtureVersions(id: string): string[] {
  if (id === "pnpm") return [fixtureVersion(id)];
  if (id === "astro") {
    return [fixtureVersion(id), nextVersion(id), nextVersion(id, 2)];
  }
  if (id === "typescript") return [fixtureVersion(id), "6.0.0"];
  if (id === "eslint-plugin-react-hooks") {
    return [fixtureVersion(id), "8.0.0"];
  }
  return [fixtureVersion(id), nextVersion(id)];
}

function rangeMaps(id: string): JsonRecord {
  const result: Record<string, JsonRecord> = {
    dependencies: {},
    optionalDependencies: {},
    peerDependencies: {},
  };
  for (
    const [edgeId, pair] of Object.entries({ ...IMPORT_PAIRS, ...PEER_PAIRS })
  ) {
    const relation = MANIFEST_RELATIONS[edgeId];
    if (pair[0] === id && relation) {
      object(result[relation], relation)[nameOf(pair[1])] =
        MANIFEST_RANGES[edgeId];
    }
  }
  return result;
}

function manifestFor(id: string, itemVersion = fixtureVersion(id)): JsonRecord {
  const ranges = rangeMaps(id);
  if (id === "hono") {
    object(ranges.dependencies, "dependencies").zod = "^4.0.0";
    object(ranges.optionalDependencies, "optionalDependencies")[
      "@scope/runtime"
    ] = "^1.2.0";
  }
  if (id === "kysely-postgres-js") {
    object(ranges.peerDependencies, "peerDependencies").kysely =
      MANIFEST_RANGES["dialect-peer-kysely"];
    object(ranges.peerDependencies, "peerDependencies").postgres =
      MANIFEST_RANGES["dialect-postgres"];
  }
  if (
    id === "eslint-plugin-react-hooks" && itemVersion !== fixtureVersion(id)
  ) {
    object(ranges.peerDependencies, "peerDependencies").eslint = "^10.0.0";
    object(ranges.dependencies, "dependencies")["missing-runtime"] = "^1.0.0";
  }
  const scripts = id === "esbuild"
    ? { postinstall: "node install.js" }
    : id === "fsevents"
    ? { install: "node-gyp rebuild" }
    : {};
  return {
    name: nameOf(id),
    version: itemVersion,
    dist: {
      integrity: id === "pnpm" ? PNPM_SRI : SRI,
      shasum: rawDigest(`${id}-shasum`).slice(0, 40),
      tarball: `https://registry.npmjs.org/${nameOf(id)}/-/${
        nameOf(id).split("/").at(-1)
      }-${itemVersion}.tgz`,
    },
    ...(id === "standard-schema-spec" ? {} : {
      dependencies: ranges.dependencies,
      optionalDependencies: ranges.optionalDependencies,
    }),
    ...(id === "types-react" || id === "standard-schema-spec"
      ? {}
      : { peerDependencies: ranges.peerDependencies }),
    ...(id === "types-react" ? {} : { scripts }),
    engines: id === "esbuild" || id === "fsevents" ? { node: ">=18" } : {},
    os: id === "fsevents" ? ["darwin"] : [],
    cpu: id === "fsevents" ? ["x64", "arm64"] : [],
    libc: id === "fsevents" ? ["glibc"] : [],
    ...(id === "astro-react"
      ? {
        peerDependenciesMeta: { "@types/react": { optional: true } },
      }
      : {}),
    ...(id === "kysely-postgres-js"
      ? { peerDependenciesMeta: { postgres: { optional: true } } }
      : {}),
    ...(id === "astro"
      ? {
        deprecated: "fixture deprecation",
        bundledDependencies: ["fixture-child"],
      }
      : {}),
    ...(id === "esbuild" ? { bin: { esbuild: "bin/esbuild" } } : {}),
  };
}

interface Fixture {
  graph: JsonRecord;
  evidence: Map<string, Uint8Array>;
}

async function makeFixture(): Promise<Fixture> {
  const evidence = new Map<string, Uint8Array>();
  const provenance: JsonRecord[] = [];
  const addEvidence = async (
    id: string,
    kind: string,
    sourceUrl: string,
    body: string,
  ) => {
    const bytes = await gzip(body);
    const path = `${PROVENANCE_ROOT}${
      id.replaceAll(/[^A-Za-z0-9._-]/g, "-")
    }.gz`;
    provenance.push({
      id,
      kind,
      path,
      compression: "gzip",
      sourceUrl,
      retrievedAt: "2026-01-10T04:05:06.789Z",
      contentSha256: await sha256Text(body),
      artifactSha256: await sha256Bytes(bytes),
    });
    evidence.set(path, bytes);
  };
  const selectedIds = [...RUNTIMES, ...DIRECT.deno, ...DIRECT.pnpm];
  const pnpmPackageIds = [
    ...DIRECT.pnpm,
    "types-react",
    "types-react-dom",
    "astro-eslint-parser",
    "esbuild",
    "fsevents",
    "scheduler",
  ];
  const npmIds = [
    ...new Set<string>([
      ...selectedIds.filter((id) => id !== "deno" && id !== "node"),
      ...pnpmPackageIds,
      "scope-runtime",
    ]),
  ];
  for (const id of npmIds) {
    const versions = fixtureVersions(id);
    const time = Object.fromEntries(versions.map((item, index) => [
      item,
      index === 0
        ? "2026-01-01T04:05:06.789Z"
        : id === "typescript" || id === "eslint-plugin-react-hooks"
        ? "2026-01-05T04:05:06.790Z"
        : index === 1
        ? "2026-01-08T04:05:06.790Z"
        : "2026-01-09T04:05:06.791Z",
    ]));
    const packument = {
      _id: nameOf(id),
      _rev: "1-fixture",
      name: nameOf(id),
      "dist-tags": { latest: versions.at(-1) },
      time: {
        created: "2025-01-01T00:00:00.000Z",
        modified: "2026-01-09T04:05:06.999Z",
        ...time,
      },
      versions: Object.fromEntries(versions.map((item) => [
        item,
        manifestFor(id, item),
      ])),
    };
    if (id === "astro") {
      object(packument.versions, "Astro fixture versions")["5.15.8-beta.1"] =
        manifestFor("astro", "5.15.8-beta.1");
      object(packument.time, "Astro fixture times")["5.15.8-beta.1"] =
        "2026-01-09T04:05:06.792Z";
    }
    await addEvidence(
      `npm-${id}`,
      "npm-packument",
      `https://registry.npmjs.org/${encodeURIComponent(nameOf(id))}`,
      JSON.stringify(packument),
    );
  }
  for (const id of ["deno", "node"] as const) {
    const rows: JsonRecord[] = [
      {
        tag_name: `v${fixtureVersion(id)}`,
        published_at: "2026-01-01T04:05:06.789Z",
        draft: false,
        prerelease: false,
      },
      {
        tag_name: `v${nextVersion(id)}`,
        published_at: "2026-01-09T04:05:06.790Z",
        draft: false,
        prerelease: false,
      },
      ...(id === "node"
        ? [
          {
            tag_name: "v25.1.0",
            published_at: "2026-01-09T05:05:06.790Z",
            draft: false,
            prerelease: false,
          },
          {
            tag_name: "v22.20.0",
            published_at: "2025-12-01T04:05:06.789Z",
            draft: false,
            prerelease: false,
          },
        ]
        : []),
      {
        tag_name: `v${nextVersion(id, 2)}-rc.1`,
        published_at: "2026-01-09T04:05:06.791Z",
        draft: false,
        prerelease: true,
      },
    ];
    if (id === "deno") {
      await addEvidence(
        "deno-releases",
        "official-release-index",
        "https://api.github.com/repos/denoland/deno/releases",
        JSON.stringify(rows),
      );
    } else {
      for (
        const row of rows.filter((candidate) =>
          typeof candidate.tag_name === "string" &&
          [
            `v${fixtureVersion("node")}`,
            `v${nextVersion("node")}`,
          ].includes(candidate.tag_name)
        )
      ) {
        const tag = string(row.tag_name, "Node fixture tag");
        await addEvidence(
          `node-release-${tag.slice(1)}`,
          "official-release-detail",
          `https://api.github.com/repos/nodejs/node/releases/tags/${tag}`,
          JSON.stringify(row),
        );
      }
    }
    if (id === "node") {
      const nodeIndexDefaults = {
        files: ["win-x64-zip"],
        npm: "11.6.1",
        v8: "13.6.233.10",
        uv: "1.51.0",
        zlib: "1.3.1",
        openssl: "3.5.4",
        modules: "137",
        security: false,
      };
      await addEvidence(
        "node-lts-index",
        "official-release-index",
        "https://nodejs.org/dist/index.json",
        JSON.stringify([
          {
            ...nodeIndexDefaults,
            version: `v${nextVersion("node")}`,
            date: "2026-01-09",
            lts: "Krypton",
          },
          {
            ...nodeIndexDefaults,
            version: `v${fixtureVersion("node")}`,
            date: "2026-01-01",
            lts: "Krypton",
          },
          {
            ...nodeIndexDefaults,
            version: "v25.1.0",
            date: "2026-01-09",
            lts: false,
          },
          {
            version: "v22.20.0",
            date: "2025-12-01",
            files: ["linux-x64"],
            v8: "12.4.254.21",
            uv: "1.51.0",
            modules: "127",
            lts: "Jod",
          },
        ]),
      );
    }
    const filename = id === "deno"
      ? "deno-x86_64-pc-windows-msvc.zip"
      : `node-v${fixtureVersion(id)}-win-x64.zip`;
    const checksumSource = id === "deno"
      ? `https://github.com/denoland/deno/releases/download/v${
        fixtureVersion(id)
      }/deno-x86_64-pc-windows-msvc.zip.sha256sum`
      : `https://nodejs.org/dist/v${fixtureVersion(id)}/SHASUMS256.txt`;
    await addEvidence(
      `${id}-checksum`,
      "release-checksum",
      checksumSource,
      `${rawDigest(id)}  ${filename}\n`,
    );
  }
  const sourceCommit = "a".repeat(40);
  const buttonPath = "apps/v4/registry/bases/base/ui/button.tsx";
  const cnPath = "apps/v4/registry/bases/base/lib/utils.ts";
  await addEvidence(
    "shadcn-button",
    "immutable-source",
    `https://raw.githubusercontent.com/shadcn-ui/ui/${sourceCommit}/${buttonPath}`,
    'import { Button as ButtonPrimitive } from "@base-ui/react/button"\nimport { cva } from "class-variance-authority"\nimport { cn } from "@/lib/utils"\nexport { ButtonPrimitive, cva, cn }\n',
  );
  await addEvidence(
    "shadcn-cn",
    "immutable-source",
    `https://raw.githubusercontent.com/shadcn-ui/ui/${sourceCommit}/${cnPath}`,
    'import { clsx } from "clsx"\nimport { twMerge } from "tailwind-merge"\nexport const cn = (...value: unknown[]) => twMerge(clsx(value))\n',
  );

  const fixtureCompatibilityFailures = (
    id: string,
    candidateVersion: string,
  ): JsonRecord[] => {
    const candidateName = nameOf(id);
    const resolutions = new Map(
      npmIds.map((item) => [nameOf(item), fixtureVersion(item)]),
    );
    resolutions.set(candidateName, candidateVersion);
    const failures: JsonRecord[] = [];
    for (
      const requirement of requiredManifestRanges(
        manifestFor(id, candidateVersion),
      )
    ) {
      const resolution = resolutions.get(requirement.name);
      if (!resolution || !satisfiesRange(resolution, requirement.range)) {
        failures.push({
          direction: "forward",
          owner: candidateName,
          ownerVersion: candidateVersion,
          kind: requirement.relation,
          target: requirement.name,
          range: requirement.range,
          actualResolution: resolution ?? null,
          optional: false,
          manifestEvidenceId: `npm-${id}`,
          manifestContentSha256: provenance.find((item) =>
            item.id === `npm-${id}`
          )!.contentSha256,
        });
      }
    }
    for (const ownerId of npmIds) {
      if (ownerId === id) continue;
      for (const requirement of requiredManifestRanges(manifestFor(ownerId))) {
        if (
          requirement.name === candidateName &&
          !satisfiesRange(candidateVersion, requirement.range)
        ) {
          failures.push({
            direction: "reverse",
            owner: nameOf(ownerId),
            ownerVersion: fixtureVersion(ownerId),
            kind: requirement.relation,
            target: candidateName,
            range: requirement.range,
            actualResolution: candidateVersion,
            optional: false,
            manifestEvidenceId: `npm-${ownerId}`,
            manifestContentSha256: provenance.find((item) =>
              item.id === `npm-${ownerId}`
            )!.contentSha256,
          });
        }
      }
    }
    return failures.sort((left, right) =>
      JSON.stringify(canonical(left)).localeCompare(
        JSON.stringify(canonical(right)),
      )
    );
  };

  const selectedPackages = selectedIds.map((id) => {
    const runtime = id === "deno" || id === "node";
    const newerVersions = fixtureVersions(id).slice(1);
    const newerReleases = newerVersions.map((newerVersion, index) => {
      const eligible = id === "typescript" ||
        id === "eslint-plugin-react-hooks";
      const failingEdges = fixtureCompatibilityFailures(id, newerVersion);
      return {
        version: newerVersion,
        publishedAt: eligible
          ? "2026-01-05T04:05:06.790Z"
          : runtime
          ? "2026-01-09T04:05:06.790Z"
          : index === 0
          ? "2026-01-08T04:05:06.790Z"
          : "2026-01-09T04:05:06.791Z",
        compatible: failingEdges.length === 0,
        reason: eligible
          ? "incompatible-retained-manifest"
          : "younger-than-cutoff",
        failingEdges,
      };
    });
    return {
      id,
      name: nameOf(id),
      version: fixtureVersion(id),
      publishedAt: "2026-01-01T04:05:06.789Z",
      manifest: DIRECT.deno.includes(id as never)
        ? "deno"
        : DIRECT.pnpm.includes(id as never)
        ? "pnpm"
        : "runtime",
      publicationEvidenceId: id === "deno"
        ? "deno-releases"
        : id === "node"
        ? `node-release-${fixtureVersion("node")}`
        : `npm-${id}`,
      artifactEvidenceId: runtime ? `${id}-checksum` : `npm-${id}`,
      artifactValue: runtime
        ? `sha256:${rawDigest(id)}`
        : id === "pnpm"
        ? PNPM_SRI
        : SRI,
      latestStable: id === "node" ? "25.1.0" : fixtureVersions(id).at(-1),
      newerReleases,
      ...(!runtime ? { distTags: { latest: fixtureVersions(id).at(-1) } } : {}),
      ...(id === "node"
        ? {
          lts: "Krypton",
          latestLts: nextVersion("node"),
          ltsIndexEvidenceId: "node-lts-index",
          releaseEvidenceIds: {
            [`v${nextVersion("node")}`]: `node-release-${nextVersion("node")}`,
            [`v${fixtureVersion("node")}`]: `node-release-${
              fixtureVersion("node")
            }`,
          },
        }
        : {}),
    };
  });

  const packageRows = pnpmPackageIds.map((id) => {
    const manifestEvidenceId = `npm-${id}`;
    const descriptor = provenance.find((item) =>
      item.id === manifestEvidenceId
    )!;
    const manifest = manifestFor(id);
    const peerDependencies = object(
      manifest.peerDependencies ?? {},
      `${id} peerDependencies`,
    );
    const peerDependenciesMeta = object(
      manifest.peerDependenciesMeta ?? {},
      `${id} peerDependenciesMeta`,
    );
    const value: JsonRecord = {
      resolution: { integrity: SRI },
      ...(Object.keys(peerDependencies).length ? { peerDependencies } : {}),
      ...(Object.keys(peerDependenciesMeta).length
        ? { peerDependenciesMeta }
        : {}),
      ...(id === "esbuild" ? { engines: { node: ">=18" }, hasBin: true } : {}),
      ...(id === "fsevents"
        ? {
          engines: { node: ">=18" },
          os: ["darwin"],
          cpu: ["x64", "arm64"],
          libc: ["glibc"],
        }
        : id === "astro"
        ? {
          deprecated: "fixture deprecation",
          bundledDependencies: ["fixture-child"],
        }
        : {}),
    };
    return {
      id,
      resolutionId: `pnpm:${nameOf(id)}@${fixtureVersion(id)}`,
      key: `${nameOf(id)}@${fixtureVersion(id)}`,
      name: nameOf(id),
      version: fixtureVersion(id),
      manifestEvidenceId,
      manifestContentSha256: descriptor.contentSha256,
      value,
    };
  });
  const primarySnapshotKeys = new Map<string, string>();
  const primarySnapshotKey = (id: string, stack: string[] = []): string => {
    const cached = primarySnapshotKeys.get(id);
    if (cached) return cached;
    invariant(!stack.includes(id), "synthetic peer graph contains a cycle");
    const item = object(
      packageRows.find((candidate) => candidate.id === id),
      `${id} package`,
    );
    const manifest = manifestFor(String(item.id));
    const peers = Object.keys(
      object(manifest.peerDependencies ?? {}, "peerDependencies"),
    ).filter((name) => packageRows.some((candidate) => candidate.name === name))
      .sort();
    const suffix = peers.map((name) => {
      const target = packageRows.find((candidate) => candidate.name === name)!;
      return `(${primarySnapshotKey(String(target.id), [...stack, id])})`;
    }).join("");
    const key = `${item.key}${suffix}`;
    primarySnapshotKeys.set(id, key);
    return key;
  };
  for (const item of packageRows) {
    primarySnapshotKey(String(item.id));
  }
  const allPairs = Object.values({ ...IMPORT_PAIRS, ...PEER_PAIRS });
  const snapshotRows = packageRows.map((item) => {
    const requiredIds = [
      ...new Set(
        allPairs.filter(([from, to]) =>
          from === item.id && packageRows.some((row) => row.id === to)
        ).map(([, to]) => to),
      ),
    ];
    const optionalIds = item.id === "vite" ? ["fsevents"] : [];
    const requiredWithoutOptional = requiredIds.filter((id) =>
      !optionalIds.includes(id)
    );
    const dependencies = Object.fromEntries(
      requiredWithoutOptional.map((id) => {
        const target = packageRows.find((row) => row.id === id)!;
        return [
          target.name,
          primarySnapshotKeys.get(id)!.slice(target.name.length + 1),
        ];
      }),
    );
    const optionalDependencies = Object.fromEntries(optionalIds.map((id) => {
      const target = packageRows.find((row) => row.id === id)!;
      return [
        target.name,
        primarySnapshotKeys.get(id)!.slice(target.name.length + 1),
      ];
    }));
    return {
      id: `primary:${item.id}`,
      key: primarySnapshotKeys.get(String(item.id)),
      packageKey: item.key,
      value: {
        ...(Object.keys(dependencies).length ? { dependencies } : {}),
        ...(Object.keys(optionalDependencies).length
          ? { optionalDependencies }
          : {}),
        ...(item.id === "fsevents" ? { optional: true } : {}),
        ...(item.id === "astro-react"
          ? { transitivePeerDependencies: ["scheduler"] }
          : {}),
      },
      dependencyIds: Object.fromEntries(
        requiredWithoutOptional.map((id) => [
          nameOf(id),
          `pnpm:${nameOf(id)}@${fixtureVersion(id)}`,
        ]),
      ),
      optionalDependencyIds: Object.fromEntries(
        optionalIds.map((id) => [
          nameOf(id),
          `pnpm:${nameOf(id)}@${fixtureVersion(id)}`,
        ]),
      ),
      peerIds: Object.fromEntries(
        Object.keys(parsePnpmPeerSuffix(
          primarySnapshotKeys.get(String(item.id))!.slice(item.key.length),
        )).map((name) => {
          const target = packageRows.find((row) => row.name === name)!;
          return [name, target.resolutionId];
        }),
      ),
      transitivePeerIds: item.id === "astro-react"
        ? { scheduler: `pnpm:scheduler@${fixtureVersion("scheduler")}` }
        : {},
      transitivePeerResolutions: item.id === "astro-react"
        ? {
          scheduler: primarySnapshotKeys.get("scheduler")!.slice(
            "scheduler@".length,
          ),
        }
        : {},
    };
  });
  const astroReactPackage = packageRows.find((item) =>
    item.id === "astro-react"
  )!;
  const astroReactManifest = manifestFor("astro-react");
  const alternatePeers = Object.keys(
    object(astroReactManifest.peerDependencies, "astro-react peers"),
  ).filter((name) => name !== "@types/react").sort();
  snapshotRows.push({
    id: "alternate:astro-react-optional-peer-omitted",
    key: `${astroReactPackage.key}${
      alternatePeers.map((name) => {
        const target = packageRows.find((candidate) =>
          candidate.name === name
        )!;
        return `(${primarySnapshotKeys.get(String(target.id))})`;
      }).join("")
    }`,
    packageKey: astroReactPackage.key,
    value: {},
    dependencyIds: {},
    optionalDependencyIds: {},
    peerIds: Object.fromEntries(alternatePeers.map((name) => {
      const target = packageRows.find((candidate) => candidate.name === name)!;
      return [name, target.resolutionId];
    })),
    transitivePeerIds: {},
    transitivePeerResolutions: {},
  });
  const rootImporterValue = {
    dependencies: {},
    devDependencies: Object.fromEntries(DIRECT.pnpm.map((id) => [
      nameOf(id),
      {
        specifier: fixtureVersion(id),
        version: primarySnapshotKeys.get(id)!.slice(nameOf(id).length + 1),
      },
    ])),
    optionalDependencies: {},
  };
  const importers = [{
    id: ".",
    value: rootImporterValue,
    dependencyIds: {},
    devDependencyIds: Object.fromEntries(
      DIRECT.pnpm.map((id) => [
        nameOf(id),
        `pnpm:${nameOf(id)}@${fixtureVersion(id)}`,
      ]),
    ),
    optionalDependencyIds: {},
  }];
  const denoSpecifiers: JsonRecord = Object.fromEntries([
    ...DIRECT.deno.map((
      id,
    ) => [
      `npm:${nameOf(id)}@${fixtureVersion(id)}`,
      id === "kysely-postgres-js"
        ? `${fixtureVersion(id)}_kysely@${fixtureVersion("kysely")}_postgres@${
          fixtureVersion("postgres")
        }`
        : id === "hono-standard-validator"
        ? `${fixtureVersion(id)}_hono@${
          fixtureVersion("hono")
        }_@standard-schema+spec@${fixtureVersion("standard-schema-spec")}`
        : fixtureVersion(id),
    ]),
    ["npm:legacy-hono@npm:hono@4.10.6", "hono@4.10.6"],
    ["npm:@scope/alias@npm:@scope/runtime@1.2.3", "@scope/runtime@1.2.3"],
    ["npm:zod@^4.0.0", "4.1.12"],
    ["jsr:@std/assert@1.0.14", "1.0.14"],
    ["jsr:@std/internal@^1.0.10", "1.0.14"],
  ]);
  const denoLockNodes: JsonRecord[] = [
    ...DIRECT.deno.map((id) => {
      const evidenceId = `npm-${id}`;
      return {
        key: `npm:${nameOf(id)}@${fixtureVersion(id)}${
          id === "kysely-postgres-js"
            ? `_kysely@${fixtureVersion("kysely")}_postgres@${
              fixtureVersion("postgres")
            }`
            : id === "hono-standard-validator"
            ? `_hono@${fixtureVersion("hono")}_@standard-schema+spec@${
              fixtureVersion("standard-schema-spec")
            }`
            : ""
        }`,
        kind: "npm",
        integrity: SRI,
        manifestEvidenceId: evidenceId,
        manifestContentSha256: provenance.find((item) =>
          item.id === evidenceId
        )!.contentSha256,
        ...(id === "hono"
          ? {
            dependencies: ["npm:zod@^4.0.0"],
            optionalDependencies: [
              "@scope/alias@npm:@scope/runtime@1.2.3",
            ],
          }
          : id === "hono-standard-validator"
          ? {
            dependencies: [
              `hono@${fixtureVersion("hono")}`,
              `@standard-schema/spec@${fixtureVersion("standard-schema-spec")}`,
            ],
          }
          : id === "kysely-postgres-js"
          ? {
            dependencies: ["kysely", "postgres"],
            optionalPeers: ["postgres"],
          }
          : {}),
      };
    }),
    {
      key: "npm:@scope/runtime@1.2.3",
      kind: "npm",
      integrity: SRI,
      manifestEvidenceId: "npm-scope-runtime",
      manifestContentSha256:
        provenance.find((item) => item.id === "npm-scope-runtime")!
          .contentSha256,
      os: ["linux"],
      cpu: ["x64", "arm64"],
      tarball: "https://registry.npmjs.org/runtime/-/runtime-1.2.3.tgz",
      deprecated: false,
      scripts: true,
      bin: true,
    },
    {
      key: "jsr:@std/assert@1.0.14",
      kind: "jsr",
      integrity: rawDigest("a"),
      dependencies: ["jsr:@std/internal@^1.0.10"],
    },
    { key: "jsr:@std/internal@1.0.14", kind: "jsr", integrity: rawDigest("b") },
  ];

  const edgeRows = (contracts: Record<string, [string, string]>) =>
    Object.entries(contracts).map(([id, [from, to]]) => {
      const relation = MANIFEST_RELATIONS[id];
      const immutable = id.startsWith("button-") || id.startsWith("cn-");
      return {
        id,
        from,
        to,
        authority: relation
          ? "npm-manifest"
          : immutable
          ? "immutable-source"
          : "successor-import",
        relation: relation ?? null,
        manifestRange: relation ? MANIFEST_RANGES[id] : null,
        selectedResolution: fixtureVersion(to),
        evidenceId: relation ? `npm-${from}` : null,
      };
    });
  const runBase = expectedRepeatRuns({
    selectedPackages,
    repository: { pnpm: { packages: packageRows } },
  } as JsonRecord);
  const runs = runBase.map((run, index) => ({
    ...run,
    runId: `fnd003-${run.runtime}-${String(run.id).split("-")[1]}-${index + 1}`,
    exitCode: 0,
    denoLockSha256: `sha256:${rawDigest("c")}`,
    pnpmLockSha256: `sha256:${rawDigest("d")}`,
    lifecycleExecutions: run.id === "pnpm-clean"
      ? [{
        packageName: "esbuild",
        version: fixtureVersion("esbuild"),
        hook: "postinstall",
        command: "node install.js",
        manifestEvidenceId: "npm-esbuild",
        manifestContentSha256: provenance.find((item) =>
          item.id === "npm-esbuild"
        )!.contentSha256,
        approvedMatcher: `esbuild@${fixtureVersion("esbuild")}`,
        pnpmRunId: `fnd003-pnpm-clean-${index + 1}`,
        exitCode: 0,
      }]
      : [],
  }));
  const hookInventory = ["esbuild", "fsevents"].map((id) => ({
    ecosystem: "pnpm",
    packageName: id,
    version: fixtureVersion(id),
    hook: id === "esbuild" ? "postinstall" : "install",
    command: id === "esbuild" ? "node install.js" : "node-gyp rebuild",
    manifestEvidenceId: `npm-${id}`,
    manifestContentSha256:
      provenance.find((item) => item.id === `npm-${id}`)!.contentSha256,
    reviewed: true,
    allowed: id === "esbuild",
    approvedMatcher: `${id}@${fixtureVersion(id)}`,
  }));
  const images: Record<string, [string, string]> = {
    deno: ["denoland/deno", `debian-${fixtureVersion("deno")}`],
    node: ["library/node", `${fixtureVersion("node")}-bookworm-slim`],
    playwright: [
      "mcr.microsoft.com/playwright",
      `v${fixtureVersion("playwright-test")}-noble`,
    ],
    postgres18: ["library/postgres", "18.4-alpine3.23"],
    postgres17: ["library/postgres", "17.10-alpine3.23"],
  };
  const ociImages: JsonRecord[] = [];
  let imageIndex = 0;
  for (const [id, [repository, tag]] of Object.entries(images)) {
    const rawDescriptors: JsonRecord[] = [
      {
        mediaType: OCI_MANIFEST_MEDIA,
        digest: `sha256:${rawDigest(String(++imageIndex))}`,
        size: 1644,
        platform: { os: "linux", architecture: "amd64" },
      },
      {
        mediaType: OCI_MANIFEST_MEDIA,
        digest: `sha256:${rawDigest(String(++imageIndex))}`,
        size: 1645,
        platform: { os: "linux", architecture: "arm64", variant: "v8" },
      },
      ...(id.startsWith("postgres")
        ? [
          {
            mediaType: OCI_MANIFEST_MEDIA,
            digest: `sha256:${rawDigest(String(++imageIndex))}`,
            size: 1500,
            platform: { os: "linux", architecture: "arm", variant: "v6" },
          },
          {
            mediaType: OCI_MANIFEST_MEDIA,
            digest: `sha256:${rawDigest(String(++imageIndex))}`,
            size: 1501,
            platform: { os: "linux", architecture: "arm", variant: "v7" },
          },
        ]
        : []),
      ...(id === "playwright" ? [] : [{
        mediaType: OCI_MANIFEST_MEDIA,
        digest: `sha256:${rawDigest(String(++imageIndex))}`,
        size: 900,
        platform: { os: "unknown", architecture: "unknown" },
        annotations: {
          "vnd.docker.reference.type": "attestation-manifest",
          "vnd.docker.reference.digest": `sha256:${rawDigest("f")}`,
        },
      }]),
    ];
    const body = JSON.stringify({
      schemaVersion: 2,
      mediaType: OCI_INDEX_MEDIA,
      manifests: rawDescriptors,
    });
    const evidenceId = `oci-${id}`;
    const sourceUrl = repository.startsWith("mcr.microsoft.com/")
      ? `https://mcr.microsoft.com/v2/${repository.slice(18)}/manifests/${tag}`
      : `https://registry-1.docker.io/v2/${repository}/manifests/${tag}`;
    await addEvidence(evidenceId, "oci-index-response", sourceUrl, body);
    const indexDigest = await sha256Text(body);
    ociImages.push({
      id,
      repository,
      tag,
      indexDigest,
      reference: `${repository}:${tag}@${indexDigest}`,
      mediaType: OCI_INDEX_MEDIA,
      descriptors: rawDescriptors.map(normalizeOciDescriptor),
      evidenceId,
    });
  }

  const graph: JsonRecord = {
    schemaVersion: 3,
    selection: {
      selectedAt: "2026-01-10T04:05:06.789Z",
      minimumAgeHours: 72,
      eligibleBefore: "2026-01-07T04:05:06.789Z",
    },
    selectedPackages,
    repository: {
      artifacts: REPOSITORY_FILES.map((path, index) => ({
        path,
        sha256: `sha256:${rawDigest(String(index + 1))}`,
      })),
      directDependencyIds: [...DIRECT.deno, ...DIRECT.pnpm],
      importEdges: edgeRows(IMPORT_PAIRS),
      peerEdges: edgeRows(PEER_PAIRS),
      denoSpecifiers,
      denoLockNodes,
      pnpm: { importers, packages: packageRows, snapshots: snapshotRows },
      lockRoots: [...LOCK_ROOTS],
      successorLockPlans: [],
      repeatability: {
        identities: Object.fromEntries(
          RUNTIMES.map((id) => [id, fixtureVersion(id)]),
        ),
        runs,
        lifecycleExecutions: runs.flatMap((run) => run.lifecycleExecutions),
      },
    },
    corepack: {
      descriptor:
        "pnpm@11.21.0+sha512.521705bce689924eac72f5a3587122f362689ef6571e55ba80076fd637c11132ecffada26fad4ea79c485bfddbfd3d5a2a5b05805a77e893de71ec8a6cca3bb1",
      registryIntegrity: PNPM_SRI,
      proof: {
        setEnvironment: { COREPACK_DEFAULT_TO_LATEST: "0" },
        unsetEnvironment: ["COREPACK_INTEGRITY_KEYS"],
        runs: [
          {
            id: "version",
            commandIdentity: "corepack-version",
            toolVersion: fixtureVersion("corepack"),
            statusToken: "exact-version-confirmed",
            exitCode: 0,
            runId: "fnd003-corepack-version-1",
          },
          {
            id: "install",
            commandIdentity: "corepack-cache-exact-package-manager",
            toolVersion: fixtureVersion("corepack"),
            statusToken: "package-manager-cached",
            exitCode: 0,
            runId: "fnd003-corepack-install-2",
          },
          {
            id: "execute",
            commandIdentity: "corepack-execute-pnpm-version",
            toolVersion: fixtureVersion("pnpm"),
            statusToken: "exact-version-confirmed",
            exitCode: 0,
            runId: "fnd003-corepack-execute-3",
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
          [`fsevents@${fixtureVersion("fsevents")}`]: false,
        },
      },
      hookInventory,
    },
    shadcn: {
      sourceCommit,
      buttonPath,
      buttonEvidenceId: "shadcn-button",
      buttonDirectImports: [
        "base-ui-react",
        "class-variance-authority",
        "cn-helper",
      ],
      cnHelperPath: cnPath,
      cnHelperEvidenceId: "shadcn-cn",
      cnHelperImports: ["clsx", "tailwind-merge"],
      registryInvocation: null,
      generatedPayloads: [],
    },
    ociImages,
    proofStatus: {
      runtimeBehavior: "proof-pending",
      followOns: clone(FOLLOW_ONS),
      followOnLockReuse: Object.fromEntries(
        ["FND-003A", "FND-003B", "FND-003C"].map((id) => [
          id,
          { locks: [...LOCK_ROOTS], mutation: "forbidden" },
        ]),
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
    provenance,
  };
  return { graph, evidence };
}

interface YamlRenderOptions {
  quoteAll?: boolean;
  crlf?: boolean;
}

function yamlRenderScalar(
  value: Exclude<YamlValue, YamlValue[] | YamlRecord>,
  quoteAll: boolean,
): string {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }
  if (
    quoteAll || value === "" || /^(?:true|false|null|~|-?\d+)$/.test(value) ||
    /^[!&*]/.test(value) || /[:#\[\]{},]/.test(value)
  ) return JSON.stringify(value);
  return value;
}

function yamlRenderKey(key: string, quoteAll: boolean): string {
  return quoteAll || key === "." || key.startsWith("@") || /[():]/.test(key)
    ? JSON.stringify(key)
    : key;
}

function renderYaml(
  value: YamlRecord,
  options: YamlRenderOptions = {},
): string {
  const lines: string[] = [];
  const render = (item: YamlValue, indent: number, key?: string) => {
    const prefix = " ".repeat(indent);
    const renderedKey = key === undefined
      ? ""
      : `${yamlRenderKey(key, options.quoteAll === true)}:`;
    if (Array.isArray(item)) {
      if (item.length === 0) lines.push(`${prefix}${renderedKey} []`);
      else {
        if (key !== undefined) lines.push(`${prefix}${renderedKey}`);
        for (const entry of item) {
          invariant(
            entry === null || typeof entry !== "object",
            "fixture YAML lists contain scalars only",
          );
          lines.push(
            `${" ".repeat(indent + (key === undefined ? 0 : 2))}- ${
              yamlRenderScalar(entry, options.quoteAll === true)
            }`,
          );
        }
      }
    } else if (item !== null && typeof item === "object") {
      const entries = Object.entries(item);
      if (entries.length === 0) {
        lines.push(`${prefix}${renderedKey} {}`);
      } else {
        if (key !== undefined) lines.push(`${prefix}${renderedKey}`);
        const childIndent = indent + (key === undefined ? 0 : 2);
        for (const [childKey, child] of entries) {
          render(child, childIndent, childKey);
        }
      }
    } else {
      lines.push(
        `${prefix}${renderedKey} ${
          yamlRenderScalar(item, options.quoteAll === true)
        }`,
      );
    }
  };
  render(value, 0);
  const text = `${lines.join("\n")}\n`;
  return options.crlf ? text.replaceAll("\n", "\r\n") : text;
}

function denoNodeValue(node: JsonRecord): JsonRecord {
  const value: JsonRecord = { integrity: node.integrity };
  for (
    const key of [
      "dependencies",
      "optionalDependencies",
      "optionalPeers",
      "os",
      "cpu",
      "tarball",
      "deprecated",
      "scripts",
      "bin",
    ]
  ) {
    if (node[key] !== undefined) value[key] = clone(node[key]);
  }
  return value;
}

function makeRepositoryContents(
  graph: JsonRecord,
  options: YamlRenderOptions = {},
): Map<string, string> {
  const selected = new Map(
    array(graph.selectedPackages, "selectedPackages").map((raw) => {
      const item = object(raw, "selected package");
      return [String(item.id), item] as const;
    }),
  );
  const repository = object(graph.repository, "repository");
  const denoNodes = array(repository.denoLockNodes, "Deno nodes").map((raw) =>
    object(raw, "Deno node")
  );
  const denoLock = {
    version: "5",
    specifiers: clone(object(repository.denoSpecifiers, "Deno specifiers")),
    npm: Object.fromEntries(
      denoNodes.filter((node) => node.kind === "npm").map((node) => [
        String(node.key).slice(4),
        denoNodeValue(node),
      ]),
    ),
    jsr: Object.fromEntries(
      denoNodes.filter((node) => node.kind === "jsr").map((node) => [
        String(node.key).slice(4),
        denoNodeValue(node),
      ]),
    ),
  };
  const imports = Object.fromEntries(DIRECT.deno.map((id) => {
    const item = object(selected.get(id), id);
    return [String(item.name), `npm:${item.name}@${item.version}`];
  }));
  const packageJson = {
    private: true,
    type: "module",
    packageManager: object(graph.corepack, "corepack").descriptor,
    engines: {
      node: selected.get("node")?.version,
      pnpm: selected.get("pnpm")?.version,
    },
    devDependencies: Object.fromEntries(DIRECT.pnpm.map((id) => [
      nameOf(id),
      selected.get(id)?.version,
    ])),
  };
  const allowBuilds = object(
    object(object(graph.lifecycle, "lifecycle").pnpm, "pnpm lifecycle")
      .allowBuilds,
    "allowBuilds",
  );
  const workspace: YamlRecord = {
    packages: [],
    saveExact: true,
    minimumReleaseAge: 4320,
    minimumReleaseAgeStrict: true,
    minimumReleaseAgeIgnoreMissingTime: false,
    trustLockfile: false,
    strictDepBuilds: true,
    dangerouslyAllowAllBuilds: false,
    allowBuilds: clone(allowBuilds) as YamlRecord,
    supportedArchitectures: {
      os: ["current", "linux"],
      cpu: ["x64", "arm64"],
    },
  };
  const pnpm = object(repository.pnpm, "repository.pnpm");
  const lock: YamlRecord = {
    lockfileVersion: "9.0",
    settings: {
      autoInstallPeers: false,
      excludeLinksFromLockfile: false,
    },
    importers: clone(
      collectionValue(keyedCollection(pnpm.importers, "importers"), "id"),
    ) as YamlRecord,
    packages: clone(
      collectionValue(keyedCollection(pnpm.packages, "packages"), "key"),
    ) as YamlRecord,
    snapshots: clone(
      collectionValue(keyedCollection(pnpm.snapshots, "snapshots"), "key"),
    ) as YamlRecord,
  };
  return new Map([
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
    ["pnpm-workspace.yaml", renderYaml(workspace, options)],
    ["pnpm-lock.yaml", renderYaml(lock, options)],
  ]);
}

async function renderReport(graph: JsonRecord): Promise<string> {
  const repository = object(graph.repository, "repository");
  const provenance = array(graph.provenance, "provenance").map((raw) => {
    const item = object(raw, "provenance descriptor");
    return {
      id: item.id,
      kind: item.kind,
      sourceUrl: item.sourceUrl,
      retrievedAt: item.retrievedAt,
      contentSha256: item.contentSha256,
      artifactSha256: item.artifactSha256,
    };
  });
  const retrievals = provenance.map((item) =>
    string(item.retrievedAt, "report retrieval")
  ).sort((left, right) =>
    compareInstants(
      instant(left, "left retrieval"),
      instant(right, "right retrieval"),
    )
  );
  const safeProjection = {
    graphSha256: await sha256Text(JSON.stringify(graph)),
    captureWindow: {
      earliestRetrieval: retrievals[0],
      latestRetrieval: retrievals.at(-1),
      maximumMinutes: 30,
    },
    selection: clone(graph.selection),
    selectedPackages: clone(graph.selectedPackages),
    dependencyRelations: {
      imports: clone(repository.importEdges),
      peers: clone(repository.peerEdges),
      denoNodes: array(repository.denoLockNodes, "Deno nodes").map((raw) => {
        const node = object(raw, "Deno node");
        return {
          key: node.key,
          dependencies: node.dependencies ?? [],
          optionalDependencies: node.optionalDependencies ?? [],
          optionalPeers: node.optionalPeers ?? [],
          manifestEvidenceId: node.manifestEvidenceId ?? null,
        };
      }),
      pnpmPackages: array(
        object(repository.pnpm, "pnpm").packages,
        "pnpm packages",
      ).map((raw) => {
        const item = object(raw, "pnpm package");
        return {
          resolutionId: item.resolutionId,
          key: item.key,
          manifestEvidenceId: item.manifestEvidenceId,
        };
      }),
    },
    lifecycle: clone(graph.lifecycle),
    repeatability: clone(repository.repeatability),
    corepackProof: clone(object(graph.corepack, "corepack").proof),
    ociImages: clone(graph.ociImages),
    exclusionsAndFollowOns: clone(graph.proofStatus),
    provenance,
  };
  assertRedactedProjection(safeProjection, "runtime graph report projection");
  return `# FND-003 immutable runtime graph\n\n${
    JSON.stringify(safeProjection, null, 2)
  }\n`;
}

function expectedWorkspace(graph: JsonRecord): JsonRecord {
  return {
    packages: [],
    saveExact: true,
    minimumReleaseAge: 4320,
    minimumReleaseAgeStrict: true,
    minimumReleaseAgeIgnoreMissingTime: false,
    trustLockfile: false,
    strictDepBuilds: true,
    dangerouslyAllowAllBuilds: false,
    allowBuilds: clone(
      object(
        object(object(graph.lifecycle, "lifecycle").pnpm, "pnpm lifecycle")
          .allowBuilds,
        "allowBuilds",
      ),
    ),
    supportedArchitectures: { os: ["current", "linux"], cpu: ["x64", "arm64"] },
  };
}

async function validateRepositoryContents(
  contents: Map<string, string>,
  graph: JsonRecord,
  readEvidence: EvidenceReader,
  loadedAuthority?: EvidenceAuthority,
) {
  const authority = loadedAuthority ?? await loadEvidence(
    graph,
    readEvidence,
    validateSelection(graph).selectedAt,
  );
  const selected = new Map(
    array(graph.selectedPackages, "selectedPackages").map((raw) => {
      const item = object(raw, "selected package");
      return [String(item.id), item] as const;
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
    exactValue(
      denoJson[key],
      BASE_DENO_CONFIGURATION[key],
      `deno.json base ${key} configuration`,
    );
  }
  invariant(
    denoJson.minimumDependencyAge === "PT72H",
    "deno minimum age is incorrect",
  );
  exactValue(
    denoJson.lock,
    { path: "./deno.lock", frozen: true },
    "deno lock policy",
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
  exactSet(
    strings(denoJson.allowScripts, "deno.json.allowScripts"),
    [],
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
      ].includes(key)
    ) &&
      ["version", "specifiers", "npm"].every((key) => key in denoLock),
    "deno.lock has missing or unknown fields",
  );
  invariant(denoLock.version === "5", "deno.lock must use version 5");
  const repository = object(graph.repository, "repository");
  exactValue(
    denoLock.specifiers,
    repository.denoSpecifiers,
    "Deno lock specifiers",
  );
  const graphNodes = array(repository.denoLockNodes, "graph Deno nodes").map((
    raw,
  ) => object(raw, "graph Deno node"));
  const fileNpm = object(denoLock.npm, "deno.lock.npm");
  const fileJsr = object(denoLock.jsr ?? {}, "deno.lock.jsr");
  exactSet(
    [
      ...Object.keys(fileNpm).map((key) => `npm:${key}`),
      ...Object.keys(fileJsr).map((key) => `jsr:${key}`),
    ],
    graphNodes.map((node) => string(node.key, "Deno graph key")),
    "Deno file and graph lock nodes",
  );
  for (const node of graphNodes) {
    const key = string(node.key, "Deno graph key");
    const fileNode = key.startsWith("npm:")
      ? fileNpm[key.slice(4)]
      : fileJsr[key.slice(4)];
    exactValue(fileNode, denoNodeValue(node), `${key} Deno node`);
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
    packageJson.private === true && packageJson.type === "module",
    "package.json root metadata drifted",
  );
  invariant(
    packageJson.packageManager ===
      object(graph.corepack, "corepack").descriptor,
    "Corepack descriptor disagrees with package.json",
  );
  exactValue(packageJson.engines, {
    node: selected.get("node")?.version,
    pnpm: selected.get("pnpm")?.version,
  }, "package engines");
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
  invariant(
    contents.get(".npmrc") === "registry=https://registry.npmjs.org/\n",
    ".npmrc contains misplaced non-registry policy",
  );
  const workspace = parseYaml(
    string(contents.get("pnpm-workspace.yaml"), "pnpm-workspace.yaml"),
    "pnpm-workspace.yaml",
  );
  exactValue(workspace, expectedWorkspace(graph), "pnpm workspace policy");
  invariant(
    !("onlyBuiltDependencies" in workspace),
    "removed pnpm onlyBuiltDependencies field is forbidden",
  );
  const pnpmLock = parseYaml(
    string(contents.get("pnpm-lock.yaml"), "pnpm-lock.yaml"),
    "pnpm-lock.yaml",
  );
  exactKeys(pnpmLock, [
    "lockfileVersion",
    "settings",
    "importers",
    "packages",
    "snapshots",
  ], "pnpm.lock");
  invariant(
    pnpmLock.lockfileVersion === "9.0",
    "pnpm lockfile must use version 9.0",
  );
  exactValue(pnpmLock.settings, {
    autoInstallPeers: false,
    excludeLinksFromLockfile: false,
  }, "pnpm lock settings");
  validatePnpmGraph(graph, authority, pnpmLock);
  const artifacts = array(repository.artifacts, "artifacts").map((raw) =>
    object(raw, "artifact")
  );
  for (const artifact of artifacts) {
    const path = string(artifact.path, "artifact.path");
    invariant(
      await sha256Text(string(contents.get(path), path)) === artifact.sha256,
      `${path} hash disagrees with graph`,
    );
  }
  const artifactHashes = new Map(
    artifacts.map((item) => [String(item.path), String(item.sha256)]),
  );
  for (
    const raw of array(
      object(repository.repeatability, "repeatability").runs,
      "repeat runs",
    )
  ) {
    const run = object(raw, "repeat run");
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
  fixture: Fixture,
  options: YamlRenderOptions = {},
): Promise<Map<string, string>> {
  const contents = makeRepositoryContents(fixture.graph, options);
  const artifacts = array(
    object(fixture.graph.repository, "repository").artifacts,
    "artifacts",
  ).map((raw) => object(raw, "artifact"));
  for (const artifact of artifacts) {
    const path = string(artifact.path, "artifact.path");
    artifact.sha256 = await sha256Text(string(contents.get(path), path));
  }
  const hashes = new Map(
    artifacts.map((item) => [String(item.path), String(item.sha256)]),
  );
  for (
    const raw of array(
      object(
        object(fixture.graph.repository, "repository").repeatability,
        "repeatability",
      ).runs,
      "repeat runs",
    )
  ) {
    const run = object(raw, "repeat run");
    run.denoLockSha256 = hashes.get("deno.lock");
    run.pnpmLockSha256 = hashes.get("pnpm-lock.yaml");
  }
  contents.set(GRAPH_PATH, JSON.stringify(fixture.graph));
  contents.set(REPORT_PATH, await renderReport(fixture.graph));
  return contents;
}

function fixtureReader(fixture: Fixture): EvidenceReader {
  return (path) => {
    const value = fixture.evidence.get(path);
    invariant(value, `synthetic evidence ${path} is absent`);
    return Promise.resolve(byteStream(value));
  };
}

async function refreshEvidenceDescriptor(
  fixture: Fixture,
  id: string,
  body: string,
) {
  const descriptor = object(
    array(fixture.graph.provenance, "provenance").find((raw) =>
      object(raw, "descriptor").id === id
    ),
    id,
  );
  const bytes = await gzip(body);
  descriptor.contentSha256 = await sha256Text(body);
  descriptor.artifactSha256 = await sha256Bytes(bytes);
  fixture.evidence.set(string(descriptor.path, `${id}.path`), bytes);
}

async function expectReject(
  mutator: (fixture: Fixture) => void | Promise<void>,
  expected: string,
) {
  const fixture = await makeFixture();
  await mutator(fixture);
  const [result] = await Promise.allSettled([
    validateGraph(fixture.graph, fixtureReader(fixture)),
  ]);
  invariant(result.status === "rejected", "negative graph unexpectedly passed");
  const message = (result.reason as Error).message;
  invariant(
    message.includes(expected),
    `expected '${expected}', observed '${message}'`,
  );
}

async function expectReaderReject(
  fixture: Fixture,
  reader: EvidenceReader,
  expected: string,
  options: EvidenceLoadOptions = {},
) {
  const [result] = await Promise.allSettled([
    validateGraph(fixture.graph, reader, options),
  ]);
  invariant(
    result.status === "rejected",
    "oversized evidence unexpectedly passed",
  );
  invariant(
    (result.reason as Error).message.includes(expected),
    `oversized evidence expected '${expected}', observed '${
      (result.reason as Error).message
    }'`,
  );
}

async function expectRepositoryReject(
  mutator: (
    contents: Map<string, string>,
    fixture: Fixture,
  ) => void | Promise<void>,
  expected: string,
) {
  const fixture = await makeFixture();
  const contents = await syntheticRepository(fixture);
  await mutator(contents, fixture);
  const [result] = await Promise.allSettled([
    validateRepositoryContents(
      contents,
      fixture.graph,
      fixtureReader(fixture),
    ),
  ]);
  invariant(
    result.status === "rejected",
    "negative repository unexpectedly passed",
  );
  const message = (result.reason as Error).message;
  invariant(
    message.includes(expected),
    `repository negative expected '${expected}', observed '${message}'`,
  );
}

function retargetSnapshot(
  graph: JsonRecord,
  snapshot: JsonRecord,
  newKey: string,
) {
  const pnpm = object(object(graph.repository, "repository").pnpm, "pnpm");
  const oldKey = string(snapshot.key, "snapshot key");
  const packageKey = string(snapshot.packageKey, "snapshot package key");
  const packageName = string(
    object(
      array(pnpm.packages, "packages").find((raw) =>
        object(raw, "package").key === packageKey
      ),
      "snapshot package",
    ).name,
    "snapshot package name",
  );
  const oldResolution = oldKey.slice(packageName.length + 1);
  const newResolution = newKey.slice(packageName.length + 1);
  for (const raw of array(pnpm.snapshots, "snapshots")) {
    const value = object(object(raw, "snapshot").value, "snapshot value");
    for (const section of ["dependencies", "optionalDependencies"]) {
      const dependencies = object(value[section] ?? {}, section);
      if (dependencies[packageName] === oldResolution) {
        dependencies[packageName] = newResolution;
      }
    }
  }
  for (const raw of array(pnpm.importers, "importers")) {
    const value = object(object(raw, "importer").value, "importer value");
    for (
      const section of [
        "dependencies",
        "devDependencies",
        "optionalDependencies",
      ]
    ) {
      const dependencies = object(value[section] ?? {}, section);
      const entry = dependencies[packageName];
      if (!entry) continue;
      const importerEntry = object(entry, "importer entry");
      if (importerEntry.version !== oldResolution) continue;
      importerEntry.version = newResolution;
    }
  }
  snapshot.key = newKey;
}

async function validateRepositoryGraph(
  readTextFile: (path: string) => Promise<string>,
  readEvidence: EvidenceReader,
) {
  const contents = await readRepositoryInputs(readTextFile);
  const graph = parseJson(
    string(contents.get(GRAPH_PATH), GRAPH_PATH),
    GRAPH_PATH,
  );
  contents.set(REPORT_PATH, await readTextFile(REPORT_PATH));
  const authority = await validateGraph(graph, readEvidence);
  await validateRepositoryContents(contents, graph, readEvidence, authority);
}

async function openEvidence(path: string): Promise<ReadableStream<Uint8Array>> {
  return (await Deno.open(path, { read: true })).readable;
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
    }; exact manifests, locks, pin record, and captured provenance are required`,
  );
  return contents;
}

Deno.test("evidence ingestion rejects wall-clock scheduling and requires an independent raw lease", async () => {
  const source = await Deno.readTextFile(new URL(import.meta.url));
  const forbiddenIdentifiers = [
    ["set", "Timeout"],
    ["set", "Interval"],
    ["Date", ".now"],
    ["Temporal", ".Now"],
    ["performance", ".now"],
  ].map((parts) => parts.join(""));
  const forbiddenPatterns = forbiddenIdentifiers.map((identifier) =>
    new RegExp(`\\b${identifier.replace(".", "\\.")}\\s*\\(`)
  );
  invariant(
    forbiddenPatterns.every((pattern, index) =>
      pattern.test(`${forbiddenIdentifiers[index]}(`) && !pattern.test(source)
    ),
    "runtime graph oracle uses forbidden wall-clock scheduling",
  );

  const selectedAt = instant(
    "2026-01-10T04:05:06.789Z",
    "independent lease fixture selection",
  );
  const body = "fixture checksum row";
  const bytes = await gzip(body);
  const path = `${PROVENANCE_ROOT}independent-lease.gz`;
  const descriptor = {
    id: "independent-lease",
    kind: "release-checksum",
    path,
    compression: "gzip",
    sourceUrl: "https://nodejs.org/dist/v24.11.0/SHASUMS256.txt",
    retrievedAt: selectedAt.canonical,
    contentSha256: await sha256Text(body),
    artifactSha256: await sha256Bytes(bytes),
  };
  let independentRuns = 0;
  const rawLeaseFactory = {
    run(): Promise<never> {
      independentRuns += 1;
      return Promise.reject(new Error("independent raw lease factory reached"));
    },
  };
  const independentReader: EvidenceReader = (requestedPath) => {
    invariant(
      requestedPath === path,
      "independent lease fixture requested the wrong evidence path",
    );
    return Promise.resolve(byteStream(bytes));
  };
  const readerProbe = await independentReader(path);
  await readerProbe.cancel();
  const [result] = await Promise.allSettled([
    loadEvidence(
      { provenance: [descriptor] },
      independentReader,
      selectedAt,
      { rawLeaseFactory } as unknown as EvidenceLoadOptions,
    ),
  ]);
  invariant(
    independentRuns === 1 && result?.status === "rejected" &&
      (result.reason as Error).message ===
        "independent raw lease factory reached",
    "evidence ingestion bypassed the independent raw lease factory",
  );

  const retainedValueFactory = createTrackedRawLeaseFactory();
  await retainedValueFactory.run("retained-value", async (scope) => {
    const lease = scope.acquire("decoded", "retained value");
    const child = lease.retain();
    invariant(
      child.withValue((value) => value) === "retained value",
      "scoped retained value changed identity",
    );
    child.release();
    lease.release();
    await Promise.resolve();
  });
  retainedValueFactory.assertIdle();
});

Deno.test("bounded transforms preflight without queued owned copies", async () => {
  const sourceChunk = new Uint8Array([1, 2, 3, 4]);
  let downstreamChunk: Uint8Array | undefined;
  let enteredDownstream!: () => void;
  const downstreamEntered = new Promise<void>((resolve) => {
    enteredDownstream = resolve;
  });
  let releaseDownstream!: () => void;
  const downstreamReleased = new Promise<void>((resolve) => {
    releaseDownstream = resolve;
  });
  const stalledPipe = byteStream(sourceChunk).pipeThrough(
    countedHashingStream(
      sourceChunk.byteLength,
      "stalled transform",
      incrementalSha256(),
      { value: 0 },
    ),
  ).pipeTo(
    new WritableStream({
      write(chunk) {
        downstreamChunk = chunk;
        enteredDownstream();
        return downstreamReleased;
      },
    }),
  );
  await downstreamEntered;
  const stalledState = {
    sameChunk: downstreamChunk === sourceChunk,
  };
  releaseDownstream();
  await stalledPipe;

  let acknowledgeCancellation!: () => void;
  const cancellation = new Promise<void>((resolve) => {
    acknowledgeCancellation = resolve;
  });
  const oversized = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2]));
    },
    cancel() {
      acknowledgeCancellation();
    },
  });
  const oversizedReader = oversized.pipeThrough(
    countedHashingStream(
      1,
      "preflight transform",
      incrementalSha256(),
      { value: 0 },
    ),
  ).getReader();
  const [oversizedResult] = await Promise.all([
    Promise.allSettled([oversizedReader.read()]),
    cancellation,
  ]);
  oversizedReader.releaseLock();
  invariant(
    stalledState.sameChunk && oversizedResult[0]?.status === "rejected" &&
      (oversizedResult[0].reason as Error).message.includes(
        "preflight transform exceeds 1 byte limit",
      ),
    `bounded transform copied/acquired before its bound or released a queued copy: ${
      JSON.stringify(stalledState)
    }`,
  );
});

Deno.test("raw lease observers receive only opaque revocable probes", async () => {
  interface ObserverProbe {
    kind: RawRepresentation;
    identity: symbol;
    retain(): ObserverProbe;
    release(): void;
  }
  let child: ObserverProbe | undefined;
  let observedSurface: string[] = [];
  let parentReleaseResult = "";
  const factory = createTrackedRawLeaseFactory({
    onAcquire(_descriptorId, _kind, lease) {
      const observer = lease as unknown as ObserverProbe;
      observedSurface = Object.keys(observer).sort();
      child = observer.retain();
      observer.release();
      try {
        observer.release();
      } catch (error) {
        parentReleaseResult = (error as Error).message;
      }
    },
  });
  const [result] = await Promise.allSettled([
    factory.run("opaque", async (scope) => {
      const lease = scope.acquire("decoded", "secret decoded fixture");
      lease.update((value) => `${value}!`);
      lease.release();
      await Promise.resolve();
    }),
  ]);
  factory.assertIdle();
  invariant(child, "opaque observer did not retain its child probe");
  let revokedMessage = "";
  try {
    child.retain();
  } catch (error) {
    revokedMessage = (error as Error).message;
  }
  invariant(
    result?.status === "rejected" &&
      (result.reason as Error).message.includes(
        "opaque retained raw lease(s): decoded",
      ) && JSON.stringify(observedSurface) ===
        JSON.stringify(["identity", "kind", "release", "retain"]) &&
      parentReleaseResult === "raw lease is no longer active" &&
      revokedMessage === "raw lease is no longer active",
    `raw lease observer exposed value/mutation authority or failed revocation: ${
      JSON.stringify({
        observedSurface,
        result: result?.status,
        parentReleaseResult,
        revokedMessage,
      })
    }`,
  );
});

Deno.test("provenance metadata and normalized claim use are independent", async () => {
  const selectedAt = instant(
    "2026-01-10T04:05:06.789Z",
    "provenance-use fixture selection",
  );
  const body = "fixture checksum row";
  const bytes = await gzip(body);
  const path = `${PROVENANCE_ROOT}provenance-use.gz`;
  const descriptor = {
    id: "provenance-use",
    kind: "release-checksum",
    path,
    compression: "gzip",
    sourceUrl: "https://nodejs.org/dist/v24.11.0/SHASUMS256.txt",
    retrievedAt: selectedAt.canonical,
    contentSha256: await sha256Text(body),
    artifactSha256: await sha256Bytes(bytes),
  };
  const createAuthority = () =>
    loadEvidence(
      { provenance: [descriptor] },
      () => Promise.resolve(byteStream(bytes)),
      selectedAt,
    );

  const metadataOnly = await createAuthority();
  metadataOnly.descriptor("provenance-use");
  let metadataOnlyMessage = "accepted";
  try {
    metadataOnly.assertAllUsed();
  } catch (error) {
    metadataOnlyMessage = (error as Error).message;
  }

  const claimOnly = await createAuthority();
  claimOnly.checksumRows("provenance-use");
  let claimOnlyMessage = "accepted";
  try {
    claimOnly.assertAllUsed();
  } catch (error) {
    claimOnlyMessage = (error as Error).message;
  }

  const complete = await createAuthority();
  complete.descriptor("provenance-use");
  complete.checksumRows("provenance-use");
  complete.assertAllUsed();
  const fixture = await makeFixture();
  await validateGraph(fixture.graph, fixtureReader(fixture));

  invariant(
    metadataOnlyMessage.includes("provenance claim membership") &&
      claimOnlyMessage.includes("provenance metadata membership"),
    `provenance use was not independently bound: ${
      JSON.stringify({ metadataOnlyMessage, claimOnlyMessage })
    }`,
  );
});

Deno.test("official Node rows reject unknown raw fields before projection", async () => {
  await expectReject(async (candidate) => {
    const descriptor = object(
      array(candidate.graph.provenance, "provenance").find((raw) =>
        object(raw, "descriptor").id === "node-lts-index"
      ),
      "Node index descriptor",
    );
    const rows = array(
      parseJsonValue(
        await gunzipBounded(candidate.evidence.get(String(descriptor.path))!),
        "Node index",
      ),
      "Node index",
    ).map((raw) => object(raw, "Node row"));
    rows[0]!.unexpectedProjectionEscape = "hidden";
    await refreshEvidenceDescriptor(
      candidate,
      "node-lts-index",
      JSON.stringify(rows),
    );
  }, "Node index row fields membership is not exact");
});

Deno.test("OCI descriptors reject unknown raw fields before projection", async () => {
  await expectReject(async (candidate) => {
    const image = object(
      array(candidate.graph.ociImages, "images")[0],
      "OCI image",
    );
    const id = string(image.evidenceId, "OCI evidence ID");
    const descriptor = object(
      array(candidate.graph.provenance, "provenance").find((raw) =>
        object(raw, "descriptor").id === id
      ),
      "OCI evidence descriptor",
    );
    const index = parseJson(
      await gunzipBounded(candidate.evidence.get(String(descriptor.path))!),
      "OCI index",
    );
    object(
      array(index.manifests, "OCI manifests")[0],
      "OCI raw descriptor",
    ).unexpectedProjectionEscape = "hidden";
    const body = JSON.stringify(index);
    await refreshEvidenceDescriptor(candidate, id, body);
    const digestValue = await sha256Text(body);
    image.indexDigest = digestValue;
    image.reference = `${image.repository}:${image.tag}@${digestValue}`;
  }, "OCI descriptor fields membership is not exact");

  await expectReject(async (candidate) => {
    const image = object(
      array(candidate.graph.ociImages, "images")[0],
      "OCI image",
    );
    const id = string(image.evidenceId, "OCI evidence ID");
    const descriptor = object(
      array(candidate.graph.provenance, "provenance").find((raw) =>
        object(raw, "descriptor").id === id
      ),
      "OCI evidence descriptor",
    );
    const index = parseJson(
      await gunzipBounded(candidate.evidence.get(String(descriptor.path))!),
      "OCI index",
    );
    index.unexpectedProjectionEscape = "hidden";
    const body = JSON.stringify(index);
    await refreshEvidenceDescriptor(candidate, id, body);
    const digestValue = await sha256Text(body);
    image.indexDigest = digestValue;
    image.reference = `${image.repository}:${image.tag}@${digestValue}`;
  }, "OCI index fields membership is not exact");

  await expectReject(async (candidate) => {
    const image = object(
      array(candidate.graph.ociImages, "images")[0],
      "OCI image",
    );
    const id = string(image.evidenceId, "OCI evidence ID");
    const descriptor = object(
      array(candidate.graph.provenance, "provenance").find((raw) =>
        object(raw, "descriptor").id === id
      ),
      "OCI evidence descriptor",
    );
    const index = parseJson(
      await gunzipBounded(candidate.evidence.get(String(descriptor.path))!),
      "OCI index",
    );
    object(
      object(
        array(index.manifests, "OCI manifests")[0],
        "OCI raw descriptor",
      ).platform,
      "OCI raw platform",
    ).unexpectedProjectionEscape = "hidden";
    const body = JSON.stringify(index);
    await refreshEvidenceDescriptor(candidate, id, body);
    const digestValue = await sha256Text(body);
    image.indexDigest = digestValue;
    image.reference = `${image.repository}:${image.tag}@${digestValue}`;
  }, "OCI descriptor platform fields membership is not exact");
});

Deno.test("aggregate evidence ingestion releases raw ownership per descriptor", async () => {
  const selectedAt = instant(
    "2026-01-10T04:05:06.789Z",
    "aggregate fixture selection",
  );
  const bodies = new Map([
    ["first", '{"claim":"first"}'],
    ["second", '{"claim":"later"}'],
  ]);
  const evidence = new Map<string, Uint8Array>();
  const provenance: JsonRecord[] = [];
  for (const [index, [id, body]] of [...bodies].entries()) {
    const bytes = await gzip(body);
    const path = `${PROVENANCE_ROOT}aggregate-${id}.gz`;
    evidence.set(path, bytes);
    provenance.push({
      id,
      kind: "release-checksum",
      path,
      compression: "gzip",
      sourceUrl: index === 0
        ? "https://github.com/denoland/deno/releases/download/v2.5.6/deno-x86_64-pc-windows-msvc.zip.sha256sum"
        : "https://nodejs.org/dist/v24.11.0/SHASUMS256.txt",
      retrievedAt: "2026-01-10T04:05:06.789Z",
      contentSha256: await sha256Text(body),
      artifactSha256: await sha256Bytes(bytes),
    });
  }
  const observed: string[] = [];
  let activeDescriptor: string | undefined;
  const observe = (event: EvidenceIngestionEvent) => {
    observed.push(
      `${event.descriptorId}:${event.action}:${event.representation}`,
    );
    if (event.action === "acquire") {
      invariant(
        activeDescriptor === undefined && event.bytes === 0,
        "aggregate evidence acquired overlapping raw ownership",
      );
      activeDescriptor = event.descriptorId;
    } else if (event.action === "retain") {
      invariant(
        activeDescriptor === event.descriptorId && event.bytes === 0,
        "aggregate evidence normalized outside its descriptor lease",
      );
    } else if (event.action === "release") {
      invariant(
        activeDescriptor === event.descriptorId && event.bytes > 0,
        "aggregate evidence released the wrong descriptor lease",
      );
      activeDescriptor = undefined;
    }
  };
  const firstBytes = evidence.get(`${PROVENANCE_ROOT}aggregate-first.gz`)!;
  const bodyLimit = new TextEncoder().encode(bodies.get("first")!).byteLength;
  const sourceHashes = new Map<string, string>();
  for (const [path, value] of evidence) {
    sourceHashes.set(path, await sha256Bytes(value));
  }
  const rawAcquisitions: string[] = [];
  const rawProbeIdentities = new Set<symbol>();
  const rawLeaseFactory = createTrackedRawLeaseFactory({
    onAcquire(descriptorId, kind, lease) {
      rawAcquisitions.push(`${descriptorId}:${kind}`);
      invariant(
        lease.kind === kind && !rawProbeIdentities.has(lease.identity) &&
          !Object.hasOwn(lease, "value") &&
          !Object.hasOwn(lease, "withValue") &&
          !Object.hasOwn(lease, "update"),
        "raw lease observer exposed its decoded value",
      );
      rawProbeIdentities.add(lease.identity);
    },
  });
  invariant(
    firstBytes.byteLength ===
        evidence.get(`${PROVENANCE_ROOT}aggregate-second.gz`)!.byteLength &&
      bodyLimit === new TextEncoder().encode(bodies.get("second")!).byteLength,
    "aggregate fixtures must share exact byte boundaries",
  );
  const authority = await loadEvidence(
    { provenance },
    (path) => Promise.resolve(byteStream(evidence.get(path)!)),
    selectedAt,
    {
      observe,
      compressedLimit: firstBytes.byteLength,
      decompressedLimit: bodyLimit,
      rawLeaseFactory,
    },
  );
  rawLeaseFactory.assertIdle();
  invariant(
    JSON.stringify(observed) === JSON.stringify([
          "first:acquire:decoded",
          "first:retain:normalized",
          "first:release:decoded",
          "second:acquire:decoded",
          "second:retain:normalized",
          "second:release:decoded",
        ]) &&
      activeDescriptor === undefined && !("text" in authority) &&
      !("json" in authority) &&
      JSON.stringify(rawLeaseFactory.startedDescriptorIds()) ===
        JSON.stringify(["first", "second"]) &&
      rawAcquisitions.every((entry) => entry.endsWith(":decoded")) &&
      rawAcquisitions.length === 2 && rawProbeIdentities.size === 2,
    "aggregate evidence ingestion retained overlapping or accumulating raw representations",
  );
  for (const [path, value] of evidence) {
    invariant(
      sourceHashes.get(path) === await sha256Bytes(value),
      "ingestion mutated its immutable reader-owned source fixture",
    );
  }
  exactValue(
    authority.checksumRows("second"),
    [[bodies.get("second")]],
    "later normalized claim after raw release",
  );
  let normalizedAccessMarkedUsed = "";
  try {
    authority.assertAllUsed();
  } catch (error) {
    normalizedAccessMarkedUsed = (error as Error).message;
  }
  invariant(
    normalizedAccessMarkedUsed.includes("provenance metadata membership"),
    "normalization or normalized access incorrectly marked evidence used",
  );
  authority.descriptor("first");
  authority.descriptor("second");
  let incompleteClaimUse = "";
  try {
    authority.assertAllUsed();
  } catch (error) {
    incompleteClaimUse = (error as Error).message;
  }
  invariant(
    incompleteClaimUse.includes("provenance claim membership"),
    "descriptor use incorrectly substituted for normalized claim use",
  );
  authority.checksumRows("first");
  authority.assertAllUsed();

  let heldRawLease: RawLeaseProbe | undefined;
  const mutantEvents: string[] = [];
  const mutantFactory = createTrackedRawLeaseFactory({
    onAcquire(descriptorId, kind, lease) {
      invariant(kind === "decoded", "mutant observed a non-decoded raw lease");
      invariant(
        descriptorId === "first",
        "mutant started after its retained child should have stopped ingestion",
      );
      heldRawLease = lease.retain();
    },
  });
  const [mutantResult] = await Promise.allSettled([
    loadEvidence(
      { provenance },
      (path) => Promise.resolve(byteStream(evidence.get(path)!)),
      selectedAt,
      {
        rawLeaseFactory: mutantFactory,
        compressedLimit: firstBytes.byteLength,
        decompressedLimit: bodyLimit,
        observe(event) {
          mutantEvents.push(
            `${event.descriptorId}:${event.action}:${event.representation}`,
          );
        },
      },
    ),
  ]);
  invariant(
    mutantResult?.status === "rejected" &&
      (mutantResult.reason as Error).message.includes(
        "first retained raw lease(s): decoded",
      ) &&
      JSON.stringify(mutantFactory.startedDescriptorIds()) ===
        JSON.stringify(["first"]) &&
      mutantEvents.includes("first:retain:normalized") &&
      mutantEvents.includes("first:release:decoded") &&
      !mutantEvents.some((event) => event.startsWith("second:")),
    "a hidden raw accumulator passed through loader-authored lifecycle events",
  );
  mutantFactory.assertIdle();
  invariant(heldRawLease, "raw accumulator mutant did not retain a lease");
  let revokedLeaseMessage = "";
  try {
    heldRawLease.retain();
  } catch (error) {
    revokedLeaseMessage = (error as Error).message;
  }
  invariant(
    revokedLeaseMessage === "raw lease is no longer active",
    "retained raw lease remained accessible after descriptor cleanup",
  );

  let releaseActiveDescriptor!: () => void;
  const overlapFactory = createTrackedRawLeaseFactory();
  const activeDescriptorRun = overlapFactory.run(
    "active",
    async (scope) => {
      const lease = scope.acquire("decoded", "active");
      await new Promise<void>((resolve) => {
        releaseActiveDescriptor = () => {
          lease.release();
          resolve();
        };
      });
    },
  );
  const [overlapResult] = await Promise.allSettled([
    overlapFactory.run("overlap", () => Promise.resolve()),
  ]);
  invariant(
    overlapResult?.status === "rejected" &&
      (overlapResult.reason as Error).message ===
        "a raw descriptor lease is already active" &&
      JSON.stringify(overlapFactory.startedDescriptorIds()) ===
        JSON.stringify(["active"]),
    "a second descriptor began while a prior raw lease remained active",
  );
  releaseActiveDescriptor();
  await activeDescriptorRun;
  overlapFactory.assertIdle();

  let failureChild: RawLeaseProbe | undefined;
  const combinedFailureFactory = createTrackedRawLeaseFactory({
    onAcquire(_descriptorId, _kind, lease) {
      failureChild = lease.retain();
    },
  });
  const [combinedFailure] = await Promise.allSettled([
    combinedFailureFactory.run("failed", async (scope) => {
      const lease = scope.acquire("decoded", "raw failure fixture");
      lease.release();
      await Promise.resolve();
      throw new Error("original normalization failure");
    }),
  ]);
  invariant(
    combinedFailure?.status === "rejected" &&
      (combinedFailure.reason as Error).message.includes(
        "original normalization failure",
      ) && (combinedFailure.reason as Error).message.includes(
        "failed retained raw lease(s): decoded",
      ),
    "raw lease cleanup masked either the original failure or retained lease",
  );
  combinedFailureFactory.assertIdle();
  invariant(failureChild, "combined failure did not retain its child lease");
  let failureChildMessage = "";
  try {
    failureChild.retain();
  } catch (error) {
    failureChildMessage = (error as Error).message;
  }
  invariant(
    failureChildMessage === "raw lease is no longer active",
    "failure cleanup left a retained child capability active",
  );

  for (
    const [limit, expected] of [
      [
        { compressedLimit: firstBytes.byteLength - 1 },
        "compressed provenance artifact exceeds",
      ],
      [
        { decompressedLimit: bodyLimit - 1 },
        "decompressed provenance artifact exceeds",
      ],
    ] as const
  ) {
    const lifecycle: EvidenceIngestionEvent[] = [];
    const sourceCancellations: string[] = [];
    const firstPath = `${PROVENANCE_ROOT}aggregate-first.gz`;
    const boundedReader: EvidenceReader = (path) => {
      const bytes = evidence.get(path)!;
      if (path !== firstPath || limit.compressedLimit === undefined) {
        return Promise.resolve(byteStream(bytes));
      }
      const boundary = limit.compressedLimit;
      return Promise.resolve(
        new ReadableStream({
          start(controller) {
            controller.enqueue(bytes.subarray(0, boundary));
            controller.enqueue(bytes.subarray(boundary));
          },
          cancel() {
            sourceCancellations.push(path);
          },
        }),
      );
    };
    const [result] = await Promise.allSettled([
      loadEvidence(
        { provenance },
        boundedReader,
        selectedAt,
        {
          ...limit,
          observe(event) {
            lifecycle.push(event);
          },
        },
      ),
    ]);
    invariant(
      result?.status === "rejected" &&
        (result.reason as Error).message.includes(expected) &&
        lifecycle.filter((event) => event.action === "cancel").length === 1 &&
        !lifecycle.some((event) => event.action === "retain") &&
        !lifecycle.some((event) => event.descriptorId === "second") &&
        (limit.compressedLimit === undefined ||
          sourceCancellations[0] === firstPath),
      `${expected} N+1 path did not cancel through aggregate ingestion`,
    );
  }

  const expandedBody = "x".repeat(1024 * 1024);
  const expandedBytes = await gzip(expandedBody);
  const expandedPath = `${PROVENANCE_ROOT}aggregate-expanded.gz`;
  const expandedDescriptor: JsonRecord = {
    id: "expanded",
    kind: "release-checksum",
    path: expandedPath,
    compression: "gzip",
    sourceUrl:
      "https://github.com/denoland/deno/releases/download/v2.5.6/deno-x86_64-pc-windows-msvc.zip.sha256sum",
    retrievedAt: "2026-01-10T04:05:06.789Z",
    contentSha256: await sha256Text(expandedBody),
    artifactSha256: await sha256Bytes(expandedBytes),
  };
  const decompressedLifecycle: EvidenceIngestionEvent[] = [];
  let decompressedCancellationCount = 0;
  let acknowledgeDecompressedCancellation!: () => void;
  const decompressedCancellation = new Promise<void>((resolve) => {
    acknowledgeDecompressedCancellation = resolve;
  });
  const decompressedResultPromise = Promise.allSettled([
    loadEvidence(
      { provenance: [expandedDescriptor, provenance[1]] },
      (path) => {
        invariant(
          path === expandedPath,
          "decompressed N+1 started the next descriptor",
        );
        return Promise.resolve(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                expandedBytes.subarray(0, expandedBytes.byteLength - 8),
              );
            },
            cancel() {
              decompressedCancellationCount += 1;
              acknowledgeDecompressedCancellation();
            },
          }),
        );
      },
      selectedAt,
      {
        compressedLimit: expandedBytes.byteLength,
        decompressedLimit: 1,
        observe(event) {
          decompressedLifecycle.push(event);
        },
      },
    ),
  ]).then(([result]) => result!);
  const firstDecompressedOutcome = await Promise.race([
    decompressedCancellation.then(() => "cancelled" as const),
    decompressedResultPromise.then(() => "settled" as const),
  ]);
  invariant(
    firstDecompressedOutcome === "cancelled",
    "decompressed N+1 settled before upstream cancellation acknowledgement",
  );
  const [, decompressedResult] = await Promise.all([
    decompressedCancellation,
    decompressedResultPromise,
  ]);
  invariant(
    decompressedResult?.status === "rejected" &&
      (decompressedResult.reason as Error).message.includes(
        "decompressed provenance artifact exceeds 1 byte limit",
      ) && decompressedCancellationCount === 1 &&
      !decompressedLifecycle.some((event) => event.descriptorId === "second") &&
      decompressedLifecycle.some((event) => event.action === "cancel") &&
      !decompressedLifecycle.some((event) => event.action === "retain"),
    "decompressed N+1 did not cancel upstream before claim commit",
  );

  const missingLaterClaim = clone(provenance);
  const laterDescriptor = object(missingLaterClaim[1], "later descriptor");
  const invalidLaterBody = "{}";
  const invalidLaterBytes = await gzip(invalidLaterBody);
  laterDescriptor.kind = "npm-packument";
  laterDescriptor.sourceUrl = "https://registry.npmjs.org/later";
  laterDescriptor.contentSha256 = await sha256Text(invalidLaterBody);
  laterDescriptor.artifactSha256 = await sha256Bytes(invalidLaterBytes);
  const missingLaterEvidence = new Map(evidence);
  missingLaterEvidence.set(String(laterDescriptor.path), invalidLaterBytes);
  const laterEvents: string[] = [];
  const [missingResult] = await Promise.allSettled([
    loadEvidence(
      { provenance: missingLaterClaim },
      (path) => Promise.resolve(byteStream(missingLaterEvidence.get(path)!)),
      selectedAt,
      {
        observe(event) {
          laterEvents.push(
            `${event.descriptorId}:${event.action}:${event.representation}`,
          );
        },
      },
    ),
  ]);
  invariant(
    missingResult?.status === "rejected" &&
      (missingResult.reason as Error).message.includes(
        "npm packument versions must be an object",
      ) && laterEvents.indexOf("first:release:decoded") <
        laterEvents.indexOf("second:acquire:decoded") &&
      laterEvents.includes("second:cancel:decoded") &&
      laterEvents.includes("second:release:decoded"),
    "discarding one raw body silently discarded a later required claim",
  );
  const wrongHashProvenance = clone(provenance);
  object(wrongHashProvenance[0], "wrong-hash descriptor").contentSha256 =
    `sha256:${rawDigest("wrong-content")}`;
  const wrongHashEvents: string[] = [];
  const [wrongHashResult] = await Promise.allSettled([
    loadEvidence(
      { provenance: wrongHashProvenance },
      (path) => Promise.resolve(byteStream(evidence.get(path)!)),
      selectedAt,
      {
        observe(event) {
          wrongHashEvents.push(
            `${event.descriptorId}:${event.action}:${event.representation}`,
          );
        },
      },
    ),
  ]);
  invariant(
    wrongHashResult?.status === "rejected" &&
      (wrongHashResult.reason as Error).message.includes(
        "official response content hash drifted",
      ) && wrongHashEvents.includes("first:cancel:decoded") &&
      wrongHashEvents.includes("first:release:decoded") &&
      !wrongHashEvents.some((event) => event.startsWith("second:")),
    "hash failure did not release the descriptor before stopping ingestion",
  );
  let unknownNormalizer = "";
  try {
    normalizeEvidenceBody({ kind: "unknown-evidence-kind" }, "body");
  } catch (error) {
    unknownNormalizer = (error as Error).message;
  }
  invariant(
    unknownNormalizer ===
      "unknown-evidence-kind evidence kind has no normalizer",
    "unknown evidence kind must fail before normalized retention",
  );
  let rawHolder = "";
  try {
    assertNormalizedEvidenceValue(new Uint8Array(1), "raw holder fixture");
  } catch (error) {
    rawHolder = (error as Error).message;
  }
  invariant(
    rawHolder.includes("retained a raw or executable evidence holder"),
    "normalized authority must reject raw byte, stream, or reader holders",
  );
  const sourcePackument: JsonRecord = {
    _id: "detached",
    _rev: "1-fixture",
    name: "detached",
    "dist-tags": { latest: "1.0.0" },
    time: { "1.0.0": "2026-01-01T00:00:00.000Z" },
    versions: {
      "1.0.0": {
        name: "detached",
        version: "1.0.0",
        scripts: { install: "node install.js" },
      },
    },
  };
  const detachedPackument = normalizeNpmPackument(sourcePackument);
  object(sourcePackument.time, "source time")["1.0.0"] =
    "2026-01-02T00:00:00.000Z";
  object(
    object(sourcePackument.versions, "source versions")["1.0.0"],
    "source manifest",
  ).scripts = {};
  invariant(
    object(detachedPackument.time, "detached time")["1.0.0"] ===
        "2026-01-01T00:00:00.000Z" &&
      object(
          object(detachedPackument.versions, "detached versions")["1.0.0"],
          "detached manifest",
        ).scripts !==
        object(
          object(sourcePackument.versions, "source versions")["1.0.0"],
          "source manifest",
        ).scripts,
    "normalized authority retained its parsed source root",
  );
});

Deno.test("captured runtime graph controls discriminate official bytes", async () => {
  const fixture = await makeFixture();
  const authority = await validateGraph(
    fixture.graph,
    fixtureReader(fixture),
  );
  const contents = await syntheticRepository(fixture);
  await validateRepositoryContents(
    contents,
    fixture.graph,
    fixtureReader(fixture),
    authority,
  );
  const repositoryStream = await openEvidence("deno.json");
  await repositoryStream.cancel();
  const retargetControl = await makeFixture();
  const retargetPnpm = object(
    object(retargetControl.graph.repository, "repository").pnpm,
    "retarget pnpm",
  );
  const retargetSnapshotRow = object(
    array(retargetPnpm.snapshots, "retarget snapshots")[0],
    "retarget snapshot",
  );
  const retargetImporter = object(
    object(
      array(retargetPnpm.importers, "retarget importers")[0],
      "retarget importer",
    ).value,
    "retarget importer value",
  );
  object(retargetImporter.dependencies, "retarget dependencies")[
    nameOf(String(retargetSnapshotRow.id).replace("primary:", ""))
  ] = { specifier: "1.0.0", version: "not-the-old-resolution" };
  delete retargetImporter.optionalDependencies;
  retargetSnapshot(
    retargetControl.graph,
    retargetSnapshotRow,
    string(retargetSnapshotRow.key, "retarget snapshot key"),
  );
  exactValue(
    requiredManifestRanges({
      dependencies: { optional: "^1.0.0" },
      optionalDependencies: { optional: "^1.0.0" },
      peerDependencies: { optionalPeer: "^1.0.0" },
      peerDependenciesMeta: { optionalPeer: { optional: true } },
    }),
    [],
    "optional manifest relations are not compatibility exclusions",
  );
  exactValue(
    requiredManifestRanges({ peerDependencies: { required: "^1.0.0" } }),
    [{
      relation: "peerDependencies",
      name: "required",
      range: "^1.0.0",
    }],
    "absent peer metadata defaults to required",
  );

  const largePackument = await makeFixture();
  const largeDescriptor = object(
    array(largePackument.graph.provenance, "provenance").find((raw) =>
      object(raw, "descriptor").id === "npm-astro"
    ),
    "large packument descriptor",
  );
  const largeBody = parseJson(
    await gunzipBounded(
      largePackument.evidence.get(String(largeDescriptor.path))!,
    ),
    "large packument",
  );
  largeBody.fixturePadding = "x".repeat(2 * 1024 * 1024 + 1);
  await refreshEvidenceDescriptor(
    largePackument,
    "npm-astro",
    JSON.stringify(largeBody),
  );
  const refreshedLargeHash = object(
    array(largePackument.graph.provenance, "provenance").find((raw) =>
      object(raw, "descriptor").id === "npm-astro"
    ),
    "large packument descriptor",
  ).contentSha256;
  object(
    array(
      object(object(largePackument.graph.repository, "repository").pnpm, "pnpm")
        .packages,
      "pnpm packages",
    ).find((raw) => object(raw, "package").id === "astro"),
    "astro package",
  ).manifestContentSha256 = refreshedLargeHash;
  await validateGraph(largePackument.graph, fixtureReader(largePackument));

  const compressedOversize = await makeFixture();
  const compressedPath = string(
    object(
      array(compressedOversize.graph.provenance, "provenance")[0],
      "compressed descriptor",
    ).path,
    "compressed descriptor path",
  );
  const compressedBytes = compressedOversize.evidence.get(compressedPath)!;
  await expectReaderReject(
    compressedOversize,
    fixtureReader(compressedOversize),
    "compressed provenance artifact exceeds",
    { compressedLimit: compressedBytes.byteLength - 1 },
  );

  const decompressedOversize = await makeFixture();
  const decompressedDescriptor = object(
    array(decompressedOversize.graph.provenance, "provenance")[0],
    "decompressed descriptor",
  );
  const decompressedBody = await gunzipBounded(
    decompressedOversize.evidence.get(
      string(decompressedDescriptor.path, "decompressed descriptor path"),
    )!,
  );
  await expectReaderReject(
    decompressedOversize,
    fixtureReader(decompressedOversize),
    "decompressed provenance artifact exceeds",
    {
      decompressedLimit: new TextEncoder().encode(decompressedBody).byteLength -
        1,
    },
  );
  for (
    const [maximum, label] of [
      [MAX_COMPRESSED_EVIDENCE_BYTES, "compressed"],
      [MAX_DECOMPRESSED_EVIDENCE_BYTES, "decompressed"],
    ] as const
  ) {
    const allocations: number[] = [];
    const body = await readBounded(
      sizedByteStream(maximum),
      maximum,
      `${label} exact-boundary fixture`,
      (size) => {
        allocations.push(size);
        return new Uint8Array(size);
      },
    );
    invariant(
      body.byteLength === maximum && body.buffer.byteLength === maximum &&
        JSON.stringify(allocations) === JSON.stringify([maximum]),
      `${label} evidence did not retain exactly one bounded backing buffer`,
    );
  }
  let cancelledAtNPlusOne = false;
  const nPlusOne = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(8));
      controller.enqueue(new Uint8Array(1));
    },
    cancel() {
      cancelledAtNPlusOne = true;
    },
  });
  const nPlusOneResult = await Promise.allSettled([
    readBounded(nPlusOne, 8, "N+1 evidence fixture"),
  ]);
  invariant(
    nPlusOneResult[0]?.status === "rejected" && cancelledAtNPlusOne &&
      (nPlusOneResult[0].reason as Error).message.includes("exceeds 8"),
    "N+1 evidence must cancel and reject before a second retained buffer",
  );

  for (
    const [candidate, range, expected] of [
      ["1.2.3", "*", true],
      ["1.2.3", "1.x", true],
      ["1.2.3", "1.2.x", true],
      ["1.2.3", "1.2", true],
      ["1.2.3", "2.x", false],
      ["1.2.3", "1.3.x", false],
      ["1.2.3", "1.2.3", true],
      ["1.2.3", "=1.2.3", true],
      ["1.2.3", ">1.2.2", true],
      ["1.2.3", ">= 1.2.3", true],
      ["1.2.3", "<2", true],
      ["1.2.3", "<=1.2.3", true],
      ["1.2.3", "~1.2.0", true],
      ["1.2.3", "^1.0.0", true],
      ["0.2.3", "^0.2.0", true],
      ["0.0.3", "^0.0.3", true],
      ["1.2.3", "1.0.0 - 1.2.3", true],
      ["9.39.5", "^8.0.0-0 || ^9.0.0 || ^10.0.0", true],
      ["9.39.5", "^10.0.0-0 || ^9.0.0", true],
      ["5.9.3", ">=4.8.4 <6.1.0", true],
      ["6.0.3", "^5.0.0", false],
      ["1.2.3-alpha", "1.2.3-alpha", true],
    ] as const
  ) {
    invariant(
      satisfiesRange(candidate, range) === expected,
      `semver fixture ${candidate} / ${range} was evaluated incorrectly`,
    );
  }
  let unsupportedRange = "";
  try {
    satisfiesRange("1.2.3", "workspace:*");
  } catch (error) {
    unsupportedRange = (error as Error).message;
  }
  invariant(
    unsupportedRange.includes("unsupported manifest range"),
    "unknown npm range syntax must fail closed",
  );
  for (
    const [left, right, expected] of [
      ["1.0.0-alpha", "1.0.0-alpha.1", -1],
      ["1.0.0-alpha.2", "1.0.0-alpha.10", -1],
      ["1.0.0-alpha", "1.0.0-beta", -1],
      ["1.0.0-2", "1.0.0-alpha", -1],
      ["1.0.0-alpha", "1.0.0-2", 1],
      ["1.0.0-alpha", "1.0.0-alpha", 0],
      ["1.0.0", "1.0.0-alpha", 1],
      ["1.0.0-alpha", "1.0.0", -1],
      ["1.0.0-alpha.1", "1.0.0-alpha", 1],
      ["1.0.0-beta", "1.0.0-alpha", 1],
    ] as const
  ) {
    invariant(
      compareVersions(left, right) === expected,
      `prerelease ordering ${left} / ${right} drifted`,
    );
  }
  let malformedJson = "";
  try {
    parseJson("{", "malformed JSON fixture");
  } catch (error) {
    malformedJson = (error as Error).message;
  }
  invariant(
    malformedJson.includes("valid JSON"),
    "malformed JSON must fail closed",
  );
  parseJson('{"spaced"   : true}', "spaced JSON key fixture");
  exactValue(splitInline("{a: b}, [c, d], 'e,f'"), [
    "{a: b}",
    "[c, d]",
    "'e,f'",
  ], "nested inline YAML splitting");
  invariant(yamlColon("{nested: value}: tail") === 15, "nested YAML colon");
  invariant(yamlColon("no-colon") === -1, "absent YAML colon");
  invariant(npmRequestName("plain") === "plain", "plain npm request name");
  invariant(
    npmRequestName("plain@1.0.0") === "plain",
    "versioned npm request name",
  );
  invariant(
    npmRequestName("@scope/plain") === "@scope/plain",
    "bare scoped npm request name",
  );
  invariant(
    npmRequestName("alias@npm:@scope/plain@1.0.0") === "@scope/plain",
    "scoped npm alias request name",
  );
  invariant(
    exactNpmTarget("plain") === null &&
      exactNpmTarget("npm:plain@1.0.0") === "npm:plain@1.0.0" &&
      exactNpmTarget("alias@npm:plain@1.0.0") === "npm:plain@1.0.0",
    "exact npm target parsing",
  );
  invariant(
    resolveDenoSpecifier(
          "npm:alias@npm:@scope/plain@^1",
          "@scope/plain@1.2.3",
          ["npm:@scope/plain@1.2.3"],
        ) === "npm:@scope/plain@1.2.3" &&
      resolveDenoSpecifier(
          "jsr:@scope/plain",
          "@scope/plain@1.2.3",
          ["jsr:@scope/plain@1.2.3"],
        ) === "jsr:@scope/plain@1.2.3" &&
      resolveDenoDependency(
          "jsr:@scope/plain@1.2.3",
          {},
          ["jsr:@scope/plain@1.2.3"],
        ) === "jsr:@scope/plain@1.2.3" &&
      resolveDenoDependency(
          "plain",
          { "npm:plain@^1": "1.2.3" },
          ["npm:plain@1.2.3"],
        ) === "npm:plain@1.2.3",
    "complete Deno specifier forms",
  );

  const alternate = await makeFixture();
  const alternateImporter = object(
    array(
      object(object(alternate.graph.repository, "repository").pnpm, "pnpm")
        .importers,
      "importers",
    )[0],
    "root importer",
  );
  delete object(alternateImporter.value, "root importer value")
    .optionalDependencies;
  delete object(alternateImporter.value, "root importer value").dependencies;
  const alternateContents = await syntheticRepository(alternate, {
    quoteAll: true,
    crlf: true,
  });
  await validateRepositoryContents(
    alternateContents,
    alternate.graph,
    fixtureReader(alternate),
  );
  exactValue(parseYaml("outer:\n  empty: {}\n", "block empty map"), {
    outer: { empty: {} },
  }, "explicit nested empty map");
  exactValue(
    parseYaml("key:\n", "null fixture"),
    { key: null },
    "bare YAML null",
  );
  exactValue(
    parseYaml(
      "flow: {plain: value, 'single''quote': '*'}\nlist: [darwin, linux]\nnullOne: null\nnullTwo: ~\n",
      "flow fixture",
    ),
    {
      flow: { plain: "value", "single'quote": "*" },
      list: ["darwin", "linux"],
      nullOne: null,
      nullTwo: null,
    },
    "flow and single-quoted YAML",
  );
  invariant(
    renderYaml({ value: null }).includes("null"),
    "YAML renderer must preserve explicit null",
  );
  invariant(
    renderYaml(["root"] as unknown as YamlRecord).trim() === "- root",
    "YAML renderer supports a root scalar sequence",
  );
  for (
    const [yaml, expected] of [
      ["a: 1\na: 2\n", "duplicate key"],
      ["a: &x value\n", "aliases, tags"],
      ["a: *x\n", "aliases, tags"],
      ["a: !tag value\n", "aliases, tags"],
      ["a:\n  <<: {}\n", "merge keys"],
      ["---\na: value\n", "unsupported YAML"],
      ["a: value\n---\nb: value\n", "unsupported YAML"],
      ["a:\n   b: value\n", "indentation"],
      ["a:\tvalue\n", "tab"],
      ["a: [one, two\n", "unsupported syntax"],
      ["a: value\rnext: value\n", "lone carriage"],
    ] as const
  ) {
    let message = "";
    try {
      parseYaml(yaml, "negative YAML");
    } catch (error) {
      message = (error as Error).message;
    }
    invariant(
      message.includes(expected),
      `YAML negative expected '${expected}', observed '${message}'`,
    );
  }

  await expectReject((candidate) => {
    object(candidate.graph.selection, "selection").selectedAt =
      "2026-01-10T04:05:06Z";
  }, "preserve RFC3339");
  await expectReject((candidate) => {
    object(candidate.graph.selection, "selection").selectedAt =
      "2026-01-10T04:05:06.789000001Z";
    object(candidate.graph.selection, "selection").eligibleBefore =
      "2026-01-07T04:05:06.789000001Z";
  }, "selection time must equal the latest provenance retrieval");
  await expectReject((candidate) => {
    object(
      array(candidate.graph.provenance, "provenance")[0],
      "descriptor",
    ).retrievedAt = "2026-01-10T03:35:06.788Z";
  }, "outside the 30-minute capture window");
  await expectReject((candidate) => {
    object(
      array(candidate.graph.provenance, "provenance")[0],
      "descriptor",
    ).retrievedAt = "2026-01-10T04:05:06.790Z";
  }, "outside the 30-minute capture window");
  await expectReject((candidate) => {
    for (const raw of array(candidate.graph.provenance, "provenance")) {
      object(raw, "descriptor").retrievedAt = "2026-01-10T04:04:06.789Z";
    }
  }, "selection time must equal the latest provenance retrieval");
  await expectReject((candidate) => {
    const descriptor = clone(
      object(array(candidate.graph.provenance, "provenance")[0], "descriptor"),
    );
    descriptor.id = "unused-descriptor";
    descriptor.path = `${PROVENANCE_ROOT}unused-descriptor.gz`;
    array(candidate.graph.provenance, "provenance").push(descriptor);
    candidate.evidence.set(
      String(descriptor.path),
      candidate.evidence.values().next().value!,
    );
  }, "provenance metadata membership");
  await expectReject((candidate) => {
    const descriptors = array(candidate.graph.provenance, "provenance").map((
      raw,
    ) => object(raw, "descriptor"));
    descriptors[1]!.path = descriptors[0]!.path;
  }, "artifact paths must be unique");
  for (
    const [sourceUrl, expected] of [
      [
        "https://user:password@registry.npmjs.org/astro",
        "credential-free exact HTTPS",
      ],
      [
        "https://registry.npmjs.org/astro?token=secret",
        "credential-free exact HTTPS",
      ],
      [
        "https://registry.npmjs.org/astro#secret",
        "credential-free exact HTTPS",
      ],
      ["https://registry.example/astro", "origin or path is not allowlisted"],
      ["not a URL", "source URL is invalid"],
    ] as const
  ) {
    await expectReject((candidate) => {
      object(
        array(candidate.graph.provenance, "provenance").find((raw) =>
          object(raw, "descriptor").id === "npm-astro"
        ),
        "astro descriptor",
      ).sourceUrl = sourceUrl;
    }, expected);
  }
  await expectReject((candidate) => {
    object(
      array(candidate.graph.provenance, "provenance")[0],
      "descriptor",
    ).kind = "unknown-evidence-kind";
  }, "origin or path is not allowlisted");
  await expectReject(async (candidate) => {
    const descriptor = object(
      array(candidate.graph.provenance, "provenance").find((raw) =>
        object(raw, "descriptor").id === "npm-astro"
      ),
      "astro descriptor",
    );
    const body = parseJson(
      await gunzipBounded(candidate.evidence.get(String(descriptor.path))!),
      "astro packument",
    );
    delete body._rev;
    await refreshEvidenceDescriptor(
      candidate,
      "npm-astro",
      JSON.stringify(body),
    );
  }, "full packument identity drifted");
  await expectReject(async (candidate) => {
    const descriptor = object(
      array(candidate.graph.provenance, "provenance").find((raw) =>
        object(raw, "descriptor").id === "npm-astro"
      ),
      "astro descriptor",
    );
    const body = parseJson(
      await gunzipBounded(candidate.evidence.get(String(descriptor.path))!),
      "astro packument",
    );
    object(body.time, "astro times").modified =
      "2026-01-10T04:05:06.789000001Z";
    await refreshEvidenceDescriptor(
      candidate,
      "npm-astro",
      JSON.stringify(body),
    );
  }, "packument event occurs after retrieval");
  await expectReject(async (candidate) => {
    const descriptor = object(
      array(candidate.graph.provenance, "provenance").find((raw) =>
        object(raw, "descriptor").id === "npm-astro"
      ),
      "astro descriptor",
    );
    const body = parseJson(
      await gunzipBounded(candidate.evidence.get(String(descriptor.path))!),
      "astro packument",
    );
    object(
      object(body.versions, "versions")[fixtureVersion("astro")],
      "astro manifest",
    ).dist = {
      integrity: SRI,
      shasum: "a".repeat(40),
      tarball: "https://example.invalid/archive.tgz",
    };
    await refreshEvidenceDescriptor(
      candidate,
      "npm-astro",
      JSON.stringify(body),
    );
  }, "tarball source is not exact");
  await expectReject((candidate) => {
    packageAt(candidate.graph, "astro").publishedAt =
      "2026-01-01T04:05:06.000Z";
  }, "publication time drifted");
  for (const invalidVersion of ["25.1.0", "22.20.0", nextVersion("node")]) {
    await expectReject((candidate) => {
      packageAt(candidate.graph, "node").version = invalidVersion;
    }, "newest official LTS line");
  }
  await expectReject((candidate) => {
    packageAt(candidate.graph, "node").latestLts = fixtureVersion("node");
  }, "newest official LTS line");
  await expectReject(async (candidate) => {
    const descriptor = object(
      array(candidate.graph.provenance, "provenance").find((raw) =>
        object(raw, "descriptor").id === "node-lts-index"
      ),
      "Node index descriptor",
    );
    const rows = array(
      parseJsonValue(
        await gunzipBounded(candidate.evidence.get(String(descriptor.path))!),
        "Node index",
      ),
      "Node index",
    ).map((raw) => object(raw, "Node row"));
    object(
      rows.find((row) => row.version === `v${fixtureVersion("node")}`),
      "Node selected row",
    ).lts = false;
    await refreshEvidenceDescriptor(
      candidate,
      "node-lts-index",
      JSON.stringify(rows),
    );
  }, "no age-eligible release");
  await expectReject((candidate) => {
    packageAt(candidate.graph, "astro").artifactValue = `sha512-${
      "B".repeat(86)
    }==`;
  }, "integrity drifted");
  await expectReject((candidate) => {
    const descriptor = object(
      array(candidate.graph.provenance, "provenance").find((raw) =>
        object(raw, "descriptor").id === "npm-astro"
      ),
      "npm-astro",
    );
    descriptor.contentSha256 = `sha256:${rawDigest("f")}`;
  }, "official response content hash drifted");
  await expectReject(async (candidate) => {
    const descriptor = object(
      array(candidate.graph.provenance, "provenance").find((raw) =>
        object(raw, "descriptor").id === "npm-astro"
      ),
      "npm-astro",
    );
    const body = parseJsonValue(
      await gunzipBounded(candidate.evidence.get(String(descriptor.path))!),
      "astro packument",
    ) as JsonRecord;
    delete object(body.versions, "versions")[nextVersion("astro")];
    await refreshEvidenceDescriptor(
      candidate,
      "npm-astro",
      JSON.stringify(body),
    );
  }, "complete newer stable interval");
  await expectReject(async (candidate) => {
    const descriptor = object(
      array(candidate.graph.provenance, "provenance").find((raw) =>
        object(raw, "descriptor").id === "npm-astro"
      ),
      "astro descriptor",
    );
    const body = parseJson(
      await gunzipBounded(candidate.evidence.get(String(descriptor.path))!),
      "astro packument",
    );
    const hiddenVersion = nextVersion("astro", 3);
    object(body.versions, "versions")[hiddenVersion] = manifestFor(
      "astro",
      hiddenVersion,
    );
    object(body.time, "times")[hiddenVersion] = "2026-01-09T04:05:06.792Z";
    await refreshEvidenceDescriptor(
      candidate,
      "npm-astro",
      JSON.stringify(body),
    );
  }, "latest stable was not derived from all captured stable versions");
  await expectReject(async (candidate) => {
    const item = packageAt(candidate.graph, "astro");
    item.version = nextVersion("astro");
    item.publishedAt = "2026-01-08T04:05:06.790Z";
    item.latestStable = nextVersion("astro");
    object(item.distTags, "astro dist-tags").latest = nextVersion("astro");
    item.newerReleases = [];
    const descriptor = object(
      array(candidate.graph.provenance, "provenance").find((raw) =>
        object(raw, "descriptor").id === "npm-astro"
      ),
      "npm-astro",
    );
    const body = parseJsonValue(
      await gunzipBounded(candidate.evidence.get(String(descriptor.path))!),
      "astro packument",
    ) as JsonRecord;
    object(body["dist-tags"], "dist-tags").latest = nextVersion("astro");
    await refreshEvidenceDescriptor(
      candidate,
      "npm-astro",
      JSON.stringify(body),
    );
  }, "latest stable was not derived from all captured stable versions");
  await expectReject((candidate) => {
    const edge = array(
      object(candidate.graph.repository, "repository").peerEdges,
      "peer edges",
    ).map((raw) => object(raw, "edge"))
      .find((edge) => edge.id === "react-hooks-peer-eslint")!;
    edge.manifestRange = "^9.0.0";
  }, "manifest range drifted from official bytes");
  await expectReject((candidate) => {
    const release = object(
      array(
        packageAt(candidate.graph, "typescript").newerReleases,
        "TypeScript newer releases",
      )[0],
      "TypeScript newer release",
    );
    release.reason = "arbitrary-incompatibility-label";
  }, "omitted an eligible compatible release");
  await expectReject((candidate) => {
    const release = object(
      array(
        packageAt(candidate.graph, "typescript").newerReleases,
        "TypeScript newer releases",
      )[0],
      "TypeScript newer release",
    );
    release.compatible = true;
    release.reason = "younger-than-cutoff";
    release.failingEdges = [];
  }, "machine-derived incompatibility edges");
  await expectReject((candidate) => {
    const release = object(
      array(
        packageAt(candidate.graph, "eslint-plugin-react-hooks").newerReleases,
        "React hooks newer releases",
      )[0],
      "React hooks newer release",
    );
    object(array(release.failingEdges, "failing edges")[0], "failing edge")
      .range = "^9.0.0";
  }, "machine-derived incompatibility edges");
  await expectReject(async (candidate) => {
    const descriptor = object(
      array(candidate.graph.provenance, "provenance").find((raw) =>
        object(raw, "descriptor").id === "npm-eslint-plugin-react-hooks"
      ),
      "react hooks descriptor",
    );
    const body = parseJson(
      await gunzipBounded(
        candidate.evidence.get(string(descriptor.path, "path"))!,
      ),
      "react hooks packument",
    );
    const manifest = object(
      object(
        body.versions,
        "versions",
      )[fixtureVersion("eslint-plugin-react-hooks")],
      "react hooks manifest",
    );
    delete manifest.peerDependencies;
    await refreshEvidenceDescriptor(
      candidate,
      "npm-eslint-plugin-react-hooks",
      JSON.stringify(body),
    );
    const refreshedHash = object(
      array(candidate.graph.provenance, "provenance").find((raw) =>
        object(raw, "descriptor").id === "npm-eslint-plugin-react-hooks"
      ),
      "react hooks descriptor",
    ).contentSha256;
    for (
      const release of array(
        packageAt(candidate.graph, "eslint-plugin-react-hooks").newerReleases,
        "newer releases",
      ).map((raw) => object(raw, "newer release"))
    ) {
      for (
        const edge of array(release.failingEdges, "failing edges").map((raw) =>
          object(raw, "failing edge")
        )
      ) {
        if (edge.manifestEvidenceId === "npm-eslint-plugin-react-hooks") {
          edge.manifestContentSha256 = refreshedHash;
        }
      }
    }
  }, "must be a non-empty string");
  await expectReject((candidate) => {
    const edge = array(
      object(candidate.graph.repository, "repository").peerEdges,
      "peer edges",
    ).map((raw) => object(raw, "edge"))
      .find((edge) => edge.id === "astro-check-peer-typescript")!;
    edge.selectedResolution = "6.0.3";
  }, "selected resolution disagrees with graph");
  await expectReject((candidate) => {
    const edge = array(
      object(candidate.graph.repository, "repository").importEdges,
      "edges",
    ).map((raw) => object(raw, "edge"))
      .find((edge) => edge.id === "kysely-dialect")!;
    edge.authority = "npm-manifest";
    edge.relation = "dependencies";
    edge.manifestRange = "^3.0.0";
    edge.evidenceId = "npm-kysely";
  }, "invents an npm manifest range");
  await expectReject((candidate) => {
    const specifiers = object(
      object(candidate.graph.repository, "repository").denoSpecifiers,
      "denoSpecifiers",
    );
    specifiers["jsr:@std/internal@^1.0.10"] = "1.0.13";
  }, "specifier target is absent");
  await expectReject((candidate) => {
    const nodes = array(
      object(candidate.graph.repository, "repository").denoLockNodes,
      "Deno nodes",
    ).map((raw) => object(raw, "Deno node"));
    const hono = object(
      nodes.find((node) => String(node.key).startsWith("npm:hono@")),
      "Hono node",
    );
    hono.dependencies = [];
  }, "retained-manifest dependencies membership is not exact");
  await expectReject((candidate) => {
    const nodes = array(
      object(candidate.graph.repository, "repository").denoLockNodes,
      "Deno nodes",
    ).map((raw) => object(raw, "Deno node"));
    const dialect = object(
      nodes.find((node) =>
        String(node.key).startsWith("npm:kysely-postgres-js@")
      ),
      "dialect node",
    );
    dialect.dependencies = ["kysely"];
    dialect.optionalDependencies = ["postgres"];
    delete dialect.optionalPeers;
  }, "retained-manifest optionalDependencies membership is not exact");
  await expectReject((candidate) => {
    const pnpm = object(
      object(candidate.graph.repository, "repository").pnpm,
      "pnpm",
    );
    array(pnpm.snapshots, "snapshots").pop();
  }, "pnpm graph must retain multiple peer-qualified snapshots");
  await expectReject((candidate) => {
    const pnpm = object(
      object(candidate.graph.repository, "repository").pnpm,
      "pnpm",
    );
    const packages = array(pnpm.packages, "packages").map((raw) =>
      object(raw, "package")
    );
    const snapshots = array(pnpm.snapshots, "snapshots").map((raw) =>
      object(raw, "snapshot")
    );
    const oldPackage = object(
      packages.find((item) => item.id === "astro"),
      "Astro package",
    );
    const newerPackage = clone(oldPackage);
    newerPackage.id = "astro-retarget";
    newerPackage.version = nextVersion("astro");
    newerPackage.key = `astro@${newerPackage.version}`;
    newerPackage.resolutionId = `pnpm:${newerPackage.key}`;
    array(pnpm.packages, "packages").push(newerPackage);
    const oldSnapshot = object(
      snapshots.find((item) => item.id === "primary:astro"),
      "Astro snapshot",
    );
    const newerSnapshot = clone(oldSnapshot);
    newerSnapshot.id = "retarget:astro";
    newerSnapshot.packageKey = newerPackage.key;
    newerSnapshot.key = String(oldSnapshot.key).replace(
      String(oldPackage.key),
      String(newerPackage.key),
    );
    array(pnpm.snapshots, "snapshots").push(newerSnapshot);
    const rootRecord = object(
      array(pnpm.importers, "importers")[0],
      "root importer",
    );
    object(
      object(rootRecord.value, "root value").devDependencies,
      "devDependencies",
    )
      .astro = {
        specifier: fixtureVersion("astro"),
        version: String(newerSnapshot.key).slice("astro@".length),
      };
  }, "importer resolution is not bound to its exact package and snapshot");
  await expectReject((candidate) => {
    const snapshot = object(
      array(
        object(object(candidate.graph.repository, "repository").pnpm, "pnpm")
          .snapshots,
        "snapshots",
      )[0],
      "snapshot",
    );
    object(snapshot.value, "snapshot value").dev = true;
  }, "invented dev field");
  await expectReject((candidate) => {
    const packageRow = object(
      array(
        object(object(candidate.graph.repository, "repository").pnpm, "pnpm")
          .packages,
        "packages",
      )[0],
      "package",
    );
    object(packageRow.value, "package value").hasBin = false;
  }, "hasBin must be true");
  await expectReject((candidate) => {
    const pnpm = object(
      object(candidate.graph.repository, "repository").pnpm,
      "pnpm",
    );
    const snapshot = object(array(pnpm.snapshots, "snapshots")[0], "snapshot");
    snapshot.packageKey = "missing@1.0.0";
  }, "snapshot lacks an exact package record");
  await expectReject((candidate) => {
    const pnpm = object(
      object(candidate.graph.repository, "repository").pnpm,
      "pnpm",
    );
    const snapshot = object(array(pnpm.snapshots, "snapshots")[0], "snapshot");
    snapshot.key = `${snapshot.key}(@types/react@1.0.0)(@types/react@1.0.0)`;
  }, "duplicate peer");
  await expectReject((candidate) => {
    const snapshots = array(
      object(object(candidate.graph.repository, "repository").pnpm, "pnpm")
        .snapshots,
      "snapshots",
    ).map((raw) => object(raw, "snapshot"));
    const snapshot = object(
      snapshots.find((row) => row.id === "primary:astro-react"),
      "astro-react snapshot",
    );
    const root = object(
      object(
        array(
          object(object(candidate.graph.repository, "repository").pnpm, "pnpm")
            .importers,
          "importers",
        )[0],
        "root importer",
      ).value,
      "root importer value",
    );
    object(root.dependencies, "root dependencies")[nameOf("astro-react")] = {
      specifier: fixtureVersion("astro-react"),
      version: "wrong-resolution",
    };
    retargetSnapshot(
      candidate.graph,
      snapshot,
      string(snapshot.key, "snapshot key").replace(
        `(react@${fixtureVersion("react")})`,
        "",
      ),
    );
    delete object(snapshot.peerIds, "peer IDs").react;
  }, "omits a required retained-manifest peer");
  await expectReject((candidate) => {
    const snapshots = array(
      object(object(candidate.graph.repository, "repository").pnpm, "pnpm")
        .snapshots,
      "snapshots",
    ).map((raw) => object(raw, "snapshot"));
    const snapshot = object(
      snapshots.find((row) => row.id === "primary:astro-react"),
      "astro-react snapshot",
    );
    retargetSnapshot(
      candidate.graph,
      snapshot,
      string(snapshot.key, "snapshot key").replace(
        `react@${fixtureVersion("react")}`,
        "react@19.2.1",
      ),
    );
  }, "must be an object");
  await expectReject((candidate) => {
    const snapshots = array(
      object(object(candidate.graph.repository, "repository").pnpm, "pnpm")
        .snapshots,
      "snapshots",
    ).map((raw) => object(raw, "snapshot"));
    const snapshot = object(
      snapshots.find((row) => row.id === "primary:astro-react"),
      "astro-react snapshot",
    );
    retargetSnapshot(
      candidate.graph,
      snapshot,
      `${snapshot.key}(invented-peer@1.0.0)`,
    );
    object(snapshot.peerIds, "peer IDs")["invented-peer"] =
      "pnpm:invented-peer@1.0.0";
  }, "not backed by its retained manifest");
  await expectReject(async (candidate) => {
    const descriptor = object(
      array(candidate.graph.provenance, "provenance").find((raw) =>
        object(raw, "descriptor").id === "npm-astro-react"
      ),
      "astro-react descriptor",
    );
    const packument = parseJson(
      await gunzipBounded(candidate.evidence.get(String(descriptor.path))!),
      "astro-react packument",
    );
    const manifest = object(
      object(packument.versions, "versions")[fixtureVersion("astro-react")],
      "astro-react manifest",
    );
    object(
      object(manifest.peerDependenciesMeta, "peer meta")["@types/react"],
      "types peer meta",
    ).optional = false;
    await refreshEvidenceDescriptor(
      candidate,
      "npm-astro-react",
      JSON.stringify(packument),
    );
    const refreshed = object(
      array(candidate.graph.provenance, "provenance").find((raw) =>
        object(raw, "descriptor").id === "npm-astro-react"
      ),
      "astro-react descriptor",
    ).contentSha256;
    const packageRecord = object(
      array(
        object(object(candidate.graph.repository, "repository").pnpm, "pnpm")
          .packages,
        "packages",
      ).find((raw) => object(raw, "package").id === "astro-react"),
      "astro-react package",
    );
    packageRecord.manifestContentSha256 = refreshed;
    object(
      object(packageRecord.value, "package value").peerDependenciesMeta,
      "peer metadata",
    )["@types/react"] = { optional: false };
  }, "omits a required retained-manifest peer");
  await expectReject((candidate) => {
    const snapshots = array(
      object(object(candidate.graph.repository, "repository").pnpm, "pnpm")
        .snapshots,
      "snapshots",
    ).map((raw) => object(raw, "snapshot"));
    const snapshot = object(
      snapshots.find((row) => row.id === "primary:astro-react"),
      "astro-react snapshot",
    );
    retargetSnapshot(
      candidate.graph,
      snapshot,
      string(snapshot.key, "snapshot key").replace(
        `(react-dom@${fixtureVersion("react-dom")}(react@${
          fixtureVersion("react")
        }))`,
        `(react-dom@${fixtureVersion("react-dom")}(react@19.2.1))`,
      ),
    );
  }, "lacks a backing snapshot identity");
  await expectReject((candidate) => {
    const deno = object(
      object(candidate.graph.lifecycle, "lifecycle").deno,
      "deno lifecycle",
    );
    deno.allowScripts = ["esbuild@0.25.12"];
  }, "exact npm constraints");
  await expectReject((candidate) => {
    const pnpm = object(
      object(candidate.graph.lifecycle, "lifecycle").pnpm,
      "pnpm lifecycle",
    );
    pnpm.allowBuilds = { esbuild: true, fsevents: false };
  }, "exact hook-owner approvals");
  await expectReject((candidate) => {
    const pnpm = object(
      object(candidate.graph.lifecycle, "lifecycle").pnpm,
      "pnpm lifecycle",
    );
    pnpm.dangerouslyAllowAllBuilds = true;
  }, "lifecycle policy is permissive");
  await expectReject((candidate) => {
    const executions = array(
      object(
        object(candidate.graph.repository, "repository").repeatability,
        "repeatability",
      ).lifecycleExecutions,
      "executions",
    );
    object(executions[0], "execution").manifestContentSha256 = `sha256:${
      rawDigest("9")
    }`;
  }, "lifecycle execution is not bound");
  await expectReject((candidate) => {
    const runs = array(
      object(
        object(candidate.graph.repository, "repository").repeatability,
        "repeatability",
      ).runs,
      "runs",
    ).map((raw) => object(raw, "run"));
    const execution = object(
      array(runs[2]!.lifecycleExecutions, "executions")[0],
      "execution",
    );
    execution.pnpmRunId = runs[0]!.runId;
    object(
      array(
        object(
          object(candidate.graph.repository, "repository").repeatability,
          "repeatability",
        ).lifecycleExecutions,
        "all executions",
      )[0],
      "execution",
    ).pnpmRunId = runs[0]!.runId;
  }, "attributed to a Deno run");
  await expectReject((candidate) => {
    const runs = array(
      object(
        object(candidate.graph.repository, "repository").repeatability,
        "repeatability",
      ).runs,
      "runs",
    ).map((raw) => object(raw, "run"));
    runs[0]!.command = "compare lock hashes";
  }, "command disagrees with captured structure");
  await expectReject((candidate) => {
    object(candidate.graph.corepack, "corepack").descriptor =
      `pnpm@11.21.0+sha512.${PNPM_SRI.slice(7)}`;
  }, "128-character lowercase hex");
  await expectReject((candidate) => {
    object(object(candidate.graph.corepack, "corepack").proof, "proof")
      .unsetEnvironment = [];
  }, "Corepack unset environment membership");
  for (
    const unsafe of [
      "token=registry-secret",
      "C:\\Users\\example\\cache",
      "/home/example/.cache",
    ]
  ) {
    await expectReject((candidate) => {
      const run = object(
        array(
          object(object(candidate.graph.corepack, "corepack").proof, "proof")
            .runs,
          "Corepack runs",
        )[0],
        "Corepack run",
      );
      run.statusToken = unsafe;
    }, "contains secret-bearing or physical-path text");
  }
  await expectReject((candidate) => {
    const descriptor = object(
      array(candidate.graph.provenance, "provenance").find((raw) =>
        object(raw, "descriptor").id === "shadcn-button"
      ),
      "button descriptor",
    );
    descriptor.sourceUrl =
      "https://raw.githubusercontent.com/shadcn-ui/ui/main/button.tsx";
  }, "source origin or path is not allowlisted");
  await expectReject((candidate) => {
    object(candidate.graph.shadcn, "shadcn").buttonDirectImports = [
      "base-ui-react",
      "class-variance-authority",
      "cn-helper",
      "lucide-react",
    ];
  }, "Button graph imports membership");
  await expectReject(async (candidate) => {
    const descriptor = object(
      array(candidate.graph.provenance, "provenance").find((raw) =>
        object(raw, "descriptor").id === "shadcn-cn"
      ),
      "cn descriptor",
    );
    await refreshEvidenceDescriptor(
      candidate,
      "shadcn-cn",
      'import { clsx } from "clsx"\nexport { clsx }\n',
    );
    descriptor.sourceUrl = `https://raw.githubusercontent.com/shadcn-ui/ui/${
      "a".repeat(40)
    }/apps/v4/registry/bases/base/lib/utils.ts`;
  }, "cn retained source imports");
  await expectReject(async (candidate) => {
    const image = object(
      array(candidate.graph.ociImages, "images")[0],
      "image",
    );
    const id = String(image.evidenceId);
    const descriptor = object(
      array(candidate.graph.provenance, "provenance").find((raw) =>
        object(raw, "descriptor").id === id
      ),
      "OCI descriptor",
    );
    const index = parseJson(
      await gunzipBounded(candidate.evidence.get(String(descriptor.path))!),
      "OCI index",
    );
    array(index.manifests, "manifests").pop();
    const body = JSON.stringify(index);
    await refreshEvidenceDescriptor(candidate, id, body);
    const digestValue = await sha256Text(body);
    image.indexDigest = digestValue;
    image.reference = `${image.repository}:${image.tag}@${digestValue}`;
  }, "complete descriptor set disagrees");
  await expectReject((candidate) => {
    const image = object(
      array(candidate.graph.ociImages, "images")[0],
      "image",
    );
    image.tag = "latest";
  }, "official repository or tag");
  await expectReject((candidate) => {
    const image = object(
      array(candidate.graph.ociImages, "images")[0],
      "image",
    );
    image.mediaType = OCI_MANIFEST_MEDIA;
  }, "not an OCI index");
  await expectReject((candidate) => {
    const image = object(
      array(candidate.graph.ociImages, "images")[0],
      "image",
    );
    image.indexDigest =
      object(array(image.descriptors, "descriptors")[0], "descriptor").digest;
  }, "index digest drifted from raw response bytes");
  await expectReject((candidate) => {
    object(candidate.graph.proofStatus, "proofStatus").runtimeBehavior =
      "proven";
  }, "cannot be marked proven");

  await expectRepositoryReject((files) => {
    const packageJson = JSON.parse(
      string(files.get("package.json"), "package.json"),
    );
    packageJson.devDependencies.astro = "^5.15.5";
    files.set("package.json", JSON.stringify(packageJson));
  }, "package dependency is not exact");
  await expectRepositoryReject((files) => {
    const denoJson = JSON.parse(string(files.get("deno.json"), "deno.json"));
    denoJson.tasks.fmt = "deno fmt tools";
    files.set("deno.json", JSON.stringify(denoJson));
  }, "base tasks configuration disagrees");
  await expectRepositoryReject((files) => {
    files.set(
      ".npmrc",
      "registry=https://registry.npmjs.org/\nsave-exact=true\n",
    );
  }, "misplaced non-registry policy");
  await expectRepositoryReject((files) => {
    const workspace = parseYaml(
      string(files.get("pnpm-workspace.yaml"), "workspace"),
      "workspace",
    );
    delete workspace.strictDepBuilds;
    files.set(
      "pnpm-workspace.yaml",
      renderYaml(workspace as unknown as YamlRecord),
    );
  }, "pnpm workspace policy disagrees");
  await expectRepositoryReject((files) => {
    const workspace = parseYaml(
      string(files.get("pnpm-workspace.yaml"), "workspace"),
      "workspace",
    );
    workspace.onlyBuiltDependencies = ["esbuild"];
    files.set(
      "pnpm-workspace.yaml",
      renderYaml(workspace as unknown as YamlRecord),
    );
  }, "pnpm workspace policy disagrees");
  await expectRepositoryReject((files) => {
    const lock = parseYaml(
      string(files.get("pnpm-lock.yaml"), "pnpm lock"),
      "pnpm lock",
    );
    lock.flatSnapshots = lock.snapshots;
    delete lock.snapshots;
    files.set("pnpm-lock.yaml", renderYaml(lock as unknown as YamlRecord));
  }, "pnpm.lock fields membership");
  await expectRepositoryReject((files) => {
    const lock = parseYaml(
      string(files.get("pnpm-lock.yaml"), "pnpm lock"),
      "pnpm lock",
    );
    object(lock.importers, "importers").extra = {};
    files.set("pnpm-lock.yaml", renderYaml(lock as unknown as YamlRecord));
  }, "pnpm importers disagrees");
  await expectRepositoryReject((files) => {
    files.set("pnpm-lock.yaml", `${files.get("pnpm-lock.yaml")}snapshots:\n`);
  }, "duplicate key");
  await expectRepositoryReject((files) => {
    const denoLock = JSON.parse(string(files.get("deno.lock"), "deno.lock"));
    denoLock.specifiers["jsr:@std/internal@^1.0.10"] = "1.0.13";
    files.set("deno.lock", JSON.stringify(denoLock));
  }, "Deno lock specifiers disagrees");
  await expectRepositoryReject((files) => {
    const denoLock = JSON.parse(string(files.get("deno.lock"), "deno.lock"));
    delete denoLock.jsr;
    files.set("deno.lock", JSON.stringify(denoLock));
  }, "Deno file and graph lock nodes");
  await expectRepositoryReject((_files, candidate) => {
    const artifact = object(
      array(
        object(candidate.graph.repository, "repository").artifacts,
        "artifacts",
      )[0],
      "artifact",
    );
    artifact.sha256 = `sha256:${rawDigest("9")}`;
  }, "hash disagrees with graph");
  await expectRepositoryReject((files) => {
    files.set(REPORT_PATH, "# stale\n");
  }, "report is missing or stale");

  const readFailure = await Promise.allSettled([readRepositoryInputs(() => {
    throw new Error("synthetic read failure");
  })]);
  invariant(
    readFailure[0]?.status === "rejected" &&
      (readFailure[0].reason as Error).message === "synthetic read failure",
    "unexpected repository reads must propagate",
  );
  await validateRepositoryGraph(
    (path) => Promise.resolve(string(contents.get(path), path)),
    fixtureReader(fixture),
  );
});

Deno.test("repository supplies the immutable FND-003 runtime graph", async () => {
  await validateRepositoryGraph(Deno.readTextFile, openEvidence);
});
