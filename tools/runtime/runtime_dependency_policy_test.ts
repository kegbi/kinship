interface RuntimePolicyIssue {
  code: string;
  path: string;
  message: string;
}

interface RuntimePolicySnapshot {
  files: Record<string, string | undefined>;
}

interface RuntimePolicyModule {
  validateRuntimeDependencyPolicy(
    snapshot: RuntimePolicySnapshot,
  ): RuntimePolicyIssue[];
}

const EXPECTED_RUNTIME_VERSIONS = {
  deno: "2.9.5",
  node: "24.15.0",
  pnpm: "11.21.0",
} as const;

const EXPECTED_BACKEND_IMPORTS = {
  "@hono/standard-validator": "npm:@hono/standard-validator@0.4.0",
  "@standard-schema/spec": "npm:@standard-schema/spec@1.1.0",
  hono: "npm:hono@4.13.1",
  kysely: "npm:kysely@0.29.4",
  "kysely-postgres-js": "npm:kysely-postgres-js@3.0.0",
  postgres: "npm:postgres@3.4.9",
  zod: "npm:zod@4.4.3",
} as const;

const EXPECTED_FRONTEND_PACKAGES = {
  "@astrojs/check": "0.9.10",
  "@astrojs/node": "11.1.0",
  "@astrojs/react": "6.0.2",
  "@base-ui/react": "1.7.0",
  "@playwright/test": "1.62.1",
  "@tailwindcss/vite": "4.3.3",
  "@types/react": "19.2.18",
  "@types/react-dom": "19.2.4",
  "@typescript-eslint/parser": "8.66.0",
  "@vitest/coverage-v8": "4.1.10",
  astro: "7.2.0",
  "class-variance-authority": "0.7.1",
  clsx: "2.1.1",
  eslint: "9.39.5",
  "eslint-plugin-astro": "1.7.0",
  "eslint-plugin-jsx-a11y": "6.10.2",
  "eslint-plugin-react-hooks": "7.1.1",
  "happy-dom": "20.11.2",
  react: "19.2.8",
  "react-dom": "19.2.8",
  shadcn: "4.16.2",
  "tailwind-merge": "3.6.0",
  tailwindcss: "4.3.3",
  typescript: "6.0.3",
  vite: "8.2.1",
  vitest: "4.1.10",
} as const;

const EXPECTED_IMAGES = {
  primary:
    "postgres:18.4-alpine3.23@sha256:996d0920e4ff9df1fc19dacb904492f3c1ec0ec1cc338f0ad7123be7731c5f5e",
  compatibility:
    "postgres:17.10-alpine3.23@sha256:8189a1f6e40904781fc9e2612687877791d21679866db58b1de996b31fc312e4",
} as const;

const SNAPSHOT_PATHS = [
  ".tool-versions",
  "compose.schema-test.yaml",
  "deno.json",
  "deno.lock",
  "docs/validation/sequence-2-runtime-dependencies.md",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
] as const;

const policyModuleUrl = new URL(
  "./runtime_dependency_policy.ts",
  import.meta.url,
);
const loadedPolicyModule = await import(policyModuleUrl.href).then(
  (module) => module as RuntimePolicyModule,
  () => undefined,
);

