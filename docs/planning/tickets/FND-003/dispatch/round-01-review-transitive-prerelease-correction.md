# FND-003 transitive prerelease correction review, round 1

Controller run ID:
`FND-003/orchestrator/r0/b308fcda-6e91-4fec-8b40-bf19c6e21a16`\
Authorized reviewer run ID:
`FND-003/reviewer/prerelease-correction/r1/73832448-3460-444c-a4f4-172ba537fdd8`\
Ticket revision: 15\
Worktree reference: `worktree:FND-003:1`

Review exact correction commit `2f82f71acc5d9dfc958f84c48df7742f31c134ae`
against parent `c873f0f`. The only correction path is
`tools/runtime/FND-003/runtime_graph_contract_test.ts`, SHA-256
`499a676651f1a95cf7685990a73b51137376da81cd0981aed9be61e0e3528d4e`, with
embedded whole-source digest
`16b6513ad04cc01312b1310c3ffd6b202a5ef462f9f72325c309b52fa5218e42`.

The controller-authorized boundary was only:

- keep selected/direct/root versions on stable-only `version()`;
- admit exact SemVer-with-optional-prerelease only for transitive pnpm package
  and snapshot identities, including the three real required prereleases;
- reject malformed, ranged, partial, build-metadata, `latest`, and prerelease
  selected/direct versions; and
- preserve exact full-lock, manifest integrity, peer, lifecycle, provenance,
  age, OCI, and report controls.

Evidence to reproduce read-only:

- focused control: exit 0, 1 passed;
- all controls excluding repository: exit 0, 12 passed/1 filtered;
- direct fmt/lint/check: exit 0;
- byte-identical combined coverage: 100 percent branches/functions/lines,
  7,857/7,857 lines;
- all pre-existing GREEN artifact hashes and 853 retained-response bytes remain
  unchanged.

Review all six lenses: bugs/correctness, security/privacy,
architecture/contracts, performance/reliability, style/maintainability, and
tests/TDD. Specifically inspect every `lockVersion()` call site and prove no
selected/direct/root or newer-release selection path was relaxed. Check the
SemVer prerelease grammar for leading-zero, empty identifier, range, `latest`,
and build-metadata bypasses. Do not expand into the known scalar-bin or broader
metadata projection observations; those were expressly outside this correction.

The worktree contains uncommitted GREEN artifacts and `node_modules`. Do not
edit, delete, stage, commit, regenerate, normalize, or otherwise mutate any
path. Return schema-v2 review data with exact identities and zero findings or
only acceptance-critical findings about this correction. No push, deploy, merge,
integration, or ticket lifecycle write.
