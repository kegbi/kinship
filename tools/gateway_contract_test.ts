import { PERSON_SECTIONS } from "../apps/web/src/features/person/sections.ts";
import { PROFILE_MODULE_DEFAULTS } from "../packages/backend/modules/workspaces/public.ts";
import { problemBody } from "../packages/http-kit/problem.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

type NginxLocation = {
  selector: string;
  body: string;
};

function nginxLocations(config: string): NginxLocation[] {
  const lines = config.split("\n");
  const locations: NginxLocation[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    if (line === undefined) break;
    const locationStart = line.match(
      /^ {4}location\s+(.+)\s+\{$/,
    );
    if (!locationStart) continue;
    const selector = locationStart[1];
    if (selector === undefined) continue;

    const body: string[] = [];
    for (lineIndex++; lineIndex < lines.length; lineIndex++) {
      const bodyLine = lines[lineIndex];
      if (bodyLine === undefined || bodyLine === "    }") break;
      body.push(bodyLine);
    }
    locations.push({ selector, body: body.join("\n") });
  }

  return locations;
}

/** The value one `add_header <name> "<value>" always;` line sets. */
export function addedHeaderValue(
  config: string,
  name: string,
): string | undefined {
  return config.match(
    new RegExp(`^\\s*add_header\\s+${name}\\s+"([^"]*)"\\s+always;$`, "m"),
  )?.[1];
}

/** A Content-Security-Policy value as directive name to source list. */
export function cspDirectives(policy: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const part of policy.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (!name) continue;
    directives.set(name.toLowerCase(), sources);
  }
  return directives;
}

const HASH_SOURCE = /^'sha(256|384|512)-[A-Za-z0-9+/]+={0,2}'$/;

/**
 * Why a `script-src` is weaker than GAP-040's: anything but the origin and
 * inline-script hashes. An empty answer is the strict policy.
 */
export function scriptSourceWeaknesses(
  sources: readonly string[] | undefined,
): string[] {
  if (sources === undefined) return ["script-src is missing"];
  const weaknesses: string[] = [];
  if (!sources.includes("'self'")) weaknesses.push("'self' is missing");
  for (const source of sources) {
    if (source === "'self'" || HASH_SOURCE.test(source)) continue;
    weaknesses.push(`${source} is allowed`);
  }
  return weaknesses;
}

/** The base64 SHA-256 of one inline script, as a CSP hash source. */
export async function scriptHashSource(body: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(body),
  );
  return `'sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}'`;
}

/** The TLS 1.2 suites the gateway may offer: ECDHE with an AEAD cipher. */
const MODERN_TLS12_SUITE =
  /^ECDHE-(ECDSA|RSA)-(AES128-GCM-SHA256|AES256-GCM-SHA384|CHACHA20-POLY1305)$/;

/** Why a server block's TLS settings fall short of the GAP-040 profile. */
export function tlsWeaknesses(config: string): string[] {
  const weaknesses: string[] = [];
  const directive = (name: string) =>
    config.match(new RegExp(`^\\s*${name}\\s+([^;]+);$`, "m"))?.[1]?.trim();
  if (directive("ssl_protocols") !== "TLSv1.2 TLSv1.3") {
    weaknesses.push("ssl_protocols is not exactly TLSv1.2 TLSv1.3");
  }
  const ciphers = directive("ssl_ciphers");
  if (ciphers === undefined) {
    weaknesses.push("ssl_ciphers is left to the library default");
  } else {
    for (const suite of ciphers.split(":")) {
      if (!MODERN_TLS12_SUITE.test(suite)) {
        weaknesses.push(`${suite} is not an ECDHE AEAD suite`);
      }
    }
  }
  if (directive("ssl_prefer_server_ciphers") !== "off") {
    weaknesses.push("ssl_prefer_server_ciphers is not off");
  }
  if (directive("ssl_session_tickets") !== "off") {
    weaknesses.push("ssl_session_tickets is not off");
  }
  return weaknesses;
}

/** Why an HSTS value departs from the private single-host decision. */
export function hstsWeaknesses(value: string | undefined): string[] {
  if (value === undefined) return ["Strict-Transport-Security is missing"];
  const weaknesses: string[] = [];
  const maxAge = Number(value.match(/^max-age=(\d+)/)?.[1] ?? "0");
  if (maxAge < 31_536_000) weaknesses.push("max-age is under one year");
  if (/includeSubDomains/i.test(value)) {
    weaknesses.push("includeSubDomains asserts HSTS for sibling hosts");
  }
  if (/preload/i.test(value)) {
    weaknesses.push("preload commits the whole domain to a browser list");
  }
  return weaknesses;
}

