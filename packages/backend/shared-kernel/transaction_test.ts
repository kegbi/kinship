import { runOrUnavailable, type TransactionRunner } from "./transaction.ts";
import { assert } from "../testing/assert.ts";

interface Handle {
  readonly opaque: unknown;
}

function runner(
  behavior: (work: (handle: Handle) => Promise<unknown>) => Promise<unknown>,
): TransactionRunner<Handle> {
  return {
    run: behavior as TransactionRunner<Handle>["run"],
  };
}

Deno.test("[GAP-007] a completed transaction returns its own result", async () => {
  const handle: Handle = { opaque: "tx" };
  const seen: Handle[] = [];
  const result = await runOrUnavailable(
    runner((work) => work(handle)),
    (transaction) => {
      seen.push(transaction);
      return Promise.resolve({ status: "ready" as const, value: 7 });
    },
  );
  assert(
    result.status === "ready" && result.value === 7,
    "the work's own result passes through untouched",
  );
  assert(
    seen.length === 1 && seen[0] === handle,
    "the work receives the runner's transaction handle",
  );
});

Deno.test("[GAP-007] a failure result passes through, not swallowed", async () => {
  const result = await runOrUnavailable(
    runner((work) => work({ opaque: "tx" })),
    () => Promise.resolve({ status: "forbidden" as const }),
  );
  assert(
    result.status === "forbidden",
    "a use case's own failure is not rewritten as unavailable",
  );
});

Deno.test("[GAP-007] work that throws becomes an unavailable failure", async () => {
  const result = await runOrUnavailable(
    runner((work) => work({ opaque: "tx" })),
    () => Promise.reject(new Error("the statement failed")),
  );
  assert(
    result.status === "unavailable",
    "a thrown error becomes unavailable rather than escaping the use case",
  );
});

Deno.test("[GAP-007] a runner that cannot start becomes unavailable", async () => {
  let started = false;
  const result = await runOrUnavailable<Handle, { readonly status: "ready" }>(
    runner(() => Promise.reject(new Error("the pool is exhausted"))),
    () => {
      started = true;
      return Promise.resolve({ status: "ready" as const });
    },
  );
  assert(
    result.status === "unavailable",
    "a connection the runner never opened is an unavailable failure",
  );
  assert(!started, "the work never ran");
});
