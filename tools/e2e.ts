import {
  createE2eTls,
  E2E_TLS_ROOT,
  type E2eTlsMaterial,
  removeE2eTls,
} from "./e2e_tls.ts";

export { createE2eTls, E2E_TLS_ROOT, removeE2eTls };
export type { E2eTlsMaterial };

export function e2eProjectName(pid: number, now: number): string {
  return `kinship-e2e-${pid}-${now}`;
}

const E2E_IMAGE_SERVICES = [
  "web",
  "gateway",
  "migrate",
  "worker",
  "api",
] as const;

export function e2eImageNames(project: string): readonly string[] {
  if (!/^kinship-e2e-\d+-\d+$/.test(project)) {
    throw new Error("Refusing to target images for an invalid E2E project.");
  }
  return E2E_IMAGE_SERVICES.map((service) => `${project}-${service}:latest`);
}

/**
 * The gateway's host port, chosen before any container exists so the one
 * Compose environment already carries the final browser origin. Docker binds
 * it as soon as this probe listener is released.
 */
export function chooseE2eGatewayPort(): number {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  try {
    return (listener.addr as Deno.NetAddr).port;
  } finally {
    listener.close();
  }
}

export function e2eGatewayOrigin(gatewayPort: number): string {
  return `https://127.0.0.1:${gatewayPort}`;
}

export function e2eEnvironment(
  project: string,
  gatewayPort: number,
): Readonly<Record<string, string>> {
  const webOrigin = e2eGatewayOrigin(gatewayPort);
  return {
    COMPOSE_PROJECT_NAME: project,
    E2E_GATEWAY_PORT: String(gatewayPort),
    POSTGRES_DB: "kinship_e2e",
    POSTGRES_PASSWORD: `e2e@:/%${project}`,
    POSTGRES_USER: "kinship_e2e",
    PUBLIC_WEB_ORIGIN: webOrigin,
    TEST_WEB_ORIGIN: webOrigin,
  };
}

const E2E_BROWSERS = ["chromium", "firefox", "webkit"] as const;

/** Every value given to `--workers`/`-j`, in any accepted spelling. */
function workerValues(testArgs: readonly string[]): string[] {
  const values: string[] = [];
  testArgs.forEach((argument, index) => {
    if (argument === "--workers" || argument === "-j") {
      values.push(testArgs[index + 1] ?? "");
    } else if (argument.startsWith("--workers=")) {
      values.push(argument.slice("--workers=".length));
    } else if (argument.startsWith("-j=")) {
      values.push(argument.slice("-j=".length));
    } else if (/^-j\d/.test(argument)) {
      values.push(argument.slice("-j".length));
    }
  });
  return values;
}

/**
 * The browsers whose projects `--project` selects. Playwright's option is
 * variadic, matches case-insensitively, and accepts `*` wildcards; selecting
 * nothing runs every browser. A browser's `-exclusive` teardown project runs
 * whenever its browser project or the exclusive project itself is selected.
 */
function selectedBrowsers(testArgs: readonly string[]): Set<string> {
  const filters: string[] = [];
  let variadic = false;
  for (const argument of testArgs) {
    if (argument === "--project") {
      variadic = true;
    } else if (argument.startsWith("--project=")) {
      filters.push(argument.slice("--project=".length));
      variadic = false;
    } else if (argument.startsWith("-")) {
      variadic = false;
    } else if (variadic) {
      filters.push(argument);
    }
  }
  if (filters.length === 0) return new Set(E2E_BROWSERS);
  const patterns = filters.map((filter) =>
    new RegExp(
      `^${
        filter.split("*").map((part) =>
          part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        ).join(".*")
      }$`,
      "i",
    )
  );
  return new Set(
    E2E_BROWSERS.filter((browser) =>
      patterns.some((pattern) =>
        pattern.test(browser) || pattern.test(`${browser}-exclusive`)
      )
    ),
  );
}

export function e2ePlaywrightArgs(
  testArgs: readonly string[],
): string[] {
  const args = ["exec", "playwright", "test", ...testArgs];
  const workers = workerValues(testArgs);
  if (workers.length === 0) {
    args.push("--workers=1");
    return args;
  }
  // Each browser's `-exclusive` project publishes the active terms, which the
  // one-active-per-type index allows only once, so two of them must never
  // share a phase (REL-085). A percentage depends on the host, so it counts
  // as parallel.
  const parallel = workers.some((value) =>
    value.endsWith("%") || Number(value) > 1
  );
  const browsers = selectedBrowsers(testArgs);
  if (parallel && browsers.size > 1) {
    throw new Error(
      `--workers above 1 cannot run the legal-acceptance exclusive projects of ${
        [...browsers].join(", ")
      } together: they would publish competing active terms. Select one ` +
        "browser with --project or omit --workers.",
    );
  }
  return args;
}

