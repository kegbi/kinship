import {
  createApplicationWorker,
  createConfiguredReminderWorker,
  runReminderWorkerLoop,
} from "./composition.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

class CountingAbortSignal {
  aborted = false;
  private readonly listeners = new Set<EventListenerOrEventListenerObject>();

  get listenerCount(): number {
    return this.listeners.size;
  }

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    if (type === "abort") this.listeners.add(listener);
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    if (type === "abort") this.listeners.delete(listener);
  }

  abort(): void {
    if (this.aborted) return;
    this.aborted = true;
    const event = new Event("abort");
    for (const listener of this.listeners) {
      if (typeof listener === "function") listener(event);
      else listener.handleEvent(event);
    }
    this.listeners.clear();
  }

  asAbortSignal(): AbortSignal {
    return this as unknown as AbortSignal;
  }
}

function emptyTick() {
  return Promise.resolve({ claimed: 0, results: [] });
}

Deno.test("[WORKSPACE-002] worker reconciles pending object cleanup before reminders", async () => {
  const effects: string[] = [];
  const worker = createApplicationWorker({
    tick: ({ owner }) => {
      effects.push(`reminders:${owner}`);
      return emptyTick();
    },
  }, {
    reconcilePendingCleanup: () => {
      effects.push("cleanup");
      return Promise.resolve({ completed: 1, inspected: 1 });
    },
  });

  await worker.tick({ owner: "restart-owner" });
  assert(
    effects.join(",") === "cleanup,reminders:restart-owner",
    `worker order was ${effects.join(",")}`,
  );
});

Deno.test({
  name: "APP-006B worker composition closes without starting a connection",
  async fn() {
    const configured = createConfiguredReminderWorker(
      "postgresql://unused:unused@127.0.0.1:1/unused",
    );
    assert(
      typeof configured.worker.tick === "function",
      "worker tick is missing",
    );
    let unavailable = false;
    try {
      await configured.worker.tick({ owner: "configuration-probe" });
    } catch {
      unavailable = true;
    } finally {
      await configured.close();
    }
    assert(unavailable, "worker unexpectedly reached an unavailable database");
  },
});

Deno.test("APP-006B worker removes abort listeners after every timer win", async () => {
  const signal = new CountingAbortSignal();
  let ticks = 0;
  await runReminderWorkerLoop({
    tick() {
      ticks += 1;
      if (ticks === 2) {
        const leakedListeners = signal.listenerCount;
        signal.abort();
        assert(
          leakedListeners === 0,
          `timer win leaked ${leakedListeners} abort listener(s)`,
        );
      }
      return emptyTick();
    },
  }, {
    intervalMilliseconds: 1,
    owner: "listener-test",
    signal: signal.asAbortSignal(),
  });
  assert(
    ticks === 2 && signal.listenerCount === 0,
    "worker loop did not stop cleanly",
  );
});

Deno.test("APP-006B worker exits when shutdown arrives during a tick", async () => {
  const signal = new CountingAbortSignal();
  const loop = runReminderWorkerLoop({
    tick() {
      signal.abort();
      return emptyTick();
    },
  }, {
    intervalMilliseconds: 60_000,
    owner: "shutdown-test",
    signal: signal.asAbortSignal(),
  });
  await Promise.race([
    loop,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("worker waited after shutdown")), 50)
    ),
  ]);
  assert(signal.listenerCount === 0, "shutdown left an abort listener");
});

Deno.test("APP-006B worker is inert for an already-aborted signal", async () => {
  const signal = new CountingAbortSignal();
  signal.abort();
  let ticks = 0;
  await runReminderWorkerLoop({
    tick() {
      ticks += 1;
      return emptyTick();
    },
  }, {
    intervalMilliseconds: 1,
    owner: "already-aborted-test",
    signal: signal.asAbortSignal(),
  });
  assert(
    ticks === 0 && signal.listenerCount === 0,
    "aborted loop performed work",
  );
});
