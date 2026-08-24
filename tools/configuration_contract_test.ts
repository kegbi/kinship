function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("Compose and root development pass PostgreSQL credentials as fields", async () => {
  const compose = await Deno.readTextFile(
    new URL("../compose.yaml", import.meta.url),
  );
  assert(
    compose.includes(
      "AUTH_MINIMUM_RESPONSE_MS: ${AUTH_MINIMUM_RESPONSE_MS:-250}",
    ),
    "Compose must pass the bounded authentication response floor only to the API",
  );
  assert(
    !compose.includes("DATABASE_URL: postgres://"),
    "Compose must not interpolate an unescaped password into a database URL",
  );
  for (
    const field of [
      "PGHOST: postgres",
      'PGPORT: "5432"',
      "PGUSER: ${POSTGRES_USER:-kinship}",
      "PGDATABASE: ${POSTGRES_DB:-kinship}",
      "PGPASSWORD: ${POSTGRES_PASSWORD}",
    ]
  ) {
    assert(
      compose.includes(field),
      `Compose must pass the PostgreSQL field ${field}`,
    );
  }
  assert(
    compose.includes(
      "AUTH_MFA_ENCRYPTION_KEYSET: ${AUTH_MFA_ENCRYPTION_KEYSET:-}",
    ),
    "Compose must pass the private MFA encryption key only to the API",
  );
  assert(
    compose.includes(
      "AUTH_THROTTLE_SUBJECT_KEYSET: ${AUTH_THROTTLE_SUBJECT_KEYSET:-}",
    ),
    "Compose must pass the private authentication-subject key only to the API",
  );
  assert(
    compose.includes(
      "INTEGRATIONS_ENCRYPTION_KEYSET: ${INTEGRATIONS_ENCRYPTION_KEYSET:-}",
    ),
    "Compose must pass the private integrations key only to the API",
  );
  const example = await Deno.readTextFile(
    new URL("../.env.example", import.meta.url),
  );
  assert(
    example.includes("AUTH_MINIMUM_RESPONSE_MS=250"),
    "the environment example must document the authentication response floor",
  );
  assert(
    example.includes("AUTH_MFA_ENCRYPTION_KEYSET="),
    "the environment example must document the production MFA key name",
  );
  assert(
    example.includes("AUTH_THROTTLE_SUBJECT_KEYSET="),
    "the environment example must document the authentication-subject key name",
  );
  assert(
    example.includes("INTEGRATIONS_ENCRYPTION_KEYSET="),
    "the environment example must document the integrations key name",
  );
  assert(
    example.includes("INTEGRATIONS_DAV_ENABLED=true"),
    "the environment example must document DAV module enablement",
  );

  const developmentTool = await Deno.readTextFile(
    new URL("./dev.ts", import.meta.url),
  );
  assert(
    developmentTool.includes('configured("AUTH_MINIMUM_RESPONSE_MS")') &&
      developmentTool.includes(
        "AUTH_MINIMUM_RESPONSE_MS: authenticationResponseFloor",
      ),
    "root development must pass an explicitly configured authentication response floor to the API",
  );
  assert(
    developmentTool.includes('configured("POSTGRES_USER")') &&
      developmentTool.includes('configured("POSTGRES_DB")'),
    "root development must consume its documented user and database",
  );
  assert(
    developmentTool.includes("PGUSER:") &&
      developmentTool.includes("PGDATABASE:") &&
      developmentTool.includes("PGPASSWORD:"),
    "root development must pass PostgreSQL credentials as separate fields",
  );
  assert(
    developmentTool.includes('DATABASE_URL: ""'),
    "root development must not inherit a conflicting ambient URL",
  );
  assert(
    developmentTool.includes('configured("AUTH_MFA_ENCRYPTION_KEYSET")') &&
      developmentTool.includes(
        "AUTH_MFA_ENCRYPTION_KEYSET: mfaEncryptionKeyset",
      ),
    "root development must pass an explicitly configured MFA key to the API",
  );
  assert(
    developmentTool.includes('configured("AUTH_THROTTLE_SUBJECT_KEYSET")') &&
      developmentTool.includes(
        "AUTH_THROTTLE_SUBJECT_KEYSET: throttleSubjectKeyset",
      ),
    "root development must pass an explicitly configured authentication-subject key to the API",
  );
  assert(
    !developmentTool.includes("`postgres://kinship:${postgresPassword}"),
    "root development must not build a raw password URL",
  );
});

