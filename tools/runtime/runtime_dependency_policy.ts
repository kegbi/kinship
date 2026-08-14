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

const LOCK_SHA256 = {
  deno: "8A39257B18EC8FF53ACB693EFE2969D8136284A0A8293517E43313E1FB7898C8",
  pnpm: "385FCD5C1E1FFBE7EEBEFBF62E3730A1F11773F43D1010F7A3C8A9A4D8F4ECF8",
} as const;

const SHA256_INITIAL = [
  0x6a09e667,
  0xbb67ae85,
  0x3c6ef372,
  0xa54ff53a,
  0x510e527f,
  0x9b05688c,
  0x1f83d9ab,
  0x5be0cd19,
] as const;

const SHA256_ROUND = [
  0x428a2f98,
  0x71374491,
  0xb5c0fbcf,
  0xe9b5dba5,
  0x3956c25b,
  0x59f111f1,
  0x923f82a4,
  0xab1c5ed5,
  0xd807aa98,
  0x12835b01,
  0x243185be,
  0x550c7dc3,
  0x72be5d74,
  0x80deb1fe,
  0x9bdc06a7,
  0xc19bf174,
  0xe49b69c1,
  0xefbe4786,
  0x0fc19dc6,
  0x240ca1cc,
  0x2de92c6f,
  0x4a7484aa,
  0x5cb0a9dc,
  0x76f988da,
  0x983e5152,
  0xa831c66d,
  0xb00327c8,
  0xbf597fc7,
  0xc6e00bf3,
  0xd5a79147,
  0x06ca6351,
  0x14292967,
  0x27b70a85,
  0x2e1b2138,
  0x4d2c6dfc,
  0x53380d13,
  0x650a7354,
  0x766a0abb,
  0x81c2c92e,
  0x92722c85,
  0xa2bfe8a1,
  0xa81a664b,
  0xc24b8b70,
  0xc76c51a3,
  0xd192e819,
  0xd6990624,
  0xf40e3585,
  0x106aa070,
  0x19a4c116,
  0x1e376c08,
  0x2748774c,
  0x34b0bcb5,
  0x391c0cb3,
  0x4ed8aa4a,
  0x5b9cca4f,
  0x682e6ff3,
  0x748f82ee,
  0x78a5636f,
  0x84c87814,
  0x8cc70208,
  0x90befffa,
  0xa4506ceb,
  0xbef9a3f7,
  0xc67178f2,
] as const;

function object(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function containsEvery(
  contents: string,
  fragments: readonly string[],
): boolean {
  return fragments.every((fragment) => contents.includes(fragment));
}

function rotateRight(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount));
}

