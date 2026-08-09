# Docker Compose Contract

## Status

Accepted topology and lifecycle contract. Compose files and exact image versions
are created during the executable scaffold, then pinned for reproducibility.

## Service Topology

| Service          | Purpose                                                                      | Profile            | Lifecycle    |
| ---------------- | ---------------------------------------------------------------------------- | ------------------ | ------------ |
| `gateway`        | Same-origin entry point, TLS in production-like use, and static Astro assets | default, test      | Long-running |
| `api`            | Deno/Hono HTTP composition root                                              | default, dev, test | Long-running |
| `worker`         | Reminder, import/export, synchronization, and maintenance commands           | default, dev, test | Long-running |
| `migrate`        | Applies and verifies immutable SQL before API/worker readiness               | default, test      | One-shot     |
| `postgres`       | Canonical durable database                                                   | default, dev, test | Long-running |
| `web`            | Astro development server with hot reload                                     | dev                | Long-running |
| `object-store`   | S3-compatible development/test attachment storage                            | dev, test          | Long-running |
| `mail`           | Captured development/test email                                              | dev, test          | Long-running |
| `otel-collector` | Optional OTLP receiver and local telemetry routing                           | observability      | Long-running |

`api` and `worker` use the same backend image and different explicit commands.
They may have different Deno permissions and environment allowlists.

## Files

The implementation uses:

- `compose.yaml` for the production-like base;
- `compose.dev.yaml` for source mounts and developer services;
- `compose.test.yaml` for isolated test settings and disposable storage.

The existing schema validation Compose file remains a narrow independent harness
until the application stack supersedes none of its checks.

## Startup And Readiness

1. PostgreSQL becomes healthy.
2. `migrate` obtains the migration lock, applies/verifies schema state, and
   exits successfully.
3. API and worker start only after successful migration completion.
4. Gateway becomes ready only after the API readiness endpoint succeeds and its
   static assets exist.

Liveness means the process event loop is responsive. Readiness means the process
can perform its role. API readiness includes a bounded database probe; API
liveness must not restart the process merely because PostgreSQL is briefly
unavailable. Worker readiness reports whether it can claim work, separately from
whether an external mail or object provider is degraded.

## Network Exposure

- Only `gateway` is exposed in a production-like profile.
- `web`, PostgreSQL, mail UI, object-store UI, and observability UIs may expose
  loopback ports only in explicit local profiles.
- API, worker, migration, and data services communicate on private Compose
  networks.
- Test ports are dynamically assigned or project-scoped to allow concurrent
  worktrees and CI jobs.

## Data And Volumes

- PostgreSQL and object bytes use named volumes in development.
- Test profiles use disposable, project-scoped volumes.
- Static build artifacts are copied into images, not shared from a developer
  directory in production-like operation.
- Canonical migrations are mounted or copied read-only into `migrate`.
- Secrets are not stored in images, Compose YAML, named volumes intended for
  source artifacts, or command-line arguments visible in process lists.

## Reset And Cleanup

Reset commands are split by environment:

- `dev:reset-data` removes only the explicitly resolved development Compose
  project volumes after displaying the project name and targets.
- `test:down` removes only the unique test project and its disposable volumes.
- no repository task may infer a destructive target from an empty variable,
  current directory name alone, or a broad Docker prune.

Production data reset is not a Compose command. It requires an explicit
operational runbook and restore point.

## Test Isolation

Every integration/E2E run uses a unique Compose project name derived from a
validated test-run identifier. The harness must:

1. start from empty database and object-store state;
2. wait on health/readiness rather than fixed sleeps;
3. apply migrations through the same migration command as deployment;
4. seed deterministic fixtures through supported application or fixture APIs;
5. collect logs, traces, database diagnostics, and Playwright artifacts on
   failure;
6. tear down its exact project and volumes in a finalizer.

## Backups And Restore

Before production deployment is accepted, a runbook and automated acceptance
test must prove:

- consistent PostgreSQL backup and restore;
- object-store backup or replication and manifest reconciliation;
- restored schema/app compatibility;
- handling of missing objects without corrupting metadata;
- recovery time and recovery point objectives chosen for the deployment.

## Image And Supply-Chain Policy

Architecture documents name technologies but not snapshot versions. At
scaffolding time:

- runtime and service images are pinned to reviewed immutable versions or
  digests;
- build stages use committed lockfiles and frozen installs;
- images run as non-root where supported and have read-only filesystems except
  explicit writable paths;
- health-check tools are present intentionally rather than installed at
  container startup;
- dependency and image updates arrive through reviewed automated changes.
