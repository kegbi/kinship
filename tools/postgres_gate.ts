export interface PostgresGateOperations {
  readonly absent: () => Promise<void>;
  readonly down: () => Promise<void>;
  readonly run: () => Promise<void>;
  readonly up: () => Promise<void>;
}

export async function runPostgresGate(
  operations: {
    readonly assertAbsent: () => Promise<void>;
    readonly down: () => Promise<void>;
    readonly run: () => Promise<void>;
    readonly up: () => Promise<void>;
  },
): Promise<void> {
  const errors: unknown[] = [];
  let started = false;
  try {
    await operations.up();
    started = true;
    await operations.run();
  } catch (error) {
    errors.push(error);
  } finally {
    try {
      await operations.down();
    } catch (error) {
      errors.push(error);
    }
    try {
      await operations.assertAbsent();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(
      errors,
      started
        ? "PostgreSQL gate and cleanup failed."
        : "PostgreSQL startup and cleanup failed.",
    );
  }
}

const composeArgs = [
  "compose",
  "--file",
  "compose.yaml",
  "--file",
  "compose.test.yaml",
  "--file",
  "compose.postgres-test.yaml",
] as const;

async function execute(
  executable: string,
  args: readonly string[],
  environment: Readonly<Record<string, string>>,
  capture = false,
): Promise<string> {
  const output = await new Deno.Command(executable, {
    args: [...args],
    cwd: new URL("../", import.meta.url),
    env: { ...environment },
    stdin: "null",
    stdout: capture ? "piped" : "inherit",
    stderr: "inherit",
  }).output();
  if (!output.success) {
    throw new Error(`${executable} ${args.join(" ")} exited ${output.code}`);
  }
  return capture ? new TextDecoder().decode(output.stdout).trim() : "";
}

async function assertProjectAbsent(
  project: string,
  environment: Readonly<Record<string, string>>,
): Promise<void> {
  for (
    const [kind, args] of [
      ["containers", [
        "ps",
        "--all",
        "--quiet",
        "--filter",
        `label=com.docker.compose.project=${project}`,
      ]],
      ["volumes", [
        "volume",
        "ls",
        "--quiet",
        "--filter",
        `label=com.docker.compose.project=${project}`,
      ]],
      ["networks", [
        "network",
        "ls",
        "--quiet",
        "--filter",
        `label=com.docker.compose.project=${project}`,
      ]],
    ] as const
  ) {
    const remaining = await execute("docker", args, environment, true);
    if (remaining) {
      throw new Error(`Disposable PostgreSQL project leaked ${kind}.`);
    }
  }
}

/**
 * The environment one disposable project and its suites run under. The suites
 * compose the API and worker, so they state `APP_ENV=test`: an unset `APP_ENV`
 * is production (AUD-K6). It carries the role passwords too, which Compose
 * requires before it renders any service (ADR 0008).
 */
export function disposablePostgresEnvironment(
  project: string,
  password: string,
): Record<string, string> {
  return {
    ...disposableRolePasswords(password),
    API_TEST_PORT: "0",
    APP_ENV: "test",
    COMPOSE_PROJECT_NAME: project,
    MAILPIT_TEST_PORT: "0",
    POSTGRES_PASSWORD: password,
    POSTGRES_TEST_PORT: "0",
    PUBLIC_WEB_ORIGIN: "http://127.0.0.1:4321",
  };
}

/**
 * The login-role passwords of one disposable project, derived from its
 * run-scoped superuser password so each run's are distinct and unguessable.
 */
export function disposableRolePasswords(password: string): {
  readonly POSTGRES_APP_PASSWORD: string;
  readonly POSTGRES_MIGRATOR_PASSWORD: string;
  readonly POSTGRES_WORKER_PASSWORD: string;
} {
  return {
    POSTGRES_APP_PASSWORD: `${password}-app`,
    POSTGRES_MIGRATOR_PASSWORD: `${password}-migrator`,
    POSTGRES_WORKER_PASSWORD: `${password}-worker`,
  };
}

/**
 * Runs `suite` against a disposable, migrated PostgreSQL project and proves the
 * project leaves no container, volume, or network behind. The suite receives the
 * child environment — including the run-scoped `DATABASE_URL` — to forward to
 * whatever process it spawns.
 */
export async function withDisposablePostgres(
  suite: (environment: Readonly<Record<string, string>>) => Promise<void>,
): Promise<void> {
  // Lanes start their projects together, so the clock alone is not unique.
  const project = `kinship-pg-${Deno.pid}-${Date.now()}-${
    crypto.randomUUID().slice(0, 8)
  }`;
  const password = `test-${crypto.randomUUID()}`;
  const environment = disposablePostgresEnvironment(project, password);
  await runPostgresGate({
    up: () =>
      execute("docker", [
        ...composeArgs,
        "up",
        "--detach",
        "--wait",
        "--wait-timeout",
        "120",
        "postgres",
      ], environment).then(() => undefined),
    run: async () => {
      const mapping = await execute(
        "docker",
        [...composeArgs, "port", "postgres", "5432"],
        environment,
        true,
      );
      const port = mapping.match(/:(\d+)$/)?.[1];
      if (!port) {
        throw new Error("Could not resolve disposable PostgreSQL port.");
      }
      const url = (user: string, secret: string) =>
        `postgres://${user}:${
          encodeURIComponent(secret)
        }@127.0.0.1:${port}/kinship`;
      const roles = disposableRolePasswords(password);
      // The bootstrap step alone connects as the superuser; the migrate job
      // runs as the schema owner, as in production (ADR 0008).
      await execute("deno", ["task", "ops", "bootstrap"], {
        ...environment,
        ...roles,
        DATABASE_URL: url("kinship", password),
      });
      await execute("deno", ["task", "migration:apply"], {
        ...environment,
        DATABASE_URL: url(
          "kinship_migrator",
          roles.POSTGRES_MIGRATOR_PASSWORD,
        ),
      });
      // Suites compose the API as `kinship_app`, so every integration test
      // runs under forced row-level security; fixtures seed and inspect as
      // the superuser, and the worker's own suites connect as its role.
      const suiteEnvironment = {
        ...environment,
        DATABASE_ADMIN_URL: url("kinship", password),
        DATABASE_URL: url("kinship_app", roles.POSTGRES_APP_PASSWORD),
        DATABASE_WORKER_URL: url(
          "kinship_worker",
          roles.POSTGRES_WORKER_PASSWORD,
        ),
      };
      await suite(suiteEnvironment);
    },
    down: () =>
      execute("docker", [
        ...composeArgs,
        "down",
        "--volumes",
        "--remove-orphans",
        "--timeout",
        "10",
      ], environment).then(() => undefined),
    assertAbsent: () => assertProjectAbsent(project, environment),
  });
}