/** Runs one `docker` command in a run's environment and returns its output. */
export type E2eDocker = (args: readonly string[]) => Promise<string>;

/** Removes exactly the images a run-scoped project built and proves them gone. */
export async function removeE2eImages(
  project: string,
  docker: E2eDocker,
): Promise<void> {
  const expected = e2eImageNames(project);
  const list = async () =>
    new Set(
      (await docker(["image", "ls", "--format", "{{.Repository}}:{{.Tag}}"]))
        .split(/\r?\n/).filter(Boolean),
    );
  const before = await list();
  const present = expected.filter((image) => before.has(image));
  if (present.length > 0) {
    await docker(["image", "rm", ...present]);
  }
  const after = await list();
  const remaining = expected.filter((image) => after.has(image));
  if (remaining.length > 0) {
    throw new Error(
      `E2E images remained after cleanup: ${remaining.join(", ")}`,
    );
  }
}

/** Proves a run-scoped project left no container, volume, or network. */
export async function assertE2eProjectAbsent(
  project: string,
  docker: E2eDocker,
): Promise<void> {
  for (
    const [kind, args] of [
      ["containers", ["ps", "-aq"]],
      ["volumes", ["volume", "ls", "-q"]],
      ["networks", ["network", "ls", "-q"]],
    ] as const
  ) {
    const filter = `label=com.docker.compose.project=${project}`;
    if (await docker([...args, "--filter", filter])) {
      throw new Error(`E2E project leaked ${kind}.`);
    }
  }
}

/**
 * Tears down a Docker fixture that ran `compose up --build` under its own
 * run-scoped project: every step runs even after an earlier one fails, and the
 * images the run built go with the project (REL-043).
 */
export async function tearDownE2eComposeProject(
  project: string,
  docker: E2eDocker,
): Promise<void> {
  const errors: unknown[] = [];
  for (
    const step of [
      () =>
        docker([
          ...E2E_COMPOSE_ARGS,
          "down",
          "--volumes",
          "--remove-orphans",
          "--timeout",
          "10",
        ]),
      () => assertE2eProjectAbsent(project, docker),
      () => removeE2eImages(project, docker),
    ]
  ) {
    try {
      await step();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, "E2E Compose project teardown failed.");
  }
}

async function removePlaywrightLastRun(): Promise<void> {
  const marker = new URL(
    "../.artifacts/playwright/.last-run.json",
    import.meta.url,
  );
  try {
    await Deno.remove(marker);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
}

async function cleanupE2eArtifacts(
  project: string,
  environment: Readonly<Record<string, string>>,
  tls: E2eTlsMaterial | undefined,
): Promise<void> {
  const results = await Promise.allSettled([
    tls ? removeE2eTls(tls) : Promise.resolve(),
    removeE2eImages(
      project,
      (args) => commandOutput("docker", args, environment),
    ),
    removePlaywrightLastRun(),
  ]);
  const errors = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : []
  );
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, "E2E artifact cleanup failed.");
  }
}

/**
 * Every executable this launcher may spawn on either platform: Docker and
 * pnpm for the stack and browsers, `deno` for the Astro child, and
 * `powershell` on Windows or `ps` and `kill` elsewhere to inspect and
 * terminate exact process trees. TLS material is made in-process
 * (`e2e_tls.ts`), so no shell is needed for it. The `test:e2e` task and every
 * test set that runs `tools/e2e_test.ts` grant exactly this list (REL-040).
 */
export const E2E_PROCESS_BINARIES: readonly string[] = [
  "docker",
  "pnpm",
  "deno",
  "powershell",
  "ps",
  "kill",
];

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
  readonly cleanupFiles?: () => Promise<void>;
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
        operations.cleanupFiles ?? (() => Promise.resolve()),
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
  protocol = "http",
): Promise<string> {
  const mapping = await commandOutput(
    "docker",
    [...E2E_COMPOSE_ARGS, "port", service, String(containerPort)],
    environment,
  );
  const port = mapping.match(/:(\d+)$/)?.[1];
  if (!port) throw new Error(`Could not inspect ${service} host port.`);
  return `${protocol}://127.0.0.1:${port}`;
}

