import {
  chooseE2eGatewayPort,
  createE2eTls,
  E2E_COMPOSE_ARGS,
  e2eEnvironment,
  removeE2eTls,
  tearDownE2eComposeProject,
} from "./e2e.ts";

/** A request identifier a client chose; the gateway must not forward it. */
const CLIENT_REQUEST_ID = "client-chosen-request-id";

/** What the gateway's own `$request_id` looks like: 32 lower-case hex digits. */
const GATEWAY_REQUEST_ID = /"request_id":"[0-9a-f]{32}"/;

const NGINX_IMAGE =
  "nginx:1.29.1-alpine3.22@sha256:42a516af16b852e33b7682d5ef8acbd5d13fe08fecadc7ed98605ba5e3b26ab8";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function docker(
  args: readonly string[],
  allowFailure = false,
  environment: Readonly<Record<string, string>> = {},
): Promise<string> {
  const output = await new Deno.Command("docker", {
    args: [...args],
    cwd: new URL("../", import.meta.url),
    env: { ...environment },
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();
  const stdout = new TextDecoder().decode(output.stdout).trim();
  const stderr = new TextDecoder().decode(output.stderr).trim();
  if (!output.success && !allowFailure) {
    throw new Error(
      `docker ${args.join(" ")} exited ${output.code}: ${stderr}`,
    );
  }
  return [stdout, stderr].filter(Boolean).join("\n");
}

async function waitForContainerHealth(
  container: string,
  expected: "healthy" | "unhealthy",
): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const status = await docker([
      "inspect",
      "--format",
      "{{.State.Health.Status}}",
      container,
    ]);
    if (status === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${container} did not become ${expected}.`);
}

async function requestHealthFromGateway(
  gatewayContainer: string,
  query = "",
): Promise<void> {
  await docker([
    "exec",
    gatewayContainer,
    "wget",
    "-q",
    "-O",
    "/dev/null",
    "--header",
    "Authorization: Bearer readiness-authorization-secret",
    "--header",
    "Cookie: kinship_session=readiness-cookie-secret",
    `http://127.0.0.1:8080/gateway-health${query}`,
  ], true);
}