/** Every `<script is:inline>` body in the Astro sources under `directory`. */
async function sourceInlineScripts(directory: URL): Promise<string[]> {
  const bodies: string[] = [];
  for await (const entry of Deno.readDir(directory)) {
    const path = new URL(
      entry.isDirectory ? `${entry.name}/` : entry.name,
      directory,
    );
    if (entry.isDirectory) {
      bodies.push(...await sourceInlineScripts(path));
      continue;
    }
    if (!entry.name.endsWith(".astro")) continue;
    const source = await Deno.readTextFile(path);
    for (
      const [, body] of source.matchAll(
        /<script\b[^>]*\bis:inline\b[^>]*>([\s\S]*?)<\/script>/g,
      )
    ) {
      bodies.push(body ?? "");
    }
  }
  return bodies;
}

function addedHeaderNames(config: string): string[] {
  return [...config.matchAll(/^\s*add_header\s+([^\s;]+)\s+/gm)].flatMap(
    (match) => match[1] === undefined ? [] : [match[1]],
  );
}

Deno.test("renderer proxy locations hide gateway-owned response headers", async () => {
  const [gateway, securityHeaders] = await Promise.all([
    Deno.readTextFile(new URL("../gateway/nginx.conf", import.meta.url)),
    Deno.readTextFile(
      new URL("../gateway/security_headers.conf", import.meta.url),
    ),
  ]);
  const securityHeaderNames = addedHeaderNames(securityHeaders);
  assert(
    securityHeaderNames.length > 0,
    "the gateway security policy declares response headers",
  );

  const rendererLocations = nginxLocations(gateway).filter(({ body }) =>
    /^\s*include \/etc\/nginx\/security_headers\.conf;$/m.test(body) &&
    /^\s*proxy_pass \$web_upstream;$/m.test(body)
  );
  assert(
    rendererLocations.length > 0,
    "the gateway declares renderer proxy locations with security headers",
  );

  for (const { selector, body } of rendererLocations) {
    const gatewayHeaderNames = [
      ...new Set([...securityHeaderNames, ...addedHeaderNames(body)]),
    ];
    const hiddenHeaderNames = new Set(
      [...body.matchAll(/^\s*proxy_hide_header\s+([^\s;]+)\s*;$/gm)].flatMap(
        (match) => match[1] === undefined ? [] : [match[1].toLowerCase()],
      ),
    );
    const missing = gatewayHeaderNames.filter((header) =>
      !hiddenHeaderNames.has(header.toLowerCase())
    );
    assert(
      missing.length === 0,
      `renderer location ${selector} exposes upstream copies of gateway-owned headers: ${
        missing.join(
          ", ",
        )
      }`,
    );
  }
});

