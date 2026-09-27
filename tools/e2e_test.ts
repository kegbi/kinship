import {
  ASTRO_PAGE_READINESS_MS,
  ASTRO_STARTUP_MS,
  awaitAstroReadiness,
  chooseE2eGatewayPort,
  E2E_ASTRO_TASK_ARGS,
  E2E_COMPOSE_ARGS,
  E2E_PROCESS_BINARIES,
  e2eEnvironment,
  e2eImageNames,
  e2ePlaywrightArgs,
  e2eProjectName,
  exactProcessTree,
  finishAstroReadinessAttempt,
  reconcileTerminationOutcome,
  runE2eGate,
  startAstro,
  startE2eStack,
  stopOwnedProcess,
  stopWeb,
  tearDownE2eComposeProject,
  terminateExactProcesses,
  waitForProcessAbsence,
} from "./e2e.ts";
import { moduleById } from "./tasks/manifest.ts";
import {
  coverageCollectionArguments,
  coverageReportArguments,
} from "./tasks/run.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("E2E launcher names only exact disposable project images", async () => {
  const project = "kinship-e2e-42-1234";
  assert(
    e2eImageNames(project).join(",") ===
      ["web", "gateway", "migrate", "worker", "api"]
        .map((service) => `${project}-${service}:latest`)
        .join(","),
    "automatic cleanup targets the five exact run-scoped images",
  );
  let rejected = false;
  try {
    e2eImageNames("kinship-e2e-unsafe");
  } catch {
    rejected = true;
  }
  assert(rejected, "automatic cleanup rejects an invalid project name");
  const config = JSON.parse(
    await Deno.readTextFile(new URL("../deno.json", import.meta.url)),
  );
  assert(
    String(config.tasks["test:e2e"]).includes(
      "--allow-write=.artifacts/playwright/.last-run.json",
    ),
    "the launcher can remove only its exact Playwright completion marker",
  );
});

Deno.test("E2E launcher isolates project, listeners, and browser origins", () => {
  const project = e2eProjectName(42, 1234);
  const environment = e2eEnvironment(project, 18004);
  assert(project === "kinship-e2e-42-1234", "project is unique per run");
  assert(
    environment.COMPOSE_PROJECT_NAME === project &&
      environment.PUBLIC_WEB_ORIGIN === "https://127.0.0.1:18004",
    "project and browser origin are run-scoped",
  );
  assert(
    environment.POSTGRES_USER === "kinship_e2e" &&
      environment.POSTGRES_DB === "kinship_e2e" &&
      environment.POSTGRES_PASSWORD === `e2e@:/%${project}`,
    "the real stack exercises non-default names and reserved password bytes",
  );
  assert(
    environment.TEST_WEB_ORIGIN === "https://127.0.0.1:18004" &&
      !("API_TEST_PORT" in environment) &&
      !("MAILPIT_TEST_PORT" in environment) &&
      !("POSTGRES_TEST_PORT" in environment),
    "Docker assigns every private service port; only the gateway is chosen",
  );
  assert(
    E2E_COMPOSE_ARGS.includes("compose.test.yaml"),
    "launcher consumes the disposable test overlay",
  );
});

Deno.test("[REL-040] the environment publishes the gateway on the chosen port", () => {
  // On Linux, Compose recreated the gateway after the launcher rebuilt the
  // environment around the port Docker had first assigned, and the recreated
  // container received a new ephemeral port. The port is now chosen before
  // any container exists and handed to Compose in the one environment.
  const environment = e2eEnvironment(e2eProjectName(42, 1234), 18004);
  assert(
    environment.E2E_GATEWAY_PORT === "18004",
    "Compose publishes the gateway on the launcher's chosen host port",
  );
  assert(
    environment.PUBLIC_WEB_ORIGIN === "https://127.0.0.1:18004" &&
      environment.TEST_WEB_ORIGIN === environment.PUBLIC_WEB_ORIGIN,
    "the browser and API origin derive from that same port",
  );
});