async function waitForContainerLog(
  container: string,
  pattern: RegExp,
): Promise<string> {
  const deadline = Date.now() + 15_000;
  let logs = "";
  while (Date.now() < deadline) {
    logs = await docker(["logs", container]);
    if (pattern.test(logs)) return logs;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Expected container log line ${pattern} was absent: ${logs}`);
}

/**
 * Asks the API for its health through the gateway, the way a browser would,
 * with a client-chosen `X-Request-Id`, and returns the identifier the answer
 * echoed. `wget -S` prints the response headers on stderr.
 */
async function requestApiThroughGateway(
  gatewayContainer: string,
): Promise<string> {
  const response = await docker([
    "exec",
    gatewayContainer,
    "wget",
    "-S",
    "-q",
    "-O",
    "/dev/null",
    "--header",
    `X-Request-Id: ${CLIENT_REQUEST_ID}`,
    "http://127.0.0.1:8080/api/v1/health",
  ], true);
  const echoed = /x-request-id:\s*(\S+)/i.exec(response)?.[1];
  assert(echoed, `the API answer echoed no request identifier: ${response}`);
  return echoed;
}

async function waitForGateway(origin: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      await fetch(origin);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("Gateway log fixture did not become reachable.");
}

async function requestForLog(
  url: string,
  headers?: HeadersInit,
): Promise<void> {
  try {
    await fetch(url, {
      ...(headers ? { headers } : {}),
      signal: AbortSignal.timeout(3_000),
    });
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "TimeoutError")) {
      throw error;
    }
  }
}

Deno.test({
  name:
    "real Nginx exposes browser protections and logs only safe operational fields",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const run = Date.now();
    const project = `kinship-e2e-${Deno.pid}-${run}`;
    const container = `kinship-gateway-log-${Deno.pid}-${run}`;
    const tls = await createE2eTls(project);
    const config = await Deno.realPath("gateway/nginx.conf");
    const securityHeaders = await Deno.realPath(
      "gateway/security_headers.conf",
    );
    let started = false;
    const errors: unknown[] = [];
    try {
      await docker([
        "run",
        "--detach",
        "--name",
        container,
        "--user",
        "nginx",
        "--publish",
        "127.0.0.1::8080",
        "--mount",
        `type=bind,source=${config},target=/etc/nginx/nginx.conf,readonly`,
        "--mount",
        `type=bind,source=${securityHeaders},target=/etc/nginx/security_headers.conf,readonly`,
        "--mount",
        `type=bind,source=${tls.certificate},target=/run/secrets/gateway_tls_certificate,readonly`,
        "--mount",
        `type=bind,source=${tls.privateKey},target=/run/secrets/gateway_tls_private_key,readonly`,
        NGINX_IMAGE,
      ]);
      started = true;
      const mapping = await docker(["port", container, "8080/tcp"]);
      const port = mapping.match(/:(\d+)$/)?.[1];
      assert(port, "Docker-assigned gateway log port is discoverable.");
      const origin = `http://127.0.0.1:${port}`;
      await waitForGateway(origin);
      const browserBoundary = await fetch(origin);
      const expectedHeaders = {
        "content-security-policy":
          "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'",
        "permissions-policy": "camera=(), geolocation=(), microphone=()",
        "referrer-policy": "no-referrer",
        "strict-transport-security": "max-age=31536000",
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
      } as const;
      for (const [name, expected] of Object.entries(expectedHeaders)) {
        assert(
          browserBoundary.headers.get(name) === expected,
          `${name} must protect every public gateway response`,
        );
      }

      const resetSecret = "reset-query-secret-7ccd";
      const verificationSecret = "verify-query-secret-61da";
      const invitationSecret = "invite-path-secret-2f90";
      const apiSecret = "api-query-secret-a54e";
      const authorizationSecret = "authorization-secret-d811";
      const cookieSecret = "cookie-secret-35f4";
      await Promise.all([
        requestForLog(`${origin}/auth/reset-password?token=${resetSecret}`),
        requestForLog(
          `${origin}/auth/verify-email?token=${verificationSecret}`,
        ),
        requestForLog(
          `${origin}/invite/${invitationSecret}?source=private-query-value`,
        ),
        requestForLog(`${origin}/api/v1/sessions?token=${apiSecret}`, {
          authorization: `Bearer ${authorizationSecret}`,
          cookie: `kinship_session=${cookieSecret}`,
        }),
      ]);

      let logs = "";
      const logDeadline = Date.now() + 5_000;
      while (Date.now() < logDeadline) {
        logs = await docker(["logs", container]);
        if (logs.includes("/invite/:token")) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      for (
        const secret of [
          resetSecret,
          verificationSecret,
          invitationSecret,
          apiSecret,
          authorizationSecret,
          cookieSecret,
          "private-query-value",
        ]
      ) {
        assert(!logs.includes(secret), `gateway logs exposed ${secret}`);
      }
      assert(
        logs.includes('"event":"gateway.request"') &&
          logs.includes('"route":"/auth/reset-password"') &&
          logs.includes('"route":"/auth/verify-email"') &&
          logs.includes('"route":"/invite/:token"') &&
          logs.includes('"route":"/api/v1/*"') &&
          logs.includes('"status":') && logs.includes('"duration_seconds":'),
        `gateway logs must retain allowlisted structured operations: ${logs}`,
      );
      const requestLines = logs.split("\n").filter((line) =>
        line.includes('"event":"gateway.request"')
      );
      assert(
        requestLines.length > 0 &&
          requestLines.every((line) => GATEWAY_REQUEST_ID.test(line)),
        `every gateway.request line carries the gateway's request identifier: ${logs}`,
      );
    } catch (error) {
      errors.push(error);
    } finally {
      if (started) {
        try {
          await docker(["rm", "--force", container]);
        } catch (error) {
          errors.push(error);
        }
      }
      try {
        const remaining = await docker([
          "ps",
          "--all",
          "--quiet",
          "--filter",
          `name=^/${container}$`,
        ]);
        assert(!remaining, "gateway log fixture container leaked");
      } catch (error) {
        errors.push(error);
      }
      try {
        await removeE2eTls(tls);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, "Gateway log test cleanup failed.");
    }
  },
});

