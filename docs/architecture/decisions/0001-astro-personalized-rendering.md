# ADR 0001: Astro Personalized Rendering

- Status: accepted
- Date: 2026-08-09

## Context

Public content benefits from build-time output, while authenticated CRM screens
contain private request-specific data. Making the complete application SSR would
discard the accepted static-first constraint. Prerendering private data at build
time is impossible and unsafe.

## Decision

Use page-level hybrid rendering:

- public and stable content is static;
- authenticated CRM pages default to a static shell with focused interactive
  islands that call the versioned API;
- token, invitation, MFA, and cookie-sensitive transitions may use on-demand
  rendering;
- any other on-demand page requires a page-catalog update and measured reason.

The person workspace remains one canonical page even when its independent
sections load through separate islands or API queries.

## Consequences

- API authorization is mandatory for every private query and mutation.
- Loading, empty, error, forbidden, and retry states are product states.
- On-demand rendering stays an exception rather than an application-wide mode.
- The first scaffold must spike one protected page to validate cookies, CSRF,
  redirects, generated contracts, and hydration behavior.
