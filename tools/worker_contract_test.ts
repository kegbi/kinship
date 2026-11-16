import {
  argumentBatches,
  buildTargets,
  checkTargets,
  COMMAND_LINE_CHARACTERS,
} from "./tasks/run.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("APP-006B worker entry point is part of mandatory check and build gates", async () => {
  assert(
    (await checkTargets()).includes("apps/worker/main.ts"),
    "the check gate does not compile apps/worker/main.ts",
  );
  assert(
    buildTargets().includes("apps/worker/main.ts"),
    "the build gate does not compile apps/worker/main.ts",
  );
});

Deno.test("[REL-105] long file lists run as command lines a Windows shim accepts", async () => {
  const targets = await checkTargets();
  const fixed = ["test", "--allow-read=" + "x".repeat(900)];
  const batches = argumentBatches(fixed, targets);
  assert(batches.length > 1, "the check targets no longer need batching");
  assert(
    batches.flat().join("|") === targets.join("|"),
    "batching drops, repeats, or reorders a file",
  );
  for (const batch of batches) {
    const length = [...fixed, ...batch].join(" ").length;
    assert(
      length <= COMMAND_LINE_CHARACTERS,
      `a command line is ${length} characters long`,
    );
  }
  const long = "x".repeat(COMMAND_LINE_CHARACTERS + 1);
  assert(
    JSON.stringify(argumentBatches([], ["a", long, "b"])) ===
      JSON.stringify([["a"], [long], ["b"]]),
    "a file longer than the budget still gets its own batch",
  );
});
