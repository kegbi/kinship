# FND-003 transitive prerelease correction, round 1

Controller run ID:
`FND-003/orchestrator/r0/b308fcda-6e91-4fec-8b40-bf19c6e21a16`\
Authorized fresh correction implementer run ID:
`FND-003/implementer/r1/2ea24c92-f3e9-4e82-a486-1ce9b9c2c080`\
Ticket revision: 15\
Worktree reference: `worktree:FND-003:1`

The packet remains `ready`, round 0. This dispatch does not create revision 16,
another lifecycle round, or any new acceptance surface. Commit
`15ca3f747f29d06bebe98d5bf9314690a262c396` freezes the controls-only RED:

- validator SHA-256:
  `88312ee3c84b05beb879a34ffa93c05bf9db6b96f219be774b39d2f04bb32700`;
- embedded whole-source digest:
  `2104938194281a8721c6cf9cc8e9fc24edca40fc71ed578307b0f90d86265ed7`;
- evidence SHA-256:
  `1a867972150440f0a8179dc08eb318fabe26ecb580ea98e2daa700af0a55590b`;
- exact new control failure:
  `@rolldown/pluginutils@1.0.0-rc.3 snapshot version must be an exact stable version`.

All successful uncommitted GREEN artifacts and 853 retained official responses
remain immutable during this correction. Do not edit, regenerate, delete, or
normalize them.

## Sole correction authority

The implementer may edit only
`tools/runtime/FND-003/runtime_graph_contract_test.ts`. No other validator,
fixture, evidence, dispatch, packet, production, capture, graph, report,
manifest, lock, provenance, cache, or Git write is authorized.

Make the smallest correction that distinguishes the two already-proven version
classes:

1. selected packages and root/direct manifest/importer versions must continue
   to use the existing exact stable `X.Y.Z` validator;
2. pnpm package and snapshot identities that are transitive lock records may use
   exact valid SemVer prerelease identifiers, including precisely the real
   `1.0.0-rc.3`, `1.0.0-beta.2`, and `5.0.0-beta.4` identities;
3. malformed, ranged, build-metadata-only, partial, `latest`, and otherwise
   non-exact lock versions remain rejected;
4. exact full-lock equality, identity/resolution binding, retained manifest
   integrity, peer, lifecycle, provenance, age-selection, OCI, and report checks
   remain byte-for-byte and behaviorally intact.

Do not special-case package names or the three literal versions. Use a narrow
exact SemVer-with-optional-prerelease parser only at transitive pnpm package and
snapshot identity boundaries. Do not permit prerelease selected/direct
versions. Do not address scalar `bin`, other metadata projections, or any other
oracle observation in this correction.

Run the new focused control and the pre-existing control suite excluding only
the incomplete repository GREEN assertion. Direct fmt/lint/check and the
whole-source digest check must pass. Produce byte-identical exact 100 percent
coverage of the corrected validator; if the one narrow branch needs a negative,
add it only inside the existing transitive-prerelease control. The successful
GREEN artifact hashes must remain equal to the RED evidence. Report exact diff,
test hash/digest, commands/exits, unchanged artifact hashes, and empty
out-of-scope changes. Stop without evidence, commit, graph/report generation,
GREEN resumption, ticket metadata, review artifact, push, deploy, or main
integration. A fresh exact-hash review follows before GREEN resumes.