Deno.test({
  name:
    "pinned Compose gateway identifies API and renderer readiness outages without secrets",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const run = Date.now();
    const project = `kinship-e2e-${Deno.pid}-${run}`;
    const tls = await createE2eTls(project);
    const environment = {
      ...e2eEnvironment(project, chooseE2eGatewayPort()),
      GATEWAY_TLS_CERTIFICATE_PATH: tls.certificate,
      GATEWAY_TLS_PRIVATE_KEY_PATH: tls.privateKey,
    };
    const errors: unknown[] = [];
    try {
      await docker(
        [
          ...E2E_COMPOSE_ARGS,
          "up",
          "--build",
          "--detach",
          "--wait",
          "--wait-timeout",
          "120",
        ],
        false,
        environment,
      );
      const gatewayContainer = await docker(
        [
          ...E2E_COMPOSE_ARGS,
          "ps",
          "--quiet",
          "gateway",
        ],
        false,
        environment,
      );
      const apiContainer = await docker(
        [
          ...E2E_COMPOSE_ARGS,
          "ps",
          "--quiet",
          "api",
        ],
        false,
        environment,
      );
      const webContainer = await docker(
        [
          ...E2E_COMPOSE_ARGS,
          "ps",
          "--quiet",
          "web",
        ],
        false,
        environment,
      );
      assert(
        gatewayContainer && apiContainer && webContainer,
        "Compose readiness fixture created all required services",
      );

      // GAP-039: the gateway replaces a client's identifier with its own,
      // forwards it, and the API logs and echoes that same identifier.
      const forwarded = await requestApiThroughGateway(gatewayContainer);
      assert(
        /^[0-9a-f]{32}$/.test(forwarded) && forwarded !== CLIENT_REQUEST_ID,
        `the gateway forwarded its own identifier, not the client's: ${forwarded}`,
      );
      const gatewayLogs = await waitForContainerLog(
        gatewayContainer,
        new RegExp(
          `"event":"gateway\\.request".*"route":"/api/v1/\\*".*"request_id":"${forwarded}"`,
        ),
      );
      const apiLogs = await waitForContainerLog(
        apiContainer,
        new RegExp(
          `"event":"api\\.request".*"route":"/api/v1/health".*"request_id":"${forwarded}"`,
        ),
      );
      assert(
        !gatewayLogs.includes(CLIENT_REQUEST_ID) &&
          !apiLogs.includes(CLIENT_REQUEST_ID),
        "a client-chosen request identifier never reaches a log line",
      );

      await docker(
        [
          ...E2E_COMPOSE_ARGS,
          "stop",
          "--timeout",
          "5",
          "api",
        ],
        false,
        environment,
      );
      await requestHealthFromGateway(
        gatewayContainer,
        "?token=readiness-query-secret",
      );
      let logs = await waitForContainerLog(
        gatewayContainer,
        /"event":"gateway\.readiness","boundary":"api","state":"unavailable","status":503/,
      );
      assert(
        logs.includes('"boundary":"web","state":"ready"'),
        "API outage retains a successful renderer boundary diagnostic",
      );

      await docker(
        [
          ...E2E_COMPOSE_ARGS,
          "start",
          "api",
        ],
        false,
        environment,
      );
      await waitForContainerHealth(apiContainer, "healthy");
      await requestHealthFromGateway(gatewayContainer);
      await waitForContainerLog(
        gatewayContainer,
        /"boundary":"api","state":"ready","status":200/,
      );

      await docker(
        [
          ...E2E_COMPOSE_ARGS,
          "stop",
          "--timeout",
          "5",
          "web",
        ],
        false,
        environment,
      );
      await requestHealthFromGateway(gatewayContainer);
      logs = await waitForContainerLog(
        gatewayContainer,
        /"event":"gateway\.readiness","boundary":"web","state":"unavailable","status":5\d\d/,
      );
      for (
        const secret of [
          "readiness-query-secret",
          "readiness-authorization-secret",
          "readiness-cookie-secret",
        ]
      ) {
        assert(!logs.includes(secret), `readiness logs exposed ${secret}`);
      }
    } catch (error) {
      errors.push(error);
    } finally {
      try {
        // Down, prove the project absent, and remove the images `up --build`
        // made for this run, so no fixture run leaves them behind (REL-043).
        await tearDownE2eComposeProject(
          project,
          (args) => docker(args, false, environment),
        );
      } catch (error) {
        errors.push(error);
      }
      try {
        await removeE2eTls(tls);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(
        errors,
        "Gateway readiness log fixture and cleanup failed.",
      );
    }
  },
});