Deno.test("production-like Compose exposes only the gateway application entry", async () => {
  const [
    base,
    test,
    gateway,
    profileShell,
    activityReportShell,
    auditShell,
    web,
  ] = await Promise
    .all([
      Deno.readTextFile(new URL("../compose.yaml", import.meta.url)),
      Deno.readTextFile(new URL("../compose.test.yaml", import.meta.url)),
      Deno.readTextFile(new URL("../gateway/nginx.conf", import.meta.url)),
      Deno.readTextFile(
        new URL(
          "../apps/web/src/pages/internal/person-profile-shell.astro",
          import.meta.url,
        ),
      ).catch(() => ""),
      Deno.readTextFile(
        new URL(
          "../apps/web/src/pages/internal/activity-report-shell.astro",
          import.meta.url,
        ),
      ).catch(() => ""),
      Deno.readTextFile(
        new URL(
          "../apps/web/src/pages/internal/person-audit-shell.astro",
          import.meta.url,
        ),
      ).catch(() => ""),
      Deno.readTextFile(new URL("../Dockerfile.web", import.meta.url)),
    ]);
  const stages = web.split(/^(?=FROM )/m);
  const stage = (name: string) =>
    stages.find((text) => new RegExp(`^FROM \\S+ AS ${name}\\n`).test(text)) ??
      "";
  const gatewayImage = stage("gateway");
  const rendererImage = stage("web");
  assert(
    base.includes("  gateway:") && base.includes("  web:"),
    "stack has gateway and private renderer",
  );
  assert(
    (web.match(/astro build/g)?.length ?? 0) === 1 &&
      stage("build").includes("astro build") &&
      gatewayImage.includes("COPY --from=build ") &&
      rendererImage.includes("COPY --from=build "),
    "the gateway and renderer targets share one Astro build stage",
  );
  const services = (name: string) =>
    base.slice(base.indexOf(`\n  ${name}:`) + 1).split(/\n {2}\S/, 1)[0] ??
      "";
  assert(
    services("web").includes("dockerfile: Dockerfile.web\n      target: web") &&
      services("gateway").includes(
        "dockerfile: Dockerfile.web\n      target: gateway",
      ),
    "Compose builds each image from its own target of the shared Dockerfile",
  );
  assert(
    test.includes('"127.0.0.1:${E2E_GATEWAY_PORT:-}:8443"') &&
      !test.includes('"127.0.0.1::8443"') &&
      !test.includes('"127.0.0.1::8000"') &&
      !test.includes('"127.0.0.1::5432"'),
    "test publishes the gateway on the E2E launcher's chosen port (REL-040), " +
      "Docker-assigned when unset, and keeps API private",
  );
  assert(
    gateway.includes("listen 8443 ssl") &&
      gateway.includes(
        "ssl_certificate /run/secrets/gateway_tls_certificate",
      ) &&
      gateway.includes(
        "ssl_certificate_key /run/secrets/gateway_tls_private_key",
      ) &&
      base.includes("GATEWAY_TLS_CERTIFICATE_PATH") &&
      base.includes("GATEWAY_TLS_PRIVATE_KEY_PATH"),
    "production-like gateway terminates TLS from deployment-provided files",
  );
  assert(
    (gateway.match(/include \/etc\/nginx\/security_headers\.conf;/g)?.length ??
          0) === 8 &&
      gatewayImage.includes(
        "COPY gateway/security_headers.conf /etc/nginx/security_headers.conf",
      ),
    "all public gateway responses receive the pinned browser security policy",
  );
  assert(
    gateway.includes("location /api/v1/") &&
      gateway.includes("proxy_pass $api_upstream") &&
      gateway.includes(
        "proxy_set_header X-Kinship-Client-Address $remote_addr",
      ),
    "gateway owns API routing and trusted client address",
  );
  assert(
    gateway.includes(
      '"bytes_sent":$body_bytes_sent,"request_id":"$request_id"}',
    ) &&
      !gateway.includes("$http_x_request_id"),
    "gateway logs its own request identifier, never a client's",
  );
  assert(
    gateway.includes("resolver 127.0.0.11") &&
      gateway.includes("set $api_upstream http://api:8000") &&
      gateway.includes("set $web_upstream http://web:4321"),
    "gateway resolves private upstreams after container startup and recreation",
  );
  assert(
    gateway.includes("log_format kinship_gateway escape=json") &&
      gateway.includes("access_log /dev/stdout kinship_gateway") &&
      gateway.includes("error_log /dev/stderr crit") &&
      gateway.includes('~^/invite/[^/]+$ "/invite/:token"') &&
      gateway.includes('~^/api/v1/ "/api/v1/*"') &&
      !gateway.includes("$request_uri") &&
      !gateway.includes("$http_authorization") &&
      !gateway.includes("$http_cookie"),
    "gateway telemetry is structured, low-cardinality, and excludes request secrets",
  );
  assert(
    gateway.includes("log_subrequest on") &&
      gateway.includes(
        "log_format kinship_gateway_readiness_api escape=json",
      ) &&
      gateway.includes(
        "log_format kinship_gateway_readiness_web escape=json",
      ) &&
      gateway.includes('"event":"gateway.readiness"') &&
      gateway.includes('"boundary":"api"') &&
      gateway.includes('"boundary":"web"') &&
      gateway.includes('"state":"$kinship_readiness_state"') &&
      gateway.includes('"dependency_status":"$upstream_status"') &&
      !gateway.includes("location = /gateway-health {\n      access_log off;"),
    "gateway safely distinguishes API and renderer readiness diagnostics",
  );
  assert(
    !gateway.includes('return 200 "ready') &&
      gateway.includes("location = /gateway-health") &&
      gateway.includes("auth_request /_gateway_web_readiness") &&
      gateway.includes("location = /_gateway_web_readiness") &&
      gateway.includes("proxy_pass $api_upstream/api/v1/health") &&
      gateway.includes(
        "error_page 401 403 404 500 502 503 504 = @gateway_unavailable",
      ) &&
      gateway.includes('return 503 "Gateway dependencies unavailable'),
    "gateway readiness is bounded by both required private upstreams and fails honestly",
  );
  for (
    const directive of [
      "client_body_temp_path /tmp/client_temp",
      "fastcgi_temp_path /tmp/fastcgi_temp",
      "proxy_temp_path /tmp/proxy_temp",
      "scgi_temp_path /tmp/scgi_temp",
      "uwsgi_temp_path /tmp/uwsgi_temp",
    ]
  ) {
    assert(
      gateway.includes(directive),
      `${directive} supports a read-only image`,
    );
  }
  assert(
    gateway.includes("client_max_body_size 1501024;") &&
      gateway.includes("location /api/v1/"),
    "gateway admits the shared 1.5 MB import source plus its JSON envelope",
  );
  for (
    const route of [
      "= /auth/verify-email",
      "= /auth/reset-password",
      "= /auth/mfa",
    ]
  ) {
    assert(gateway.includes(`location ${route}`), `${route} is on-demand`);
  }
  assert(
    gateway.includes("try_files $uri $uri/index.html $uri.html") &&
      gateway.includes("max-age=31536000, immutable") &&
      gateway.includes("error_page 404 /404.html"),
    "gateway directly serves extensionless prerendered and fingerprinted assets",
  );
  const profileLocation = [...gateway.matchAll(
    /location ~ "\^\/app\/people\/[^\"]+" \{[\s\S]*?\n {4}\}/g,
  )].map((match) => match[0]).find((location) =>
    location.includes("/internal/person-profile-shell/index.html")
  ) ?? "";
  assert(
    profileLocation.includes(
      "try_files /internal/person-profile-shell/index.html =404",
    ) &&
      !profileLocation.includes("proxy_pass") &&
      gateway.includes("location = /internal/person-profile-shell") &&
      gateway.includes("location ^~ /internal/person-profile-shell/") &&
      gateway.includes('"~^/app/people/[0-9a-fA-F]') &&
      gateway.includes('"/app/people/:personId"'),
    "UUID person paths use one low-cardinality static profile shell without the renderer",
  );
  assert(
    profileShell.includes("export const prerender = true") &&
      activityReportShell.includes("export const prerender = true") &&
      auditShell.includes("export const prerender = true") &&
      gateway.includes(
        "try_files /internal/activity-report-shell/index.html =404",
      ) &&
      gateway.includes("location = /internal/activity-report-shell") &&
      gateway.includes(
        "try_files /internal/person-audit-shell/index.html =404",
      ) &&
      gateway.includes("location = /internal/person-audit-shell") &&
      gateway.includes(
        "try_files /internal/import-report-shell/index.html =404",
      ) &&
      gateway.includes("location = /internal/import-report-shell") &&
      gatewayImage.includes(
        "COPY --from=build --chown=nginx:nginx /app/apps/web/dist/client /usr/share/nginx/html",
      ),
    "the gateway image receives both prerendered reusable person shell artifacts",
  );
  const invitationLocation = gateway.match(
    /location ~ \^\/invite\/\[\^\/\]\+\$ \{[\s\S]*?\n {4}\}/,
  )?.[0] ?? "";
  assert(
    invitationLocation.includes("proxy_hide_header Cache-Control;") &&
      invitationLocation.includes(
        'add_header Cache-Control "private, no-store" always;',
      ),
    "invitation responses expose one private no-store policy through the gateway",
  );
  assert(
    stage("build").includes("pnpm install --frozen-lockfile") &&
      rendererImage.includes("server/entry.mjs"),
    "renderer image uses frozen dependencies and production output",
  );
});

