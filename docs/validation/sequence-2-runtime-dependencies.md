# Sequence 2 Runtime And Dependency Selection

Selection date: 2026-08-14. The Foundation maintainers own a quarterly review;
security fixes may be proposed sooner, but still require exact manifest and lock
updates plus the applicable gated matrix.

## Selection and compatibility basis

- Exact execution selectors are Deno 2.9.5, Node 24.15.0 LTS, and pnpm 11.21.0
  in `.tool-versions`. `package.json` `engines` remain compatibility ranges, not
  execution selectors. Primary evidence: the
  [Deno 2.9.5 release](https://github.com/denoland/deno/releases/tag/v2.9.5),
  Node's [release status](https://nodejs.org/en/about/previous-releases) and
  [24.15.0 LTS release](https://nodejs.org/en/blog/release/v24.15.0), and pnpm's
  [`packageManager` contract](https://pnpm.io/package_json#packagemanager) and
  [frozen install](https://pnpm.io/cli/install).
- The already exact backend imports in `deno.json` and frontend tool packages in
  `package.json` were retained without novelty upgrades. `deno.lock` and the one
  root `pnpm-lock.yaml` are the resolved sources of truth. Clean frozen
  online/offline installs and the repository type/tests are the executable
  compatibility proof. Astro 7's documented Node floor is below Node 24; Hono
  retains its documented Deno entry path.
- `pnpm-workspace.yaml` keeps one shared, non-branch lock, exact saves, strict
  72 hours package age controls, and the reviewed lifecycle set only:
  `esbuild@0.28.2` enabled and `fsevents@2.3.2` / `fsevents@2.3.3` explicitly
  disabled. Deno keeps `allowScripts: []`.

The execution host evidence covers Windows x64 plus Linux `linux/amd64` and
`linux/arm64`. The only consumed container images are the PostgreSQL 18.4 and
17.10 Alpine schema-matrix images, pinned to Docker Official Image
multi-platform index digests verified through
[Docker Hub](https://hub.docker.com/_/postgres) and
`docker buildx imagetools inspect`.

## Repository authority and deferral

`.tool-versions` selects executions; `deno.json`, `package.json`, and
`pnpm-workspace.yaml` declare dependencies and policy; `deno.lock` and
`pnpm-lock.yaml` freeze resolutions; `compose.schema-test.yaml` and the schema
tasks consume the two image pins. `tools/runtime/runtime_dependency_policy.ts`
checks these sources through the root runtime test.

No Deno, Node, Playwright, gateway, API, worker, or web image is consumed yet.
Their Dockerfiles and immutable image pins are explicitly deferred to FND-10;
this sequence does not create unused constants or a production Compose stack.

## Round-2 verification

Verification on 2026-08-14 completed with this matrix:

| Check                              | Result                                   |
| ---------------------------------- | ---------------------------------------- |
| `deno task test:runtime`           | 10 passed, 0 failed                      |
| `deno task test:runtime:coverage`  | 100% branches, functions, and lines      |
| `deno task fmt`                    | 54 files checked                         |
| `deno task lint`                   | 8 files checked                          |
| `deno task check`                  | All three production tools checked       |
| `deno task test:workflow`          | 35 passed, 0 failed                      |
| `deno task test:workflow:coverage` | 94.5% branches; 100% functions and lines |
| `deno task test:schema:matrix`     | PostgreSQL 18.4 and 17.10 passed         |

The schema matrix reported the exact primary image
`postgres:18.4-alpine3.23@sha256:996d0920e4ff9df1fc19dacb904492f3c1ec0ec1cc338f0ad7123be7731c5f5e`
and exact compatibility image
`postgres:17.10-alpine3.23@sha256:8189a1f6e40904781fc9e2612687877791d21679866db58b1de996b31fc312e4`.
Both versions passed rollback, clean apply, catalog and field-catalog checks,
database behavior checks, teardown, and clean reapply, with 87 tables and 811
columns observed in each live database.

The earlier clean online/offline Deno and pnpm bootstrap proofs were not
repeated in round 2 because no dependency input or lockfile changed.
