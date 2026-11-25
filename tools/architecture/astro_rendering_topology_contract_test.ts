const MAX_DOCUMENT_LENGTH = 65_536;
const MAX_ROUTE_ROWS = 32;

type Route = Readonly<{ id: string; path: string }>;

/**
 * ADR 0007: only the pages whose first response carries request-time data,
 * the active legal documents, render on demand.
 */
const EXPECTED_ON_DEMAND_ROUTES: readonly Route[] = [
  { id: "legal.privacy", path: "/privacy" },
  { id: "legal.terms", path: "/terms" },
];

const CATALOG_FIXTURE = `pages:
  - id: legal.privacy
    path: /privacy
    access: public
    rendering: on-demand
  - id: legal.terms
    path: /terms
    access: public
    rendering: on-demand
  - id: auth.mfa
    path: /auth/mfa
    access: authentication-challenge
    rendering: static-shell-islands
`;

const NETWORK_CLAIMS = [
  "| `gateway` | Sole public entry point |",
  "| `web` | Private |",
  "| `api` | Private |",
  "| `worker`, `migrate`, `postgres`, `object-store`, `mail`, and `otel-collector` | Private |",
] as const;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function normalize(text: string): string {
  return text.replaceAll("\r\n", "\n");
}

function extractUniqueH2Section(
  document: string,
  heading: string,
): string | null {
  const normalized = normalize(document);
  if (normalized.length > MAX_DOCUMENT_LENGTH) {
    return null;
  }

  const exactHeading = `## ${heading}`;
  const headingMatches = [...normalized.matchAll(/^## .+$/gm)].filter(
    (match) => match[0] === exactHeading,
  );
  if (headingMatches.length !== 1) {
    return null;
  }

  const start = headingMatches[0]!.index;
  const remainder = normalized.slice(start + exactHeading.length);
  const nextH2Offset = remainder.search(/^## .+$/m);
  const end = nextH2Offset === -1
    ? normalized.length
    : start + exactHeading.length + nextH2Offset;
  return normalized.slice(start, end).trimEnd();
}

function parseOnDemandRoutes(catalog: string): Route[] {
  const routes: Route[] = [];
  const blocks = normalize(catalog).split(/\n(?=[ ]{2}- id: )/);
  for (const block of blocks) {
    const page = /^[ ]{2}- id: ([^\n]+)\n[ ]{4}path: ([^\n]+)/m.exec(block);
    if (page === null) {
      continue;
    }
    if (/^[ ]{4}rendering: on-demand$/m.test(block)) {
      routes.push({ id: page[1]!, path: page[2]! });
    }
  }
  return routes;
}

function routesEqual(
  actual: readonly Route[],
  expected: readonly Route[],
): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function gatewaySection(routes: readonly Route[]): string {
  const routeRows = routes.map(({ id, path }) =>
    `| \`${id}\` | \`${path}\` | private \`web\` |`
  );
  return [
    "## Gateway Routing",
    "",
    "The gateway serves static, prerendered, and fingerprinted Astro output directly. It routes `/api/v1/*` to the private `api` service and routes only the following cataloged on-demand pages to the private `web` renderer:",
    "",
    "| Page catalog ID | Path pattern | Destination |",
    "| --- | --- | --- |",
    ...routeRows,
    "",
    "No other page or request path may be routed to `web`. Production and test keep both `web` and `api` private; development alone overrides `web` to run `astro dev`.",
  ].join("\n");
}

function validateGatewayRouting(
  document: string,
  routes: readonly Route[],
): boolean {
  const section = extractUniqueH2Section(document, "Gateway Routing");
  if (section === null) {
    return false;
  }

  const rendererRows = section.split("\n").filter((line) =>
    /^\| `[^`]+` \| `[^`]+` \| private `web` \|$/.test(line)
  );
  if (rendererRows.length > MAX_ROUTE_ROWS) {
    return false;
  }

  const expected = gatewaySection(routes).split("\n");
  const actual = section.split("\n");
  if (actual.length !== expected.length) {
    return false;
  }
  if (
    actual[0] !== expected[0] || actual[1] !== expected[1] ||
    actual[2] !== expected[2] || actual[3] !== expected[3] ||
    actual[4] !== expected[4] || actual[5] !== expected[5] ||
    actual.at(-2) !== expected.at(-2) || actual.at(-1) !== expected.at(-1)
  ) {
    return false;
  }
  return routesEqual(
    actual.slice(6, 6 + routes.length).map((row) => {
      const match = /^\| `([^`]+)` \| `([^`]+)` \| private `web` \|$/.exec(row);
      return { id: match?.[1] ?? "", path: match?.[2] ?? "" };
    }),
    routes,
  );
}

function networkExposureSection(): string {
  return [
    "## Network Exposure",
    "",
    "Public reachability is restricted to this complete allowlist:",
    "",
    "| Service or service class | Production-like and test reachability |",
    "| --- | --- |",
    ...NETWORK_CLAIMS,
    "",
    "Development-only loopback exposure does not make a service public.",
    "Test ports are dynamically assigned or project-scoped for concurrent worktrees and CI jobs.",
  ].join("\n");
}

function validateNetworkExposure(document: string): boolean {
  const section = extractUniqueH2Section(document, "Network Exposure");
  if (section === null) {
    return false;
  }

  const expected = networkExposureSection().split("\n");
  const actual = section.split("\n");
  if (actual.length !== expected.length) {
    return false;
  }
  if (
    actual[0] !== expected[0] || actual[1] !== expected[1] ||
    actual[2] !== expected[2] || actual[3] !== expected[3] ||
    actual[4] !== expected[4] || actual[5] !== expected[5] ||
    actual.at(-3) !== expected.at(-3) || actual.at(-2) !== expected.at(-2) ||
    actual.at(-1) !== expected.at(-1)
  ) {
    return false;
  }
  return actual.slice(6, 6 + NETWORK_CLAIMS.length).every(
    (claim, index) => claim === NETWORK_CLAIMS[index],
  );
}

function issueUnless(condition: boolean, issue: string): string[] {
  return condition ? [] : [issue];
}

function catalogIssues(catalog: string): string[] {
  return issueUnless(
    routesEqual(parseOnDemandRoutes(catalog), EXPECTED_ON_DEMAND_ROUTES),
    "page catalog: exact on-demand ID/path set is required",
  );
}

function requireClauses(
  label: string,
  document: string,
  clauses: readonly string[],
  issues: string[],
): void {
  for (const clause of clauses) {
    if (!document.includes(clause)) {
      issues.push(`${label}: missing DG-01 clause: ${clause}`);
    }
  }
}

Deno.test("FND-001S in-memory complete-section discriminators", async (t) => {
  const routes = parseOnDemandRoutes(CATALOG_FIXTURE);
  const canonicalGateway = gatewaySection(routes);
  const canonicalExposure = networkExposureSection();
  const lastRoute = "| `legal.terms` | `/terms` | private `web` |";
  const extraRoute = "| `unexpected.route` | `/unexpected` | private `web` |";

  assert(
    catalogIssues(CATALOG_FIXTURE).length === 0,
    "canonical catalog fixture must pass",
  );
  assert(
    catalogIssues(
      CATALOG_FIXTURE.replace("rendering: on-demand", "rendering: static"),
    ).length === 1,
    "changed catalog fixture must fail",
  );
  assert(
    issueUnless(true, "unused").length === 0,
    "true issue guard must be empty",
  );
  assert(
    issueUnless(false, "expected").length === 1,
    "false issue guard must report",
  );

  await t.step("canonical unique Gateway Routing section passes", () => {
    assert(
      validateGatewayRouting(canonicalGateway, routes),
      "canonical gateway section rejected",
    );
  });
  await t.step("contiguous extra route row fails", () => {
    const changed = canonicalGateway.replace(
      lastRoute,
      `${lastRoute}\n${extraRoute}`,
    );
    assert(
      !validateGatewayRouting(changed, routes),
      "contiguous extra route was accepted",
    );
  });
  await t.step("separated extra route row fails", () => {
    const changed = `${canonicalGateway}\n\nRoute appendix:\n\n${extraRoute}`;
    assert(
      !validateGatewayRouting(changed, routes),
      "separated extra route was accepted",
    );
  });
  await t.step("later contradictory renderer prose fails", () => {
    const changed =
      `${canonicalGateway}\n\nThe gateway also routes /reports/* to the web renderer.`;
    assert(
      !validateGatewayRouting(changed, routes),
      "contradictory renderer prose was accepted",
    );
  });
  await t.step("second route table fails", () => {
    const changed =
      `${canonicalGateway}\n\n| Path | Destination |\n| --- | --- |\n| /shadow | web |`;
    assert(
      !validateGatewayRouting(changed, routes),
      "second route table was accepted",
    );
  });
  await t.step("missing route fails", () => {
    assert(
      !validateGatewayRouting(
        canonicalGateway.replace(`${lastRoute}\n`, ""),
        routes,
      ),
      "missing route was accepted",
    );
  });
  await t.step("duplicate route fails", () => {
    const changed = canonicalGateway.replace(
      lastRoute,
      `${lastRoute}\n${lastRoute}`,
    );
    assert(
      !validateGatewayRouting(changed, routes),
      "duplicate route was accepted",
    );
  });
  await t.step("malformed route table fails", () => {
    const changed = canonicalGateway.replace(
      "| --- | --- | --- |",
      "| --- | --- |",
    );
    assert(
      !validateGatewayRouting(changed, routes),
      "malformed route table was accepted",
    );
  });
  await t.step("malformed route row fails", () => {
    const changed = canonicalGateway.replace(
      lastRoute,
      "| legal.terms | /terms | private web |",
    );
    assert(
      !validateGatewayRouting(changed, routes),
      "malformed route row was accepted",
    );
  });
  await t.step("duplicate Gateway Routing section fails", () => {
    const changed = `${canonicalGateway}\n\n${canonicalGateway}`;
    assert(
      !validateGatewayRouting(changed, routes),
      "duplicate section was accepted",
    );
  });
  await t.step("oversized gateway document fails closed", () => {
    const changed = `${canonicalGateway}\n${"x".repeat(MAX_DOCUMENT_LENGTH)}`;
    assert(
      !validateGatewayRouting(changed, routes),
      "oversized document was accepted",
    );
  });
  await t.step("excessive route shape fails closed", () => {
    const excessRows = Array.from(
      { length: MAX_ROUTE_ROWS + 1 },
      (_, index) =>
        `| \`extra.${index}\` | \`/extra/${index}\` | private \`web\` |`,
    ).join("\n");
    const changed = canonicalGateway.replace(
      lastRoute,
      `${lastRoute}\n${excessRows}`,
    );
    assert(
      !validateGatewayRouting(changed, routes),
      "excessive route set was accepted",
    );
  });
  await t.step(
    "a following level-two section does not contaminate Gateway Routing",
    () => {
      const changed =
        `${canonicalGateway}\n\n## Following Section\n\nUnrelated content.`;
      assert(
        validateGatewayRouting(changed, routes),
        "bounded gateway section was rejected",
      );
    },
  );

  await t.step("canonical unique Network Exposure section passes", () => {
    assert(
      validateNetworkExposure(canonicalExposure),
      "canonical exposure section rejected",
    );
  });
  await t.step("missing gateway claim fails", () => {
    assert(
      !validateNetworkExposure(
        canonicalExposure.replace(`${NETWORK_CLAIMS[0]}\n`, ""),
      ),
      "missing gateway claim was accepted",
    );
  });
  await t.step("malformed exposure table fails", () => {
    const changed = canonicalExposure.replace("| --- | --- |", "| --- |");
    assert(
      !validateNetworkExposure(changed),
      "malformed exposure table was accepted",
    );
  });
  await t.step("mixed public/private claim fails", () => {
    const changed = canonicalExposure.replace(
      "| `web` | Private |",
      "| `web` | Private and public |",
    );
    assert(
      !validateNetworkExposure(changed),
      "mixed exposure claim was accepted",
    );
  });
  await t.step("duplicate exposure claim fails", () => {
    const changed = canonicalExposure.replace(
      NETWORK_CLAIMS[1],
      `${NETWORK_CLAIMS[1]}\n${NETWORK_CLAIMS[1]}`,
    );
    assert(
      !validateNetworkExposure(changed),
      "duplicate exposure claim was accepted",
    );
  });
  await t.step("unrecognized exposure claim fails", () => {
    const changed = canonicalExposure.replace(
      NETWORK_CLAIMS[1],
      "| `web` | Internal-ish |",
    );
    assert(
      !validateNetworkExposure(changed),
      "unrecognized exposure claim was accepted",
    );
  });
  await t.step("synonym-based additional-public claim fails", () => {
    const changed =
      `${canonicalExposure}\nThe \`api\` service is also internet-facing.`;
    assert(
      !validateNetworkExposure(changed),
      "public synonym claim was accepted",
    );
  });
  await t.step("additional public service claim fails", () => {
    const changed = canonicalExposure.replace(
      NETWORK_CLAIMS[0],
      `${NETWORK_CLAIMS[0]}\n| \`api\` | Public |`,
    );
    assert(
      !validateNetworkExposure(changed),
      "additional public service was accepted",
    );
  });
  await t.step("duplicate Network Exposure section fails", () => {
    const changed = `${canonicalExposure}\n\n${canonicalExposure}`;
    assert(
      !validateNetworkExposure(changed),
      "duplicate exposure section was accepted",
    );
  });
});

Deno.test("FND-001S authoritative repository contracts require DG-01 topology", async () => {
  const paths = {
    agents: "AGENTS.md",
    adr: "docs/architecture/decisions/0001-astro-personalized-rendering.md",
    technology: "docs/architecture/technology-baseline.md",
    compose: "docs/architecture/compose-contract.md",
    configuration: "docs/architecture/configuration-and-secrets.md",
    observability: "docs/architecture/observability.md",
    catalog: "docs/product/page-catalog.yaml",
    informationArchitecture: "docs/product/information-architecture.md",
  } as const;
  const keys = Object.keys(paths) as (keyof typeof paths)[];
  const documents = Object.fromEntries(
    await Promise.all(
      keys.map(async (key) => [key, await Deno.readTextFile(paths[key])]),
    ),
  ) as Record<keyof typeof paths, string>;
  const catalogRoutes = parseOnDemandRoutes(documents.catalog);
  const issues = catalogIssues(documents.catalog);

  issues.push(...issueUnless(
    validateGatewayRouting(documents.compose, catalogRoutes),
    "compose: complete unique Gateway Routing section does not match the catalog-derived allowlist",
  ));
  issues.push(...issueUnless(
    validateNetworkExposure(documents.compose),
    "compose: complete unique Network Exposure section does not match the public/private allowlist",
  ));

  requireClauses("AGENTS.md", documents.agents, [
    "The production-like frontend topology keeps `web` as a private Astro renderer for exactly the page catalog's `on-demand` routes.",
    "The gateway serves static, prerendered, and fingerprinted output, forwards `/api/v1/*` to the private `api`, and is the only public entry point.",
    "Development alone may override `web` to run `astro dev`.",
  ], issues);
  requireClauses("ADR 0001", documents.adr, [
    "public and stable content is static;",
    "Production and test run a private Astro `web` renderer for exactly the page catalog's two `on-demand` ID/path pairs, `legal.privacy` and `legal.terms`.",
    "The gateway serves static and prerendered output, routes `/api/v1/*` to private `api`, routes only those two on-demand patterns to private `web`, and is the sole public entry point.",
    "Development alone replaces the private renderer command with `astro dev`.",
  ], issues);
  // Wrapped prose and padded table cells are compared with runs of
  // whitespace collapsed, so reflowing either document keeps the pin.
  const flatten = (text: string) => text.replace(/\s+/g, " ");
  requireClauses("ADR 0001", flatten(documents.adr), [
    "token, invitation, MFA, and compliance pages are prerendered shells that read their token or state in the browser;",
    "only a page whose first response carries request-time data renders on demand, as ADR 0007 decides, and it requires a page-catalog update and measured reason.",
  ], issues);
  requireClauses(
    "information architecture",
    flatten(documents.informationArchitecture),
    [
      "| Marketing and API reference | Static | Public and stable content. |",
      "| Legal documents | On-demand (ADR 0007) | Request-time public data, readable without JavaScript. |",
      "| Token, invitation, MFA, and compliance pages | Static shell with an island | Served `private, no-store`; the island reads the token or state in the browser. |",
    ],
    issues,
  );
  requireClauses("technology baseline", documents.technology, [
    "`web` is a long-running private Astro renderer in production and test and an `astro dev` server only in development.",
    "`web` may consume only generated API contracts, a private API origin, forwarded request context, and renderer operations configuration.",
    "It receives no database, object-store, provider credential, identity key, backend-internal import, or direct-adapter authority.",
  ], issues);
  requireClauses("Compose contract", documents.compose, [
    "The gateway's own readiness does not depend on `web`; it forwards an on-demand request to `web` and returns a bounded unavailable response when that dependency is not ready, unless it still holds a successful render of that page.",
    "`web` liveness reports whether its renderer process is alive; readiness additionally requires the renderer to accept requests and its private `api` origin to be reachable.",
    "Development alone overrides the `web` command to `astro dev`; production-like and test profiles use the private production renderer.",
  ], issues);
  requireClauses("configuration contract", documents.configuration, [
    "The private Astro renderer receives only a private API origin, forwarded request context, generated API contracts, and renderer operations configuration.",
    "It receives no database or object-store configuration, provider credentials, identity keys, backend-internal imports, or direct-adapter authority.",
  ], issues);
  requireClauses("observability contract", documents.observability, [
    "Gateway-to-`web`-to-`api` requests preserve one correlation context, and each hop records its own service span.",
    "Renderer telemetry uses safe route templates and redacts token path segments, query values, cookies, authorization data, verification and reset data, invitation data, MFA data, and compliance payloads.",
    "Token, MFA, invitation, and compliance pages use `Cache-Control: private, no-store`; the on-demand legal pages use `Cache-Control: no-cache` behind the gateway's five-minute shared copy; fingerprinted static assets use `Cache-Control: public, max-age=31536000, immutable`.",
  ], issues);

  assert(
    issues.length === 0,
    `Missing accepted DG-01 topology clauses (${issues.length}):\n- ${
      issues.join("\n- ")
    }`,
  );
});
