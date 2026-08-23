import {
  E2E_ASTRO_TASK_ARGS,
  E2E_COMPOSE_ARGS,
  e2eEnvironment,
  e2eImageNames,
  e2ePlaywrightArgs,
  e2eProjectName,
  exactProcessTree,
  finishAstroReadinessAttempt,
  reconcileTerminationOutcome,
  runE2eGate,
  startAstro,
  stopOwnedProcess,
  stopWeb,
  terminateExactProcesses,
  waitForProcessAbsence,
} from "./e2e.ts";

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
  const environment = e2eEnvironment(project, "http://127.0.0.1:18004");
  assert(project === "kinship-e2e-42-1234", "project is unique per run");
  assert(
    environment.COMPOSE_PROJECT_NAME === project &&
      environment.PUBLIC_WEB_ORIGIN === "http://127.0.0.1:18004",
    "project and browser origin are run-scoped",
  );
  assert(
    environment.POSTGRES_USER === "kinship_e2e" &&
      environment.POSTGRES_DB === "kinship_e2e" &&
      environment.POSTGRES_PASSWORD === `e2e@:/%${project}`,
    "the real stack exercises non-default names and reserved password bytes",
  );
  assert(
    environment.TEST_WEB_ORIGIN === "http://127.0.0.1:18004" &&
      !("API_TEST_PORT" in environment) &&
      !("MAILPIT_TEST_PORT" in environment) &&
      !("POSTGRES_TEST_PORT" in environment),
    "Docker, not released listeners, assigns service ports",
  );
  assert(
    E2E_COMPOSE_ARGS.includes("compose.test.yaml"),
    "launcher consumes the disposable test overlay",
  );
});

Deno.test("production-like E2E serializes shared state unless explicitly overridden", () => {
  assert(
    e2ePlaywrightArgs(["tests/e2e/app-008a.spec.ts"]).join(" ") ===
      "exec playwright test tests/e2e/app-008a.spec.ts --workers=1",
    "the shared Compose database is serialized by default",
  );
  assert(
    e2ePlaywrightArgs(["--workers=2", "tests/e2e/app-008a.spec.ts"]).join(
          " ",
        ) === "exec playwright test --workers=2 tests/e2e/app-008a.spec.ts" &&
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

Deno.test("root coverage task passes portable production include arguments", async () => {
  const config = JSON.parse(
    await Deno.readTextFile(new URL("../deno.json", import.meta.url)),
  ) as { readonly tasks?: Readonly<Record<string, string>> };
  const task = config.tasks?.["test:coverage:api:direct"] ?? "";
  const includes = [
    "apps/api",
    "packages/backend",
    "packages/contracts",
    "tools/contracts",
    "tools/migrations",
  ].map((path) => `--include=${path}`);
  assert(
    includes.every((argument) => task.includes(argument)),
    "each production prefix is a separate shell-safe coverage argument",
  );
  assert(
    task.includes("--coverage-raw-data-only"),
    "collection defers threshold enforcement to the scoped report",
  );
  assert(
    !task.includes("|") && !task.includes('--include="') &&
      !task.includes("--include='"),
    "coverage filtering cannot depend on platform-specific shell quoting",
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
