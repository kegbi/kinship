# Sequence 1 Foundation Rework — Round 3

Date: 2026-08-14\
Candidate base: `ec8188bf6d5ec079aeed65eff6021be01b67247f`\
Frozen RED revision: `fa87f1ab21663c624401636d4b2db94625b05dc5`\
Formatting-only RED revision: `c16b45d17485cfcba84759781d5e35b2f0a0e4f5`

## RED

The only behavior-bearing RED path was
`tools/workflows/foundation_recovery_policy_test.ts`. The controller froze its
formatted SHA-256 as
`EB5DA6CB15E149A806425CE3AC7FBD7ED36EC0523022D2731AF201C717817AA0`.

Command: `deno task test:workflow`\
Exit: `1`\
Observed: `26 passed / 7 failed`. The failures showed that governed coverage
assertions using words, decimal fractions, caps, or ceilings were accepted;
appended, redirected, separated, or exit-masked root check commands were also
accepted. Controls also required ordinary dates, versions, import percentages,
examples, and a non-test `*_contract.ts` target to retain their intended
classification. Production/configuration/policy paths were unchanged during RED.

## GREEN

Changed production path: `tools/workflows/foundation_recovery_policy.ts`.

The validator now extracts controlled quantitative coverage assertions,
normalizes them, accepts only the repository's explicit canonical 80% forms, and
fails closed for new governed wording. It does not translate arbitrary English
number words. Root `check` validation uses the one canonical command; test
targets retain the more specific `toolchain.hidden-test` result while
redirection, separators, fallback commands, and ordinary appended targets also
produce the stable toolchain rejection required by their class.

Command: `deno task test:workflow`\
Exit: `0`\
Observed: `33 passed / 0 failed`.

## REFACTOR and gates

The exact root check command and its production-only purpose are documented in
`docs/architecture/quality-gates.md`.

| Command                                                            | Exit | Observed result                                         |
| ------------------------------------------------------------------ | ---: | ------------------------------------------------------- |
| `deno task fmt:check`                                              |    0 | 49 files checked                                        |
| `deno task lint`                                                   |    0 | 6 files checked                                         |
| `deno task check`                                                  |    0 | schema and workflow policy entry points checked         |
| `deno task test:workflow`                                          |    0 | 33 passed, 0 failed                                     |
| `deno task test:workflow:coverage`                                 |    0 | 96.7% branches, 100% functions, 100% lines              |
| `deno task deps:deno` with a fresh explicit `DENO_DIR`             |    0 | frozen online cache population passed                   |
| `deno task deps:deno:offline` with the same `DENO_DIR`             |    0 | cached-only frozen install passed                       |
| clean `pnpm install --frozen-lockfile` with a fresh explicit store |    0 | 841 packages downloaded into the isolated store         |
| clean `pnpm install --frozen-lockfile --offline` with that store   |    0 | 841 packages reused, 0 downloaded                       |
| `deno task test:schema:matrix`                                     |    0 | PostgreSQL 18.4 and 17.10 passed every schema assertion |
| `git diff --check`                                                 |    0 | no whitespace errors                                    |

Dependency proof root:
`C:\Users\User\AppData\Local\Temp\relationships-seq1-r3-5122ccde9f054ae79a72c921c85e63bd`.

Lockfiles are byte-unchanged from the candidate and have these SHA-256 values:

- `deno.lock`:
  `8A39257B18EC8FF53ACB693EFE2969D8136284A0A8293517E43313E1FB7898C8`
- `pnpm-lock.yaml`:
  `385FCD5C1E1FFBE7EEBEFBF62E3730A1F11773F43D1010F7A3C8A9A4D8F4ECF8`

## Changed paths and residual risk

- Test/check: `tools/workflows/foundation_recovery_policy_test.ts` (frozen by
  the controller before GREEN)
- Production enforcement: `tools/workflows/foundation_recovery_policy.ts`
- Contract documentation: `docs/architecture/quality-gates.md`
- Evidence: `docs/validation/sequence-1-foundation-rework-round-3.md`

The controlled coverage vocabulary deliberately fails closed. A future
intentional rewording of governed coverage policy must update the allowlist and
its tests together. No application runtime, database schema, user flow, or
FND-003 artifact was changed or restored.