Deno.test("[REL-040] the gateway host port is chosen from a released loopback listener", async () => {
  const port = chooseE2eGatewayPort();
  assert(
    Number.isInteger(port) && port > 0 && port <= 65_535,
    `the chosen gateway port is a real TCP port, not ${port}`,
  );
  const listener = Deno.listen({ hostname: "127.0.0.1", port });
  try {
    assert(
      (listener.addr as Deno.NetAddr).port === port,
      "the probe listener is released so Docker can bind the chosen port",
    );
  } finally {
    listener.close();
  }
  const launcher = await Deno.readTextFile(
    new URL("./e2e.ts", import.meta.url),
  );
  assert(
    !launcher.includes('"create",') &&
      !launcher.includes('["start", gatewayContainer]'),
    "no gateway is started ahead of the stack to discover its port",
  );
});

Deno.test("[REL-040] the stack starts once and must keep the chosen gateway port", async () => {
  const calls: string[] = [];
  const operations = (gatewayOrigin: string) => ({
    compose: (args: readonly string[]) => {
      calls.push(args.join(" "));
      return Promise.resolve();
    },
    port: (service: string, containerPort: number, protocol: string) =>
      Promise.resolve(
        service === "gateway"
          ? gatewayOrigin
          : `${protocol}://127.0.0.1:${containerPort + 1}`,
      ),
  });
  const started = await startE2eStack(
    18004,
    operations("https://127.0.0.1:18004"),
  );
  assert(
    calls.join("|") ===
      "up --build --detach --wait --wait-timeout 120",
    `the stack is built and started by one Compose command, not ${
      calls.join("|")
    }`,
  );
  assert(
    started.gatewayOrigin === "https://127.0.0.1:18004" &&
      started.mailOrigin === "http://127.0.0.1:8026",
    "the ready stack reports the chosen gateway and the Docker-assigned mail origin",
  );

  let error: unknown;
  try {
    await startE2eStack(18004, operations("https://127.0.0.1:18005"));
  } catch (caught) {
    error = caught;
  }
  assert(
    String(error).includes("chosen port 18004") &&
      String(error).includes("https://127.0.0.1:18005"),
    `a gateway published elsewhere fails clearly, not with ${String(error)}`,
  );
});

Deno.test("[REL-040] a failed stack start prints diagnostics and keeps its cause", async () => {
  const calls: string[] = [];
  let error: unknown;
  try {
    await startE2eStack(18004, {
      compose: (args) => {
        calls.push(args[0] ?? "");
        return args[0] === "up"
          ? Promise.reject(new Error("compose up failed"))
          : Promise.resolve();
      },
      port: () => Promise.reject(new Error("no port after a failed start")),
    });
  } catch (caught) {
    error = caught;
  }
  assert(
    String(error).includes("compose up failed"),
    "the Compose failure stays primary",
  );
  assert(
    calls.join(",") === "up,ps,logs",
    `status and logs follow a failed start, not ${calls.join(",")}`,
  );
});

function fakeImageDocker(
  images: Set<string>,
  calls: string[],
  options: { readonly downFails?: boolean; readonly rmIgnored?: boolean } = {},
): (args: readonly string[]) => Promise<string> {
  return (args) => {
    calls.push(args.join(" "));
    if (args.includes("down") && options.downFails) {
      return Promise.reject(new Error("compose down failed"));
    }
    if (args[0] === "image" && args[1] === "ls") {
      return Promise.resolve([...images].join("\n"));
    }
    if (args[0] === "image" && args[1] === "rm" && !options.rmIgnored) {
      for (const image of args.slice(2)) images.delete(image);
    }
    return Promise.resolve("");
  };
}