Deno.test("[OPS-001E1] RustFS owns local and recovery S3 boundaries", async () => {
  const base = await Deno.readTextFile(
    new URL("../compose.yaml", import.meta.url),
  );
  const development = await Deno.readTextFile(
    new URL("../compose.dev.yaml", import.meta.url),
  );
  const test = await Deno.readTextFile(
    new URL("../compose.test.yaml", import.meta.url),
  );
  assert(
    !base.includes("  object-store:"),
    "production-like Compose has no local object-store service",
  );
  assert(
    !base.includes("condition: service_healthy\n      object-store:"),
    "base API has no local object-store dependency",
  );
  assert(
    base.includes("OBJECT_STORAGE_HOST: ${OBJECT_STORAGE_HOST"),
    "base API accepts an external object host",
  );
  assert(
    base.includes(
      "OBJECT_STORAGE_REQUEST_TIMEOUT_MS: ${OBJECT_STORAGE_REQUEST_TIMEOUT_MS:-30000}",
    ),
    "base API passes a finite object-store request timeout",
  );
  const rustfsImage =
    "rustfs/rustfs:1.0.0-beta.12@sha256:41fe89380f4120a337790c02af192c3fe7bb55c3edc2e6e9357b487b47c6ab21";
  for (
    const [name, localBoundary] of [
      ["development overlay", development],
      ["test overlay", test],
    ] as const
  ) {
    assert(
      localBoundary.includes(rustfsImage),
      `${name} must use the exact accepted RustFS image`,
    );
    assert(
      !localBoundary.includes("minio/minio:"),
      `${name} must not run a MinIO server`,
    );
  }
  for (
    const [name, overlay] of [
      ["development overlay", development],
      ["test overlay", test],
    ] as const
  ) {
    assert(overlay.includes("  object-store:"), `${name} owns RustFS`);
    assert(
      overlay.includes("RUSTFS_ACCESS_KEY:") &&
        overlay.includes("RUSTFS_SECRET_KEY:"),
      `${name} configures RustFS credentials`,
    );
    assert(
      overlay.includes("/health"),
      `${name} waits on the RustFS health endpoint`,
    );
    assert(
      !overlay.includes("MINIO_ROOT_") && !overlay.includes("MC_HOST_"),
      `${name} must not retain MinIO server configuration`,
    );
  }
  const developmentTool = await Deno.readTextFile(
    new URL("./dev.ts", import.meta.url),
  );
  assert(
    developmentTool.includes('"--wait"') &&
      developmentTool.includes('"postgres"') &&
      developmentTool.includes('"mailpit"') &&
      developmentTool.includes('"object-store"'),
    "root development must wait for its RustFS dependency",
  );
  for (
    const name of [
      "OBJECT_STORAGE_ACCESS_KEY",
      "OBJECT_STORAGE_BUCKET",
      "OBJECT_STORAGE_HOST",
      "OBJECT_STORAGE_PORT",
      "OBJECT_STORAGE_REQUEST_TIMEOUT_MS",
      "OBJECT_STORAGE_SECRET_KEY",
      "OBJECT_STORAGE_USE_SSL",
    ]
  ) {
    assert(
      developmentTool.includes(`${name}:`),
      `root development must pass ${name} to its host API`,
    );
  }
  const dockerfile = await Deno.readTextFile(
    new URL("../Dockerfile.api", import.meta.url),
  );
  assert(
    dockerfile.includes(
      "deno install --frozen --node-modules-dir=none --entrypoint apps/api/main.ts apps/worker/main.ts tools/migrations/main.ts",
    ),
    "the API image dependency stage must cache every production entrypoint",
  );
  assert(
    dockerfile.indexOf("USER deno") < dockerfile.indexOf("deno install"),
    "the API image dependency cache must be readable by its runtime user",
  );
  const tasks = await Deno.readTextFile(
    new URL("../deno.json", import.meta.url),
  );
  const configuredTasks = (JSON.parse(tasks) as {
    tasks?: Record<string, string>;
  }).tasks ?? {};
  for (
    const name of [
      "OBJECT_STORAGE_ACCESS_KEY",
      "OBJECT_STORAGE_BUCKET",
      "OBJECT_STORAGE_CONSOLE_PORT",
      "OBJECT_STORAGE_PORT",
      "OBJECT_STORAGE_REQUEST_TIMEOUT_MS",
      "OBJECT_STORAGE_SECRET_KEY",
    ]
  ) {
    assert(
      configuredTasks.dev?.includes(name),
      `root development must permit its configured ${name}`,
    );
  }
  for (const taskName of ["test:unit:api", "test:coverage:api:direct"]) {
    assert(
      configuredTasks[taskName]?.includes("Dockerfile.api"),
      `${taskName} must permit the configuration contract to read Dockerfile.api`,
    );
  }
  for (
    const name of [
      "OBJECT_STORAGE_ACCESS_KEY",
      "OBJECT_STORAGE_BUCKET",
      "OBJECT_STORAGE_HOST",
      "OBJECT_STORAGE_PORT",
      "OBJECT_STORAGE_REQUEST_TIMEOUT_MS",
      "OBJECT_STORAGE_SECRET_KEY",
      "OBJECT_STORAGE_USE_SSL",
    ]
  ) {
    assert(
      configuredTasks["test:coverage:api:direct"]?.includes(name),
      `coverage API composition must permit the object-storage environment name ${name}`,
    );
  }
  for (
    const name of [
      "READABLE_STREAM",
      "OBJECT_STORAGE_ACCESS_KEY",
      "OBJECT_STORAGE_BUCKET",
      "OBJECT_STORAGE_HOST",
      "OBJECT_STORAGE_PORT",
      "OBJECT_STORAGE_REQUEST_TIMEOUT_MS",
      "OBJECT_STORAGE_SECRET_KEY",
      "OBJECT_STORAGE_USE_SSL",
    ]
  ) {
    assert(
      configuredTasks["test:coverage:planning:direct"]?.includes(name),
      `planning coverage composition must permit the shared API environment name ${name}`,
    );
  }
  for (const manifest of [dockerfile, tasks]) {
    assert(
      manifest.includes("OBJECT_STORAGE_REQUEST_TIMEOUT_MS"),
      "API environment allowlists include the object-store request timeout",
    );
  }
  const auditAdapter = await Deno.readTextFile(
    new URL(
      "../packages/backend/modules/governance/adapters/postgres/file_audit.ts",
      import.meta.url,
    ),
  );
  assert(
    !auditAdapter.includes('from "../../../files'),
    "governance keeps its accepted dependency manifest",
  );
});

