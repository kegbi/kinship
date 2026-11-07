import { parse as parseYaml } from "@std/yaml";
import {
  COVERAGE_AGGREGATE,
  INTEGRATION_PERMISSIONS,
  moduleById,
  TEST_AGGREGATE,
} from "./tasks/manifest.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("APR-009 existing API checks include the timezone and calendar boundary regression once", () => {
  const regression = "tests/integration/time_preferences_postgres_test.ts";
  const api = moduleById("api");
  assert(api, "the task manifest declares the api module");
  assert(
    (api.integration ?? []).filter((entry) => entry === regression).length ===
      1,
    "the api module must own the APR-009 PostgreSQL regression exactly once",
  );
  assert(
    (api.coverage?.tests ?? []).filter((entry) => entry === regression)
      .length === 1,
    "API coverage must measure the APR-009 PostgreSQL regression exactly once",
  );
});

for (const scope of ["api-access", "integrations"]) {
  Deno.test(`[APR-011] root test and coverage run ${scope} gates once`, () => {
    const module = moduleById(scope);
    assert(module?.unit, `the task manifest declares a ${scope} unit set`);
    assert(
      TEST_AGGREGATE.filter((id) => id === scope).length === 1,
      `root test must run the ${scope} unit set exactly once`,
    );
    assert(
      module.coverage?.postgres === true,
      `${scope} coverage must run against a disposable PostgreSQL project`,
    );
    assert(
      COVERAGE_AGGREGATE.filter((id) => id === scope).length === 1,
      `root coverage must run the ${scope} coverage gate exactly once`,
    );
  });
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
      "AUTH_SIGN_IN_DEVICE_KEYSET: ${AUTH_SIGN_IN_DEVICE_KEYSET:-}",
    ),
    "Compose must pass the private sign-in device key only to the API",
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
    example.includes("AUTH_SIGN_IN_DEVICE_KEYSET="),
    "the environment example must document the sign-in device key name",
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
    developmentTool.includes('configured("AUTH_SIGN_IN_DEVICE_KEYSET")') &&
      developmentTool.includes(
        "AUTH_SIGN_IN_DEVICE_KEYSET: signInDeviceKeyset",
      ),
    "root development must pass an explicitly configured sign-in device key to the API",
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
  const support = await Deno.readTextFile(
    new URL("../compose.support.yaml", import.meta.url),
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
    const [name, overlay] of [
      ["development overlay", development],
      ["test overlay", test],
    ] as const
  ) {
    for (const service of ["mailpit", "object-store"]) {
      assert(
        overlay.includes(
          `\n  ${service}:\n    extends:\n      file: compose.support.yaml\n      service: ${service}\n`,
        ),
        `${name} must extend the shared ${service} definition`,
      );
    }
    assert(
      !overlay.includes("rustfs/rustfs:") &&
        !overlay.includes("axllent/mailpit:") &&
        !overlay.includes("RUSTFS_ACCESS_KEY:"),
      `${name} must not redefine a support service compose.support.yaml owns`,
    );
    assert(
      overlay.includes("  object-store:"),
      `${name} places RustFS storage`,
    );
    assert(
      !overlay.includes("minio/minio:") && !overlay.includes("MINIO_ROOT_") &&
        !overlay.includes("MC_HOST_"),
      `${name} must not retain MinIO server configuration`,
    );
  }
  assert(
    support.includes(rustfsImage),
    "local support services must use the exact accepted RustFS image",
  );
  assert(
    support.includes("RUSTFS_ACCESS_KEY:") &&
      support.includes("RUSTFS_SECRET_KEY:"),
    "local support services configure RustFS credentials",
  );
  assert(
    support.includes("http://127.0.0.1:9000/health"),
    "local support services wait on the RustFS health endpoint",
  );
  assert(
    !support.includes("minio/minio:") && !support.includes("MINIO_ROOT_") &&
      !support.includes("MC_HOST_"),
    "local support services must not run a MinIO server",
  );
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
  const api = moduleById("api");
  assert(
    api?.unit && api.coverage,
    "the task manifest declares the api module",
  );
  for (
    const [label, permissions] of [
      ["the api unit set", api.unit.permissions],
      ["api coverage", api.coverage.permissions],
    ] as const
  ) {
    const reads = permissions?.read;
    assert(
      reads !== undefined && reads !== "all" &&
        reads.includes("Dockerfile.api"),
      `${label} must permit the configuration contract to read Dockerfile.api`,
    );
  }
  const planning = moduleById("planning");
  assert(planning?.coverage, "the task manifest declares planning coverage");
  for (
    const [label, permissions] of [
      ["coverage API composition", api.coverage.permissions],
      ["planning coverage composition", planning.coverage.permissions],
    ] as const
  ) {
    const granted = permissions?.env;
    assert(
      granted !== undefined && granted !== "all",
      `${label} must declare an exact environment allowlist`,
    );
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
        granted.includes(name),
        `${label} must permit the shared object-storage environment name ${name}`,
      );
    }
  }
  const manifestSource = await Deno.readTextFile(
    new URL("./tasks/manifest.ts", import.meta.url),
  );
  for (const declaration of [dockerfile, manifestSource]) {
    assert(
      declaration.includes("OBJECT_STORAGE_REQUEST_TIMEOUT_MS"),
      "API environment allowlists include the object-store request timeout",
    );
  }
  const auditAdapter = await Deno.readTextFile(
    new URL(
      "../packages/backend/modules/governance/adapters/postgres/audit_event_recorder.ts",
      import.meta.url,
    ),
  );
  assert(
    !/from "\.\.\/\.\.\/\.\.\/[a-z-]+\/public\.ts"/.test(auditAdapter),
    "governance keeps its accepted dependency manifest",
  );
});