Deno.test("[REL-043] a Compose fixture's teardown removes the images it built", async () => {
  const project = "kinship-e2e-42-1234";
  const unrelated = ["kinship-e2e-7-8-api:latest", "postgres:18.4-alpine3.23"];
  const images = new Set([...e2eImageNames(project), ...unrelated]);
  const calls: string[] = [];
  let error: unknown;
  try {
    await tearDownE2eComposeProject(
      project,
      fakeImageDocker(images, calls, { downFails: true }),
    );
  } catch (caught) {
    error = caught;
  }
  assert(
    String(error).includes("compose down failed"),
    `a failed down stays reported, not ${String(error)}`,
  );
  const down = calls.findIndex((call) =>
    call.startsWith(`${E2E_COMPOSE_ARGS.join(" ")} down `)
  );
  const remove = calls.indexOf(`image rm ${e2eImageNames(project).join(" ")}`);
  assert(
    down >= 0 && remove > down,
    `the images go after down, even a failed one: ${calls.join(" | ")}`,
  );
  assert(
    [...images].sort().join(",") === [...unrelated].sort().join(","),
    `only this run's images are removed, leaving ${[...images].join(",")}`,
  );
});

Deno.test("[REL-043] a Compose fixture's teardown fails when its images remain", async () => {
  const project = "kinship-e2e-42-1234";
  let error: unknown;
  try {
    await tearDownE2eComposeProject(
      project,
      fakeImageDocker(new Set(e2eImageNames(project)), [], {
        rmIgnored: true,
      }),
    );
  } catch (caught) {
    error = caught;
  }
  assert(
    String(error).includes(`${project}-api:latest`),
    `a leftover image fails the fixture, not ${String(error)}`,
  );
});

Deno.test("[REL-040] the launcher's process binaries are declared once", async () => {
  const [launcher, configText] = await Promise.all([
    Deno.readTextFile(new URL("./e2e.ts", import.meta.url)),
    Deno.readTextFile(new URL("../deno.json", import.meta.url)),
  ]);
  const spawned = new Set(
    [
      ...launcher.matchAll(
        /(?:new Deno\.Command|commandOutput|command)\(\s*"([^"]+)"/g,
      ),
    ].map((match) => match[1]!),
  );
  assert(spawned.has("ps") && spawned.has("kill"), "the scan sees Linux paths");
  const undeclared = [...spawned].filter((binary) =>
    !E2E_PROCESS_BINARIES.includes(binary)
  );
  assert(
    undeclared.length === 0,
    `the launcher spawns undeclared binaries: ${undeclared.join(", ")}`,
  );
  const config = JSON.parse(configText) as {
    readonly tasks: Readonly<Record<string, string>>;
  };
  const granted = /--allow-run=([^ ]+)/.exec(config.tasks["test:e2e"] ?? "")
    ?.[1]?.split(",") ?? [];
  assert(
    [...granted].sort().join(",") ===
      [...E2E_PROCESS_BINARIES].sort().join(","),
    `test:e2e grants exactly the launcher binaries, not ${granted.join(",")}`,
  );
});

Deno.test("production-like E2E serializes shared state unless explicitly overridden", () => {
  assert(
    e2ePlaywrightArgs(["tests/e2e/journal.JOURNAL-001.spec.ts"]).join(" ") ===
      "exec playwright test tests/e2e/journal.JOURNAL-001.spec.ts --workers=1",
    "the shared Compose database is serialized by default",
  );
  assert(
    e2ePlaywrightArgs(["--workers=2", "tests/e2e/journal.JOURNAL-001.spec.ts"])
          .join(
            " ",
          ) ===
        "exec playwright test --workers=2 tests/e2e/journal.JOURNAL-001.spec.ts" &&
      e2ePlaywrightArgs(["-j", "2"]).join(" ") ===
        "exec playwright test -j 2",
    "an explicit Playwright worker choice remains authoritative",
  );
});

Deno.test("E2E Astro startup alone bypasses the persistent dev lock", async () => {
  assert(
    E2E_ASTRO_TASK_ARGS.join(" ") === "task dev:web --ignore-lock",
    "the disposable E2E process uses Astro's supported lock bypass",
  );
  assert(
    !E2E_ASTRO_TASK_ARGS.join(" ").includes("--force"),
    "E2E cannot replace or signal the PID recorded by a stale lock",
  );

  const config = JSON.parse(
    await Deno.readTextFile(new URL("../deno.json", import.meta.url)),
  ) as { readonly tasks?: Readonly<Record<string, string>> };
  const developerTask = config.tasks?.["dev:web"] ?? "";
  assert(
    !developerTask.includes("--ignore-lock"),
    "normal developer startup retains Astro's lock protection",
  );
});

