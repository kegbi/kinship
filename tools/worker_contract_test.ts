Deno.test("APP-006B worker entry point is part of mandatory check and build gates", async () => {
  const config = JSON.parse(await Deno.readTextFile("deno.json")) as {
    readonly tasks?: Readonly<Record<string, string>>;
  };
  const check = config.tasks?.["check:api"] ?? "";
  const build = config.tasks?.["build:api"] ?? "";
  if (!check.includes("apps/worker/main.ts")) {
    throw new Error("check:api does not compile apps/worker/main.ts");
  }
  if (!build.includes("apps/worker/main.ts")) {
    throw new Error("build:api does not compile apps/worker/main.ts");
  }
});
