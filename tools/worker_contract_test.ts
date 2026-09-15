import { buildTargets, checkTargets } from "./tasks/run.ts";

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
