import {
  assert,
  assertEquals,
  assertRejects,
  assertStatus,
  assertThrows,
} from "./assert.ts";

/** Fails unless `work` throws, returning the message it threw. */
function messageOf(work: () => void): string {
  try {
    work();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("the assertion under test did not fail");
}

Deno.test("[GAP-014] assert narrows its condition and reports the caller's message", () => {
  const value: string | undefined = "present";
  assert(value, "value is present");
  // The narrowing is the reason the suites use `assert` over a bare `if`.
  assert(value.length === 7, "the narrowed value is readable");
  assert(
    messageOf(() => assert(0, "zero is falsy")) === "zero is falsy",
    "the caller's message is the failure",
  );
});

Deno.test("[GAP-014] assertEquals compares rendered JSON text, not structure", () => {
  // Three behaviours the migrated call sites depend on. A structural
  // comparison would reject the first two, which pass today.
  assertEquals({ amount: undefined, id: "a" }, { id: "a" });
  assertEquals(
    new Date("2026-08-23T10:00:00.000Z"),
    "2026-08-23T10:00:00.000Z",
  );
  assert(
    messageOf(() => assertEquals({ left: 1, right: 2 }, { right: 2, left: 1 }))
      .length > 0,
    "key order is significant because the comparison is textual",
  );
});

Deno.test("[GAP-014] assertEquals names both values and keeps the caller's message", () => {
  assertEquals(
    messageOf(() => assertEquals(1, 2)),
    "Expected 2, received 1",
  );
  assertEquals(
    messageOf(() => assertEquals(1, 2, "counted twice")),
    "counted twice: Expected 2, received 1",
  );
  // A value JSON cannot render still produces a readable comparison.
  assertEquals(
    messageOf(() => assertEquals(undefined, 1)),
    "Expected 1, received undefined",
  );
});

Deno.test("[GAP-014] assertThrows returns the error and fails on a quiet call", () => {
  const thrown = assertThrows(() => {
    throw new Error("refused");
  }, "the call must throw");
  assert(thrown instanceof Error, "the caught error is returned");
  assertEquals(thrown.message, "refused");
  assertEquals(
    messageOf(() => assertThrows(() => undefined, "this call must throw")),
    "this call must throw",
  );
});

Deno.test("[GAP-014] assertRejects returns the error and fails on a resolved call", async () => {
  const thrown = await assertRejects(() => {
    throw new Error("synchronous refusal");
  }, "a throwing call rejects");
  assert(thrown instanceof Error, "the caught error is returned");
  assertEquals(thrown.message, "synchronous refusal");

  const rejected = await assertRejects(
    () => Promise.reject(new Error("asynchronous refusal")),
    "a rejecting promise rejects",
  );
  assert(rejected instanceof Error, "an awaited rejection is returned too");

  let reported = "";
  try {
    await assertRejects(() => Promise.resolve("ok"), "this call must reject");
  } catch (error) {
    reported = error instanceof Error ? error.message : String(error);
  }
  assertEquals(reported, "this call must reject");
});

Deno.test("[GAP-014] assertStatus names the status that arrived", () => {
  assertStatus(new Response(null, { status: 204 }), 204);
  assertEquals(
    messageOf(() => assertStatus({ status: 500 }, 200)),
    "expected status 200, received 500",
  );
  assertEquals(
    messageOf(() => assertStatus({ status: 500 }, 200, "the route answers")),
    "the route answers: expected status 200, received 500",
  );
});