export interface E2eStackOperations {
  /** Runs `docker compose` with the launcher's files and one environment. */
  readonly compose: (
    args: readonly string[],
    allowFailure?: boolean,
  ) => Promise<unknown>;
  /** Resolves a service's published host origin. */
  readonly port: (
    service: string,
    containerPort: number,
    protocol: string,
  ) => Promise<string>;
}

/**
 * Builds and starts the whole stack with one Compose command, so no container
 * is ever created under an environment that later changes. REL-040: starting
 * the gateway first to learn a Docker-assigned port made Compose recreate it
 * on Linux, where the recreated container received a different port.
 */
export async function startE2eStack(
  gatewayPort: number,
  operations: E2eStackOperations,
): Promise<{ readonly gatewayOrigin: string; readonly mailOrigin: string }> {
  try {
    await operations.compose([
      "up",
      "--build",
      "--detach",
      "--wait",
      "--wait-timeout",
      "120",
    ]);
  } catch (error) {
    await operations.compose(["ps", "--all"], true);
    await operations.compose(
      ["logs", "--no-color", "--tail", "100", "gateway", "web", "api"],
      true,
    );
    throw error;
  }
  const [gatewayOrigin, mailOrigin] = await Promise.all([
    operations.port("gateway", 8443, "https"),
    operations.port("mailpit", 8025, "http"),
  ]);
  const expected = e2eGatewayOrigin(gatewayPort);
  if (gatewayOrigin !== expected) {
    throw new Error(
      `Compose published the gateway at ${gatewayOrigin} instead of the chosen port ${gatewayPort} (${expected}).`,
    );
  }
  return { gatewayOrigin, mailOrigin };
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
      ? `deno task dev:web bound a listener but did not serve the expected page within ${
        ASTRO_PAGE_READINESS_MS / 1_000
      } seconds.`
      : `deno task dev:web did not bind its listener within ${
        ASTRO_STARTUP_MS / 1_000
      } seconds.`,
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

/**
 * The page-readiness budget measures only how long an already listening Astro
 * child may take to serve the real page. Process start-up owns a separate
 * budget so a slow cold start inside the coverage aggregate cannot consume the
 * page deadline of a healthy child.
 */
export const ASTRO_PAGE_READINESS_MS = 30_000;
export const ASTRO_STARTUP_MS = 120_000;

const ASTRO_READY_TITLE = "<title>Kinship — Remember what matters</title>";

export interface AstroReadinessOperations {
  readonly exited: Promise<{
    readonly status: Deno.CommandStatus;
    readonly type: "exit";
  }>;
  readonly listenerIsReachable: () => Promise<boolean>;
  readonly now: () => number;
  readonly pageIsReady: (budgetMs: number) => Promise<boolean>;
  readonly sleep: (milliseconds: number) => Promise<void>;
}

export type AstroReadinessResult =
  | { readonly type: "ready" }
  | {
    readonly listenerBound: boolean;
    readonly status: Deno.CommandStatus;
    readonly type: "exit";
  }
  | { readonly type: "timeout" };

export async function awaitAstroReadiness(
  operations: AstroReadinessOperations,
): Promise<AstroReadinessResult> {
  const startupDeadline = operations.now() + ASTRO_STARTUP_MS;
  let pageDeadline: number | undefined;
  while (true) {
    if (pageDeadline === undefined) {
      // A bound strict port is the child's own ready signal: only then can it
      // serve, so only then does the page-readiness budget start.
      if (await operations.listenerIsReachable()) {
        pageDeadline = operations.now() + ASTRO_PAGE_READINESS_MS;
      } else if (operations.now() >= startupDeadline) {
        return { type: "timeout" };
      }
    }
    if (pageDeadline !== undefined) {
      const remaining = pageDeadline - operations.now();
      if (remaining <= 0) return { type: "timeout" };
      // One probe request may use the whole remaining budget: aborting the
      // request that proves readiness is what made the probe non-deterministic
      // while the machine was loaded.
      if (await operations.pageIsReady(remaining)) {
        const stillRunning = await Promise.race([
          operations.exited.then(() => false),
          operations.sleep(100).then(() => true),
        ]);
        if (stillRunning) return { type: "ready" };
      }
    }
    const result = await Promise.race([
      operations.exited,
      operations.sleep(200).then(() => ({ type: "pending" } as const)),
    ]);
    if (result.type === "exit") {
      return {
        listenerBound: await operations.listenerIsReachable(),
        status: result.status,
        type: "exit",
      };
    }
  }
}

async function astroPageIsReady(
  origin: string,
  budgetMs: number,
): Promise<boolean> {
  try {
    const response = await fetch(origin, {
      signal: AbortSignal.timeout(Math.max(budgetMs, 1_000)),
    });
    const body = await response.text();
    return response.ok && body.includes(ASTRO_READY_TITLE);
  } catch {
    // The selected port has not bound yet.
    return false;
  }
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
    const result = await awaitAstroReadiness({
      exited,
      listenerIsReachable: () => listenerIsReachable(origin),
      now: () => Date.now(),
      pageIsReady: (budgetMs) => astroPageIsReady(origin, budgetMs),
      sleep: (milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)),
    });
    if (result.type === "ready") {
      return {
        child,
        origin,
        processTree: await exactProcessTree(child.pid),
      };
    }
    if (result.type === "exit") {
      // A different process won the strict port; choose another random port.
      if (result.listenerBound) continue;
      throw new Error(
        `deno task dev:web exited with code ${result.status.code} before readiness.`,
      );
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
    if (outcome === "retry") continue;
  }
  throw new Error("Astro could not bind a verified strict-port listener.");
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

async function waitForGatewayHealth(origin: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${origin}/gateway-health`)).ok) return;
    } catch {
      // A required private upstream is still recovering.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    "E2E gateway dependencies did not recover within 30 seconds.",
  );
}

async function assertGatewayDependencyReadiness(
  origin: string,
  environment: Readonly<Record<string, string>>,
): Promise<void> {
  for (const service of ["api", "web"] as const) {
    await command(
      "docker",
      [...E2E_COMPOSE_ARGS, "stop", "--timeout", "5", service],
      environment,
    );
    try {
      const deadline = Date.now() + 15_000;
      let unavailable = false;
      while (Date.now() < deadline) {
        try {
          unavailable =
            (await fetch(`${origin}/gateway-health`)).status === 503;
        } catch {
          unavailable = false;
        }
        if (unavailable) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (!unavailable) {
        throw new Error(
          `Gateway readiness remained available after ${service} stopped.`,
        );
      }
    } finally {
      await command(
        "docker",
        [...E2E_COMPOSE_ARGS, "start", service],
        environment,
      );
      await waitForGatewayHealth(origin);
    }
  }
}

async function main(): Promise<void> {
  // Refuse unsafe arguments before any container starts.
  const playwrightArgs = e2ePlaywrightArgs(Deno.args);
  const project = e2eProjectName(Deno.pid, Date.now());
  let browser: OwnedProcess | undefined;
  let tls: E2eTlsMaterial | undefined;
  const gatewayPort = chooseE2eGatewayPort();
  let environment = e2eEnvironment(project, gatewayPort);
  await runE2eGate({
    startup: async () => {
      tls = await createE2eTls(project);
      environment = {
        ...environment,
        GATEWAY_TLS_CERTIFICATE_PATH: tls.certificate,
        GATEWAY_TLS_PRIVATE_KEY_PATH: tls.privateKey,
      };
      const stackEnvironment = environment;
      const { gatewayOrigin, mailOrigin } = await startE2eStack(gatewayPort, {
        compose: (args, allowFailure) =>
          command(
            "docker",
            [...E2E_COMPOSE_ARGS, ...args],
            stackEnvironment,
            allowFailure,
          ),
        port: (service, containerPort, protocol) =>
          composePort(service, containerPort, stackEnvironment, protocol),
      });
      environment = {
        ...environment,
        E2E_EXTERNAL_WEB: "1",
        TEST_MAIL_ORIGIN: mailOrigin,
      };
      await waitForApi(gatewayOrigin);
      await waitForGatewayHealth(gatewayOrigin);
      await assertGatewayDependencyReadiness(gatewayOrigin, environment);
    },
    test: async () => {
      const args = playwrightArgs;
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
    webStatus: () => new Promise<Deno.CommandStatus>(() => undefined),
    stopTest: async () => {
      if (browser) await stopOwnedProcess(browser);
    },
    stopWeb: () => Promise.resolve(),
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
    assertAbsent: () =>
      assertE2eProjectAbsent(
        project,
        (args) => commandOutput("docker", args, environment),
      ),
    cleanupFiles: () => cleanupE2eArtifacts(project, environment, tls),
  });
}

if (import.meta.main) await main();