interface AstroReadinessFake {
  readonly budgets: readonly number[];
  readonly elapsed: () => number;
  readonly operations: Parameters<typeof awaitAstroReadiness>[0];
}

function astroReadinessFake(child: {
  readonly listenerBoundAt: number;
  readonly pageServedAt: number;
}): AstroReadinessFake {
  let clock = 0;
  const budgets: number[] = [];
  return {
    budgets,
    elapsed: () => clock,
    operations: {
      exited: new Promise<never>(() => undefined),
      listenerIsReachable: () =>
        Promise.resolve(clock >= child.listenerBoundAt),
      now: () => clock,
      pageIsReady: (budgetMs) => {
        budgets.push(budgetMs);
        return Promise.resolve(clock >= child.pageServedAt);
      },
      sleep: (milliseconds) => {
        clock += milliseconds;
        return Promise.resolve();
      },
    },
  };
}

Deno.test("[GAP-002] Astro page readiness starts at the child's own listener signal", async () => {
  // REL-031: inside the root coverage aggregate the Astro child spent most of
  // the fixed window cold-starting, so the page deadline expired while the
  // healthy child was about to serve the real page.
  const fake = astroReadinessFake({
    listenerBoundAt: 25_000,
    pageServedAt: 31_000,
  });
  const result = await awaitAstroReadiness(fake.operations);
  assert(
    result.type === "ready",
    `a child that binds at 25s and serves the real page 6s later is ready, not ${result.type}`,
  );
  assert(
    fake.elapsed() < 25_000 + ASTRO_PAGE_READINESS_MS,
    "page readiness is decided inside one page budget after the listener signal",
  );
});

Deno.test("[GAP-002] one readiness probe may use the remaining page budget", async () => {
  const fake = astroReadinessFake({
    listenerBoundAt: 0,
    pageServedAt: 12_000,
  });
  await awaitAstroReadiness(fake.operations);
  assert(
    fake.budgets[0] === ASTRO_PAGE_READINESS_MS,
    `the first probe request owns the whole page budget, not ${
      fake.budgets[0]
    } ms`,
  );
  assert(
    fake.budgets.every((budget) => budget > 0),
    "no probe request is issued after the page budget is spent",
  );
});

Deno.test("[GAP-002] a bound Astro child that never serves the page still fails", async () => {
  const fake = astroReadinessFake({
    listenerBoundAt: 4_000,
    pageServedAt: Number.POSITIVE_INFINITY,
  });
  const result = await awaitAstroReadiness(fake.operations);
  assert(
    result.type === "timeout",
    "a listener alone never satisfies readiness",
  );
  assert(
    fake.elapsed() >= 4_000 + ASTRO_PAGE_READINESS_MS &&
      fake.elapsed() < 4_000 + 2 * ASTRO_PAGE_READINESS_MS,
    "the page budget is still bounded, measured from the listener signal",
  );
});

Deno.test("[GAP-002] an Astro child that never binds gives up on its own budget", async () => {
  const fake = astroReadinessFake({
    listenerBoundAt: Number.POSITIVE_INFINITY,
    pageServedAt: Number.POSITIVE_INFINITY,
  });
  const result = await awaitAstroReadiness(fake.operations);
  assert(result.type === "timeout", "start-up cannot wait forever");
  assert(
    fake.budgets.length === 0,
    "no page is probed before the child's listener signal",
  );
  assert(
    fake.elapsed() >= ASTRO_STARTUP_MS &&
      fake.elapsed() < ASTRO_STARTUP_MS + ASTRO_PAGE_READINESS_MS,
    "start-up is bounded by its own budget",
  );
});

