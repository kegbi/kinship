import {
  disposablePostgresEnvironment,
  runPostgresGate,
} from "./postgres_gate.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("PostgreSQL gate preserves primary and cleanup failures", async () => {
  const calls: string[] = [];
  let error: unknown;
  try {
    await runPostgresGate({
      up: () => {
        calls.push("up");
        return Promise.resolve();
      },
      run: () => {
        calls.push("test");
        return Promise.reject(new Error("primary test failure"));
      },
      down: () => {
        calls.push("down");
        return Promise.reject(new Error("cleanup failure"));
      },
      assertAbsent: () => {
        calls.push("absence");
        return Promise.reject(new Error("leaked project"));
      },
    });
  } catch (caught) {
    error = caught;
  }
  assert(error instanceof AggregateError, "all failures must remain visible");
  assert(
    error.errors.map(String).join("|").includes("primary test failure") &&
      error.errors.map(String).join("|").includes("cleanup failure") &&
      error.errors.map(String).join("|").includes("leaked project"),
    "primary, down, and absence errors are aggregated",
  );
  assert(
    calls.join(",") === "up,test,down,absence",
    "cleanup and exact absence always run",
  );
});

Deno.test("PostgreSQL gate cleans up startup failures", async () => {
  const calls: string[] = [];
  let failed = false;
  try {
    await runPostgresGate({
      up: () => Promise.reject(new Error("startup failure")),
      run: () => {
        calls.push("test");
        return Promise.resolve();
      },
      down: () => {
        calls.push("down");
        return Promise.resolve();
      },
      assertAbsent: () => {
        calls.push("absence");
        return Promise.resolve();
      },
    });
  } catch (error) {
    failed = String(error).includes("startup failure");
  }
  assert(failed, "startup failure propagates");
  assert(calls.join(",") === "down,absence", "failed startup still cleans");
});

Deno.test("[AUD-K6] the integration harness runs its suites as APP_ENV=test", () => {
  const environment = disposablePostgresEnvironment("kinship-pg-1-2", "p");
  assert(
    environment.APP_ENV === "test",
    "suites that compose the API or worker state APP_ENV explicitly",
  );
  assert(
    environment.COMPOSE_PROJECT_NAME === "kinship-pg-1-2" &&
      environment.POSTGRES_PASSWORD === "p",
    "the project and its password stay run-scoped",
  );
});
