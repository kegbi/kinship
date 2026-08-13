# Sequence 1 Foundation Rework — Round 4

Date: 2026-08-14\
Candidate base: `b31d3d63da38cd32799b3191c89cacc548dc67ef`\
Frozen RED revision: `c3ebe3848134730a635e00b9a841fc1ecabe009e`

## RED

The only changed path was `tools/workflows/foundation_recovery_policy_test.ts`.
The controller froze its SHA-256 as
`9B8E680C74019BFBF6D5246ED4AB749ABCDF80B6F2E76493645DF6181DB942A4`.

Command: `deno task test:workflow`\
Exit: `1`\
Observed: `33 passed / 2 failed`. One aggregate failure showed that all five
dispatched governed single-metric statements were accepted in each of the eight
coverage-policy inputs: 40 missing `coverage.superseded` results. The other
aggregate failure showed that appended `*_test.tsx` and `*.test.tsx` targets
produced only `toolchain.deno`, without `toolchain.hidden-test`. Ordinary
`*_contract.ts` and `*_contract.tsx` controls retained only the generic
noncanonical-command result. Production, configuration, and policy paths were
unchanged during RED.

Command: `deno fmt --check tools/workflows/foundation_recovery_policy_test.ts`\
Exit: `0`\
Observed: the one changed RED test file was already formatted.

## GREEN

Changed production path: `tools/workflows/foundation_recovery_policy.ts`.

The controlled assertion boundary now combines a governed scope with any
coverage metric or with the existing coverage/gate nouns, while still requiring
a quantitative assertion and preserving the explicit non-governing examples. It
does not translate English number words or scan arbitrary prose. Direct test
target recognition now includes TypeScript JSX test filenames; appended TSX test
targets receive both the hidden-test and exact-command results, while ordinary
contract TS/TSX targets remain only generically noncanonical.

Command: `deno task test:workflow`\
Exit: `0`\
Observed: `35 passed / 0 failed`.

## REFACTOR and gates

No contract wording or architecture document needed to change. The focused
predicates were kept local to the existing coverage-assertion and root-check
validation boundaries.

| Command                                                                                                                 | Exit | Observed result                                         |
| ----------------------------------------------------------------------------------------------------------------------- | ---: | ------------------------------------------------------- |
| `deno task fmt:check`                                                                                                   |    0 | 51 files checked                                        |
| `deno task lint`                                                                                                        |    0 | 6 files checked                                         |
| `deno task check`                                                                                                       |    0 | schema and workflow policy entry points checked         |
| `deno task test:workflow`                                                                                               |    0 | 35 passed, 0 failed                                     |
| `deno task test:workflow:coverage`                                                                                      |    0 | 94.5% branches, 100% functions, 100% lines              |
| `deno task deps:deno` with a fresh explicit `DENO_DIR`                                                                  |    0 | frozen online cache population passed                   |
| `deno task deps:deno:offline` with the same `DENO_DIR`                                                                  |    0 | cached-only frozen install passed                       |
| `pnpm install --frozen-lockfile --store-dir C:\Users\User\AppData\Local\Temp\relationships-seq1-r4-pnpm-a49d`           |    0 | 841 packages downloaded into the empty isolated store   |
| `pnpm install --frozen-lockfile --offline --store-dir C:\Users\User\AppData\Local\Temp\relationships-seq1-r4-pnpm-a49d` |    0 | 841 packages reused, 0 downloaded                       |
| `deno task test:schema:matrix`                                                                                          |    0 | PostgreSQL 18.4 and 17.10 passed every schema assertion |
| `git diff --check`                                                                                                      |    0 | no whitespace errors                                    |

Dependency proof locations:

- Deno cache:
  `C:\Users\User\AppData\Local\Temp\relationships-seq1-r4-deno-f87d33bb27044f54b063708e343cd208`
- pnpm store: `C:\Users\User\AppData\Local\Temp\relationships-seq1-r4-pnpm-a49d`

The pnpm online proof started with an empty explicit store and without a
workspace `node_modules`. After it populated the store, the generated
workspace-local `node_modules` was moved to a verified temporary location. The
offline proof restored all 841 packages from the same store with zero downloads.

Lockfiles are byte-unchanged from the candidate base and have these SHA-256
values:

- `deno.lock`:
  `8A39257B18EC8FF53ACB693EFE2969D8136284A0A8293517E43313E1FB7898C8`
- `pnpm-lock.yaml`:
  `385FCD5C1E1FFBE7EEBEFBF62E3730A1F11773F43D1010F7A3C8A9A4D8F4ECF8`

The frozen test remains byte-identical. The completed production implementation
has SHA-256 `E43B7B4E22C3E4E2A2A86F5A0EAC06863AAACFCB0347D082B0191946F47B4817`.

## Changed paths and residual risk

- Test/check: `tools/workflows/foundation_recovery_policy_test.ts` (frozen by
  the controller before GREEN)
- Production enforcement: `tools/workflows/foundation_recovery_policy.ts`
- Evidence: `docs/validation/sequence-1-foundation-rework-round-4.md`

The controlled vocabulary remains deliberately fail-closed. A future intentional
governed coverage assertion must be added to the explicit allowlist with its
test. No application runtime, schema, product flow, dependency configuration, or
architecture contract changed.

Blockers: none.