/**
 * The credential endpoints a client can guess secrets through: sign-in, MFA,
 * registration and its email verification, password reset, and every step of
 * accepting an invitation. The contract registry is their authority.
 */
const CREDENTIAL_ROUTES = [
  ["authentication.ts", "/api/v1/sessions"],
  ["authentication.ts", "/api/v1/mfa-challenges"],
  ["authentication.ts", "/api/v1/password-reset-requests"],
  ["authentication.ts", "/api/v1/password-resets"],
  ["registration.ts", "/api/v1/registrations"],
  ["registration.ts", "/api/v1/email-verifications"],
  ["registration.ts", "/api/v1/email-verification-deliveries"],
  ["invitations.ts", "/api/v1/workspace-invitations/accept"],
  ["invitations.ts", "/api/v1/workspace-invitations/authenticate"],
  ["invitations.ts", "/api/v1/workspace-invitations/inspect"],
  ["invitations.ts", "/api/v1/workspace-invitations/mfa"],
  ["invitations.ts", "/api/v1/workspace-invitations/register"],
  ["invitations.ts", "/api/v1/workspace-invitations/verification-delivery"],
] as const;

/** Signed-in or harmless API paths the stricter zone must leave alone. */
const ORDINARY_API_PATHS = [
  "/api/v1/session",
  "/api/v1/sign-out",
  "/api/v1/health",
  "/api/v1/people",
  "/api/v1/settings/sessions",
  "/api/v1/workspace-invitations",
  "/api/v1/sessions/extra",
];

