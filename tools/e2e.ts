export function e2eProjectName(pid: number, now: number): string {
  return `kinship-e2e-${pid}-${now}`;
}

export function e2eEnvironment(
  project: string,
  webOrigin: string,
): Readonly<Record<string, string>> {
  return {
    COMPOSE_PROJECT_NAME: project,
    POSTGRES_DB: "kinship_e2e",
    POSTGRES_PASSWORD: `e2e@:/%${project}`,
    POSTGRES_USER: "kinship_e2e",
    PUBLIC_WEB_ORIGIN: webOrigin,
    TEST_WEB_ORIGIN: webOrigin,
  };
}

export const E2E_COMPOSE_ARGS = [
  "compose",
  "--file",
  "compose.yaml",
  "--file",
  "compose.test.yaml",
] as const;

export const E2E_ASTRO_TASK_ARGS = [
  "task",
  "dev:web",
  "--ignore-lock",
] as const;

export async function runE2eGate(operations: {
  readonly assertAbsent: () => Promise<void>;
  readonly down: () => Promise<void>;
  readonly startup: () => Promise<void>;
  readonly stopTest: () => Promise<void>;
  readonly stopWeb: () => Promise<void>;
  readonly test: () => Promise<void>;
  readonly webStatus: () => Promise<Deno.CommandStatus>;
}): Promise<void> {
  const errors: unknown[] = [];
  let test: Promise<void> | undefined;
  try {
    await operations.startup();
    test = Promise.resolve().then(operations.test);
    const result = await Promise.race([
      test.then(
        () => ({ type: "test-passed" } as const),
        (error: unknown) => ({ error, type: "test-failed" } as const),
      ),
      operations.webStatus().then((
        status,
      ) => ({ status, type: "web-exited" } as const)),
    ]);
    if (result.type === "test-failed") throw result.error;
    if (result.type === "web-exited") {
      throw new Error(
        `E2E web process exited with code ${result.status.code}.`,
      );
    }
  } catch (error) {
    errors.push(error);
  } finally {
    for (
      const cleanup of [
        operations.stopTest,
        operations.stopWeb,
        operations.down,
        operations.assertAbsent,
      ]
    ) {
      try {
        await cleanup();
      } catch (error) {
        errors.push(error);
      }
    }
    if (test) {
      const settled = await Promise.race([
        test.then(
          () => true,
          () => true,
        ),
        new Promise<false>((resolve) =>
          setTimeout(() => resolve(false), 3_000)
        ),
      ]);
      if (!settled) {
        errors.push(
          new Error("E2E browser process did not settle after cancellation."),
        );
      }
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, "E2E gate and cleanup failed.");
  }
}

