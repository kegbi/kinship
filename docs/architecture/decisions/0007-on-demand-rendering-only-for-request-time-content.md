# ADR 0007: On-Demand Rendering Only For Request-Time Content

- Status: accepted; implemented by AUD-G5
- Date: 2026-11-07
- Amends: [ADR 0001](0001-astro-personalized-rendering.md)

## Context

ADR 0001 sends five routes to the private Astro renderer: `auth.verify-email`,
`auth.reset`, `auth.mfa`, `invitation.accept`, and `compliance.accept`. The
2026-11-07 audit (FER-03) found that none of them reads the request:

- Each returns byte-identical HTML for every token, query, and cookie.
- Their only server work sets `Cache-Control: private, no-store` and
  `Referrer-Policy: no-referrer`, and the gateway already replaces both.
- The token is read in the browser and then removed from the URL with
  `history.replaceState`.

The renderer still costs something:

- It is a 1.08 GB image that carries the whole pnpm devDependency tree.
- The gateway's `/gateway-health` depends on it.
- With `output: "server"`, every new page needs the renderer unless it remembers
  `prerender = true`.

FER-10 found the opposite case. `legal.privacy` and `legal.terms` are cataloged
as `static`, but their whole body is the active legal document, which client
JavaScript fetches through a five-level module chain. Without JavaScript they
show nothing.

## Decision

On 2026-11-07 the product owner accepted option B of decision D1 in the audit
remediation plan.

- **Only `/privacy` and `/terms` render on demand.** Their first response
  carries request-time public data: the active legal document, read from the
  API's public `GET /api/v1/legal-documents/{documentType}`. The gateway caches
  the rendered page for about five minutes, so a burst of visits costs one
  render. The pages show their text without JavaScript.
- **The five former on-demand routes become static.**
  - `/auth/verify-email`, `/auth/reset-password`, `/auth/mfa`, and
    `/app/compliance` are prerendered.
  - `/invite/:token` is served from an internal shell, like the person, journal,
    and import-report shells.
  - nginx serves all five with `Cache-Control: private, no-store` and the shared
    security headers, which include `Referrer-Policy: no-referrer`.
- **Pages are static by default.** Astro uses `output: "static"` with the Node
  adapter, so a page is prerendered unless it opts out with
  `export const prerender = false`. Only the catalog's on-demand routes opt out.
- **The renderer stays private and small.** Its image carries only runtime
  dependencies. The gateway's own health does not depend on it. A renderer
  outage affects only the two legal pages, which then answer the gateway's
  bounded unavailable response.
- **The topology rule in `AGENTS.md` stays true.** `web` renders exactly the
  catalog's `on-demand` routes; the catalog now lists two of them.

## Consequences

- AUD-G5 implements this decision. In the same candidate, it updates every
  clause that encodes the old topology:
  - ADR 0001's sentence about "five `on-demand` ID/path pairs";
  - the catalog entries: `legal.privacy` and `legal.terms` become `on-demand`,
    and each of the other five takes the strategy that matches its definition;
  - the Gateway Routing section of `compose-contract.md`;
  - `tools/architecture/astro_rendering_topology_contract_test.ts`;
  - `tools/web_build_output_test.ts` and the gateway contract tests.

  ADR 0001 now describes the two on-demand routes, and the FND-001S test
  enforces them.
- The legal pages become readable, and crawlable, without JavaScript. A newly
  activated legal version can take up to the cache lifetime to appear on the
  public page. Acceptance always reads the API, never this page.
- The five token and compliance routes no longer depend on a second process. A
  renderer outage no longer marks the only public entry point unhealthy.
- A new page is static unless the catalog and a measured reason say otherwise.
  ADR 0001's rule becomes the configuration default instead of a convention.

## Alternatives Rejected

- **Retire the renderer (option A).** This removes a service, but `/privacy` and
  `/terms` would stay client-fetched; a `<noscript>` link to a JSON document is
  not a reading experience. It also changes the topology sentence in
  `AGENTS.md`.
- **Keep the five on-demand routes (option C).** This keeps a renderer whose
  output never varies, and keeps the gateway's health coupled to it, for no
  user-visible benefit.