/** One `http`-level `map <source> <variable> { … }` block's body. */
function nginxMap(config: string, variable: string): string {
  return config.match(
    new RegExp(`\\n {2}map \\S+ \\${variable} \\{\\n([\\s\\S]*?)\\n {2}\\}`),
  )?.[1] ?? "";
}

function nginxLocation(config: string, selector: string): string {
  return nginxLocations(config).find((location) =>
    location.selector === selector
  )?.body ?? "";
}

/** The rate a `limit_req_zone` line declares, in requests per second. */
function zoneRate(config: string, zone: string): number {
  const [, amount, unit] = config.match(
    new RegExp(`limit_req_zone \\S+ zone=${zone}:\\d+m rate=(\\d+)r/([sm]);`),
  ) ?? [];
  if (amount === undefined) return Number.NaN;
  return Number(amount) / (unit === "m" ? 60 : 1);
}

/** Why the gateway's API rate limits fall short of GAP-040. */
function rateLimitWeaknesses(config: string): string[] {
  const weaknesses: string[] = [];
  const zones: readonly [string, RegExp][] = [
    [
      "a per-address API zone",
      /^ {2}limit_req_zone \$binary_remote_addr zone=kinship_api:10m rate=\d+r\/s;$/m,
    ],
    [
      "a per-address credential zone",
      /^ {2}limit_req_zone \$kinship_credential_client zone=kinship_credentials:10m rate=\d+r\/m;$/m,
    ],
    [
      "a per-address connection zone",
      /^ {2}limit_conn_zone \$binary_remote_addr zone=kinship_connections:10m;$/m,
    ],
  ];
  for (const [name, pattern] of zones) {
    if (!pattern.test(config)) weaknesses.push(`${name} is missing`);
  }
  const apiRate = zoneRate(config, "kinship_api");
  const credentialRate = zoneRate(config, "kinship_credentials");
  if (
    !(credentialRate > 0 && credentialRate <= 5 && apiRate > credentialRate)
  ) {
    weaknesses.push(
      `the credential zone (${credentialRate}/s) is not stricter than the API zone (${apiRate}/s)`,
    );
  }
  if (
    !/^ {2}limit_req_status 429;$/m.test(config) ||
    !/^ {2}limit_conn_status 429;$/m.test(config)
  ) {
    weaknesses.push("a limited request is not answered 429");
  }
  const api = nginxLocation(config, "/api/v1/");
  for (
    const directive of [
      /^\s*limit_req zone=kinship_api burst=\d+ nodelay;$/m,
      /^\s*limit_req zone=kinship_credentials burst=\d+ nodelay;$/m,
      /^\s*limit_conn kinship_connections \d+;$/m,
    ]
  ) {
    if (!directive.test(api)) weaknesses.push(`/api/v1/ lacks ${directive}`);
  }
  if (
    !/^\s*error_page 429 = @rate_limited;$/m.test(api) ||
    /proxy_intercept_errors on/.test(api)
  ) {
    weaknesses.push(
      "/api/v1/ does not answer its own refusals while passing the API's through",
    );
  }
  return weaknesses;
}