async function command(
  executable: string,
  args: readonly string[],
  environment: Readonly<Record<string, string>>,
  allowFailure = false,
): Promise<boolean> {
  const status = await new Deno.Command(executable, {
    args: [...args],
    cwd: new URL("../", import.meta.url),
    env: { ...environment },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn().status;
  if (!status.success && !allowFailure) {
    throw new Error(`${executable} ${args.join(" ")} exited ${status.code}`);
  }
  return status.success;
}

async function commandOutput(
  executable: string,
  args: readonly string[],
  environment: Readonly<Record<string, string>>,
): Promise<string> {
  const output = await new Deno.Command(executable, {
    args: [...args],
    cwd: new URL("../", import.meta.url),
    env: { ...environment },
    stdout: "piped",
    stderr: "inherit",
  }).output();
  if (!output.success) {
    throw new Error(`${executable} ${args.join(" ")} exited ${output.code}`);
  }
  return new TextDecoder().decode(output.stdout).trim();
}

async function composePort(
  service: string,
  containerPort: number,
  environment: Readonly<Record<string, string>>,
): Promise<string> {
  const mapping = await commandOutput(
    "docker",
    [...E2E_COMPOSE_ARGS, "port", service, String(containerPort)],
    environment,
  );
  const port = mapping.match(/:(\d+)$/)?.[1];
  if (!port) throw new Error(`Could not inspect ${service} host port.`);
  return `http://127.0.0.1:${port}`;
}

export interface OwnedProcess {
  readonly child: Deno.ChildProcess;
  readonly processTree: readonly number[];
}

interface OwnedWeb extends OwnedProcess {
  readonly origin: string;
}

async function listenerIsReachable(origin: string): Promise<boolean> {
  const url = new URL(origin);
  try {
    const connection = await Deno.connect({
      hostname: url.hostname,
      port: Number(url.port),
    });
    connection.close();
    return true;
  } catch {
    return false;
  }
}

async function processRows(): Promise<
  readonly { readonly pid: number; readonly parent: number }[]
> {
  let rows: readonly { readonly pid: number; readonly parent: number }[];
  if (Deno.build.os === "windows") {
    const output = await commandOutput("powershell", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress",
    ], {});
    const parsed: unknown = JSON.parse(output);
    const records = Array.isArray(parsed) ? parsed : [parsed];
    rows = records.flatMap((record): { pid: number; parent: number }[] => {
      if (typeof record !== "object" || record === null) return [];
      const processId = Reflect.get(record, "ProcessId");
      const parentProcessId = Reflect.get(record, "ParentProcessId");
      return typeof processId === "number" &&
          typeof parentProcessId === "number"
        ? [{ pid: processId, parent: parentProcessId }]
        : [];
    });
  } else {
    const output = await commandOutput("ps", ["-eo", "pid=,ppid="], {});
    rows = output.split(/\r?\n/).flatMap((line) => {
      const match = line.trim().match(/^(\d+)\s+(\d+)$/);
      return match ? [{ pid: Number(match[1]), parent: Number(match[2]) }] : [];
    });
  }
  return rows;
}

export async function exactProcessTree(
  rootPid: number,
): Promise<readonly number[]> {
  const rows = await processRows();
  const tree = [rootPid];
  for (let index = 0; index < tree.length; index += 1) {
    for (const row of rows) {
      if (row.parent === tree[index] && !tree.includes(row.pid)) {
        tree.push(row.pid);
      }
    }
  }
  return tree;
}

export async function waitForProcessAbsence(
  processTree: readonly number[],
): Promise<boolean> {
  const targets = new Set(processTree);
  const deadline = Date.now() + 3_000;
  do {
    const rows = await processRows();
    if (!rows.some((row) => targets.has(row.pid))) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (true);
}

export interface ProcessTerminationOutcome {
  readonly code: number;
  readonly stderr: string;
  readonly success: boolean;
}

export async function reconcileTerminationOutcome(
  outcome: ProcessTerminationOutcome,
  processTree: readonly number[],
  proveAbsence: (
    processTree: readonly number[],
  ) => Promise<boolean> = waitForProcessAbsence,
): Promise<void> {
  if (await proveAbsence(processTree)) return;
  if (!outcome.success) {
    throw new Error(
      `Could not terminate the exact Windows process tree${
        outcome.stderr ? `: ${outcome.stderr}` : ` (exit ${outcome.code}).`
      }`,
    );
  }
  throw new Error(
    `Exact process tree remained alive: ${processTree.join(", ")}.`,
  );
}

export async function terminateExactProcesses(
  processTree: readonly number[],
): Promise<void> {
  const descendants = [...new Set(processTree)].reverse();
  if (descendants.length === 0) return;
  if (Deno.build.os === "windows") {
    const output = await new Deno.Command("powershell", {
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `$ErrorActionPreference='Stop'; $targets=@(${
          descendants.join(
            ",",
          )
        }); foreach($targetId in $targets) { $process=Get-Process -Id $targetId -ErrorAction SilentlyContinue; if ($null -ne $process) { try { Stop-Process -Id $targetId -Force -ErrorAction Stop } catch { if ($null -ne (Get-Process -Id $targetId -ErrorAction SilentlyContinue)) { throw } } } }`,
      ],
      stdout: "null",
      stderr: "piped",
    }).output();
    await reconcileTerminationOutcome({
      code: output.code,
      stderr: new TextDecoder().decode(output.stderr).trim(),
      success: output.success,
    }, descendants);
    return;
  } else {
    const failures: unknown[] = [];
    for (const processId of descendants) {
      const output = await new Deno.Command("kill", {
        args: ["-KILL", String(processId)],
        stdout: "null",
        stderr: "piped",
      }).output();
      if (!output.success) {
        const stillExists = (await processRows()).some((row) =>
          row.pid === processId
        );
        if (stillExists) {
          failures.push(
            new Error(
              `kill -KILL ${processId} exited ${output.code}: ${
                new TextDecoder().decode(output.stderr).trim()
              }`,
            ),
          );
        }
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        "Could not terminate the exact process tree.",
      );
    }
  }
  if (!(await waitForProcessAbsence(descendants))) {
    throw new Error(
      `Exact process tree remained alive: ${descendants.join(", ")}.`,
    );
  }
}

async function waitForListenerAbsence(origin: string): Promise<boolean> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (!(await listenerIsReachable(origin))) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

export async function stopOwnedProcess(
  process: OwnedProcess,
): Promise<void> {
  const processTree = [
    ...new Set([
      ...process.processTree,
      ...await exactProcessTree(process.child.pid),
    ]),
  ];
  const alreadySettled = await Promise.race([
    process.child.status.then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 0)),
  ]);
  const targets = alreadySettled
    ? processTree.filter((processId) => processId !== process.child.pid)
    : processTree;
  if (targets.length > 0) {
    await terminateExactProcesses(targets);
  }
  const settled = await Promise.race([
    process.child.status.then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 3_000)),
  ]);
  if (!settled) {
    throw new Error(
      `Owned process ${process.child.pid} did not settle after termination.`,
    );
  }
  if (!(await waitForProcessAbsence(processTree))) {
    throw new Error(
      `Owned process tree remained alive: ${processTree.join(", ")}.`,
    );
  }
}

