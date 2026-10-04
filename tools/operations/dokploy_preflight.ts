import {
  type PrivateProductionPreflightResult,
  runPrivateProductionPreflight,
} from "./private_production_preflight.ts";
import { loadPrivateProductionProfile } from "./private_production_probe.ts";

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
  const result = runPrivateProductionPreflight(
    await loadPrivateProductionProfile(),
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