Deno.test("[GAP-040] the gateway limits API and credential request rates per client address", async () => {
  const gateway = await Deno.readTextFile(
    new URL("../gateway/nginx.conf", import.meta.url),
  );
  const credentialMap = nginxMap(gateway, "$kinship_credential_client");
  const pattern = credentialMap.match(/^\s*~(\S+) \$binary_remote_addr;$/m)
    ?.[1];
  assert(
    pattern !== undefined && /^\s*default "";$/m.test(credentialMap),
    "credential requests are keyed by client address and all others by nothing",
  );
  const credential = new RegExp(pattern);
  for (const [file, path] of CREDENTIAL_ROUTES) {
    const routes = await Deno.readTextFile(
      new URL(`../packages/contracts/routes/${file}`, import.meta.url),
    );
    assert(
      routes.includes(`path: "${path}"`),
      `${path} is a real route in the contract registry`,
    );
    assert(credential.test(path), `${path} counts against the credential zone`);
  }
  for (const path of ORDINARY_API_PATHS) {
    assert(!credential.test(path), `${path} is not a credential route`);
  }

  const weaknesses = rateLimitWeaknesses(gateway);
  assert(weaknesses.length === 0, `rate limits: ${weaknesses.join("; ")}`);

  // The pre-GAP-040 gateway, and nginx's default 503 refusal.
  const before = gateway
    .replace(/^ *limit_(req|conn)(_zone|_status)?\b.*\n/gm, "")
    .replace(/^ *error_page 429 .*\n/m, "");
  assert(
    rateLimitWeaknesses(before).length === 9,
    `an unlimited gateway is rejected: ${rateLimitWeaknesses(before)}`,
  );
  assert(
    rateLimitWeaknesses(
      gateway.replace("limit_req_status 429;", "limit_req_status 503;"),
    ).length === 1,
    "a 503 refusal is rejected",
  );
  assert(
    rateLimitWeaknesses(
      gateway.replace(/rate=\d+r\/m;/, "rate=600r/m;"),
    ).length === 1,
    "a credential zone as loose as the API zone is rejected",
  );

  const limited = nginxLocation(gateway, "@rate_limited");
  const body = limited.match(/^\s*return 429 '(\{[^']*\})';$/m)?.[1];
  assert(body !== undefined, "the rate-limit answer returns a JSON body");
  const parsed = JSON.parse(body) as { code?: string; detail?: string };
  assert(
    body ===
        JSON.stringify(
          problemBody(
            429,
            parsed.code ?? "",
            "Too many requests",
            parsed.detail ?? "",
          ),
        ) && parsed.code === "request_rate_limited",
    `the rate-limit answer is the API's RFC 9457 problem shape: ${body}`,
  );
  assert(
    /^\s*default_type application\/problem\+json;$/m.test(limited) &&
      /^\s*add_header Cache-Control "no-store" always;$/m.test(limited) &&
      /^\s*add_header Retry-After "\d+" always;$/m.test(limited) &&
      /^\s*include \/etc\/nginx\/security_headers\.conf;$/m.test(limited),
    "the rate-limit answer is an uncached problem with the browser policy",
  );
});

Deno.test("[GAP-040] TLS offers only modern forward-secret AEAD suites", async () => {
  const gateway = await Deno.readTextFile(
    new URL("../gateway/nginx.conf", import.meta.url),
  );
  const weaknesses = tlsWeaknesses(gateway);
  assert(weaknesses.length === 0, `TLS weaknesses: ${weaknesses.join("; ")}`);

  const before = "    ssl_protocols TLSv1.2 TLSv1.3;\n";
  assert(
    tlsWeaknesses(before).length === 3,
    "the library-default cipher configuration is rejected",
  );
  for (
    const weak of [
      "ECDHE-RSA-AES128-SHA",
      "ECDHE-RSA-AES128-SHA256",
      "AES128-GCM-SHA256",
      "DHE-RSA-AES128-GCM-SHA256",
      "ECDHE-RSA-DES-CBC3-SHA",
    ]
  ) {
    assert(
      tlsWeaknesses(
        `ssl_protocols TLSv1.2 TLSv1.3;\nssl_ciphers ${weak};\nssl_prefer_server_ciphers off;\nssl_session_tickets off;\n`,
      ).length === 1,
      `${weak} is rejected`,
    );
  }
  assert(
    tlsWeaknesses(
      "ssl_protocols TLSv1 TLSv1.1 TLSv1.2 TLSv1.3;\nssl_ciphers ECDHE-RSA-AES128-GCM-SHA256;\nssl_prefer_server_ciphers on;\nssl_session_tickets on;\n",
    ).length === 3,
    "legacy protocols, server preference, and session tickets are rejected",
  );
});

Deno.test("[GAP-040] HSTS stays scoped to the deployment host", async () => {
  const securityHeaders = await Deno.readTextFile(
    new URL("../gateway/security_headers.conf", import.meta.url),
  );
  const value = addedHeaderValue(securityHeaders, "Strict-Transport-Security");
  assert(
    value === "max-age=31536000" && hstsWeaknesses(value).length === 0,
    `HSTS keeps one year without asserting sibling hosts: ${value}`,
  );
  for (
    const rejected of [
      "max-age=31536000; includeSubDomains",
      "max-age=63072000; includeSubDomains; preload",
      "max-age=86400",
    ]
  ) {
    assert(hstsWeaknesses(rejected).length > 0, `${rejected} is rejected`);
  }
  const contract = await Deno.readTextFile(
    new URL("../docs/architecture/compose-contract.md", import.meta.url),
  );
  assert(
    /includeSubDomains/.test(contract) && /GAP-040/.test(contract),
    "the compose contract records the HSTS decision",
  );
});

