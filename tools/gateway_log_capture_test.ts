import {
  chooseE2eGatewayPort,
  createE2eTls,
  E2E_COMPOSE_ARGS,
  e2eEnvironment,
  removeE2eTls,
  tearDownE2eComposeProject,
} from "./e2e.ts";
import { API_ROUTES } from "../packages/contracts/routes/mod.ts";

/** A request identifier a client chose; the gateway must not forward it. */
const CLIENT_REQUEST_ID = "client-chosen-request-id";

/** What the gateway's own `$request_id` looks like: 32 lower-case hex digits. */
const GATEWAY_REQUEST_ID = /"request_id":"[0-9a-f]{32}"/;

/** The one inline script the pages carry: the theme bootstrap (GAP-040). */
const THEME_SCRIPT_HASH =
  "'sha256-JcBF2XCeGM7UUhyx5ih7eaW4njR7Xo8zgcRdSMNXAj4='";

const CONTENT_SECURITY_POLICY =
  `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data:; font-src 'self' data:; style-src 'self'; script-src 'self' ${THEME_SCRIPT_HASH}; connect-src 'self'`;

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

Deno.test("Dokploy gateway ignores generic upstream names on its shared edge network", async () => {
  const id = `kinship-dns-${Deno.pid}-${Date.now()}`;
  const privateNetwork = `${id}-private`;
  const sharedNetwork = `${id}-edge`;
  const gateway = `${id}-gateway`;
  const upstream = `${id}-upstream`;
  const otherApp = `${id}-other`;
  const tls = await createE2eTls(`kinship-e2e-${Deno.pid}-${Date.now()}`);
  const containers: string[] = [];
  const networks: string[] = [];
  try {
    for (const network of [privateNetwork, sharedNetwork]) {
      await docker(["network", "create", network]);
      networks.push(network);
    }
    for (
      const [name, network, aliases, body] of [
        [upstream, privateNetwork, [
          "kinship-private-api",
          "kinship-private-web",
        ], "kinship-private"],
        [
          otherApp,
          sharedNetwork,
          ["api", "web"],
          "unrelated-shared-application",
        ],
      ] as const
    ) {
      const config =
        `events {} http { server { listen 8000; listen 4321; location / { return 200 '${body}'; } } }`;
      await docker([
        "run",
        "--detach",
        "--name",
        name,
        "--network",
        network,
        ...aliases.flatMap((alias) => ["--network-alias", alias]),
        "--entrypoint",
        "sh",
        NGINX_IMAGE,
        "-c",
        `printf '%s' "$1" >/tmp/upstream.conf; exec nginx -c /tmp/upstream.conf -g 'daemon off;'`,
        "sh",
        config,
      ]);
      containers.push(name);
    }
    await docker([
      "create",
      "--name",
      gateway,
      "--network",
      sharedNetwork,
      "--user",
      "nginx",
      "--mount",
      `type=bind,source=${await Deno.realPath(
        "gateway/nginx.conf",
      )},target=/etc/nginx/nginx.conf,readonly`,
      "--mount",
      `type=bind,source=${await Deno.realPath(
        "gateway/security_headers.conf",
      )},target=/etc/nginx/security_headers.conf,readonly`,
      "--mount",
      `type=bind,source=${tls.certificate},target=/run/secrets/gateway_tls_certificate,readonly`,
      "--mount",
      `type=bind,source=${tls.privateKey},target=/run/secrets/gateway_tls_private_key,readonly`,
      NGINX_IMAGE,
    ]);
    containers.push(gateway);
    await docker(["network", "connect", privateNetwork, gateway]);
    await docker(["start", gateway]);
    const request = (path: string) =>
      docker([
        "exec",
        gateway,
        "wget",
        "-q",
        "-O",
        "-",
        `http://127.0.0.1:8080${path}`,
      ]);
    const deadline = Date.now() + 15_000;
    while (true) {
      try {
        await request("/");
        break;
      } catch {
        if (Date.now() >= deadline) {
          throw new Error("DNS fixture gateway did not start");
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    const collision = await docker([
      "exec",
      gateway,
      "wget",
      "-q",
      "-O",
      "-",
      "http://web:4321/privacy",
    ]);
    assert(
      collision === "unrelated-shared-application",
      "generic web resolves to the unrelated shared application",
    );
    for (const path of ["/privacy", "/api/v1/health", "/gateway-health"]) {
      assert(
        await request(path) === "kinship-private",
        `${path} must route to the private Kinship service despite shared aliases`,
      );
    }
  } finally {
    for (const name of containers.reverse()) {
      await docker(["rm", "--force", name]);
    }
    for (const name of networks.reverse()) {
      await docker(["network", "rm", name]);
    }
    await removeE2eTls(tls);
  }
});

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

/** How many times the gateway logged its API readiness as ready. */
function countReady(logs: string): number {
  return logs.split('"boundary":"api","state":"ready","status":200').length -
    1;
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
        // The token pages are static files (ADR 0007); the static root is a
        // tmpfs the gateway fills before nginx starts.
        "--tmpfs",
        "/usr/share/nginx/html:rw,mode=1777",
        "--entrypoint",
        "sh",
        NGINX_IMAGE,
        "-c",
        `${
          [
            "auth/reset-password",
            "auth/verify-email",
            "internal/invite-shell",
          ].map((page) =>
            `mkdir -p /usr/share/nginx/html/${page} && printf fixture > /usr/share/nginx/html/${page}/index.html`
          ).join(" && ")
        } && exec nginx -g 'daemon off;'`,
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

      // REL-068: one leaked feed URL is refused past its own small burst,
      // while another feed from the same address is still served.
      const feedPath = (id: string, secret: string) =>
        `${origin}/api/v1/calendar-feeds/kin_cal_00000000-0000-4000-8000-${id}.${secret}.ics`;
      const feedRefusals = (await Promise.all(
        Array.from(
          { length: 12 },
          (_, index) =>
            rateLimitedAnswer(
              feedPath("000000000002", `leaked-feed-secret-${index}`),
            ),
        ),
      )).filter((answer) => answer !== undefined);
      assert(
        feedRefusals.length > 0 &&
          feedRefusals.every(({ body }) =>
            body.includes('"code":"request_rate_limited"')
          ),
        "a burst on one feed past its credential limit is refused",
      );
      assert(
        await rateLimitedAnswer(
          feedPath("000000000003", "other-feed-secret"),
        ) === undefined,
        "another feed from the same address is not refused",
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
    "pinned Compose gateway reports API outages, outlives the renderer, and serves the legal pages it rendered",
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

      // ADR 0007 (AUD-G5): while no privacy policy is active, the renderer
      // answers 404, which the gateway does not keep; once one is, the page
      // carries its text, so it reads without JavaScript.
      const missingPrivacy = await pageThroughGateway(
        gatewayContainer,
        "/privacy",
      );
      assert(
        missingPrivacy.status === 404,
        `an unpublished policy answers 404: ${missingPrivacy.status}`,
      );
      const privacyText = "AUD-G5 fixture privacy policy, rendered on demand.";
      await docker(
        [
          ...E2E_COMPOSE_ARGS,
          "exec",
          "-T",
          "postgres",
          "psql",
          "-U",
          "kinship_e2e",
          "-d",
          "kinship_e2e",
          "-v",
          "ON_ERROR_STOP=1",
          "-c",
          `insert into crm.legal_documents
            (id, document_type, version, content, published_at, is_active)
            values ('${crypto.randomUUID()}'::uuid, 'privacy', 'AUD-G5',
              '${privacyText}', now() - interval '1 minute', true)`,
        ],
        false,
        environment,
      );

      // GAP-040: every inline script a served page carries, static or
      // rendered on demand, is one the served CSP allows by hash. The token,
      // MFA, invitation, and compliance pages are static files (ADR 0007).
      const seen: string[] = [];
      const pages = new Map<string, string>();
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
          "/privacy",
        ]
      ) {
        const page = await pageThroughGateway(gatewayContainer, path);
        assert(page.status === 200, `${path} answered ${page.status}`);
        assert(
          page.policy === CONTENT_SECURITY_POLICY,
          `${path} is served the gateway's CSP: ${page.policy}`,
        );
        pages.set(path, page.html);
        const allowed = scriptSources(page.policy);
        for (const hash of await inlineScriptHashes(page.html)) {
          seen.push(`${path} ${hash}`);
          assert(allowed.includes(hash), `${path} inlines ${hash}, blocked`);
        }
      }
      assert(
        seen.some((entry) => entry.startsWith("/app ")) &&
          seen.some((entry) => entry.startsWith("/app/compliance ")) &&
          seen.some((entry) => entry.startsWith("/privacy ")) &&
          seen.every((entry) => entry.endsWith(THEME_SCRIPT_HASH)),
        `static and rendered pages carry only the theme script: ${seen}`,
      );
      const privacy = pages.get("/privacy")!;
      assert(
        privacy.includes(privacyText) && privacy.includes("Version AUD-G5") &&
          !/<script\b[^>]*\bsrc=/.test(privacy) && !/<style\b/i.test(privacy) &&
          !/\sstyle=/i.test(privacy),
        `the rendered policy carries its text and no script or inline style: ${privacy}`,
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
      // The kept page covers the outage: the gateway does not ask again.
      const keptDuringApiOutage = await pageThroughGateway(
        gatewayContainer,
        "/privacy",
      );
      assert(
        keptDuringApiOutage.status === 200 &&
          keptDuringApiOutage.html.includes(privacyText),
        `the kept policy is served while the API is down: ${keptDuringApiOutage.status}`,
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
      // ADR 0007: a renderer outage leaves the gateway healthy and every
      // static page served; only a legal page it has not kept is unavailable.
      const readyBefore = countReady(await docker(["logs", gatewayContainer]));
      await requestHealthFromGateway(gatewayContainer);
      const deadline = Date.now() + 15_000;
      logs = await docker(["logs", gatewayContainer]);
      while (countReady(logs) <= readyBefore && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        logs = await docker(["logs", gatewayContainer]);
      }
      assert(
        countReady(logs) > readyBefore && !logs.includes('"boundary":"web"'),
        "the gateway stays ready through a renderer outage and never asks it",
      );
      const duringRendererOutage: [string, number][] = [];
      for (
        const path of ["/auth/mfa", "/app/compliance", "/privacy", "/terms"]
      ) {
        duringRendererOutage.push([
          path,
          (await pageThroughGateway(gatewayContainer, path)).status,
        ]);
      }
      assert(
        JSON.stringify(duringRendererOutage) ===
          JSON.stringify([
            ["/auth/mfa", 200],
            ["/app/compliance", 200],
            ["/privacy", 200],
            ["/terms", 503],
          ]),
        `a renderer outage reaches only an unkept legal page: ${
          JSON.stringify(duringRendererOutage)
        }`,
      );
      await docker(
        [...E2E_COMPOSE_ARGS, "start", "web"],
        false,
        environment,
      );
      // Answered by the renderer again, whatever it makes of a document this
      // fixture never published, rather than by the gateway's outage page.
      const recovery = Date.now() + 15_000;
      let recovered = 0;
      while (recovered < 200 || recovered === 502 || recovered === 503) {
        assert(Date.now() < recovery, `no recovery: /terms ${recovered}`);
        await new Promise((resolve) => setTimeout(resolve, 250));
        recovered =
          (await pageThroughGateway(gatewayContainer, "/terms")).status;
      }
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

// BusyBox wget retains encoded bytes; fetch transparently decompresses them.
async function compressionResponse(
  container: string,
  path: string,
  encoding: string,
  via = false,
  post = false,
) {
  const output = await docker([
    "exec",
    container,
    "sh",
    "-c",
    'wget -S -q -O /tmp/compression-body "$@" 2>/tmp/compression-headers && cat /tmp/compression-headers && printf "\\nBODY\\n" && base64 /tmp/compression-body',
    "sh",
    "--header",
    `Accept-Encoding: ${encoding}`,
    ...(via ? ["--header", "Via: 1.1 edge-proxy"] : []),
    ...(post
      ? ["--header", "Content-Type: application/json", "--post-data", "{}"]
      : []),
    `http://127.0.0.1:8080${path}`,
  ]);
  const [head = "", encoded = ""] = output.split("\nBODY\n");
  const headers: Record<string, string> = {};
  for (const line of head.split("\n")) {
    const match = line.trim().match(/^([^:]+):\s*(.*)$/);
    if (match) headers[match[1]!.toLowerCase()] = match[2]!;
  }
  return {
    status: Number(head.match(/HTTP\/\S+ (\d+)/)?.[1]),
    headers,
    body: Uint8Array.from(
      atob(encoded.replace(/\s/g, "")),
      (c) => c.charCodeAt(0),
    ),
  };
}

/**
 * One request curl makes from inside the gateway container, optionally with a
 * body of `bodyBytes` zero bytes: the status, negotiated HTTP version,
 * lower-cased response headers, and body text.
 */
async function curlInGateway(
  container: string,
  url: string,
  options: {
    readonly http2?: boolean;
    readonly bodyBytes?: number;
    readonly headers?: readonly string[];
    readonly method?: string;
  } = {},
) {
  const send = options.bodyBytes === undefined
    ? ""
    : `head -c ${options.bodyBytes} /dev/zero | `;
  const upload = options.bodyBytes === undefined
    ? ""
    : "--data-binary @- -H 'Content-Type: application/octet-stream' -H 'Expect:'";
  const output = await docker([
    "exec",
    container,
    "sh",
    "-c",
    `${send}curl -sk ${
      options.http2 ? "--http2" : "--http1.1"
    } ${upload} -D /dev/shm/curl-headers -o /dev/shm/curl-body -w '%{http_code} %{http_version}' "$@" && printf '\\nHEADERS\\n' && cat /dev/shm/curl-headers && printf '\\nBODY\\n' && cat /dev/shm/curl-body`,
    "sh",
    ...(options.method ? ["-X", options.method] : []),
    ...(options.headers ?? []).flatMap((header) => ["-H", header]),
    url,
  ]);
  const [summary = "", rest = ""] = output.split("\nHEADERS\n");
  const [head = "", body = ""] = rest.split("\nBODY\n");
  const [status, version] = summary.trim().split(" ");
  const headers: Record<string, string[]> = {};
  for (const line of head.split("\n")) {
    const match = line.trim().match(/^([^:]+):\s*(.*)$/);
    if (match) (headers[match[1]!.toLowerCase()] ??= []).push(match[2]!);
  }
  return { status: Number(status), version, headers, body };
}

Deno.test({
  name:
    "[AUD-G1] real Nginx revalidates HTML, speaks HTTP/2 over TLS, and admits a whole person file",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const id = `kinship-delivery-${Deno.pid}-${Date.now()}`;
    const tls = await createE2eTls(`kinship-e2e-${Deno.pid}-${Date.now()}`);
    const containers: string[] = [];
    let networkCreated = false;
    const uuid = "393de041-31ca-47c3-95d4-ae37b7473e2e";
    const files = [
      "index.html",
      "favicon.svg",
      "docs/api/openapi.json",
      "_astro/fixture.js",
      "internal/person-profile-shell/index.html",
      "internal/person-audit-shell/index.html",
      "internal/activity-report-shell/index.html",
      "internal/import-report-shell/index.html",
      "internal/journal-item-shell/index.html",
      // ADR 0007: the token, MFA, invitation, and compliance pages.
      "auth/verify-email/index.html",
      "auth/reset-password/index.html",
      "auth/mfa/index.html",
      "app/compliance/index.html",
      "internal/invite-shell/index.html",
    ];
    // The static root is a tmpfs the gateway fills before nginx starts, so the
    // fixture needs no host directory.
    const fill = files.map((file) =>
      `mkdir -p "/usr/share/nginx/html/${
        file.split("/").slice(0, -1).join("/")
      }" && printf fixture > "/usr/share/nginx/html/${file}"`
    ).join(" && ");
    try {
      await docker(["network", "create", id]);
      networkCreated = true;
      const upstream = `${id}-upstream`;
      // The API stand-in answers 201 with the body length it received. The
      // renderer stand-in echoes what reached it under a fresh identifier, so
      // a kept page is the same bytes; its terms set a cookie.
      const upstreamConfig =
        `events {} http { server { listen 8000; client_max_body_size 0; location / { return 201 '{"received":$content_length}'; } } ` +
        `server { listen 4321; default_type text/html; ` +
        `location = /privacy { return 200 'privacy $request_id cookie=[$http_cookie] authorization=[$http_authorization] host=[$host] args=[$args] uri=[$request_uri]'; } ` +
        `location = /terms { add_header Set-Cookie 'tracker=$request_id'; return 200 'terms $request_id'; } } }`;
      await docker([
        "run",
        "--detach",
        "--name",
        upstream,
        "--network",
        id,
        "--network-alias",
        "kinship-private-api",
        "--network-alias",
        "kinship-private-web",
        "--entrypoint",
        "sh",
        NGINX_IMAGE,
        "-c",
        `printf '%s' "$1" >/tmp/upstream.conf; exec nginx -c /tmp/upstream.conf -g 'daemon off;'`,
        "sh",
        upstreamConfig,
      ]);
      containers.push(upstream);
      const gateway = `${id}-gateway`;
      await docker([
        "run",
        "--detach",
        "--name",
        gateway,
        "--network",
        id,
        "--user",
        "nginx",
        "--tmpfs",
        "/usr/share/nginx/html:rw,mode=1777",
        // Smaller than one upload, as Compose's 16m /tmp is smaller than two:
        // a person file must stream to the API, not buffer to a temp file.
        "--tmpfs",
        "/tmp:rw,mode=1777,size=4m",
        ...[
          [await Deno.realPath("gateway/nginx.conf"), "/etc/nginx/nginx.conf"],
          [
            await Deno.realPath("gateway/security_headers.conf"),
            "/etc/nginx/security_headers.conf",
          ],
          [tls.certificate, "/run/secrets/gateway_tls_certificate"],
          [tls.privateKey, "/run/secrets/gateway_tls_private_key"],
        ].flatMap((
          [source, target],
        ) => [
          "--mount",
          `type=bind,source=${source},target=${target},readonly`,
        ]),
        "--entrypoint",
        "sh",
        NGINX_IMAGE,
        "-c",
        `${fill} && exec nginx -g 'daemon off;'`,
      ]);
      containers.push(gateway);
      const http = "http://127.0.0.1:8080";
      const deadline = Date.now() + 15_000;
      while (true) {
        try {
          assert(
            (await curlInGateway(gateway, `${http}/`)).status === 200,
            "gateway ready",
          );
          break;
        } catch (error) {
          if (Date.now() >= deadline) throw error;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      const one = (
        headers: Record<string, string[]>,
        name: string,
      ) => headers[name]?.length === 1 ? headers[name][0] : undefined;

      // FEQ-07/FER-07: browsers reaching the TLS listener negotiate h2.
      const secure = await curlInGateway(gateway, "https://127.0.0.1:8443/", {
        http2: true,
      });
      assert(
        secure.status === 200 && secure.version === "2",
        `the TLS listener negotiates HTTP/2 (${secure.version})`,
      );
      assert(
        one(secure.headers, "server") === "nginx",
        `the Server header names no version: ${secure.headers.server}`,
      );

      // FER-05: every static document revalidates, once, with the policy.
      for (
        const path of [
          "/",
          "/docs/api/openapi.json",
          `/app/people/${uuid}`,
          `/app/people/${uuid}/audit`,
          `/app/people/${uuid}/activity-report`,
          `/app/settings/import/${uuid}`,
          `/app/journal/${uuid}`,
        ]
      ) {
        const page = await curlInGateway(gateway, `${http}${path}`);
        assert(
          page.status === 200 &&
            one(page.headers, "cache-control") === "no-cache" &&
            one(page.headers, "content-security-policy") ===
              CONTENT_SECURITY_POLICY &&
            one(page.headers, "x-frame-options") === "DENY",
          `${path} revalidates with the browser policy: ${
            JSON.stringify(page.headers)
          }`,
        );
      }
      // ADR 0007 (AUD-G5): a page whose address carries a token, an MFA
      // challenge, or a pending compliance step is a static file no cache
      // keeps, with the browser policy; its shell is not reachable itself.
      for (
        const path of [
          "/auth/verify-email?token=fixture-secret",
          "/auth/reset-password?token=fixture-secret",
          "/auth/mfa",
          "/app/compliance?next=%2Fapp",
          "/invite/fixture-secret",
          "/invite/continue",
          // The built files at their own paths answer the same way.
          "/auth/reset-password/?token=fixture-secret",
          "/auth/verify-email/index.html?token=fixture-secret",
          "/auth/mfa/",
          "/app/compliance/index.html",
        ]
      ) {
        const page = await curlInGateway(gateway, `${http}${path}`);
        assert(
          page.status === 200 && page.body === "fixture" &&
            one(page.headers, "cache-control") === "private, no-store" &&
            one(page.headers, "content-security-policy") ===
              CONTENT_SECURITY_POLICY &&
            one(page.headers, "referrer-policy") === "no-referrer" &&
            one(page.headers, "x-frame-options") === "DENY",
          `${path} is a private static page: ${page.status} ${
            JSON.stringify(page.headers)
          }`,
        );
      }
      for (
        const path of [
          "/internal/invite-shell",
          "/internal/invite-shell/",
          "/internal/invite-shell/index.html",
        ]
      ) {
        assert(
          (await curlInGateway(gateway, `${http}${path}`)).status === 404,
          `${path} is not reachable`,
        );
      }

      // The legal pages render on demand behind a five-minute shared copy
      // that nothing a client sends reaches or varies.
      const legal = (query: string, cookie: string) =>
        curlInGateway(gateway, `${http}/privacy${query}`, {
          headers: [
            `Cookie: kinship_session=${cookie}`,
            `Authorization: Bearer ${cookie}`,
          ],
        });
      const first = await legal("?first=1", "reader-one-secret");
      assert(
        first.status === 200 &&
          first.body.includes("cookie=[] authorization=[]") &&
          first.body.includes("host=[kinship-private-web]") &&
          first.body.includes("args=[] uri=[/privacy]") &&
          one(first.headers, "cache-control") === "no-cache" &&
          one(first.headers, "content-security-policy") ===
            CONTENT_SECURITY_POLICY &&
          first.headers["content-encoding"] === undefined,
        `the legal page renders without the reader's cookie, credentials, host, or query: ${first.body} ${
          JSON.stringify(first.headers)
        }`,
      );
      const second = await legal("?second=2", "reader-two-secret");
      assert(
        second.status === 200 && second.body === first.body,
        `another reader gets the kept page: ${second.body}`,
      );
      const terms = [
        await curlInGateway(gateway, `${http}/terms`),
        await curlInGateway(gateway, `${http}/terms`),
      ];
      assert(
        terms.every(({ status, headers }) =>
          status === 200 && headers["set-cookie"] === undefined
        ) && terms[0]!.body !== terms[1]!.body,
        `a render that sets a cookie is neither kept nor passed on: ${
          JSON.stringify(terms)
        }`,
      );
      assert(
        (await curlInGateway(gateway, `${http}/privacy`, { method: "POST" }))
          .status === 403,
        "the legal pages answer only GET and HEAD",
      );

      const favicon = await curlInGateway(gateway, `${http}/favicon.svg`);
      assert(
        favicon.status === 200 &&
          one(favicon.headers, "cache-control") === "public, max-age=86400" &&
          one(favicon.headers, "content-security-policy") ===
            CONTENT_SECURITY_POLICY,
        `the favicon is cached for a day: ${JSON.stringify(favicon.headers)}`,
      );
      const asset = await curlInGateway(gateway, `${http}/_astro/fixture.js`);
      assert(
        asset.status === 200 &&
          one(asset.headers, "cache-control") ===
            "public, max-age=31536000, immutable" &&
          one(asset.headers, "x-content-type-options") === "nosniff" &&
          one(asset.headers, "cross-origin-resource-policy") ===
            "same-origin" &&
          [
            "content-security-policy",
            "permissions-policy",
            "referrer-policy",
            "strict-transport-security",
            "x-frame-options",
          ].every((name) => asset.headers[name] === undefined),
        `a fingerprinted asset carries only its subresource headers: ${
          JSON.stringify(asset.headers)
        }`,
      );

      // SECA-12: a 5 MB document reaches the API; past the file limit the
      // gateway answers the API's own problem.
      const filesPath = `${http}/api/v1/people/${uuid}/files`;
      const accepted = await curlInGateway(gateway, filesPath, {
        bodyBytes: 5_000_000,
      });
      assert(
        accepted.status === 201 &&
          accepted.body === '{"received":5000000}',
        `a 5 MB upload reaches the API whole: ${accepted.status} ${accepted.body}`,
      );
      for (
        const [path, bodyBytes] of [
          [filesPath, 11 * 1024 * 1024],
          [`${http}/api/v1/people`, 2_000_000],
        ] as const
      ) {
        const refused = await curlInGateway(gateway, path, { bodyBytes });
        assert(
          refused.status === 413 &&
            one(refused.headers, "content-type") ===
              "application/problem+json" &&
            one(refused.headers, "cache-control") === "no-store" &&
            one(refused.headers, "content-security-policy") ===
              CONTENT_SECURITY_POLICY,
          `${path} refuses ${bodyBytes} bytes as an uncached problem: ${refused.status} ${
            JSON.stringify(refused.headers)
          }`,
        );
        const problem = JSON.parse(refused.body) as Record<string, unknown>;
        assert(
          problem.status === 413 && problem.code === "request_too_large" &&
            problem.type === "https://kinship.test/problems/request_too_large",
          `the refusal is the API's problem shape: ${refused.body}`,
        );
      }
    } finally {
      for (const container of containers.reverse()) {
        await docker(["rm", "--force", container]);
      }
      if (networkCreated) await docker(["network", "rm", id]);
      await removeE2eTls(tls);
    }
  },
});

/** Every route a secret-bearing exchange answers on, as a request it accepts. */
const SECRET_BEARING_REQUESTS = API_ROUTES.filter((route) =>
  route.secrecy !== undefined
).map((route) => ({
  method: route.method,
  path: route.path.replace(
    /\{[^}]+\}/g,
    "393de041-31ca-47c3-95d4-ae37b7473e2e",
  ),
}));

Deno.test("[AUD-G2] real Nginx compresses static files and API JSON behind a proxy, serves pre-compressed assets, and never compresses a secret", async () => {
  const id = `kinship-compression-${Deno.pid}-${Date.now()}`;
  const tls = await createE2eTls(`kinship-e2e-${Deno.pid}-${Date.now()}`);
  const containers: string[] = [];
  let networkCreated = false;
  const line = "<p>Kinship static profile, people and reminders.</p>";
  const body = `${line}\n`.repeat(400);
  const uuid = "393de041-31ca-47c3-95d4-ae37b7473e2e";
  const files = [
    ["index.html", "/"],
    ["_astro/fixture.css", "/_astro/fixture.css"],
    ["_astro/fixture.js", "/_astro/fixture.js"],
    ["images/fixture.svg", "/images/fixture.svg"],
    ["docs/api/openapi.json", "/docs/api/openapi.json"],
    ["internal/person-profile-shell/index.html", `/app/people/${uuid}`],
    ["internal/person-audit-shell/index.html", `/app/people/${uuid}/audit`],
    [
      "internal/activity-report-shell/index.html",
      `/app/people/${uuid}/activity-report`,
    ],
    ["internal/import-report-shell/index.html", `/app/settings/import/${uuid}`],
    ["internal/journal-item-shell/index.html", `/app/journal/${uuid}`],
    // ADR 0007: static files whose address may carry a token. The body is the
    // same file for every reader and holds no secret, so it compresses too.
    ["auth/verify-email/index.html", "/auth/verify-email?token=fixture"],
    ["auth/reset-password/index.html", "/auth/reset-password?token=fixture"],
    ["auth/mfa/index.html", "/auth/mfa"],
    ["app/compliance/index.html", "/app/compliance"],
    ["internal/invite-shell/index.html", "/invite/fixture-token"],
  ] as const;
  /** The pages no cache keeps (ADR 0007); every other document revalidates. */
  const privatePage = (path: string) =>
    /^\/(auth\/|app\/compliance|invite\/)/.test(path);
  // The build pre-compresses this one, as `Dockerfile.web` does every asset.
  const precompressed = "/usr/share/nginx/html/_astro/fixture.js.gz";
  // The static root is a tmpfs the gateway fills before nginx starts, so the
  // fixture needs no host directory.
  const fill = [
    ...files.map(([file]) =>
      `mkdir -p "/usr/share/nginx/html/${
        file.split("/").slice(0, -1).join("/")
      }" && yes '${line}' | head -n 400 > "/usr/share/nginx/html/${file}"`
    ),
    `gzip -9 -c /usr/share/nginx/html/_astro/fixture.js > ${precompressed}`,
  ].join(" && ");
  // Upstream answers stay small: Windows caps a command line at 32 KiB.
  const json = `{"records":[${
    Array.from(
      { length: 40 },
      (_, index) =>
        `{"id":${index},"name":"Kinship person","note":"Remember the birthday."}`,
    ).join(",")
  }],"status":"ready"}`;
  const html = `${line}\n`.repeat(40);
  const calendar = "BEGIN:VEVENT\nSUMMARY:Kinship reminder\nEND:VEVENT\n"
    .repeat(40);
  try {
    await docker(["network", "create", id]);
    networkCreated = true;
    const upstream = `${id}-upstream`;
    // The API answers JSON (an iCalendar feed for the feed path) to every
    // method; the renderer answers HTML.
    const upstreamConfig = `events {} http { ` +
      `server { listen 8000; default_type application/json; ` +
      `location / { return 200 '${json}'; } ` +
      `location /api/v1/calendar-feeds/ { default_type text/calendar; return 200 '${calendar}'; } } ` +
      `server { listen 4321; default_type text/html; location / { return 200 '${html}'; } } }`;
    await docker([
      "run",
      "--detach",
      "--name",
      upstream,
      "--network",
      id,
      "--network-alias",
      "kinship-private-api",
      "--network-alias",
      "kinship-private-web",
      "--entrypoint",
      "sh",
      NGINX_IMAGE,
      "-c",
      `printf '%s' "$1" >/tmp/upstream.conf; exec nginx -c /tmp/upstream.conf -g 'daemon off;'`,
      "sh",
      upstreamConfig,
    ]);
    containers.push(upstream);
    const gateway = `${id}-gateway`;
    await docker([
      "run",
      "--detach",
      "--name",
      gateway,
      "--network",
      id,
      "--user",
      "nginx",
      "--tmpfs",
      "/usr/share/nginx/html:rw,mode=1777",
      ...[
        [await Deno.realPath("gateway/nginx.conf"), "/etc/nginx/nginx.conf"],
        [
          await Deno.realPath("gateway/security_headers.conf"),
          "/etc/nginx/security_headers.conf",
        ],
        [tls.certificate, "/run/secrets/gateway_tls_certificate"],
        [tls.privateKey, "/run/secrets/gateway_tls_private_key"],
      ].flatMap((
        [source, target],
      ) => ["--mount", `type=bind,source=${source},target=${target},readonly`]),
      "--entrypoint",
      "sh",
      NGINX_IMAGE,
      "-c",
      `${fill} && exec nginx -g 'daemon off;'`,
    ]);
    containers.push(gateway);
    const origin = gateway;
    const deadline = Date.now() + 15_000;
    while (true) {
      try {
        assert(
          (await compressionResponse(origin, "/", "identity")).status === 200,
          "gateway ready",
        );
        break;
      } catch (error) {
        if (Date.now() >= deadline) throw error;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    const gunzip = (bytes: Uint8Array<ArrayBuffer>) =>
      new Response(
        new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")),
      ).text();
    const prebuilt = Uint8Array.from(
      atob((await docker(["exec", gateway, "base64", precompressed])).replace(
        /\s/g,
        "",
      )),
      (c) => c.charCodeAt(0),
    );
    for (const [, path] of files) {
      const identity = await compressionResponse(origin, path, "identity");
      assert(
        identity.status === 200 && !identity.headers["content-encoding"],
        `${path} serves identity`,
      );
      assert(
        new TextDecoder().decode(identity.body) === body,
        `${path} preserves static bytes`,
      );
      for (const via of [false, true]) {
        const compressed = await compressionResponse(origin, path, "gzip", via);
        assert(
          compressed.status === 200 &&
            compressed.headers["content-encoding"] === "gzip",
          `${path} negotiates gzip (Via=${via})`,
        );
        assert(
          await gunzip(compressed.body) === body,
          `${path} gzip decodes to identity`,
        );
        assert(
          compressed.body.length < identity.body.length / 2,
          `${path} reduces transfer bytes`,
        );
        if (path === "/_astro/fixture.js") {
          // gzip_static sends the build's file as it is, not a fresh stream.
          assert(
            compressed.body.length === prebuilt.length &&
              compressed.body.every((byte, index) => byte === prebuilt[index]),
            `${path} is served from its pre-compressed .gz (Via=${via})`,
          );
        }
        if (path === "/" && !via) {
          console.info(
            `Static fixture: ${identity.body.length} identity bytes, ${compressed.body.length} gzip bytes`,
          );
        }
        for (const response of [identity, compressed]) {
          assert(
            String(response.headers.vary).includes("Accept-Encoding"),
            `${path} varies by encoding`,
          );
          assert(
            response.headers["x-content-type-options"] === "nosniff",
            `${path} preserves nosniff`,
          );
          if (path.startsWith("/_astro/")) {
            // AUD-G1: a subresource carries no document policy.
            assert(
              response.headers["cache-control"] ===
                  "public, max-age=31536000, immutable" &&
                !response.headers["content-security-policy"] &&
                !response.headers["strict-transport-security"],
              `${path} preserves immutable cache without document policies`,
            );
          } else {
            assert(
              response.headers["content-security-policy"] &&
                response.headers["strict-transport-security"] ===
                  "max-age=31536000" &&
                response.headers["cache-control"] ===
                  (privatePage(path) ? "private, no-store" : "no-cache"),
              `${path} preserves CSP and HSTS and its cache policy`,
            );
          }
        }
      }
      const refused = await compressionResponse(
        origin,
        path,
        "gzip;q=0, identity",
      );
      assert(
        !refused.headers["content-encoding"],
        `${path} respects gzip refusal`,
      );
    }

    // D4: API JSON is compressed, on the ordinary and the upload locations.
    for (
      const [path, post] of [
        ["/api/v1/people", false],
        ["/api/v1/health", false],
        [`/api/v1/people/${uuid}/files`, true],
        ["/api/v1/workspace-invitations", true],
      ] as const
    ) {
      for (const via of [false, true]) {
        const response = await compressionResponse(
          origin,
          path,
          "gzip",
          via,
          post,
        );
        assert(
          response.status === 200 &&
            response.headers["content-encoding"] === "gzip" &&
            String(response.headers.vary).includes("Accept-Encoding"),
          `${path} JSON negotiates gzip (Via=${via})`,
        );
        assert(
          await gunzip(response.body) === json,
          `${path} gzip decodes to the API's JSON`,
        );
        assert(
          response.headers["content-security-policy"] &&
            response.headers["x-content-type-options"] === "nosniff",
          `${path} keeps the browser policy`,
        );
      }
      const refused = await compressionResponse(
        origin,
        path,
        "gzip;q=0, identity",
        false,
        post,
      );
      assert(
        !refused.headers["content-encoding"] &&
          new TextDecoder().decode(refused.body) === json,
        `${path} respects gzip refusal`,
      );
    }

    // D4: a body carrying a secret, or answering a credential, never shares a
    // compression context with anything else (the route registry names them).
    assert(
      SECRET_BEARING_REQUESTS.length >= 17,
      `the registry names every secret-bearing route (${SECRET_BEARING_REQUESTS.length})`,
    );
    for (const { method, path } of SECRET_BEARING_REQUESTS) {
      assert(method === "post", `${path} is sent as busybox wget can`);
      for (const via of [false, true]) {
        const response = await compressionResponse(
          origin,
          path,
          "gzip",
          via,
          true,
        );
        assert(
          response.status === 200 && !response.headers["content-encoding"] &&
            new TextDecoder().decode(response.body) === json,
          `POST ${path} stays uncompressed (Via=${via})`,
        );
        assert(
          response.headers["content-security-policy"] &&
            response.headers["x-content-type-options"] === "nosniff",
          `POST ${path} keeps the browser policy`,
        );
      }
    }

    for (
      const [path, expected] of [
        ["/privacy", html],
        ["/terms", html],
        [
          "/api/v1/calendar-feeds/kin_cal_0f8b2c1e-5d4a-4b3c-9a21-7e6d5c4b3a29.fixture_Calendar-Feed.ics",
          calendar,
        ],
      ] as const
    ) {
      const response = await compressionResponse(origin, path, "gzip", true);
      assert(
        response.status === 200 && !response.headers["content-encoding"],
        `${path} stays uncompressed`,
      );
      assert(
        new TextDecoder().decode(response.body) === expected,
        `${path} retains upstream bytes`,
      );
      if (!path.startsWith("/api/")) {
        assert(
          response.headers["cache-control"] === "no-cache",
          `${path} keeps the legal pages' revalidation policy`,
        );
      }
    }
  } finally {
    for (const container of containers.reverse()) {
      await docker(["rm", "--force", container]);
    }
    if (networkCreated) await docker(["network", "rm", id]);
    await removeE2eTls(tls);
  }
});
