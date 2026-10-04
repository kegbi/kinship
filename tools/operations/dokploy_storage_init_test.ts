import {
  initializeStorage,
  type StorageCommand,
} from "./dokploy_storage_init.ts";

Deno.test("OPS-001E initialization scopes app policy and never places secrets in argv", async () => {
  const calls: StorageCommand[] = [];
  const environment = {
    OBJECT_STORAGE_BUCKET: "kinship-files",
    OBJECT_STORAGE_ACCESS_KEY: "app-key",
    OBJECT_STORAGE_SECRET_KEY: "app-secret",
    RUSTFS_ADMIN_ACCESS_KEY: "root-key",
    RUSTFS_ADMIN_SECRET_KEY: "root-secret",
  };
  let policy = "";
  await initializeStorage(environment, (call) => {
    calls.push(call);
    return Promise.resolve();
  }, (value) => {
    policy = value;
    return Promise.resolve();
  });
  const serializedArgs = JSON.stringify(calls.map((call) => call.args));
  if (
    serializedArgs.includes("app-secret") ||
    serializedArgs.includes("root-secret")
  ) throw new Error("secret in argv");
  const user = calls.find((call) => call.args.includes("add"));
  if (user?.input !== "app-key\napp-secret\n") {
    throw new Error("credentials must pass through stdin");
  }
  const parsed = JSON.parse(policy);
  if (
    parsed.Statement.some((s: { Action: string[] }) =>
      s.Action.some((a) => a.startsWith("admin:") || a === "s3:*")
    )
  ) throw new Error("application policy is overprivileged");
  if (
    parsed.Statement.some((s: { Resource: string[] }) =>
      s.Resource.some((r) => !r.startsWith("arn:aws:s3:::kinship-files"))
    )
  ) throw new Error("policy escapes bucket");
});

Deno.test("OPS-001E initialization rejects shared root identity before mutations", async () => {
  let called = false;
  try {
    await initializeStorage({
      OBJECT_STORAGE_BUCKET: "kinship-files",
      OBJECT_STORAGE_ACCESS_KEY: "same",
      OBJECT_STORAGE_SECRET_KEY: "secret",
      RUSTFS_ADMIN_ACCESS_KEY: "same",
      RUSTFS_ADMIN_SECRET_KEY: "secret",
    }, () => {
      called = true;
      return Promise.resolve();
    }, () => Promise.resolve());
    throw new Error("expected rejection");
  } catch (error) {
    if (
      called || !(error instanceof Error) ||
      error.message !== "Invalid storage initialization configuration"
    ) throw error;
  }
});
