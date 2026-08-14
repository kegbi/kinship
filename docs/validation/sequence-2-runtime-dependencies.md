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

## Round-3 review-rework verification

The frozen review regression suite at `aeeb59fa49010242e6b7807ca03565750d554ff9`
first reproduced 11 passing and 9 intentionally failing tests. The runtime
policy now reads effective mapping values from `pnpm-workspace.yaml` and
`compose.schema-test.yaml`: comments do not satisfy controls, `allowBuilds` must
be the exact reviewed map at its proper key, and malformed or duplicate mappings
fail closed. Complete approved lock bytes are protected by SHA-256
`8A39257B18EC8FF53ACB693EFE2969D8136284A0A8293517E43313E1FB7898C8` for
`deno.lock` and
`385FCD5C1E1FFBE7EEBEFBF62E3730A1F11773F43D1010F7A3C8A9A4D8F4ECF8` for
`pnpm-lock.yaml`.

Verification on 2026-08-14 completed with this round-3 matrix:

| Check                              | Result                                      |
| ---------------------------------- | ------------------------------------------- |
| `deno task test:runtime`           | 20 passed, 0 failed                         |
| `deno task test:runtime:coverage`  | 80.6% branches; 100% functions; 97.1% lines |
| `deno task fmt`                    | 54 files checked                            |
| `deno task lint`                   | 8 files checked                             |
| `deno task check`                  | All three production tools checked          |
| `deno task test:workflow`          | 35 passed, 0 failed                         |
| `deno task test:workflow:coverage` | 94.5% branches; 100% functions and lines    |
| `git diff --check`                 | Passed                                      |

Dependency installs and the live PostgreSQL matrix were not repeated in round 3.
This rework changes only the runtime policy validator and this evidence;
dependency inputs, both approved lockfiles, package manifests, Compose values,
and the schema runner remain byte-for-byte unchanged from their prior clean
online/offline install and PostgreSQL 18.4/17.10 matrix proofs.

## Round-4 review-rework verification

The frozen review regression suite at
`76a0a4ecc78661ed22379c334b993319f8e6a47a`, with SHA-256
`320B94AFC0F5109D32661DA689AF508C2C48C9E380986491D31520C9D4D9B9BB`, first
reproduced 20 passing and 5 intentionally failing tests. The bounded YAML reader
now requires block mapping colons to have YAML separation and rejects sequences
at the root or within the consumer-required `allowBuilds`, `services`, and
`postgres` mappings. Canonical inline comments and unrelated sequence-valued
configuration remain accepted.

Verification on 2026-08-14 completed with this round-4 matrix:

| Check                              | Result                                      |
| ---------------------------------- | ------------------------------------------- |
| `deno task test:runtime`           | 25 passed, 0 failed                         |
| `deno task test:runtime:coverage`  | 84.3% branches; 100% functions; 97.2% lines |
| `deno task fmt`                    | 54 files checked                            |
| `deno task lint`                   | 8 files checked                             |
| `deno task check`                  | All three production tools checked          |
| `deno task test:workflow`          | 35 passed, 0 failed                         |
| `deno task test:workflow:coverage` | 94.5% branches; 100% functions and lines    |
| `git diff --check`                 | Passed                                      |

Dependency installs and the live PostgreSQL matrix were not repeated in round 4.
This rework changes only the runtime policy validator and this evidence;
dependency inputs, both approved lockfiles, package manifests, Compose values,
and the schema runner remain byte-for-byte unchanged from their prior clean
online/offline install and PostgreSQL 18.4/17.10 matrix proofs.

## Round-5 review-rework verification

The frozen review regression suite at
`7ae8ff965f9cbb2fee0290dcdacb873109ef00a8`, with SHA-256
`E2B74E5770EF4EBBE105CD84733055222D6643D8860BD882C03FC367B8964913`, first
reproduced 25 passing and 2 intentionally failing tests. The bounded YAML reader
now requires every mapping's immediate children to use one consistent
indentation depth. This rejects the reviewed one-space drift in the workspace
`allowBuilds` map and Compose `postgres` service while preserving unrelated
sequence-valued configuration.

Verification on 2026-08-14 completed with this round-5 matrix:

| Check                              | Result                                      |
| ---------------------------------- | ------------------------------------------- |
| `deno task test:runtime`           | 27 passed, 0 failed                         |
| `deno task test:runtime:coverage`  | 84.7% branches; 100% functions; 97.2% lines |
| `deno task fmt`                    | 54 files checked                            |
| `deno task lint`                   | 8 files checked                             |
| `deno task check`                  | All three production tools checked          |
| `deno task test:workflow`          | 35 passed, 0 failed                         |
| `deno task test:workflow:coverage` | 94.5% branches; 100% functions and lines    |
| `git diff --check`                 | Passed                                      |

Dependency installs and the live PostgreSQL matrix were not repeated in round 5.
This rework changes only the runtime policy validator and this evidence;
dependency inputs, both approved lockfiles, package manifests, Compose values,
and the schema runner remain byte-for-byte unchanged from their prior clean
online/offline install and PostgreSQL 18.4/17.10 matrix proofs.
