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

/** The one inline script the pages carry: the theme bootstrap (GAP-040). */
const THEME_SCRIPT_HASH =
  "'sha256-JcBF2XCeGM7UUhyx5ih7eaW4njR7Xo8zgcRdSMNXAj4='";

const CONTENT_SECURITY_POLICY =
  `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' ${THEME_SCRIPT_HASH}; connect-src 'self'`;

/** The `script-src` sources of one Content-Security-Policy value. */
function scriptSources(policy: string): string[] {
  return policy.split(";").map((part) => part.trim().split(/\s+/))
    .find(([name]) => name === "script-src")?.slice(1) ?? [];
}

/** The CSP hash source of each executable inline script in a page. */
async function inlineScriptHashes(html: string): Promise<string[]> {
  const hashes: string[] = [];
  for (
    const [, attributes = "", body = ""] of html.matchAll(
      /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
    )
  ) {
    if (/\bsrc\s*=/i.test(attributes)) continue;
    const type = attributes.match(/\btype\s*=\s*["']?([^"'\s>]*)/i)?.[1] ??
      "";
    if (!/^(|module|text\/javascript|application\/javascript)$/i.test(type)) {
      continue;
    }
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(body),
    );
    hashes.push(
      `'sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}'`,
    );
  }
  return hashes;
}

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

/**
 * One request the upstream cannot answer here (the fixture has no API); the
 * answer when the gateway refused it itself with 429, undefined otherwise.
 */
async function rateLimitedAnswer(
  url: string,
): Promise<{ body: string; headers: Headers } | undefined> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
    const body = await response.text();
    return response.status === 429
      ? { body, headers: response.headers }
      : undefined;
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return undefined;
    }
    throw error;
  }
}

/**
 * A page fetched through the gateway from inside its container, the way the
 * browser meets it: the last status and CSP (after redirects) and the body.
 */
async function pageThroughGateway(
  gatewayContainer: string,
  path: string,
): Promise<{ status: number; policy: string | undefined; html: string }> {
  const output = await new Deno.Command("docker", {
    args: [
      "exec",
      gatewayContainer,
      "wget",
      "-S",
      "-q",
      "-O",
      "-",
      `http://127.0.0.1:8080${path}`,
    ],
    cwd: new URL("../", import.meta.url),
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();
  const headers = new TextDecoder().decode(output.stderr);
  const statuses = [...headers.matchAll(/HTTP\/1\.1 (\d{3})/g)];
  const policies = [
    ...headers.matchAll(/content-security-policy:\s*([^\r\n]+)/gi),
  ];
  return {
    status: Number(statuses.at(-1)?.[1] ?? "0"),
    policy: policies.at(-1)?.[1]?.trim(),
    html: new TextDecoder().decode(output.stdout),
  };
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
        "content-security-policy": CONTENT_SECURITY_POLICY,
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
      // GAP-052: a calendar feed's secret is its path, so the path itself
      // must never reach a log line.
      const calendarSecret = "calendar-path-secret-9b3e71c4a0";
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
        requestForLog(
          `${origin}/api/v1/calendar-feeds/kin_cal_00000000-0000-4000-8000-000000000001.${calendarSecret}.ics`,
        ),
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
          calendarSecret,
          "kin_cal_",
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

      // GAP-040: past the credential burst, the gateway itself refuses one
      // client address with the API's RFC 9457 problem shape.
      const refusals = (await Promise.all(
        Array.from(
          { length: 150 },
          () => rateLimitedAnswer(`${origin}/api/v1/password-resets`),
        ),
      )).filter((answer) => answer !== undefined);
      assert(
        refusals.length > 0,
        "a burst of credential requests past the limit is refused",
      );
      for (const { body, headers } of refusals) {
        assert(
          headers.get("content-type") === "application/problem+json" &&
            headers.get("cache-control") === "no-store" &&
            headers.get("retry-after") !== null &&
            headers.get("content-security-policy") ===
              CONTENT_SECURITY_POLICY,
          `the refusal is an uncached problem with the browser policy: ${[
            ...headers,
          ]}`,
        );
        const problem = JSON.parse(body) as Record<string, unknown>;
        assert(
          problem.status === 429 && problem.code === "request_rate_limited" &&
            problem.type ===
              "https://kinship.test/problems/request_rate_limited" &&
            typeof problem.title === "string" &&
            typeof problem.detail === "string",
          `the refusal is the API's problem shape: ${body}`,
        );
      }
      await waitForContainerLog(
        container,
        /"event":"gateway\.request","method":"GET","route":"\/api\/v1\/\*","status":429/,
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

      // GAP-040: every inline script a served page carries, static or
      // rendered on demand, is one the served CSP allows by hash.
      const seen: string[] = [];
      for (
        const path of [
          "/",
          "/auth/sign-in",
          "/app",
          "/app/people/0b8f3c2e-4d5a-4b6c-8d7e-9f0a1b2c3d4e",
          "/auth/mfa",
          "/auth/reset-password",
          "/auth/verify-email",
          "/app/compliance",
          "/invite/unknown-invitation-token",
        ]
      ) {
        const page = await pageThroughGateway(gatewayContainer, path);
        if (page.status !== 200) {
          assert(
            !["/", "/auth/sign-in", "/app", "/auth/mfa", "/app/compliance"]
              .includes(path),
            `${path} answered ${page.status}`,
          );
          continue;
        }
        assert(
          page.policy === CONTENT_SECURITY_POLICY,
          `${path} is served the gateway's CSP: ${page.policy}`,
        );
        const allowed = scriptSources(page.policy);
        for (const hash of await inlineScriptHashes(page.html)) {
          seen.push(`${path} ${hash}`);
          assert(allowed.includes(hash), `${path} inlines ${hash}, blocked`);
        }
      }
      assert(
        seen.some((entry) => entry.startsWith("/app ")) &&
          seen.some((entry) => entry.startsWith("/app/compliance ")) &&
          seen.every((entry) => entry.endsWith(THEME_SCRIPT_HASH)),
        `static and rendered pages carry only the theme script: ${seen}`,
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