Deno.test("[REL-011] root development rebuilds the current migration bundle", async () => {
  const developmentTool = await Deno.readTextFile(
    new URL("./dev.ts", import.meta.url),
  );
  assert(
    developmentTool.includes(
      '[...compose, "run", "--build", "--rm", "migrate"]',
    ),
    "root development must build the migration image from the current checkout before applying it",
  );
});

Deno.test("[REL-004] aggregate integration has object-store configuration authority", () => {
  const reads = INTEGRATION_PERMISSIONS.read;
  assert(
    reads !== undefined && reads !== "all" &&
      reads.includes("personal-crm-schema/v12"),
    "aggregate integration must read the canonical v12 schema",
  );
  const granted = INTEGRATION_PERMISSIONS.env;
  assert(
    granted !== undefined && granted !== "all",
    "aggregate integration must declare an exact environment allowlist",
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
      granted.includes(name),
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
      "PUBLIC_WEB_ORIGIN",
      "SMTP_FROM",
      "SMTP_HOST",
      "SMTP_PASSWORD",
      "SMTP_PORT",
      "SMTP_SECURITY",
      "SMTP_USERNAME",
    ]
  ) {
    assert(worker.includes(name), `worker command/env omits ${name}`);
  }
  assert(
    worker.includes(
      '"--allow-net=postgres:5432,${OBJECT_STORAGE_HOST:-object-store}:${OBJECT_STORAGE_PORT:-9000},${SMTP_HOST:-mailpit}:${SMTP_PORT:-1025}",',
    ),
    "worker network authority must be limited to PostgreSQL, configured object storage, and SMTP",
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

Deno.test("[AUD-K6] every launcher states APP_ENV, and only production is a default", async () => {
  const read = (path: string) =>
    Deno.readTextFile(new URL(`../${path}`, import.meta.url));
  for (
    const [overlay, environment] of [
      ["compose.dev.yaml", "development"],
      ["compose.test.yaml", "test"],
    ] as const
  ) {
    const text = await read(overlay);
    for (const service of ["api", "worker"]) {
      assert(
        text.includes(
          `\n  ${service}:\n    environment:\n      APP_ENV: ${environment}\n`,
        ),
        `${overlay} must state APP_ENV=${environment} for ${service}`,
      );
    }
  }
  const base = await read("compose.yaml");
  assert(
    base.split("APP_ENV: ${APP_ENV:-production}").length - 1 === 2,
    "compose.yaml defaults api and worker to production",
  );
  assert(
    (await read("tools/dev.ts")).includes('APP_ENV: "development"'),
    "deno task dev states development",
  );
  for (
    const path of ["compose.yaml", "compose.dev.yaml", "compose.test.yaml"]
  ) {
    assert(
      !/APP_ENV:-(?!production\})/.test(await read(path)),
      `${path} defaults APP_ENV to nothing but production`,
    );
  }
});

Deno.test("[AUD-G4] each service's defining Compose file hardens it and PostgreSQL preloads pg_stat_statements", async () => {
  type Service = {
    readonly cap_drop?: readonly string[];
    readonly command?: readonly string[];
    readonly mem_limit?: string;
    readonly pids_limit?: number;
    readonly security_opt?: readonly string[];
    readonly shm_size?: string;
  };
  for (const path of ["compose.yaml", "compose.support.yaml"]) {
    const { services } = parseYaml(
      await Deno.readTextFile(new URL(`../${path}`, import.meta.url)),
    ) as { services: Record<string, Service> };
    for (const [name, service] of Object.entries(services)) {
      assert(
        service.security_opt?.includes("no-new-privileges:true") &&
          JSON.stringify(service.cap_drop) === '["ALL"]',
        `${path} ${name} drops every capability and forbids privilege gain`,
      );
      assert(
        /^\d+[mg]$/.test(service.mem_limit ?? "") &&
          Number.isInteger(service.pids_limit),
        `${path} ${name} states its memory and pid limits`,
      );
    }
    if (path === "compose.yaml") {
      const command = services.postgres?.command ?? [];
      assert(
        command.includes("shared_preload_libraries=pg_stat_statements") &&
          command.includes("log_parameter_max_length=0"),
        "PostgreSQL preloads pg_stat_statements and logs no bind values",
      );
      assert(
        services.postgres?.shm_size === "256m",
        "PostgreSQL has 256 MiB of /dev/shm for parallel hash joins",
      );
    }
  }
});
