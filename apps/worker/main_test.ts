import { denoWorkerRuntime, runWorker, type WorkerRuntime } from "./main.ts";
import { assert } from "../../packages/backend/testing/assert.ts";

type Signal = "SIGINT" | "SIGTERM";

/** Signal registration the test can fire and inspect. */
class RecordedSignals {
  readonly handlers = new Map<Signal, Set<() => void>>();

  add(signal: Signal, handler: () => void): void {
    const handlers = this.handlers.get(signal) ?? new Set();
    handlers.add(handler);
    this.handlers.set(signal, handlers);
  }

  remove(signal: Signal, handler: () => void): void {
    this.handlers.get(signal)?.delete(handler);
  }

  fire(signal: Signal): void {
    for (const handler of [...(this.handlers.get(signal) ?? [])]) handler();
  }

  get count(): number {
    let count = 0;
    for (const handlers of this.handlers.values()) count += handlers.size;
    return count;
  }
}

function environment(values: Readonly<Record<string, string>>) {
  return { get: (name: string) => values[name] };
}

const DATABASE_URL = "postgresql://unused:unused@127.0.0.1:1/unused";

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  Deno.test(`[GAP-037] worker entry point starts, stops on ${signal}, and closes`, async () => {
    const signals = new RecordedSignals();
    const effects: string[] = [];
    const runtime: WorkerRuntime = {
      configure: (databaseUrl) => {
        effects.push(`configure:${databaseUrl}`);
        return {
          close: () => {
            effects.push("close");
            return Promise.resolve();
          },
          worker: {
            tick: ({ owner }) => {
              effects.push(`tick:${owner}`);
              assert(signals.count === 2, "both shutdown signals are wired");
              signals.fire(signal);
              return Promise.resolve();
            },
          },
        };
      },
      environment: environment({
        DATABASE_URL,
        WORKER_INSTANCE_ID: "worker-a",
      }),
      intervalMilliseconds: 60_000,
      randomOwner: () => "unused-owner",
      signals,
    };

    await runWorker(runtime);

    assert(
      effects.join(",") ===
        `configure:${DATABASE_URL},tick:worker-a,close`,
      `worker lifecycle was ${effects.join(",")}`,
    );
    assert(signals.count === 0, "shutdown left a signal listener registered");
  });
}

Deno.test("[GAP-037] worker entry point names an owner when none is configured", async () => {
  const signals = new RecordedSignals();
  const owners: string[] = [];
  await runWorker({
    configure: () => ({
      close: () => Promise.resolve(),
      worker: {
        tick: ({ owner }) => {
          owners.push(owner);
          signals.fire("SIGTERM");
          return Promise.resolve();
        },
      },
    }),
    environment: environment({ DATABASE_URL }),
    intervalMilliseconds: 60_000,
    randomOwner: () => "generated-owner",
    signals,
  });
  assert(
    owners.join(",") === "generated-owner",
    `worker ticked as ${owners.join(",")}`,
  );
});

Deno.test("[GAP-037] worker entry point closes its connection when a tick fails", async () => {
  const signals = new RecordedSignals();
  let closed = false;
  let failure: unknown;
  try {
    await runWorker({
      configure: () => ({
        close: () => {
          closed = true;
          return Promise.resolve();
        },
        worker: { tick: () => Promise.reject(new Error("database down")) },
      }),
      environment: environment({ DATABASE_URL }),
      intervalMilliseconds: 60_000,
      randomOwner: () => "owner",
      signals,
    });
  } catch (error) {
    failure = error;
  }
  assert(
    failure instanceof Error && failure.message === "database down",
    "a failed tick was swallowed",
  );
  assert(closed, "a failed tick left the database connection open");
  assert(signals.count === 0, "a failed tick left a signal listener");
});

Deno.test("[GAP-037] worker entry point refuses to start without a database", async () => {
  const signals = new RecordedSignals();
  let configured = false;
  let failure: unknown;
  try {
    await runWorker({
      configure: () => {
        configured = true;
        throw new Error("unreachable");
      },
      environment: environment({}),
      intervalMilliseconds: 60_000,
      randomOwner: () => "owner",
      signals,
    });
  } catch (error) {
    failure = error;
  }
  assert(
    failure instanceof Error &&
      failure.message === "Worker database configuration is required.",
    "a worker without a database started",
  );
  assert(!configured && signals.count === 0, "a refused worker composed");
});

Deno.test("[GAP-037] the default worker runtime composes the configured worker", async () => {
  const signals = new RecordedSignals();
  const original = signals.add.bind(signals);
  // A shutdown already pending at startup: the loop is inert, so the real
  // composition is built and closed without reaching the database.
  signals.add = (signal, handler) => {
    original(signal, handler);
    if (signal === "SIGTERM") handler();
  };
  await runWorker({
    environment: environment({ APP_ENV: "test", DATABASE_URL }),
    signals,
  });
  assert(signals.count === 0, "the default runtime left a signal listener");
});

Deno.test("[AUD-K6] the default worker runtime without APP_ENV composes as production", async () => {
  const signals = new RecordedSignals();
  let failure: unknown;
  try {
    await runWorker({ environment: environment({ DATABASE_URL }), signals });
  } catch (caught) {
    failure = caught;
  }
  assert(
    failure instanceof Error &&
      failure.message.includes("required in production"),
    "an unset APP_ENV never composes the worker with local defaults",
  );
  assert(signals.count === 0, "a refused worker left a signal listener");
});

Deno.test("[GAP-037] the deployed runtime reads Deno's environment and signals", () => {
  const runtime = denoWorkerRuntime();
  assert(runtime.environment === Deno.env, "the worker reads another host");
  let received = 0;
  const handler = () => {
    received += 1;
  };
  // Registering and removing proves the listener is Deno's own and leaves no
  // signal stream open for the test sanitizer to find.
  runtime.signals.add("SIGTERM", handler);
  runtime.signals.remove("SIGTERM", handler);
  runtime.signals.add("SIGINT", handler);
  runtime.signals.remove("SIGINT", handler);
  assert(received === 0, "registering a shutdown listener fired it");
});

Deno.test("[GAP-037] worker entry point removes its signal listeners when composition fails", async () => {
  const signals = new RecordedSignals();
  let failure: unknown;
  try {
    await runWorker({
      configure: () => {
        throw new Error("object storage misconfigured");
      },
      environment: environment({ DATABASE_URL }),
      signals,
    });
  } catch (error) {
    failure = error;
  }
  assert(
    failure instanceof Error &&
      failure.message === "object storage misconfigured",
    "a failed composition was swallowed",
  );
  assert(signals.count === 0, "a failed composition left a signal listener");
});
