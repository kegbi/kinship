export interface RuntimePolicySnapshot {
  files: Record<string, string | undefined>;
}

export interface RuntimePolicyIssue {
  code: string;
  path: string;
  message: string;
}

interface RuntimePolicyRule extends RuntimePolicyIssue {
  valid: boolean;
}

const backendImports = {
  "@hono/standard-validator": "npm:@hono/standard-validator@0.4.0",
  "@standard-schema/spec": "npm:@standard-schema/spec@1.1.0",
  hono: "npm:hono@4.13.1",
  kysely: "npm:kysely@0.29.4",
  "kysely-postgres-js": "npm:kysely-postgres-js@3.0.0",
  postgres: "npm:postgres@3.4.9",
  zod: "npm:zod@4.4.3",
} as const;

const frontendPackages = {
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

export const RUNTIME_DEPENDENCY_POLICY = {
  selectedOn: "2026-08-14",
  runtimes: {
    deno: "2.9.5",
    node: "24.15.0",
    pnpm: "11.21.0",
  },
  compatibility: {
    node: ">=24.0.0 <25",
    pnpm: "11.21.0",
  },
  backendImports,
  frontendPackages,
  dependencyAge: {
    deno: "PT72H",
    pnpmMinutes: 4320,
  },
  lifecycle: {
    denoAllowScripts: [],
    pnpmAllowBuilds: {
      "esbuild@0.28.2": true,
      "fsevents@2.3.2": false,
      "fsevents@2.3.3": false,
    },
  },
  images: {
    postgresPrimary:
      "postgres:18.4-alpine3.23@sha256:996d0920e4ff9df1fc19dacb904492f3c1ec0ec1cc338f0ad7123be7731c5f5e",
    postgresCompatibility:
      "postgres:17.10-alpine3.23@sha256:8189a1f6e40904781fc9e2612687877791d21679866db58b1de996b31fc312e4",
  },
  architectures: ["windows/x64", "linux/amd64", "linux/arm64"],
} as const;

const PACKAGE_MANAGER =
  "pnpm@11.21.0+sha512.521705bce689924eac72f5a3587122f362689ef6571e55ba80076fd637c11132ecffada26fad4ea79c485bfddbfd3d5a2a5b05805a77e893de71ec8a6cca3bb1";

const TASKS = {
  check:
    "DENO_NO_PACKAGE_JSON=1 deno check tools/schema/validate_postgres.ts tools/workflows/foundation_recovery_policy.ts tools/runtime/runtime_dependency_policy.ts",
  "test:runtime":
    "DENO_NO_PACKAGE_JSON=1 deno test --allow-read tools/runtime/runtime_dependency_policy_test.ts",
  "test:runtime:coverage":
    "DENO_NO_PACKAGE_JSON=1 deno test --allow-read --coverage=.coverage/runtime --clean tools/runtime/runtime_dependency_policy_test.ts && deno coverage --include=tools/runtime/runtime_dependency_policy\\.ts$ --detailed --threshold=80 .coverage/runtime",
  "deps:deno":
    "DENO_NO_PACKAGE_JSON=1 deno install --frozen --node-modules-dir=none",
  "deps:deno:offline":
    "DENO_NO_PACKAGE_JSON=1 deno install --frozen --cached-only --node-modules-dir=none",
  "deps:node": "pnpm install --frozen-lockfile",
  "deps:node:offline": "pnpm install --offline --frozen-lockfile",
  deps: "deno task deps:deno && deno task deps:node",
} as const;

function object(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function containsEvery(
  contents: string,
  fragments: readonly string[],
): boolean {
  return fragments.every((fragment) => contents.includes(fragment));
}

export function validateRuntimeDependencyPolicy(
  snapshot: RuntimePolicySnapshot,
): RuntimePolicyIssue[] {
  const files = snapshot.files;
  const denoJson = object(JSON.parse(String(files["deno.json"])));
  const packageJson = object(JSON.parse(String(files["package.json"])));
  const tasks = object(denoJson.tasks);
  const engines = object(packageJson.engines);
  const workspace = String(files["pnpm-workspace.yaml"]);
  const denoLock = String(files["deno.lock"]);
  const pnpmLock = String(files["pnpm-lock.yaml"]);
  const note = String(
    files["docs/validation/sequence-2-runtime-dependencies.md"],
  );
  const compose = String(files["compose.schema-test.yaml"]);

  const runtimeActual = {
    selector: String(files[".tool-versions"]).trim(),
    nodeCompatibility: engines.node,
    pnpmCompatibility: engines.pnpm,
    packageManager: packageJson.packageManager,
  };
  const runtimeExpected = {
    selector: "deno 2.9.5\nnodejs 24.15.0\npnpm 11.21.0",
    nodeCompatibility: RUNTIME_DEPENDENCY_POLICY.compatibility.node,
    pnpmCompatibility: RUNTIME_DEPENDENCY_POLICY.compatibility.pnpm,
    packageManager: PACKAGE_MANAGER,
  };

  const backendLockFragments = Object.values(backendImports).map((specifier) =>
    `${JSON.stringify(specifier)}:`
  );
  const frontendLockFragments = Object.values(frontendPackages).map(
    (version) => `specifier: ${version}`,
  );
  const lockActual = {
    imports: denoJson.imports,
    frontend: packageJson.devDependencies,
    backendLocked: containsEvery(denoLock, backendLockFragments),
    frontendLocked: containsEvery(pnpmLock, frontendLockFragments),
  };
  const lockExpected = {
    imports: backendImports,
    frontend: frontendPackages,
    backendLocked: true,
    frontendLocked: true,
  };

  const allowBuildLines = Array.from(
    workspace.matchAll(/^[ ]{2}\S+@\S+: (?:true|false)$/gm),
    (match) => match[0],
  );
  const lifecycleActual = {
    lock: denoJson.lock,
    minimumDependencyAge: denoJson.minimumDependencyAge,
    allowScripts: denoJson.allowScripts,
    workspaceControls: containsEvery(workspace, [
      "lockfile: true",
      "sharedWorkspaceLockfile: true",
      "gitBranchLockfile: false",
      "saveExact: true",
      "minimumReleaseAge: 4320",
      "minimumReleaseAgeStrict: true",
      "minimumReleaseAgeIgnoreMissingTime: false",
      "strictDepBuilds: true",
      "dangerouslyAllowAllBuilds: false",
    ]),
    allowBuildLines,
  };
  const lifecycleExpected = {
    lock: { path: "./deno.lock", frozen: true },
    minimumDependencyAge: RUNTIME_DEPENDENCY_POLICY.dependencyAge.deno,
    allowScripts: RUNTIME_DEPENDENCY_POLICY.lifecycle.denoAllowScripts,
    workspaceControls: true,
    allowBuildLines: [
      "  esbuild@0.28.2: true",
      "  fsevents@2.3.2: false",
      "  fsevents@2.3.3: false",
    ],
  };

  const taskActual = Object.fromEntries(
    Object.keys(TASKS).map((name) => [name, tasks[name]]),
  );
  const selectionTokens = [
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
  ];
  const containerActual = {
    primary: compose.includes(
      `\${POSTGRES_IMAGE:-${RUNTIME_DEPENDENCY_POLICY.images.postgresPrimary}}`,
    ),
    compatibility: tasks["test:schema:compat"],
  };
  const containerExpected = {
    primary: true,
    compatibility:
      `deno task test:schema --postgres-image ${RUNTIME_DEPENDENCY_POLICY.images.postgresCompatibility}`,
  };

  const rules: RuntimePolicyRule[] = [
    {
      code: "runtime.pin",
      path: ".tool-versions",
      message: "execution runtimes must retain their exact selected versions",
      valid: JSON.stringify(runtimeActual) === JSON.stringify(runtimeExpected),
    },
    {
      code: "dependency.lock",
      path: "deno.lock, pnpm-lock.yaml",
      message:
        "exact manifest dependencies must be consumed by canonical locks",
      valid: JSON.stringify(lockActual) === JSON.stringify(lockExpected),
    },
    {
      code: "dependency.lifecycle",
      path: "deno.json, pnpm-workspace.yaml",
      message:
        "frozen locks, package age, and lifecycle allowlists must stay narrow",
      valid:
        JSON.stringify(lifecycleActual) === JSON.stringify(lifecycleExpected),
    },
    {
      code: "dependency.task",
      path: "deno.json",
      message:
        "root runtime and dependency tasks must retain exact truthful commands",
      valid: JSON.stringify(taskActual) === JSON.stringify(TASKS),
    },
    {
      code: "documentation.selection",
      path: "docs/validation/sequence-2-runtime-dependencies.md",
      message:
        "runtime selection evidence and upgrade ownership must stay recorded",
      valid: containsEvery(note, selectionTokens),
    },
    {
      code: "container.pin",
      path: "compose.schema-test.yaml, deno.json",
      message: "consumed PostgreSQL images must use immutable index digests",
      valid:
        JSON.stringify(containerActual) === JSON.stringify(containerExpected),
    },
  ];
  return rules.filter((rule) => !rule.valid).map((
    { valid: _valid, ...issue },
  ) => issue);
}
