const repositoryRoot = new URL("../", import.meta.url);
const localFile = await Deno.readTextFile(new URL("../.env", import.meta.url))
  .catch(() => "");
const localEnvironment = Object.fromEntries(
  localFile.split(/\r?\n/).map((line) => line.trim()).filter((line) =>
    line.length > 0 && !line.startsWith("#") && line.includes("=")
  ).map((line) => {
    const separator = line.indexOf("=");
    return [line.slice(0, separator), line.slice(separator + 1)];
  }),
);
const configured = (name: string): string | undefined =>
  Deno.env.get(name) ?? localEnvironment[name];
const postgresPassword = configured("POSTGRES_PASSWORD") ??
  "kinship-local-development-only";
const postgresDatabase = configured("POSTGRES_DB") ?? "kinship";
const postgresUser = configured("POSTGRES_USER") ?? "kinship";
const postgresPort = configured("POSTGRES_PORT") ?? "5432";
const apiPort = configured("API_PORT") ?? "8000";
const webPort = configured("WEB_PORT") ?? "4321";
const smtpPort = configured("SMTP_PORT") ?? "1025";
const composeEnvironment = {
  POSTGRES_DB: postgresDatabase,
  POSTGRES_PASSWORD: postgresPassword,
  POSTGRES_PORT: postgresPort,
  POSTGRES_USER: postgresUser,
  API_PORT: apiPort,
  WEB_PORT: webPort,
  SMTP_PORT: smtpPort,
};
const compose = [
  "compose",
  "--file",
  "compose.yaml",
  "--file",
  "compose.dev.yaml",
] as const;

async function run(
  executable: string,
  args: readonly string[],
  env: Readonly<Record<string, string>> = {},
): Promise<void> {
  const status = await new Deno.Command(executable, {
    args: [...args],
    cwd: repositoryRoot,
    env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn().status;
  if (!status.success) {
    throw new Error(`${executable} ${args.join(" ")} exited ${status.code}`);
  }
}

async function waitForApi(origin: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/api/v1/health`);
      if (response.ok) return;
    } catch {
      // The process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Local API did not become ready within 60 seconds.");
}

let children: Deno.ChildProcess[] = [];
try {
  await run(
    "docker",
    [...compose, "up", "--detach", "--wait", "postgres", "mailpit"],
    composeEnvironment,
  );
  await run(
    "docker",
    [...compose, "run", "--rm", "migrate"],
    composeEnvironment,
  );

  const common = {
    APP_ENV: "development",
    PUBLIC_WEB_ORIGIN: `http://127.0.0.1:${webPort}`,
  };
  const api = new Deno.Command(Deno.execPath(), {
    args: ["task", "dev:api"],
    cwd: repositoryRoot,
    env: {
      ...common,
      DATABASE_URL: "",
      HOST: "127.0.0.1",
      PGDATABASE: postgresDatabase,
      PGHOST: "127.0.0.1",
      PGPASSWORD: postgresPassword,
      PGPORT: postgresPort,
      PGUSER: postgresUser,
      PORT: apiPort,
      SMTP_FROM: "hello@kinship.local",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: smtpPort,
    },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
  children = [api];
  await waitForApi(`http://127.0.0.1:${apiPort}`);

  const web = new Deno.Command(Deno.execPath(), {
    args: ["task", "dev:web"],
    cwd: repositoryRoot,
    env: {
      API_ORIGIN: `http://127.0.0.1:${apiPort}`,
      WEB_PORT: webPort,
    },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
  children.push(web);
  const statuses = children.map((child) => child.status);
  const first = await Promise.race(statuses);
  if (!first.success) {
    throw new Error(`development process exited ${first.code}`);
  }
} finally {
  for (const child of children) {
    try {
      child.kill("SIGTERM");
    } catch {
      // The process already exited.
    }
  }
  await Promise.allSettled(children.map((child) => child.status));
  await run(
    "docker",
    [...compose, "down", "--remove-orphans", "--timeout", "10"],
    composeEnvironment,
  ).catch(() => undefined);
}