Deno.test("E2E canonical Astro child remains live outside CI", async () => {
  const previousCi = Deno.env.get("CI");
  let web: Awaited<ReturnType<typeof startAstro>> | undefined;
  Deno.env.delete("CI");
  try {
    web = await startAstro("http://127.0.0.1:1");
    assert(
      web.child.stdin !== null,
      "the launcher owns an open stdin for the canonical Astro child",
    );
    const response = await fetch(web.origin, {
      signal: AbortSignal.timeout(2_000),
    });
    assert(response.ok, "the canonical Astro child becomes ready");
    assert(
      (await response.text()).includes(
        "<title>Kinship — Remember what matters</title>",
      ),
      "readiness comes from the real Kinship page",
    );
    const exited = await Promise.race([
      web.child.status.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 250)),
    ]);
    assert(!exited, "the ready canonical Astro child remains live");
  } finally {
    if (web) await stopWeb(web);
    if (previousCi === undefined) Deno.env.delete("CI");
    else Deno.env.set("CI", previousCi);
  }
});

Deno.test("E2E orchestration aggregates primary, down, and absence failures", async () => {
  const calls: string[] = [];
  let error: unknown;
  try {
    await runE2eGate({
      startup: () =>
        Promise.resolve(calls.push("startup")).then(() => undefined),
      test: () => Promise.reject(new Error("browser failure")),
      webStatus: () => new Promise<Deno.CommandStatus>(() => undefined),
      stopTest: () => {
        calls.push("test-stop");
        return Promise.reject(new Error("browser cleanup failure"));
      },
      stopWeb: () => {
        calls.push("web-stop");
        return Promise.reject(new Error("web listener still bound"));
      },
      down: () => Promise.reject(new Error("down failure")),
      assertAbsent: () => Promise.reject(new Error("project leak")),
    });
  } catch (caught) {
    error = caught;
  }
  assert(error instanceof AggregateError, "cleanup failures are aggregated");
  assert(
    error.errors.map(String).join("|").includes("browser failure") &&
      error.errors.map(String).join("|").includes(
        "browser cleanup failure",
      ) &&
      error.errors.map(String).join("|").includes("web listener still bound") &&
      error.errors.map(String).join("|").includes("down failure") &&
      error.errors.map(String).join("|").includes("project leak"),
    "primary browser failure remains visible beside cleanup failures",
  );
  assert(
    calls.join(",") === "startup,test-stop,web-stop",
    "browser and web processes are always stopped in order",
  );
});

Deno.test("E2E orchestration reports an early web exit before browser success", async () => {
  let error: unknown;
  const operations = {
    startup: () => Promise.resolve(),
    test: () => new Promise<void>((resolve) => setTimeout(resolve, 25)),
    webStatus: () =>
      Promise.resolve({ code: 17, signal: null, success: false } as const),
    stopTest: () => Promise.resolve(),
    stopWeb: () => Promise.resolve(),
    down: () => Promise.resolve(),
    assertAbsent: () => Promise.resolve(),
  };
  try {
    await runE2eGate(operations);
  } catch (caught) {
    error = caught;
  }
  assert(
    String(error).includes("web process exited with code 17"),
    "web death is the primary failure instead of a later browser symptom",
  );
});

Deno.test("E2E orchestration cancels and awaits a non-settling browser child", async () => {
  let browserStopped = false;
  let settleBrowser: (() => void) | undefined;
  const browserStatus = new Promise<void>((resolve) => {
    settleBrowser = resolve;
  });
  const operations = {
    startup: () => Promise.resolve(),
    test: () => browserStatus,
    webStatus: () =>
      Promise.resolve({ code: 19, signal: null, success: false } as const),
    stopTest: async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      browserStopped = true;
      settleBrowser?.();
      await browserStatus;
    },
    stopWeb: () => Promise.resolve(),
    down: () => Promise.resolve(),
    assertAbsent: () => Promise.resolve(),
  };
  try {
    await runE2eGate(operations);
  } catch {
    // The early web exit is expected; cancellation must still settle first.
  }
  assert(
    browserStopped,
    "the owned browser child is stopped and awaited when web exits first",
  );
});

Deno.test("Astro wrong-content readiness stops its live child at the deadline", async () => {
  let stopped = false;
  let error: unknown;
  try {
    await finishAstroReadinessAttempt({
      exited: new Promise(() => undefined),
      listenerIsReachable: () => Promise.resolve(true),
      stop: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        stopped = true;
      },
    });
  } catch (caught) {
    error = caught;
  }
  assert(stopped, "the live owned child is stopped before readiness rejects");
  assert(
    String(error).includes("did not serve the expected page"),
    "the bounded readiness error is preserved",
  );
});

