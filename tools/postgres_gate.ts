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

async function main(): Promise<void> {
  const task = Deno.args[0];
  if (
    task !== "test:integration:direct" && task !== "test:coverage:api:direct" &&
    task !== "test:coverage:planning:direct" &&
    task !== "test:integration:exports:direct"
  ) {
    throw new Error("Expected an allowlisted direct PostgreSQL gate task.");
  }
  const project = `kinship-pg-${Deno.pid}-${Date.now()}`;
  const password = `test-${crypto.randomUUID()}`;
  const environment: Record<string, string> = {
    API_TEST_PORT: "0",
    COMPOSE_PROJECT_NAME: project,
    MAILPIT_TEST_PORT: "0",
    POSTGRES_PASSWORD: password,
    POSTGRES_TEST_PORT: "0",
    PUBLIC_WEB_ORIGIN: "http://127.0.0.1:4321",
  };
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
      const taskEnvironment = {
        ...environment,
        DATABASE_URL: `postgres://kinship:${
          encodeURIComponent(password)
        }@127.0.0.1:${port}/kinship`,
      };
      await execute("deno", ["task", "migration:apply"], taskEnvironment);
      await execute("deno", ["task", task], taskEnvironment);
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

if (import.meta.main) await main();