Deno.test("[GAP-040] the CSP allows scripts only from the origin and hashed inline scripts", async () => {
  const securityHeaders = await Deno.readTextFile(
    new URL("../gateway/security_headers.conf", import.meta.url),
  );
  const policy = addedHeaderValue(securityHeaders, "Content-Security-Policy");
  assert(policy !== undefined, "the gateway serves a CSP");
  const directives = cspDirectives(policy);
  const scriptSources = directives.get("script-src");
  const weaknesses = scriptSourceWeaknesses(scriptSources);
  assert(weaknesses.length === 0, `script-src: ${weaknesses.join("; ")}`);
  assert(
    !directives.has("script-src-elem") && !directives.has("script-src-attr"),
    "no narrower script directive reopens inline scripts",
  );

  const inline = await sourceInlineScripts(
    new URL("../apps/web/src/", import.meta.url),
  );
  assert(inline.length > 0, "the theme script is an inline script");
  const expected = new Set(await Promise.all(inline.map(scriptHashSource)));
  const hashes = new Set(
    scriptSources!.filter((source) => source !== "'self'"),
  );
  for (const hash of expected) {
    assert(hashes.has(hash), `script-src allows the inline script ${hash}`);
  }
  for (const hash of hashes) {
    assert(expected.has(hash), `script-src allows a stale inline hash ${hash}`);
  }

  assert(
    JSON.stringify(directives.get("style-src")) ===
      JSON.stringify(["'self'", "'unsafe-inline'"]),
    "style-src keeps inline styles, which Base UI's <style> elements need",
  );
  for (
    const [name, sources] of [
      ["default-src", ["'self'"]],
      ["object-src", ["'none'"]],
      ["base-uri", ["'self'"]],
      ["frame-ancestors", ["'none'"]],
      ["form-action", ["'self'"]],
      ["connect-src", ["'self'"]],
    ] as const
  ) {
    assert(
      JSON.stringify(directives.get(name)) === JSON.stringify(sources),
      `${name} stays ${sources.join(" ")}`,
    );
  }

  const before = cspDirectives(
    "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'",
  );
  assert(
    scriptSourceWeaknesses(before.get("script-src")).includes(
      "'unsafe-inline' is allowed",
    ),
    "the pre-GAP-040 script-src is rejected",
  );
  for (
    const weak of [
      ["'self'", "'unsafe-eval'"],
      ["'self'", "'unsafe-hashes'", "'sha256-AAAA'"],
      ["'self'", "https:"],
      ["'self'", "*"],
      ["'self'", "data:"],
      ["'self'", "'nonce-static'"],
      ["'sha256-AAAA'"],
    ]
  ) {
    assert(
      scriptSourceWeaknesses(weak).length > 0,
      `script-src ${weak.join(" ")} is rejected`,
    );
  }
  assert(
    scriptSourceWeaknesses(undefined).length > 0,
    "a policy without script-src is rejected",
  );
});

Deno.test("[GAP-040] Astro sources carry no inline event handler attributes", async () => {
  // CSP cannot allow `onclick="…"` without 'unsafe-inline' or
  // 'unsafe-hashes'; a handler belongs in a script.
  const offenders: string[] = [];
  async function scan(directory: URL): Promise<void> {
    for await (const entry of Deno.readDir(directory)) {
      if (entry.isDirectory) {
        await scan(new URL(`${entry.name}/`, directory));
        continue;
      }
      if (!entry.name.endsWith(".astro")) continue;
      const source = await Deno.readTextFile(new URL(entry.name, directory));
      for (
        const [attribute] of source.matchAll(/<[a-zA-Z][^>]*?\son[a-z]+=/g)
      ) {
        offenders.push(`${entry.name}: ${attribute}`);
      }
    }
  }
  await scan(new URL("../apps/web/src/", import.meta.url));
  assert(offenders.length === 0, `inline handlers: ${offenders.join("; ")}`);
});

Deno.test("[GAP-040] every proxied location forwards the gateway's request identifier", async () => {
  const gateway = await Deno.readTextFile(
    new URL("../gateway/nginx.conf", import.meta.url),
  );
  const proxied = nginxLocations(gateway).filter(({ body }) =>
    /^\s*proxy_pass /m.test(body)
  );
  assert(
    proxied.length >= 8,
    `the gateway proxies the API, readiness, and renderer locations (${proxied.length})`,
  );
  for (const { selector, body } of proxied) {
    assert(
      /^\s*proxy_set_header X-Request-Id \$request_id;$/m.test(body),
      `${selector} forwards the gateway's own request identifier`,
    );
  }
});