export async function stopWeb(web: OwnedWeb): Promise<void> {
  const errors: unknown[] = [];
  try {
    await stopOwnedProcess(web);
  } catch (error) {
    errors.push(error);
  }
  if (!(await waitForListenerAbsence(web.origin))) {
    errors.push(new Error(`E2E web listener remained bound at ${web.origin}.`));
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, "E2E web process cleanup failed.");
  }
}

export async function finishAstroReadinessAttempt(operations: {
  readonly exited: Promise<{
    readonly status: Deno.CommandStatus;
    readonly type: "exit";
  }>;
  readonly listenerIsReachable: () => Promise<boolean>;
  readonly stop: () => Promise<void>;
}): Promise<"retry"> {
  const exit = await Promise.race([
    operations.exited,
    new Promise<{ readonly type: "pending" }>((resolve) =>
      setTimeout(() => resolve({ type: "pending" }), 0)
    ),
  ]);
  if (exit.type === "exit") return "retry";
  const listener = await operations.listenerIsReachable();
  const failure = new Error(
    listener
      ? "deno task dev:web bound a listener but did not serve the expected page within 30 seconds."
      : "deno task dev:web did not become ready within 30 seconds.",
  );
  try {
    await operations.stop();
  } catch (cleanupError) {
    throw new AggregateError(
      [failure, cleanupError],
      "Astro readiness and cleanup failed.",
    );
  }
  throw failure;
}

export async function startAstro(apiOrigin: string): Promise<OwnedWeb> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const port = 20_000 +
      crypto.getRandomValues(new Uint16Array(1))[0]! % 40_000;
    const origin = `http://127.0.0.1:${port}`;
    const child = new Deno.Command("deno", {
      args: [...E2E_ASTRO_TASK_ARGS],
      cwd: new URL("../", import.meta.url),
      env: {
        API_ORIGIN: apiOrigin,
        E2E_STRICT_PORT: "1",
        WEB_PORT: String(port),
      },
      stdin: "piped",
      stdout: "inherit",
      stderr: "inherit",
    }).spawn();
    const exited = child.status.then((
      status,
    ) => ({ status, type: "exit" } as const));
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(origin, {
          signal: AbortSignal.timeout(1_000),
        });
        if (
          response.ok &&
          (await response.text()).includes(
            "<title>Kinship — Remember what matters</title>",
          )
        ) {
          const stillRunning = await Promise.race([
            exited.then(() => false),
            new Promise<true>((resolve) =>
              setTimeout(() => resolve(true), 100)
            ),
          ]);
          if (stillRunning) {
            return {
              child,
              origin,
              processTree: await exactProcessTree(child.pid),
            };
          }
        }
      } catch {
        // The selected port has not bound yet.
      }
      const result = await Promise.race([
        exited,
        new Promise<{ readonly type: "pending" }>((resolve) =>
          setTimeout(() => resolve({ type: "pending" }), 200)
        ),
      ]);
      if (result.type === "exit") {
        if (await listenerIsReachable(origin)) break;
        throw new Error(
          `deno task dev:web exited with code ${result.status.code} before readiness.`,
        );
      }
    }
    const web = {
      child,
      origin,
      processTree: await exactProcessTree(child.pid),
    };
    const outcome = await finishAstroReadinessAttempt({
      exited,
      listenerIsReachable: () => listenerIsReachable(origin),
      stop: () => stopWeb(web),
    });
    if (outcome === "retry") {
      // A different process won the strict port; choose another random port.
      continue;
    }
  }
  throw new Error("Astro could not bind a verified strict-port listener.");
}

