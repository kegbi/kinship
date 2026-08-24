import { isHealthResponse } from "../../packages/contracts/health.ts";

const DEFAULT_PROFILE_PATH = "docs/planning/private-production-profile.json";

export interface PrivateProductionProfile {
  readonly version: number;
  readonly environment: "private-production";
  readonly sourceCapacityProfile: string;
  readonly capacity: {
    readonly burstUsers: number;
    readonly steadyUsers: number;
    readonly workspaces: number;
  };
  readonly serviceObjectives: {
    readonly availability: {
      readonly allowedDowntimeMinutes: number;
      readonly rollingDays: number;
      readonly targetPercent: number;
    };
    readonly p95LatencyMs: {
      readonly boundedImportExportCompletion: number;
      readonly interactivePage: number;
      readonly ordinaryApiMutation: number;
      readonly ordinaryApiRead: number;
      readonly representativeQuery: number;
      readonly workerDueToDelivery: number;
    };
  };
  readonly recovery: {
    readonly archiveRoot: ".artifacts/private-production-recovery";
    readonly backupSchedule: "daily";
    readonly backupCommand: string;
    readonly manifestVersion: 1;
    readonly migrationVerificationTask: "deno task test:schema:matrix";
    readonly prerequisites: readonly string[];
    readonly promotionRule: string;
    readonly retentionDays: number;
    readonly restoreCommand: string;
    readonly rpoHours: number;
    readonly rtoMinutes: number;
    readonly schemaVersion: 7;
  };
  readonly observability: {
    readonly forbiddenLogData: readonly string[];
    readonly gatewayConfigPath: string;
    readonly gatewayRequestFields: readonly string[];
    readonly readinessProbe: {
      readonly consecutiveFailuresToAlert: number;
      readonly intervalMs: number;
      readonly path: string;
      readonly timeoutMs: number;
    };
    readonly telemetry: {
      readonly localStructuredLogs: boolean;
      readonly retentionDays: number;
      readonly thirdPartyExport: boolean;
    };
  };
}

export interface ReadinessProbeResult {
  readonly attempts: number;
  readonly consecutiveFailures: number;
  readonly durationMs: number;
  readonly environment: "private-production";
  readonly event: "operator.readiness_probe";
  readonly state: "ready" | "unavailable";
  readonly status: number;
}

interface ProbeDependencies {
  readonly fetcher: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>;
  readonly now: () => number;
  readonly sleep: (milliseconds: number) => Promise<void>;
}

const DEFAULT_DEPENDENCIES: ProbeDependencies = {
  fetcher: fetch,
  now: () => performance.now(),
  sleep: (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

function assertProbeProfile(
  profile: PrivateProductionProfile,
): void {
  const probe = profile.observability.readinessProbe;
  if (
    profile.environment !== "private-production" ||
    profile.recovery.archiveRoot !==
      ".artifacts/private-production-recovery" ||
    profile.recovery.backupSchedule !== "daily" ||
    !profile.recovery.backupCommand ||
    profile.recovery.manifestVersion !== 1 ||
    profile.recovery.migrationVerificationTask !==
      "deno task test:schema:matrix" ||
    profile.recovery.prerequisites.length < 3 ||
    !profile.recovery.promotionRule ||
    profile.recovery.retentionDays < 1 ||
    !profile.recovery.restoreCommand ||
    profile.recovery.rpoHours < 1 ||
    profile.recovery.rtoMinutes < 1 ||
    profile.recovery.schemaVersion !== 7 ||
    probe.path !== "/gateway-health" ||
    probe.consecutiveFailuresToAlert < 1 ||
    probe.intervalMs < 0 ||
    probe.timeoutMs < 1
  ) {
    throw new Error("Invalid private-production readiness profile.");
  }
}

function readinessUrl(origin: string, path: string): URL {
  const parsed = new URL(origin);
  if (
    parsed.protocol !== "https:" || parsed.pathname !== "/" ||
    parsed.username || parsed.password || parsed.search || parsed.hash
  ) {
    throw new Error("The private-production origin must be an HTTPS origin.");
  }
  return new URL(path, parsed);
}

export async function loadPrivateProductionProfile(
  path = DEFAULT_PROFILE_PATH,
): Promise<PrivateProductionProfile> {
  const profile = JSON.parse(
    await Deno.readTextFile(path),
  ) as PrivateProductionProfile;
  assertProbeProfile(profile);
  return profile;
}

export async function runReadinessProbe(
  profile: PrivateProductionProfile,
  origin: string,
  dependencyOverrides: Partial<ProbeDependencies> = {},
): Promise<ReadinessProbeResult> {
  assertProbeProfile(profile);
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencyOverrides };
  const probe = profile.observability.readinessProbe;
  const url = readinessUrl(origin, probe.path);
  let status = 0;
  let durationMs = 0;

  for (
    let attempts = 1;
    attempts <= probe.consecutiveFailuresToAlert;
    attempts++
  ) {
    const startedAt = dependencies.now();
    let ready = false;
    let response: Response | undefined;
    try {
      response = await dependencies.fetcher(url, {
        headers: { accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(probe.timeoutMs),
      });
    } catch {
      status = 0;
    }

    if (response) {
      status = response.status;
      const body = response.ok
        ? await response.json().catch(() => undefined)
        : undefined;
      ready = response.ok && isHealthResponse(body);
    }
    durationMs = Math.max(0, Math.round(dependencies.now() - startedAt));

    if (ready) {
      return {
        attempts,
        consecutiveFailures: 0,
        durationMs,
        environment: profile.environment,
        event: "operator.readiness_probe",
        state: "ready",
        status,
      };
    }

    if (attempts < probe.consecutiveFailuresToAlert) {
      await dependencies.sleep(probe.intervalMs);
    }
  }

  return {
    attempts: probe.consecutiveFailuresToAlert,
    consecutiveFailures: probe.consecutiveFailuresToAlert,
    durationMs,
    environment: profile.environment,
    event: "operator.readiness_probe",
    state: "unavailable",
    status,
  };
}

async function main(): Promise<number> {
  const [origin] = Deno.args;
  if (!origin || Deno.args.length !== 1) {
    await Deno.stderr.write(
      new TextEncoder().encode(
        "Usage: deno task ops:probe:private-production https://crm.example\n",
      ),
    );
    return 64;
  }

  const profile = await loadPrivateProductionProfile();
  const result = await runReadinessProbe(profile, origin);
  await Deno.stdout.write(
    new TextEncoder().encode(`${JSON.stringify(result)}\n`),
  );
  return result.state === "ready" ? 0 : 2;
}

if (import.meta.main) Deno.exit(await main());
