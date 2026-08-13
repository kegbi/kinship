# Sequence 1 Foundation Rework Round 2 Evidence

Date: 2026-08-13

Rework base: `df5eb0693aa3cabcecb6d1a5d89a1f8249183852`

Prior review comparison base: `04fb6f01231a9ecbccd7151a93bf7fea4b8e6247`

Candidate: the committed HEAD of `codex/sequence-1-foundation-rework-round-2`
that contains this evidence. The exact immutable commit is reported in the
implementation handoff because a Git object cannot embed its own digest.

Scope: resolve the round-2 coverage-policy, hidden-test, and lock/configuration
findings without restoring retired workflow machinery or changing the 80% line,
branch, and function minimum.

## RED

Only `tools/workflows/foundation_recovery_policy_test.ts` changed before the RED
proof. `git diff --name-only` confirmed that production, configuration, and
policy paths remained unchanged.

```text
deno task test:workflow
```

Exit: `1`. Result: `22 passed | 3 failed`. The intended failing groups were:

- controlled coverage assertions using floors, minimums, server-side scope,
  caps, `seventy-nine percent`, and `0.79` were accepted;
- quoted `*_test.ts` and quoted or unquoted `*.test.ts` check targets were
  accepted; and
- alternate or missing Deno lock paths and disabled, missing, branch-specific,
  or redirected pnpm workspace lock settings were accepted.

## GREEN

```text
deno task test:workflow
```

Exit: `0`. Result: `25 passed | 0 failed`.

The smallest production/configuration change added a bounded coverage-assertion
grammar, test-target token unquoting for the two TypeScript conventions,
canonical Deno and pnpm lock validation, an implementation-only root check
target, and explicit pnpm workspace lock settings.

## REFACTOR

```text
deno fmt tools/workflows/foundation_recovery_policy.ts tools/workflows/foundation_recovery_policy_test.ts deno.json pnpm-workspace.yaml docs/architecture/quality-gates.md
deno task test:workflow
deno task test:workflow:coverage
```

Exit: `0` for all commands. The focused suite remained `25 passed | 0 failed`.
Production coverage was 100.0% lines, 97.8% branches, and 100.0% functions.

## Adversarial Regression Matrix

The unfiltered workflow suite executes every mutation below across the relevant
authoritative inputs:

- `Production test coverage has a 70% floor.`
- `The backend coverage minimum is 70%.`
- `Server-side line, branch, and function coverage may be 70%.`
- `Frontend lines, branches, and functions are capped at 80%.`
- production coverage `at least seventy-nine percent` and backend coverage
  `must be 0.79`;
- quoted `*_test.ts`, quoted `*.test.ts`, and unquoted `*.test.ts` root check
  targets;
- `deno test --filter=never`, output redirection, and
  `|| deno eval "Deno.exit(0)"` on both canonical workflow tasks;
- missing or alternate `deno.json` lock paths;
- missing/false `lockfile`, missing/false `sharedWorkspaceLockfile`,
  missing/true `gitBranchLockfile`, and `lockfileDir: ./other`;
- `--frozen=true`, `pnpm i --frozen-lockfile`, and an alternate pnpm lockfile
  directory; and
- the earlier no-op, missing, unlocked, lock-mutating, unpaired online/offline,
  and extra-option dependency task probes.

Every coverage mutation produces `coverage.superseded`; every check test target
produces `toolchain.hidden-test`; workflow command mutations produce
`toolchain.deno`; and lock/configuration mutations produce
`toolchain.dependencies` at the responsible configuration path.

## Final Verification

| Command                            | Exit | Observed result                                      |
| ---------------------------------- | ---: | ---------------------------------------------------- |
| `deno task fmt:check`              |    0 | 49 files checked after evidence was added            |
| `deno task lint`                   |    0 | 6 files checked                                      |
| `deno task check`                  |    0 | schema tool and workflow production policy checked   |
| `deno task test:workflow`          |    0 | 25 passed, 0 failed                                  |
| `deno task test:workflow:coverage` |    0 | 100.0% lines, 97.8% branches, 100.0% functions       |
| `deno task test:schema:matrix`     |    0 | PostgreSQL 18.4 and 17.10 passed the complete matrix |
| `git diff --check`                 |    0 | no whitespace errors                                 |

Frozen Deno bootstrap used one new explicit cache:

```powershell
$env:DENO_DIR='C:\Users\User\AppData\Local\Temp\relationships-seq1-r2-deno-edf95d04b4b64fe2bbe558e9d371e418'
deno task deps:deno
deno task deps:deno:offline
```

Exit: `0` for both tasks. The online task populated the new cache; the offline
task completed with `--cached-only` from the same cache.

Clean pnpm bootstrap used one new explicit store:

```powershell
pnpm install --frozen-lockfile --store-dir 'C:\Users\User\AppData\Local\Temp\relationships-seq1-r2-pnpm-318fd69b48d04b59a708d70c33535ec8'
git clean -fdX -- node_modules
pnpm install --offline --frozen-lockfile --store-dir 'C:\Users\User\AppData\Local\Temp\relationships-seq1-r2-pnpm-318fd69b48d04b59a708d70c33535ec8'
```

Exit: `0` for all commands. The online install downloaded and added 841
packages. The offline reinstall reused 841, downloaded 0, and added 841.

Lock hashes before and after all gates were unchanged:

- `deno.lock`: `47e698702b11beba0ea1ad21a4efcc3dbd13e414`
- `pnpm-lock.yaml`: `5d784acae45798a534abaf89f8ee820e09f038da`

## Changed Paths

Test/check paths:

- `tools/workflows/foundation_recovery_policy_test.ts`
- `deno.json`

Production/configuration/policy paths:

- `tools/workflows/foundation_recovery_policy.ts`
- `pnpm-workspace.yaml`
- `docs/architecture/quality-gates.md`

Evidence path:

- `docs/validation/sequence-1-foundation-rework-round-2.md`

## Remaining Risks

- Coverage prose validation is intentionally bounded to governed production,
  backend/frontend, and server/client-side assertions. A new prose form needs a
  focused regression before it becomes controlled grammar.
- The root check target rule covers the repository's TypeScript conventions,
  `*_test.ts` and `*.test.ts`. A future JavaScript test convention must extend
  the contract test-first.
- Safe CLI aliases are deliberately rejected. Adopting an equivalent spelling
  requires updating the documented exact-syntax contract and its mutations.

Blockers: none.
