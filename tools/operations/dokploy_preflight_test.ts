import { deploymentMayProceed } from "./dokploy_preflight.ts";
import type { PrivateProductionPreflightResult } from "./private_production_preflight.ts";

Deno.test("OPS-001E backup waiver permits only the archive issue with a verified secret store", () => {
  const result = (codes: string[]): PrivateProductionPreflightResult => ({
    checks: [],
    environment: "private-production",
    event: "operator.configuration_preflight",
    issues: codes.map((code) => ({ code, action: "correct configuration" })),
    state: codes.length ? "blocked" : "ready",
  });
  const env = (waiver = "true", secretStore = "true") => ({
    get: (name: string) =>
      name === "KINSHIP_ALLOW_NO_BACKUP"
        ? waiver
        : name === "PRIVATE_PRODUCTION_SECRET_STORE_READY"
        ? secretStore
        : undefined,
  });
  for (
    const [codes, environment, expected] of [
      [[], env("false"), true],
      [["archive-encryption"], env(), true],
      [["archive-encryption"], env("false"), false],
      [["archive-encryption"], env("true", "false"), false],
      [["archive-encryption", "smtp-configuration"], env(), false],
      [["smtp-configuration"], env(), false],
    ] as const
  ) {
    if (deploymentMayProceed(result([...codes]), environment) !== expected) {
      throw new Error("waiver must not relax other configuration requirements");
    }
  }
});