Deno.test("failed exact termination is accepted only after PID absence proof", async () => {
  const targets = [1201, 1202];
  let provenTargets: readonly number[] = [];
  await reconcileTerminationOutcome(
    { code: 1, stderr: "", success: false },
    targets,
    (processTree) => {
      provenTargets = processTree;
      return Promise.resolve(true);
    },
  );
  assert(
    provenTargets.join(",") === targets.join(","),
    "a failed command is reconciled against the complete exact PID tree",
  );

  let error: unknown;
  try {
    await reconcileTerminationOutcome(
      { code: 1, stderr: "termination failed", success: false },
      targets,
      () => Promise.resolve(false),
    );
  } catch (caught) {
    error = caught;
  }
  assert(
    String(error).includes("termination failed"),
    "a failed command remains a cleanup failure while an exact PID survives",
  );
});

Deno.test("root coverage passes portable production include arguments", async () => {
  const api = moduleById("api");
  assert(api?.coverage, "the task manifest declares an api coverage set");
  const includes = api.coverage.include;
  for (
    const path of [
      "apps/api",
      "packages/backend",
      "packages/contracts",
      "tools/contracts",
      "tools/migrations",
    ]
  ) {
    assert(
      includes.includes(path),
      `each production prefix is its own coverage include: ${path}`,
    );
  }
  assert(
    includes.every((path) =>
      !path.includes("|") && !path.includes('"') && !path.includes("'")
    ),
    "coverage filtering cannot depend on platform-specific shell quoting",
  );
  const collection = await coverageCollectionArguments(api.coverage);
  assert(
    collection.includes("--coverage-raw-data-only"),
    "collection defers threshold enforcement to the scoped report",
  );
  assert(
    collection.includes("--clean"),
    "collection starts from an empty raw coverage directory",
  );
  const report = coverageReportArguments(api.coverage);
  assert(
    includes.every((path) => report.includes(`--include=${path}`)),
    "each production prefix reaches the report as its own argument",
  );
});

Deno.test("[GAP-006] each coverage set enforces the threshold it declares", () => {
  const api = moduleById("api");
  assert(api?.coverage, "the task manifest declares an api coverage set");
  assert(
    api.coverage.threshold === undefined &&
      coverageReportArguments(api.coverage).includes("--threshold=80"),
    "a set that declares no threshold is held to the repository floor",
  );

  const kernel = moduleById("shared-kernel");
  assert(kernel?.coverage, "the task manifest measures the shared kernel");
  assert(
    kernel.coverage.threshold === 95 &&
      coverageReportArguments(kernel.coverage).includes("--threshold=95"),
    "every module depends on the kernel, so its own bar is higher",
  );
  assert(
    kernel.coverage.include.includes("packages/backend/shared-kernel"),
    "the kernel coverage set measures the kernel",
  );
});

Deno.test({
  name: "Windows cleanup terminates and proves absence of the exact PID tree",
  ignore: Deno.build.os !== "windows",
  fn: async () => {
    const child = new Deno.Command("powershell", {
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$nested = Start-Process powershell -ArgumentList @('-NoProfile','-NonInteractive','-Command','Start-Sleep -Seconds 60') -PassThru; Start-Sleep -Seconds 60",
      ],
      stdout: "null",
      stderr: "null",
    }).spawn();
    let tree: readonly number[] = [child.pid];
    try {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        tree = await exactProcessTree(child.pid);
        if (tree.length >= 2) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert(tree.length >= 2, "the fixture created a real child process");
      await stopOwnedProcess({ child, processTree: [child.pid] });
      assert(
        await waitForProcessAbsence(tree),
        "cleanup refreshed and removed the late descendant PID",
      );
    } finally {
      const remaining = await exactProcessTree(child.pid);
      if (!(await waitForProcessAbsence([...tree, ...remaining]))) {
        await terminateExactProcesses([...tree, ...remaining]);
      }
    }
  },
});