Deno.test("AUTH-003 E2E has no direct product API or host Astro escape hatch", async () => {
  const [launcher, flow] = await Promise.all([
    Deno.readTextFile(new URL("./e2e.ts", import.meta.url)),
    Deno.readTextFile(
      new URL("../tests/e2e/sign-in.AUTH-003.spec.ts", import.meta.url),
    ),
  ]);
  assert(
    !launcher.includes("const astro = await startAstro"),
    "E2E does not start host Astro",
  );
  assert(
    !launcher.includes("TEST_API_ORIGIN") && !flow.includes("TEST_API_ORIGIN"),
    "product actions use the sole gateway origin",
  );
  // GAP-036: the specs take their origins from the shared E2E support, so the
  // same guard covers every support module.
  const supportDirectory = new URL("../tests/e2e/support/", import.meta.url);
  const support = new Map<string, string>();
  for await (const entry of Deno.readDir(supportDirectory)) {
    if (!entry.isFile || !entry.name.endsWith(".ts")) continue;
    support.set(
      entry.name,
      await Deno.readTextFile(new URL(entry.name, supportDirectory)),
    );
  }
  assert(support.has("env.ts"), "E2E support declares its origins");
  for (const [name, source] of support) {
    assert(
      !source.includes("TEST_API_ORIGIN"),
      `E2E support ${name} uses the sole gateway origin`,
    );
    assert(
      name === "env.ts" || !source.includes("TEST_WEB_ORIGIN"),
      `E2E support ${name} takes the gateway origin from env.ts`,
    );
  }
  assert(
    /export const origin = process\.env\.TEST_WEB_ORIGIN \?\?/.test(
      support.get("env.ts")!,
    ),
    "E2E support's one origin is the gateway origin",
  );
});

Deno.test("[APP-003C] static person shell keeps the accepted canonical sections", async () => {
  // The section registry (GAP-028) is the one list the shell, the section
  // navigation, and this contract read; the shell renders every section's
  // chrome from it through `PersonSection.astro`.
  const [shell, sectionChrome] = await Promise.all([
    Deno.readTextFile(
      new URL(
        "../apps/web/src/pages/internal/person-profile-shell.astro",
        import.meta.url,
      ),
    ),
    Deno.readTextFile(
      new URL(
        "../apps/web/src/components/person/PersonSection.astro",
        import.meta.url,
      ),
    ),
  ]);
  const expected = [
    "identity-summary",
    "important-dates",
    "contact-methods",
    "addresses",
    "relationships",
    "first-meeting",
    "work",
    "food-preferences",
    "pets",
    "life-events",
    "notes",
    "conversations",
    "calls",
    "activities",
    "tasks",
    "reminders",
    "stay-in-touch",
    "gifts",
    "debts",
    "documents",
    "photos",
    "audit-summary",
  ];
  assert(
    JSON.stringify(PERSON_SECTIONS.map((section) => section.id)) ===
      JSON.stringify(expected),
    "the registry declares every page-catalog section once and in order",
  );
  assert(
    shell.includes('from "../../features/person/sections.ts"') &&
      shell.includes("PERSON_SECTIONS.map(") &&
      !/const sections = \[/.test(shell),
    "the shell renders its sections from the registry, not its own list",
  );
  assert(
    shell.includes("href={`?section=${section.id}`}") &&
      sectionChrome.includes("data-profile-section={id}") &&
      shell.includes("data-zone={zone.id}") &&
      sectionChrome.includes("No empty result is being inferred"),
    "sections use canonical query deep links, structural zone metadata, and honest unavailable states",
  );
  assert(
    !shell.includes("/app/people/:personId/") &&
      !shell.includes("/app/people/${personId}/"),
    "the shell introduces no person-specific subpage tree",
  );
});

Deno.test("[REL-015] settings profile reserves alerts for validation", async () => {
  const profile = await Deno.readTextFile(
    new URL(
      "../apps/web/src/pages/app/settings/profile.astro",
      import.meta.url,
    ),
  );
  const alerts = profile.match(/\brole=["']alert["']/g) ?? [];
  const lifecycleBlockers = profile.match(
    /<p\b[^>]*\bid=["']lifecycle-blockers["'][^>]*>/,
  )?.[0];

  assert(
    alerts.length === 1,
    `the settings profile declares exactly one alert; found ${alerts.length}`,
  );
  assert(
    lifecycleBlockers !== undefined &&
      !/\brole=["']alert["']/.test(lifecycleBlockers),
    "standing lifecycle blockers are not an alert",
  );
});

Deno.test("[GAP-047] personalization lists exactly the sections the workspace can switch off", () => {
  const switchable = PERSON_SECTIONS.flatMap((section) =>
    section.visibilityKey ? [[section.visibilityKey, section.title]] : []
  );
  assert(
    JSON.stringify(
      PROFILE_MODULE_DEFAULTS.map((module) => [module.key, module.name]),
    ) === JSON.stringify(switchable),
    "each switchable registry section is a default profile module, in registry order and under its title",
  );
});
