# Active Delivery

Status: Accepted near-term execution order, revised 2026-08-14

This file is the authoritative task queue. The larger roadmap remains a product
coverage reference, not a sequence of prerequisites.

`docs/planning/tickets/` contains historical workflow artifacts. New work does
not create or update ticket packets, dispatch files, controller IDs, evidence
logs, or integration ledgers there.

## Direction

The architecture, product catalogs, module ownership, authorization matrix, and
canonical schema are sufficient to start the application. Freeze additional
contract and enforcement work unless a current vertical ticket is concretely
blocked.

Foundation capabilities are implemented just in time inside the first feature
that consumes them. A ticket should leave a runnable application or a completed
user-visible behavior, not another empty framework.

## Parked Work

The FND-03 migration comparison is parked on branch
`codex/fnd-03-migration-runner-spike` at checkpoint
`22c169864cdc50abf525f22bf1c34bb01dadfa7b`. It is not integrated or accepted.
The repository-owned raw runner passed the substantive PostgreSQL 18.4 and 17.10
paths reached by the spike; Atlas hardening is stopped. When the app first needs
migrations, adopt only the minimum raw runner behavior that ticket uses and
review it as part of that vertical change.

Authentication, gateway/TLS, background jobs, CI, telemetry depth, design-system
breadth, and architecture enforcement are likewise deferred until the active
feature consumes their boundary.

## Now: APP-001 Runnable Application

Outcome: a developer can start the real web and API applications and see a
working public product surface backed by a live versioned API endpoint.

Deliver only:

- `apps/api`: Deno/Hono application with versioned health/readiness behavior;
- `apps/web`: Astro application with the accepted public home route and a small
  API connectivity state;
- the minimum shared contract needed by those two applications;
- real root development, build, check, and focused test commands; and
- focused unit/contract tests plus one Chromium smoke path.

Do not add authentication, database persistence, Compose, generated clients,
all-browser E2E, CI, broad component libraries, telemetry exporters, or module
scaffolds unless APP-001 cannot run without them.

Acceptance:

1. One documented root command starts both applications for development.
2. The API exposes a stable `/api/v1/health` response without secrets.
3. The public home page renders through Astro and shows API ready/error states.
4. Production code meets 80% line, branch, and function coverage.
5. Focused checks and a clean read-only review pass.

## Next: APP-002 Protected Workspace Skeleton

Add the minimum identity/session adapter and active-workspace context needed for
a protected application shell. Prove anonymous rejection, active membership, and
a second-workspace isolation negative. Decide Better Auth adoption only to the
extent required by this ticket.

## Then: APP-003 People Core

Deliver a thin vertical People path: list, create, and open the canonical person
workspace using the existing schema and module boundaries. Include the API,
PostgreSQL adapter, UI states, and stable flow coverage for the complete
behavior actually delivered. Introduce the minimal migration runner and Compose
services here if APP-003 is the first ticket that needs them.

## Queue Rules

- Keep at most one `Now`, two `Next`, and a short later backlog.
- Split work by observable user outcome, not by technical layer.
- Do not create a new foundation sequence.
- A blocked ticket pulls in only its minimum blocker and resumes the vertical
  outcome in the same ticket.
- Update this file when a candidate integrates; detailed evidence stays in Git
  and test output, not in new planning artifacts.