async function assertProjectAbsent(
  project: string,
  environment: Readonly<Record<string, string>>,
): Promise<void> {
  for (
    const [kind, args] of [
      ["containers", [
        "ps",
        "-aq",
        "--filter",
        `label=com.docker.compose.project=${project}`,
      ]],
      ["volumes", [
        "volume",
        "ls",
        "-q",
        "--filter",
        `label=com.docker.compose.project=${project}`,
      ]],
      ["networks", [
        "network",
        "ls",
        "-q",
        "--filter",
        `label=com.docker.compose.project=${project}`,
      ]],
    ] as const
  ) {
    if (await commandOutput("docker", args, environment)) {
      throw new Error(`E2E project leaked ${kind}.`);
    }
  }
}

async function waitForApi(origin: string): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/api/v1/health`);
      if (response.ok) return;
    } catch {
      // Compose is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("E2E API did not become ready within 120 seconds.");
}

async function main(): Promise<void> {
  const project = e2eProjectName(Deno.pid, Date.now());
  let apiTarget: string | undefined;
  const forward = async (
    request: Request,
    destination: string | undefined,
  ): Promise<Response> => {
    if (!destination) return new Response("Service starting", { status: 503 });
    const source = new URL(request.url);
    const target = new URL(source.pathname + source.search, destination);
    const init: RequestInit = {
      method: request.method,
      headers: request.headers,
      redirect: "manual",
    };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = request.body;
    }
    return await fetch(target, init);
  };
  const proxy = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen: () => undefined },
    (request) => forward(request, apiTarget),
  );
  const proxyPort = (proxy.addr as Deno.NetAddr).port;
  let web: OwnedWeb | undefined;
  let browser: OwnedProcess | undefined;
  let environment = e2eEnvironment(project, "http://127.0.0.1:1");
  await runE2eGate({
    startup: async () => {
      const astro = await startAstro(`http://127.0.0.1:${proxyPort}`);
      web = astro;
      environment = e2eEnvironment(project, astro.origin);
      await command("docker", [
        ...E2E_COMPOSE_ARGS,
        "up",
        "--detach",
        "--wait",
        "--wait-timeout",
        "120",
      ], environment);
      const [apiOrigin, mailOrigin] = await Promise.all([
        composePort("api", 8000, environment),
        composePort("mailpit", 8025, environment),
        composePort("postgres", 5432, environment),
      ]);
      apiTarget = apiOrigin;
      environment = {
        ...environment,
        API_ORIGIN: `http://127.0.0.1:${proxyPort}`,
        E2E_EXTERNAL_WEB: "1",
        TEST_API_ORIGIN: apiOrigin,
        TEST_MAIL_ORIGIN: mailOrigin,
      };
      await waitForApi(apiOrigin);
    },
    test: async () => {
      const args = ["exec", "playwright", "test", ...Deno.args];
      const child = new Deno.Command("pnpm", {
        args,
        cwd: new URL("../", import.meta.url),
        env: { ...environment },
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      }).spawn();
      browser = { child, processTree: [child.pid] };
      const status = await child.status;
      if (!status.success) {
        throw new Error(`pnpm ${args.join(" ")} exited ${status.code}`);
      }
    },
    webStatus: () => {
      if (!web) {
        return Promise.reject(new Error("E2E web process was not started."));
      }
      return web.child.status;
    },
    stopTest: async () => {
      if (browser) await stopOwnedProcess(browser);
    },
    stopWeb: async () => {
      try {
        if (web) await stopWeb(web);
      } finally {
        await proxy.shutdown();
      }
    },
    down: () =>
      command(
        "docker",
        [
          ...E2E_COMPOSE_ARGS,
          "down",
          "--volumes",
          "--remove-orphans",
          "--timeout",
          "10",
        ],
        environment,
      ).then(() => undefined),
    assertAbsent: () => assertProjectAbsent(project, environment),
  });
}

if (import.meta.main) await main();