function sha256(contents: string): string {
  const source = new TextEncoder().encode(contents);
  const paddedLength = Math.ceil((source.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(source);
  padded[source.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bitLength = source.length * 8;
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(paddedLength - 4, bitLength);

  const hash: number[] = [...SHA256_INITIAL];
  for (let offset = 0; offset < paddedLength; offset += 64) {
    const schedule = new Uint32Array(64);
    for (let index = 0; index < 16; index++) {
      schedule[index] = view.getUint32(offset + index * 4);
    }
    for (let index = 16; index < schedule.length; index++) {
      const previous15 = schedule[index - 15] ?? 0;
      const previous2 = schedule[index - 2] ?? 0;
      const sigma0 = rotateRight(previous15, 7) ^
        rotateRight(previous15, 18) ^ (previous15 >>> 3);
      const sigma1 = rotateRight(previous2, 17) ^
        rotateRight(previous2, 19) ^ (previous2 >>> 10);
      schedule[index] = ((schedule[index - 16] ?? 0) + sigma0 +
        (schedule[index - 7] ?? 0) + sigma1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = hash as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    for (let index = 0; index < schedule.length; index++) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^
        rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temporary1 = (h + sum1 + choice +
        (SHA256_ROUND[index] ?? 0) + (schedule[index] ?? 0)) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^
        rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }
    const blockHash = [a, b, c, d, e, f, g, h];
    for (let index = 0; index < hash.length; index++) {
      hash[index] = ((hash[index] ?? 0) + (blockHash[index] ?? 0)) >>> 0;
    }
  }
  return hash.map((word) => word.toString(16).padStart(8, "0")).join("")
    .toUpperCase();
}

function stripYamlComment(line: string): string | undefined {
  let singleQuoted = false;
  let doubleQuoted = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (character === "'" && !doubleQuoted) {
      if (singleQuoted && line[index + 1] === "'") {
        index++;
      } else {
        singleQuoted = !singleQuoted;
      }
    } else if (
      character === '"' && !singleQuoted && line[index - 1] !== "\\"
    ) {
      doubleQuoted = !doubleQuoted;
    } else if (
      character === "#" && !singleQuoted && !doubleQuoted &&
      (index === 0 || /\s/.test(line[index - 1] ?? ""))
    ) {
      return line.slice(0, index);
    }
  }
  return singleQuoted || doubleQuoted ? undefined : line;
}

function parseYamlScalar(source: string): unknown {
  if (source === "true") return true;
  if (source === "false") return false;
  if (/^-?\d+$/.test(source)) return Number(source);
  if (source === "{}") return Object.create(null) as Record<string, unknown>;
  if (source.startsWith("[") || source.startsWith("{")) {
    return JSON.parse(source) as unknown;
  }
  if (source.startsWith('"')) return JSON.parse(source) as unknown;
  if (source.startsWith("'")) {
    if (!source.endsWith("'") || source.length < 2) throw new Error();
    return source.slice(1, -1).replaceAll("''", "'");
  }
  return source;
}

function parseYamlMappings(
  source: string,
  requiredMappingPaths: readonly (readonly string[])[],
): Record<string, unknown> | undefined {
  const root = Object.create(null) as Record<string, unknown>;
  const stack: Array<{
    indent: number;
    childIndent?: number;
    path: readonly string[];
    value: Record<string, unknown>;
  }> = [
    { indent: -1, path: [], value: root },
  ];
  try {
    for (const originalLine of source.split(/\r?\n/)) {
      if (originalLine.includes("\t")) throw new Error();
      const uncommented = stripYamlComment(originalLine);
      if (uncommented === undefined) throw new Error();
      const line = uncommented.trimEnd();
      if (line.trim() === "") continue;
      const indent = line.length - line.trimStart().length;
      const entry = line.slice(indent);
      while ((stack.at(-1)?.indent ?? -1) >= indent) stack.pop();
      const parent = stack.at(-1);
      if (parent === undefined || indent <= parent.indent) throw new Error();
      if (parent.childIndent === undefined) parent.childIndent = indent;
      else if (indent !== parent.childIndent) throw new Error();
      if (entry.startsWith("- ")) {
        const mappingRequired = requiredMappingPaths.some((path) =>
          path.length === parent.path.length &&
          path.every((key, index) => key === parent.path[index])
        );
        if (mappingRequired) throw new Error();
        continue;
      }

      const separator = entry.indexOf(":");
      if (separator <= 0) throw new Error();
      const separatorFollower = entry[separator + 1];
      if (separatorFollower !== undefined && !/\s/.test(separatorFollower)) {
        throw new Error();
      }
      const key = entry.slice(0, separator).trim();
      if (!/^[A-Za-z0-9_.@/-]+$/.test(key)) throw new Error();
      if (Object.hasOwn(parent.value, key)) throw new Error();
      const scalar = entry.slice(separator + 1).trim();
      if (scalar === "") {
        const child = Object.create(null) as Record<string, unknown>;
        parent.value[key] = child;
        stack.push({ indent, path: [...parent.path, key], value: child });
      } else {
        parent.value[key] = parseYamlScalar(scalar);
      }
    }
    return root;
  } catch {
    return undefined;
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function exactRecord(
  actual: unknown,
  expected: Record<string, boolean>,
): boolean {
  const actualRecord = record(actual);
  return actualRecord !== undefined &&
    JSON.stringify(Object.keys(actualRecord).sort()) ===
      JSON.stringify(Object.keys(expected).sort()) &&
    Object.entries(expected).every(([key, value]) =>
      actualRecord[key] === value
    );
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
    denoLockSha256: sha256(denoLock),
    pnpmLockSha256: sha256(pnpmLock),
  };
  const lockExpected = {
    imports: backendImports,
    frontend: frontendPackages,
    backendLocked: true,
    frontendLocked: true,
    denoLockSha256: LOCK_SHA256.deno,
    pnpmLockSha256: LOCK_SHA256.pnpm,
  };

  const workspaceConfig = parseYamlMappings(workspace, [[], ["allowBuilds"]]);
  const expectedAllowBuilds =
    RUNTIME_DEPENDENCY_POLICY.lifecycle.pnpmAllowBuilds;
  const workspaceControls = workspaceConfig !== undefined &&
    workspaceConfig.lockfile === true &&
    workspaceConfig.sharedWorkspaceLockfile === true &&
    workspaceConfig.gitBranchLockfile === false &&
    workspaceConfig.saveExact === true &&
    workspaceConfig.minimumReleaseAge === 4320 &&
    workspaceConfig.minimumReleaseAgeStrict === true &&
    workspaceConfig.minimumReleaseAgeIgnoreMissingTime === false &&
    workspaceConfig.strictDepBuilds === true &&
    workspaceConfig.dangerouslyAllowAllBuilds === false &&
    exactRecord(workspaceConfig.allowBuilds, expectedAllowBuilds);
  const lifecycleActual = {
    lock: denoJson.lock,
    minimumDependencyAge: denoJson.minimumDependencyAge,
    allowScripts: denoJson.allowScripts,
    workspaceControls,
  };
  const lifecycleExpected = {
    lock: { path: "./deno.lock", frozen: true },
    minimumDependencyAge: RUNTIME_DEPENDENCY_POLICY.dependencyAge.deno,
    allowScripts: RUNTIME_DEPENDENCY_POLICY.lifecycle.denoAllowScripts,
    workspaceControls: true,
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
  const composeConfig = parseYamlMappings(compose, [
    [],
    ["services"],
    ["services", "postgres"],
  ]);
  const composeServices = record(composeConfig?.services);
  const composePostgres = record(composeServices?.postgres);
  const containerActual = {
    primary: composePostgres?.image,
    compatibility: tasks["test:schema:compat"],
  };
  const containerExpected = {
    primary:
      `\${POSTGRES_IMAGE:-${RUNTIME_DEPENDENCY_POLICY.images.postgresPrimary}}`,
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
