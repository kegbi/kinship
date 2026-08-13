# Sequence 1 Foundation Rework Evidence

Date: 2026-08-13

Base revision: `063c51cd5a421dae1448f967d62714038d5b6c8c`

Implementation branch: `codex/sequence-1-foundation-rework`

Scope: resolve SEQ1-TEST-001, SEQ1-CORRECT-002, SEQ1-CORRECT-003, and
SEQ1-TDD-004 without restoring the retired ticket workflow or adding provenance
metadata.

## RED

Production and policy files were unchanged for both accepted RED observations.
After the regression edits, `git status --short` and `git diff --name-only`
reported only `tools/workflows/foundation_recovery_policy_test.ts`.

1. Existing hidden runtime assertion:

   ```powershell
   $env:DENO_NO_PACKAGE_JSON='1'; deno test --allow-read=.npmrc,deno.json,deno.lock,package.json,pnpm-workspace.yaml,pnpm-lock.yaml,tools/runtime/FND-003,docs/validation/runtime-graph-fnd003.json,docs/validation/runtime-graph-fnd003.md tools/runtime/FND-003/runtime_graph_contract_test.ts
   ```

   Exit: `1`. Result: `12 passed | 1 failed`. The repository assertion failed
   because `docs/validation/runtime-graph-fnd003.md` did not exist. This proved
   that the test type-checked by the root `check` task was not a passing
   executable gate.

2. Focused regressions for all dispatched findings:

   ```text
   deno task test:workflow
   ```

   Exit: `1`. Result: `16 passed | 4 failed`. The intended failing groups were:

   - backend and frontend scope-specific thresholds were accepted at 70%;
   - a check-only test and retired runtime artifacts were not rejected;
   - missing and no-op dependency tasks were accepted; and
   - unfrozen Deno locks, lost online/offline pairing, and lock-mutating
     commands were accepted.

A preliminary direct runtime invocation without `DENO_NO_PACKAGE_JSON=1` is not
counted as RED evidence: it exited `1` during type resolution because the
separate Node workspace was visible.

## GREEN

The first `deno task test:workflow` GREEN attempt exited `1` with TS2448 and
TS2454 because `tasks` was declared after its first use. After the declaration
was moved before validation, the exact command exited `0` with
`20 passed | 0
failed`.

```text
deno task test:workflow
```

Exit: `0`. Result: `20 passed | 0 failed`.

```text
deno task test:workflow:coverage
```

Exit: `0`. Result: 100.0% lines, 98.7% branches, and 100.0% functions for
`foundation_recovery_policy.ts`.

The implementation now:

- recognizes production, backend, and frontend line/branch/function threshold
  claims even when a scope-specific statement calls the threshold a gate;
- rejects tests referenced by `check` but not by an executable Deno test task;
- rejects the retired FND-003 runtime graph paths;
- requires a frozen Deno lock and the five truthful dependency task commands;
- tolerates whitespace and bootstrap-option ordering while rejecting extra or
  lock-mutating behavior; and
- removes the unaccepted FND-003 test, snapshot, fixtures, and provenance bundle
  instead of presenting a partial gate as active.

## REFACTOR AND FULL GATES

```text
deno fmt
deno task test:workflow
```

Exit: `0` for both. The focused suite remained `20 passed | 0 failed` after
formatting.

Final static and workflow gates:

| Command                            | Exit | Observed result                                   |
| ---------------------------------- | ---: | ------------------------------------------------- |
| `deno task fmt:check`              |    0 | 48 files checked                                  |
| `deno task lint`                   |    0 | 6 files checked                                   |
| `deno task check`                  |    0 | schema tool and workflow policy test type-checked |
| `deno task test:workflow`          |    0 | 20 passed, 0 failed                               |
| `deno task test:workflow:coverage` |    0 | 100.0% lines, 98.7% branches, 100.0% functions    |
| `git diff --check`                 |    0 | no whitespace errors                              |

Frozen Deno bootstrap used one new explicit cache:

```powershell
$env:DENO_DIR='C:\Users\User\AppData\Local\Temp\relationships-seq1-deno-eaf408dccecb4973899a6d69a156b854'; deno task deps:deno
$env:DENO_DIR='C:\Users\User\AppData\Local\Temp\relationships-seq1-deno-eaf408dccecb4973899a6d69a156b854'; deno task deps:deno:offline
```

Exit: `0` for both. The online task populated the fresh cache from the frozen
lock; the second task completed with `--cached-only` from that same cache.

Clean pnpm bootstrap used one new explicit store:

```powershell
git clean -fdX -- node_modules
pnpm install --frozen-lockfile --store-dir 'C:\Users\User\AppData\Local\Temp\relationships-seq1-pnpm-61d3e96bdb9a4a93b2e5297489850a50'
git clean -fdX -- node_modules
pnpm install --offline --frozen-lockfile --store-dir 'C:\Users\User\AppData\Local\Temp\relationships-seq1-pnpm-61d3e96bdb9a4a93b2e5297489850a50'
```

Exit: `0` for all commands. The online install added 841 packages. The offline
reinstall reused all 841 packages and downloaded 0.

```text
deno task test:schema:matrix
```

Exit: `0`. PostgreSQL 18.4 and 17.10 each passed atomic rollback, clean apply,
catalog/field-catalog assertions, database behavior assertions, teardown, and
clean reapply.

No runtime/FND graph gate remains active. The root `check` task no longer names
the retired test. A repository search for
`runtime_graph_contract_test|runtime-graph-fnd003|tools/runtime/FND-003` outside
`docs/planning/tickets/**` found only the defensive retired-path assertions in
the workflow policy and its regression test.

The lock hashes before and after all gates were unchanged:

- `deno.lock`: `47e698702b11beba0ea1ad21a4efcc3dbd13e414`
- `pnpm-lock.yaml`: `5d784acae45798a534abaf89f8ee820e09f038da`

## CHANGED PATHS

Test/check paths:

- `tools/workflows/foundation_recovery_policy_test.ts`
- `deno.json`

Production/policy paths:

- `tools/workflows/foundation_recovery_policy.ts`
- `docs/planning/quality-and-operations.md`
- retired `docs/validation/runtime-graph-fnd003.json`
- retired `tools/runtime/FND-003/` as one unaccepted 859-file unit

Evidence path:

- `docs/validation/sequence-1-foundation-rework.md`

## REMAINING RISKS

- The repository intentionally has no runtime-graph gate now. A future gate must
  be introduced with a real root test task and passing artifacts in one new RED
  -> GREEN -> REFACTOR cycle.
- The 860 retired tracked files (about 73.5 MiB) remain recoverable from the
  base revision; restoring any retired path is rejected by the workflow policy.
- This change validates command semantics at the root contract boundary; it does
  not add planned application, browser, hook, Compose, or CI aggregates.

Blockers: none.