Deno.test("[REL-004] aggregate integration has object-store configuration authority", async () => {
  const manifest = JSON.parse(
    await Deno.readTextFile(new URL("../deno.json", import.meta.url)),
  ) as { tasks?: Record<string, string> };
  const integrationTask = manifest.tasks?.["test:integration:direct"] ?? "";

  assert(
    integrationTask.includes("--allow-read=") &&
      integrationTask.includes("personal-crm-schema/v7"),
    "aggregate integration must read the canonical v7 schema",
  );
  for (
    const name of [
      "OBJECT_STORAGE_ACCESS_KEY",
      "OBJECT_STORAGE_BUCKET",
      "OBJECT_STORAGE_HOST",
      "OBJECT_STORAGE_PORT",
      "OBJECT_STORAGE_REQUEST_TIMEOUT_MS",
      "OBJECT_STORAGE_SECRET_KEY",
      "OBJECT_STORAGE_USE_SSL",
    ]
  ) {
    assert(
      integrationTask.includes(name),
      `aggregate integration must permit the object-storage environment name ${name}`,
    );
  }
});

Deno.test("[REL-008] worker receives exact production runtime authority", async () => {
  const base = await Deno.readTextFile(
    new URL("../compose.yaml", import.meta.url),
  );
  const development = await Deno.readTextFile(
    new URL("../compose.dev.yaml", import.meta.url),
  );
  const test = await Deno.readTextFile(
    new URL("../compose.test.yaml", import.meta.url),
  );
  const worker = base.slice(
    base.indexOf("\n  worker:"),
    base.indexOf("\n  web:"),
  );
  for (
    const name of [
      "APP_ENV",
      "READABLE_STREAM",
      "OBJECT_STORAGE_ACCESS_KEY",
      "OBJECT_STORAGE_BUCKET",
      "OBJECT_STORAGE_HOST",
      "OBJECT_STORAGE_PORT",
      "OBJECT_STORAGE_REQUEST_TIMEOUT_MS",
      "OBJECT_STORAGE_SECRET_KEY",
      "OBJECT_STORAGE_USE_SSL",
    ]
  ) {
    assert(worker.includes(name), `worker command/env omits ${name}`);
  }
  assert(
    worker.includes(
      "--allow-net=postgres:5432,${OBJECT_STORAGE_HOST:-object-store}:${OBJECT_STORAGE_PORT:-9000}",
    ),
    "worker network authority must be limited to PostgreSQL and configured object storage",
  );
  for (const overlay of [development, test]) {
    const overlayWorker = overlay.slice(
      overlay.indexOf("\n  worker:"),
      overlay.indexOf("\n  web:"),
    );
    assert(
      overlayWorker.includes("object-store:") &&
        overlayWorker.includes("condition: service_healthy"),
      "local worker must wait for its private object store",
    );
  }
});
