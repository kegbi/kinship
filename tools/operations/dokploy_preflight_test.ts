import {
  deploymentMayProceed,
  withTrustedProxyCheck,
} from "./dokploy_preflight.ts";
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

Deno.test("[AUD-G4] the Dokploy preflight trusts exactly one configured proxy address", () => {
  const ready: PrivateProductionPreflightResult = {
    checks: ["application"],
    environment: "private-production",
    event: "operator.configuration_preflight",
    issues: [],
    state: "ready",
  };
  const env = (proxy: string | undefined) => ({
    get: (name: string) =>
      name === "GATEWAY_TRUSTED_PROXY"
        ? proxy
        : name === "KINSHIP_ALLOW_NO_BACKUP" ||
            name === "PRIVATE_PRODUCTION_SECRET_STORE_READY"
        ? "true"
        : undefined,
  });
  for (const accepted of ["10.0.1.40", "172.18.0.2", "fd00::1a"]) {
    const result = withTrustedProxyCheck(ready, env(accepted));
    if (
      result.state !== "ready" ||
      !result.checks.includes("gateway-trusted-proxy")
    ) {
      throw new Error(`${accepted} is one exact proxy address`);
    }
  }
  for (
    const refused of [
      undefined,
      "",
      " 10.0.1.40",
      "10.0.1.40/32",
      "10.0.0.0/8",
      "0.0.0.0/0",
      "0.0.0.0",
      "::",
      "::/0",
      "*",
      "all",
      "unix:",
      "traefik",
      "10.0.1.040",
      "10.0.1.256",
      "10.0.1.40 10.0.1.41",
      "10.0.1.40,10.0.1.41",
      "10.0.1.40;\nreal_ip_header X-Real-IP",
      "FD00::1A",
      "fd00::1::2",
      "[fd00::1a]",
    ]
  ) {
    const result = withTrustedProxyCheck(ready, env(refused));
    if (
      result.state !== "blocked" ||
      result.issues.map((issue) => issue.code).join() !==
        "gateway-trusted-proxy" ||
      JSON.stringify(result).includes("X-Real-IP")
    ) {
      throw new Error(`${JSON.stringify(refused)} must block the deployment`);
    }
    const waived = withTrustedProxyCheck(
      { ...ready, issues: [{ code: "archive-encryption", action: "" }] },
      env(refused),
    );
    if (deploymentMayProceed(waived, env(refused))) {
      throw new Error("the backup waiver never covers the trusted proxy");
    }
  }
});
