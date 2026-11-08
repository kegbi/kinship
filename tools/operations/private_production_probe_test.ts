import {
  loadPrivateProductionProfile,
  type PrivateProductionProfile,
  runReadinessProbe,
} from "./private_production_probe.ts";

const PROFILE_PATH = "docs/planning/private-production-profile.json";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",");
    return `{${entries}}`;
  }
  return JSON.stringify(value);
}

function assertEquals(actual: unknown, expected: unknown): void {
  if (canonical(actual) !== canonical(expected)) {
    throw new Error(
      `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

async function loadProfile(): Promise<PrivateProductionProfile> {
  return await loadPrivateProductionProfile(PROFILE_PATH);
}

Deno.test("OPS-001B fixes proportionate private-production objectives", async () => {
  const profile = await loadProfile();

  assertEquals(profile.environment, "private-production");
  assertEquals(profile.capacity, {
    burstUsers: 3,
    steadyUsers: 1,
    workspaces: 1,
  });
  assertEquals(profile.serviceObjectives.availability, {
    allowedDowntimeMinutes: 432,
    rollingDays: 30,
    targetPercent: 99,
  });
  assertEquals(profile.serviceObjectives.p95LatencyMs, {
    boundedImportExportCompletion: 10_000,
    interactivePage: 2_000,
    ordinaryApiMutation: 1_000,
    ordinaryApiRead: 500,
    representativeQuery: 250,
    workerDueToDelivery: 10_000,
  });
  assertEquals(profile.observability.readinessProbe, {
    consecutiveFailuresToAlert: 3,
    intervalMs: 60_000,
    path: "/gateway-health",
    timeoutMs: 3_000,
  });
  assertEquals(profile.observability.telemetry, {
    localStructuredLogs: true,
    retentionDays: 30,
    thirdPartyExport: false,
  });
  assert(
    profile.observability.gatewayRequestFields.includes("duration_seconds") &&
      profile.observability.gatewayRequestFields.includes("route") &&
      profile.observability.gatewayRequestFields.includes("status"),
    "gateway logs must measure normalized request latency and outcome",
  );

  const gateway = await Deno.readTextFile(
    profile.observability.gatewayConfigPath,
  );
  const gatewayFieldMarkers: Readonly<Record<string, string>> = {
    bytes_sent: '"bytes_sent":$body_bytes_sent',
    duration_seconds: '"duration_seconds":$request_time',
    event: '"event":"gateway.request"',
    method: '"method":"$request_method"',
    route: '"route":"$kinship_route_template"',
    status: '"status":$status',
  };
  for (const field of profile.observability.gatewayRequestFields) {
    assert(
      gateway.includes(gatewayFieldMarkers[field] ?? "missing-marker"),
      `gateway structured request log is missing ${field}`,
    );
  }
  // ADR 0007: the gateway's readiness follows the API alone.
  assert(
    gateway.includes('"event":"gateway.readiness"') &&
      gateway.includes('"boundary":"api"') &&
      !gateway.includes('"boundary":"web"'),
    "operator probe must use the existing API readiness boundary",
  );

  const mvp = JSON.parse(
    await Deno.readTextFile(profile.sourceCapacityProfile),
  ) as {
    readonly concurrency: PrivateProductionProfile["capacity"];
    readonly functionalCeilingsMs: Readonly<Record<string, number>>;
  };
  assertEquals(profile.capacity, mvp.concurrency);
  for (
    const [operation, objective] of Object.entries(
      profile.serviceObjectives.p95LatencyMs,
    )
  ) {
    assert(
      objective <= (mvp.functionalCeilingsMs[operation] ?? -1),
      `${operation} production objective must not loosen PERF-001`,
    );
  }
});

Deno.test("OPS-001B readiness probe succeeds on one valid healthy response", async () => {
  const profile = await loadProfile();
  let calls = 0;
  const result = await runReadinessProbe(profile, "https://crm.example", {
    fetcher: (input, init) => {
      calls += 1;
      assertEquals(String(input), "https://crm.example/gateway-health");
      assertEquals(init?.redirect, "error");
      return Promise.resolve(Response.json({
        readiness: "ready",
        status: "healthy",
      }));
    },
    now: (() => {
      const values = [100, 124];
      return () => values.shift() ?? 124;
    })(),
    sleep: () => Promise.reject(new Error("healthy probe must not wait")),
  });

  assertEquals(calls, 1);
  assertEquals(result, {
    attempts: 1,
    consecutiveFailures: 0,
    durationMs: 24,
    environment: "private-production",
    event: "operator.readiness_probe",
    state: "ready",
    status: 200,
  });
});

Deno.test("OPS-001B malformed healthy HTTP response preserves its status", async () => {
  const profile = await loadProfile();
  const result = await runReadinessProbe(
    {
      ...profile,
      observability: {
        ...profile.observability,
        readinessProbe: {
          ...profile.observability.readinessProbe,
          consecutiveFailuresToAlert: 1,
        },
      },
    },
    "https://crm.example",
    {
      fetcher: () =>
        Promise.resolve(
          new Response("{not-json", {
            headers: { "content-type": "application/json" },
            status: 200,
          }),
        ),
      now: () => 10,
    },
  );

  assertEquals(result.state, "unavailable");
  assertEquals(result.status, 200);
});

Deno.test("OPS-001B redirect response cannot satisfy readiness", async () => {
  const profile = await loadProfile();
  const result = await runReadinessProbe(
    {
      ...profile,
      observability: {
        ...profile.observability,
        readinessProbe: {
          ...profile.observability.readinessProbe,
          consecutiveFailuresToAlert: 1,
        },
      },
    },
    "https://crm.example",
    {
      fetcher: (_input, init) => {
        assertEquals(init?.redirect, "error");
        return Promise.reject(new TypeError("redirect mode is error"));
      },
      now: () => 10,
    },
  );

  assertEquals(result.state, "unavailable");
  assertEquals(result.status, 0);
  assertEquals(result.consecutiveFailures, 1);
});

Deno.test("OPS-001B readiness alert requires three consecutive minute failures", async () => {
  const profile = await loadProfile();
  const responses: Array<Response | Error> = [
    new Error("network unavailable"),
    Response.json({ status: "healthy", readiness: "starting" }),
    new Response("unavailable", { status: 503 }),
  ];
  const waits: number[] = [];

  const result = await runReadinessProbe(profile, "https://crm.example", {
    fetcher: () => {
      const response = responses.shift()!;
      return response instanceof Error
        ? Promise.reject(response)
        : Promise.resolve(response);
    },
    now: () => 10,
    sleep: (milliseconds) => {
      waits.push(milliseconds);
      return Promise.resolve();
    },
  });

  assertEquals(waits, [60_000, 60_000]);
  assertEquals(result, {
    attempts: 3,
    consecutiveFailures: 3,
    durationMs: 0,
    environment: "private-production",
    event: "operator.readiness_probe",
    state: "unavailable",
    status: 503,
  });
});

Deno.test("OPS-001B readiness probe does not alert after recovery", async () => {
  const profile = await loadProfile();
  const responses = [
    new Response("unavailable", { status: 503 }),
    Response.json({ status: "healthy", readiness: "ready" }),
  ];

  const result = await runReadinessProbe(profile, "https://crm.example", {
    fetcher: () => Promise.resolve(responses.shift()!),
    now: () => 10,
    sleep: () => Promise.resolve(),
  });

  assertEquals(result.state, "ready");
  assertEquals(result.attempts, 2);
  assertEquals(result.consecutiveFailures, 0);
});

Deno.test("OPS-001B production probe rejects unsafe origins and invalid policy", async () => {
  const profile = await loadProfile();
  let unsafeOrigin: unknown;
  try {
    await runReadinessProbe(profile, "http://crm.example");
  } catch (error) {
    unsafeOrigin = error;
  }
  assert(
    unsafeOrigin instanceof Error && unsafeOrigin.message.includes("HTTPS"),
    "private-production probe must reject plaintext origins",
  );

  let credentialedOrigin: unknown;
  try {
    await runReadinessProbe(profile, "https://operator:secret@crm.example");
  } catch (error) {
    credentialedOrigin = error;
  }
  assert(
    credentialedOrigin instanceof Error &&
      !credentialedOrigin.message.includes("secret"),
    "probe rejects credentials without reflecting them",
  );

  let invalidPolicy: unknown;
  try {
    await runReadinessProbe({
      ...profile,
      observability: {
        ...profile.observability,
        readinessProbe: {
          ...profile.observability.readinessProbe,
          consecutiveFailuresToAlert: 0,
        },
      },
    }, "https://crm.example");
  } catch (error) {
    invalidPolicy = error;
  }
  assert(
    invalidPolicy instanceof Error && invalidPolicy.message.includes("profile"),
    "invalid alert policy must fail before a request",
  );
});

Deno.test("OPS-001B default clock and bounded wait recover without alerting", async () => {
  const profile = await loadProfile();
  const responses = [
    new Response("unavailable", { status: 503 }),
    Response.json({ status: "healthy", readiness: "ready" }),
  ];
  const result = await runReadinessProbe(
    {
      ...profile,
      observability: {
        ...profile.observability,
        readinessProbe: {
          ...profile.observability.readinessProbe,
          intervalMs: 0,
        },
      },
    },
    "https://crm.example",
    {
      fetcher: () => Promise.resolve(responses.shift()!),
    },
  );

  assertEquals(result.state, "ready");
  assert(result.durationMs >= 0, "default monotonic clock records duration");
});
