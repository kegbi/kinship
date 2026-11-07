import {
  type PrivateProductionPreflightResult,
  runPrivateProductionPreflight,
} from "./private_production_preflight.ts";
import { loadPrivateProductionProfile } from "./private_production_probe.ts";

interface EnvironmentReader {
  get(name: string): string | undefined;
}

const IPV4 =
  /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/**
 * AUD-G4 (SECA-06): the gateway trusts `X-Forwarded-For` only from the one
 * address in `GATEWAY_TRUSTED_PROXY`, which the nginx entrypoint substitutes
 * into `set_real_ip_from`. Only a single canonical IPv4 or IPv6 literal
 * passes: no prefix length, hostname, list, `unix:`, unspecified address, or
 * whitespace, so neither a broad network nor a smuggled directive is trusted.
 */
export function isExactProxyAddress(value: string | undefined): boolean {
  if (!value) return false;
  if (IPV4.test(value)) return value !== "0.0.0.0";
  if (!/^[0-9a-f:.]+$/.test(value) || !value.includes(":")) return false;
  try {
    const hostname = new URL(`http://[${value}]/`).hostname;
    return hostname === `[${value}]` && hostname !== "[::]";
  } catch {
    return false;
  }
}

export function withTrustedProxyCheck(
  result: PrivateProductionPreflightResult,
  environment: EnvironmentReader,
): PrivateProductionPreflightResult {
  const issues = isExactProxyAddress(environment.get("GATEWAY_TRUSTED_PROXY"))
    ? result.issues
    : [...result.issues, {
      code: "gateway-trusted-proxy",
      action:
        "Set GATEWAY_TRUSTED_PROXY to the one exact IPv4 or IPv6 address of the Dokploy edge proxy, with no prefix length, hostname, or list.",
    }];
  return {
    ...result,
    checks: [...result.checks, "gateway-trusted-proxy"],
    issues,
    state: issues.length === 0 ? "ready" : "blocked",
  };
}

export function deploymentMayProceed(
  result: PrivateProductionPreflightResult,
  environment: { get(name: string): string | undefined },
): boolean {
  return result.state === "ready" || (
    environment.get("KINSHIP_ALLOW_NO_BACKUP") === "true" &&
    environment.get("PRIVATE_PRODUCTION_SECRET_STORE_READY") === "true" &&
    result.issues.length === 1 &&
    result.issues[0]?.code === "archive-encryption"
  );
}

if (import.meta.main) {
  const result = withTrustedProxyCheck(
    runPrivateProductionPreflight(
      await loadPrivateProductionProfile(),
      Deno.env,
    ),
    Deno.env,
  );
  console.log(JSON.stringify(result));
  const allowed = deploymentMayProceed(result, Deno.env);
  if (allowed && result.state === "blocked") {
    console.log(
      JSON.stringify({
        event: "operator.backup_waiver",
        state: "temporary-no-backup",
        productionAccepted: false,
      }),
    );
  }
  Deno.exit(allowed ? 0 : 2);
}
