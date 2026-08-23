function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("production-like Compose exposes only the gateway application entry", async () => {
  const [
    base,
    test,
    gateway,
    gatewayImage,
    profileShell,
    activityReportShell,
    auditShell,
    web,
  ] = await Promise
    .all([
      Deno.readTextFile(new URL("../compose.yaml", import.meta.url)),
      Deno.readTextFile(new URL("../compose.test.yaml", import.meta.url)),
      Deno.readTextFile(new URL("../gateway/nginx.conf", import.meta.url)),
      Deno.readTextFile(new URL("../Dockerfile.gateway", import.meta.url)),
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
  assert(
    base.includes("  gateway:") && base.includes("  web:"),
    "stack has gateway and private renderer",
  );
  assert(
    test.includes('"127.0.0.1::8443"') &&
      !test.includes('"127.0.0.1::8000"') &&
      !test.includes('"127.0.0.1::5432"'),
    "test publishes a Docker-assigned gateway port and keeps API private",
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
    gateway.includes("location /api/v1/") &&
      gateway.includes("proxy_pass $api_upstream") &&
      gateway.includes(
        "proxy_set_header X-Kinship-Client-Address $remote_addr",
      ),
    "gateway owns API routing and trusted client address",
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
    web.includes("pnpm install --frozen-lockfile") &&
      web.includes("server/entry.mjs"),
    "renderer image uses frozen dependencies and production output",
  );
});

Deno.test("AUTH-003 E2E has no direct product API or host Astro escape hatch", async () => {
  const [launcher, flow] = await Promise.all([
    Deno.readTextFile(new URL("./e2e.ts", import.meta.url)),
    Deno.readTextFile(
      new URL("../tests/e2e/auth-003.spec.ts", import.meta.url),
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
});

Deno.test("[APP-003C] static person shell keeps the accepted canonical sections", async () => {
  const shell = await Deno.readTextFile(
    new URL(
      "../apps/web/src/pages/internal/person-profile-shell.astro",
      import.meta.url,
    ),
  );
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
  const declared = [...shell.matchAll(
    /\["([a-z-]+)", "[^"]+", "(?:core|independent)"\]/g,
  )].map((match) => match[1]);
  assert(
    JSON.stringify(declared) === JSON.stringify(expected),
    "the shell declares every page-catalog section once and in order",
  );
  assert(
    shell.includes("href={`?section=${id}`}") &&
      shell.includes("data-profile-section={id}") &&
      shell.includes("data-load-mode={loadMode}") &&
      shell.includes("No empty result is being inferred"),
    "sections use canonical query deep links and honest independent states",
  );
  assert(
    !shell.includes("/app/people/:personId/") &&
      !shell.includes("/app/people/${personId}/"),
    "the shell introduces no person-specific subpage tree",
  );
});
