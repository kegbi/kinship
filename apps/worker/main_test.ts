import { denoWorkerRuntime, runWorker, type WorkerRuntime } from "./main.ts";
import { assert, assertEquals } from "../../packages/backend/testing/assert.ts";
import { recordingLogger } from "../../packages/backend/testing/fakes.ts";

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

Deno.test("[AUD-W2] worker entry point logs a failed tick, keeps running, and closes", async () => {
  const signals = new RecordedSignals();
  const logger = recordingLogger();
  const effects: string[] = [];
  let ticks = 0;
  await runWorker({
    configure: (_databaseUrl, configuredLogger) => {
      assert(configuredLogger === logger, "the worker logs elsewhere");
      return {
        close: () => {
          effects.push("close");
          return Promise.resolve();
        },
        reconnect: () => {
          effects.push("reconnect");
          return Promise.resolve();
        },
        worker: {
          tick: () => {
            ticks += 1;
            effects.push(`tick:${ticks}`);
            if (ticks === 1) {
              return Promise.reject(
                Object.assign(new Error("database down"), {
                  code: "CONNECTION_CLOSED",
                }),
              );
            }
            signals.fire("SIGTERM");
            return Promise.resolve();
          },
        },
      };
    },
    environment: environment({ DATABASE_URL }),
    intervalMilliseconds: 1,
    logger,
    randomOwner: () => "owner",
    signals,
  });
  assertEquals(effects, ["tick:1", "reconnect", "tick:2", "close"]);
  assertEquals(logger.events.map((line) => line.event), ["worker.job"]);
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

/** An event target that counts the listeners on it, by event type. */
class CountingTarget extends EventTarget {
  readonly listening = new Map<string, number>();

  override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean,
  ): void {
    this.listening.set(type, (this.listening.get(type) ?? 0) + 1);
    super.addEventListener(type, listener, options);
  }

  override removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions | boolean,
  ): void {
    this.listening.set(type, (this.listening.get(type) ?? 0) - 1);
    super.removeEventListener(type, listener, options);
  }
}

Deno.test("[AUD-W2] worker entry point listens for driver crashes only while it runs", async () => {
  const signals = new RecordedSignals();
  const faults = new CountingTarget();
  let listeningDuringTick: unknown;
  await runWorker({
    configure: () => ({
      close: () => Promise.resolve(),
      worker: {
        tick: () => {
          listeningDuringTick = Object.fromEntries(faults.listening);
          signals.fire("SIGTERM");
          return Promise.resolve();
        },
      },
    }),
    environment: environment({ DATABASE_URL }),
    faults,
    intervalMilliseconds: 1,
    randomOwner: () => "owner",
    signals,
  });
  assertEquals(listeningDuringTick, { error: 1, unhandledrejection: 1 });
  assertEquals(Object.fromEntries(faults.listening), {
    error: 0,
    unhandledrejection: 0,
  });
});

Deno.test("[AUD-W2] worker entry point stops promptly while a tick and its close are stuck", async () => {
  const signals = new RecordedSignals();
  const faults = new CountingTarget();
  const effects: string[] = [];
  const started = performance.now();
  await runWorker({
    configure: () => ({
      close: () => {
        effects.push("close");
        return new Promise<never>(() => undefined);
      },
      worker: {
        tick: () => {
          effects.push("tick");
          setTimeout(() => signals.fire("SIGTERM"), 1);
          return new Promise<never>(() => undefined);
        },
      },
    }),
    environment: environment({ DATABASE_URL }),
    faults,
    intervalMilliseconds: 1,
    randomOwner: () => "owner",
    shutdownGraceMilliseconds: 20,
    signals,
  });
  assert(
    performance.now() - started < 1_000,
    "a stuck tick held the shutdown",
  );
  assertEquals(effects, ["tick", "close"]);
  assert(signals.count === 0, "a stuck tick left a signal listener");
  assertEquals(Object.fromEntries(faults.listening), {
    error: 0,
    unhandledrejection: 0,
  });
});

Deno.test("[AUD-W2] a tick in flight at shutdown is given its grace to finish", async () => {
  const signals = new RecordedSignals();
  const effects: string[] = [];
  await runWorker({
    configure: () => ({
      close: () => {
        effects.push("close");
        return Promise.resolve();
      },
      worker: {
        tick: async () => {
          signals.fire("SIGTERM");
          await new Promise((resolve) => setTimeout(resolve, 10));
          effects.push("tick finished");
        },
      },
    }),
    environment: environment({ DATABASE_URL }),
    faults: new EventTarget(),
    intervalMilliseconds: 1,
    randomOwner: () => "owner",
    shutdownGraceMilliseconds: 5_000,
    signals,
  });
  assertEquals(effects, ["tick finished", "close"]);
});