function readOptional(path: string): string | undefined {
  try {
    return Deno.readTextFileSync(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
}

function repositorySnapshot(): RuntimePolicySnapshot {
  return {
    files: Object.fromEntries(
      SNAPSHOT_PATHS.map((path) => [path, readOptional(path)]),
    ),
  };
}

function requireText(snapshot: RuntimePolicySnapshot, path: string): string {
  const contents = snapshot.files[path];
  if (contents === undefined) {
    throw new Error(`required file is missing: ${path}`);
  }
  return contents;
}

function requirePolicyModule(): RuntimePolicyModule {
  if (loadedPolicyModule === undefined) {
    throw new Error(
      "runtime dependency policy source is missing: " +
        policyModuleUrl.pathname,
    );
  }
  return loadedPolicyModule;
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function parseJson(path: string, contents: string): Record<string, unknown> {
  const value = JSON.parse(contents) as unknown;
  assert(
    typeof value === "object" && value !== null && !Array.isArray(value),
    `${path} must contain a JSON object`,
  );
  return value as Record<string, unknown>;
}

function record(value: unknown, label: string): Record<string, unknown> {
  assert(
    typeof value === "object" && value !== null && !Array.isArray(value),
    `${label} must be an object`,
  );
  return value as Record<string, unknown>;
}

function mutate(
  snapshot: RuntimePolicySnapshot,
  path: string,
  transform: (contents: string) => string,
): RuntimePolicySnapshot {
  return {
    files: {
      ...snapshot.files,
      [path]: transform(requireText(snapshot, path)),
    },
  };
}

function issueCodes(issues: RuntimePolicyIssue[]): string[] {
  return [...new Set(issues.map((issue) => issue.code))].sort();
}

Deno.test("repository satisfies the executable runtime dependency policy", () => {
  assertEquals(
    requirePolicyModule().validateRuntimeDependencyPolicy(repositorySnapshot()),
    [],
  );
});

Deno.test("execution runtimes have exact pins distinct from compatibility ranges", () => {
  const snapshot = repositorySnapshot();
  const toolVersions = requireText(snapshot, ".tool-versions").trim().split(
    /\r?\n/,
  );
  assertEquals(toolVersions, [
    `deno ${EXPECTED_RUNTIME_VERSIONS.deno}`,
    `nodejs ${EXPECTED_RUNTIME_VERSIONS.node}`,
    `pnpm ${EXPECTED_RUNTIME_VERSIONS.pnpm}`,
  ]);

  const packageJson = parseJson(
    "package.json",
    requireText(snapshot, "package.json"),
  );
  const engines = record(packageJson.engines, "package.json engines");
  assertEquals(engines.node, ">=24.0.0 <25");
  assertEquals(engines.pnpm, EXPECTED_RUNTIME_VERSIONS.pnpm);
  assert(
    packageJson.packageManager ===
      "pnpm@11.21.0+sha512.521705bce689924eac72f5a3587122f362689ef6571e55ba80076fd637c11132ecffada26fad4ea79c485bfddbfd3d5a2a5b05805a77e893de71ec8a6cca3bb1",
    "packageManager must retain the exact pnpm version and integrity",
  );
});

Deno.test("exact backend and frontend manifests are consumed by their locks", () => {
  const snapshot = repositorySnapshot();
  const denoJson = parseJson("deno.json", requireText(snapshot, "deno.json"));
  assertEquals(denoJson.imports, EXPECTED_BACKEND_IMPORTS);

  const denoLock = requireText(snapshot, "deno.lock");
  for (const [name, specifier] of Object.entries(EXPECTED_BACKEND_IMPORTS)) {
    assert(
      denoLock.includes(JSON.stringify(specifier)),
      `deno.lock must consume ${name} at ${specifier}`,
    );
  }

  const packageJson = parseJson(
    "package.json",
    requireText(snapshot, "package.json"),
  );
  assertEquals(packageJson.devDependencies, EXPECTED_FRONTEND_PACKAGES);
  const pnpmLock = requireText(snapshot, "pnpm-lock.yaml");
  for (const [name, version] of Object.entries(EXPECTED_FRONTEND_PACKAGES)) {
    const quoted = `'${name}':`;
    const plain = `${name}:`;
    assert(
      (pnpmLock.includes(quoted) || pnpmLock.includes(plain)) &&
        pnpmLock.includes(`specifier: ${version}`),
      `pnpm-lock.yaml must consume ${name} at ${version}`,
    );
  }
});

Deno.test("locks, package age, and lifecycle allowlists remain narrow", () => {
  const snapshot = repositorySnapshot();
  const denoJson = parseJson("deno.json", requireText(snapshot, "deno.json"));
  assertEquals(denoJson.lock, { path: "./deno.lock", frozen: true });
  assertEquals(denoJson.minimumDependencyAge, "PT72H");
  assertEquals(denoJson.allowScripts, []);

  const workspace = requireText(snapshot, "pnpm-workspace.yaml");
  for (
    const setting of [
      "lockfile: true",
      "sharedWorkspaceLockfile: true",
      "gitBranchLockfile: false",
      "saveExact: true",
      "minimumReleaseAge: 4320",
      "minimumReleaseAgeStrict: true",
      "minimumReleaseAgeIgnoreMissingTime: false",
      "strictDepBuilds: true",
      "dangerouslyAllowAllBuilds: false",
      "  esbuild@0.28.2: true",
      "  fsevents@2.3.2: false",
      "  fsevents@2.3.3: false",
    ]
  ) {
    assert(workspace.includes(setting), `pnpm policy is missing ${setting}`);
  }
  const allowBuildLines = workspace.match(/^  \S+@\S+: (?:true|false)$/gm) ??
    [];
  assertEquals(allowBuildLines, [
    "  esbuild@0.28.2: true",
    "  fsevents@2.3.2: false",
    "  fsevents@2.3.3: false",
  ]);
  const pnpmLock = requireText(snapshot, "pnpm-lock.yaml");
  assert(
    pnpmLock.includes("esbuild@0.28.2"),
    "reviewed esbuild must be locked",
  );
  assert(
    pnpmLock.includes("fsevents@2.3.2"),
    "reviewed fsevents 2.3.2 must be locked",
  );
  assert(
    pnpmLock.includes("fsevents@2.3.3"),
    "reviewed fsevents 2.3.3 must be locked",
  );
});

Deno.test("version-selection note records evidence, ownership, and deferrals", () => {
  const note = requireText(
    repositorySnapshot(),
    "docs/validation/sequence-2-runtime-dependencies.md",
  );
  for (
    const required of [
      "2026-08-14",
      "https://github.com/denoland/deno/releases/tag/v2.9.5",
      "https://nodejs.org/en/about/previous-releases",
      "https://pnpm.io/package_json#packagemanager",
      "https://hub.docker.com/_/postgres",
      "deno.json",
      "deno.lock",
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "linux/amd64",
      "linux/arm64",
      "esbuild@0.28.2",
      "fsevents@2.3.2",
      "fsevents@2.3.3",
      "72 hours",
      "quarterly",
      "Foundation",
      "FND-10",
    ]
  ) {
    assert(
      note.includes(required),
      `version-selection note is missing ${required}`,
    );
  }
});

Deno.test("runtime policy is exposed through truthful root test, coverage, and check tasks", () => {
  const denoJson = parseJson(
    "deno.json",
    requireText(repositorySnapshot(), "deno.json"),
  );
  const tasks = record(denoJson.tasks, "deno.json tasks");
  assertEquals(
    tasks["test:runtime"],
    "DENO_NO_PACKAGE_JSON=1 deno test --allow-read tools/runtime/runtime_dependency_policy_test.ts",
  );
  assertEquals(
    tasks["test:runtime:coverage"],
    "DENO_NO_PACKAGE_JSON=1 deno test --allow-read --coverage=.coverage/runtime --clean tools/runtime/runtime_dependency_policy_test.ts && deno coverage --include=tools/runtime/runtime_dependency_policy\\.ts$ --detailed --threshold=80 .coverage/runtime",
  );
  assertEquals(
    tasks.check,
    "DENO_NO_PACKAGE_JSON=1 deno check tools/schema/validate_postgres.ts tools/workflows/foundation_recovery_policy.ts tools/runtime/runtime_dependency_policy.ts",
  );
});

Deno.test("online and offline dependency tasks are frozen pairs", () => {
  const denoJson = parseJson(
    "deno.json",
    requireText(repositorySnapshot(), "deno.json"),
  );
  const tasks = record(denoJson.tasks, "deno.json tasks");
  assertEquals(
    tasks["deps:deno"],
    "DENO_NO_PACKAGE_JSON=1 deno install --frozen --node-modules-dir=none",
  );
  assertEquals(
    tasks["deps:deno:offline"],
    "DENO_NO_PACKAGE_JSON=1 deno install --frozen --cached-only --node-modules-dir=none",
  );
  assertEquals(tasks["deps:node"], "pnpm install --frozen-lockfile");
  assertEquals(
    tasks["deps:node:offline"],
    "pnpm install --offline --frozen-lockfile",
  );
  assertEquals(tasks.deps, "deno task deps:deno && deno task deps:node");
});

Deno.test("only consumed PostgreSQL images are immutable multi-architecture pins", () => {
  const snapshot = repositorySnapshot();
  const compose = requireText(snapshot, "compose.schema-test.yaml");
  assert(
    compose.includes(`\${POSTGRES_IMAGE:-${EXPECTED_IMAGES.primary}}`),
    "schema Compose must consume the PostgreSQL 18.4 index digest",
  );
  const denoJson = parseJson("deno.json", requireText(snapshot, "deno.json"));
  const tasks = record(denoJson.tasks, "deno.json tasks");
  assertEquals(
    tasks["test:schema:compat"],
    `deno task test:schema --postgres-image ${EXPECTED_IMAGES.compatibility}`,
  );
});

Deno.test("validator rejects pin, lock, lifecycle, task, note, and image drift", () => {
  const validator = requirePolicyModule().validateRuntimeDependencyPolicy;
  let snapshot = repositorySnapshot();
  snapshot = mutate(
    snapshot,
    ".tool-versions",
    (value) => value.replace("deno 2.9.5", "deno 2.9"),
  );
  snapshot = mutate(
    snapshot,
    "deno.lock",
    (value) => value.replace('"npm:zod@4.4.3"', '"npm:zod@4.4.2"'),
  );
  snapshot = mutate(
    snapshot,
    "pnpm-workspace.yaml",
    (value) =>
      value.replace(
        "dangerouslyAllowAllBuilds: false",
        "dangerouslyAllowAllBuilds: true",
      ),
  );
  snapshot = mutate(snapshot, "deno.json", (value) => {
    const config = parseJson("deno.json", value);
    const tasks = record(config.tasks, "deno.json tasks");
    tasks["deps:node:offline"] = "pnpm install";
    return JSON.stringify(config);
  });
  snapshot = mutate(
    snapshot,
    "docs/validation/sequence-2-runtime-dependencies.md",
    (value) => value.replaceAll("FND-10", "later"),
  );
  snapshot = mutate(
    snapshot,
    "compose.schema-test.yaml",
    (value) =>
      value.replace(EXPECTED_IMAGES.primary, "postgres:18.4-alpine3.23"),
  );

  assertEquals(issueCodes(validator(snapshot)), [
    "container.pin",
    "dependency.lifecycle",
    "dependency.lock",
    "dependency.task",
    "documentation.selection",
    "runtime.pin",
  ]);
});
