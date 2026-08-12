# FND-003 Better Auth prerequisite amendment, round 1

Controller run ID:
`FND-003/orchestrator/r0/b308fcda-6e91-4fec-8b40-bf19c6e21a16`\
Authorized retry implementer run ID:
`FND-003/implementer/r1/09f30892-781e-41bb-b44a-ead4e74fe4d9`\
Ticket revision: 3\
Worktree reference: `worktree:FND-003:1`

The packet remains `ready`, round 0. This amendment names a later prerequisite
without expanding FND-003 or granting production-write authority.

Better Auth and passkey packages remain absent from every current selected,
direct, Deno-lock, pnpm-lock, OCI, lifecycle, and source-provenance record. The
exact graph membership checks must reject their insertion. The graph and report
may record `better-auth` as an early exclusion, but must not record a current
version as selected or locked.

Name `FND-003E` as `better-auth-probe-root-lock-amendment`. It runs only after
FND-003 is formally integrated and before DG-03. Under its own strict TDD
packet, FND-003E will add a real non-published probe workspace member, freshly
selected exact age-eligible Better Auth and passkey development pins, empty
lifecycle approvals, production-entrypoint exclusion, and updated versions of
the same single root locks. It must not create a nested spike lock.

The observed matching Better Auth pair `1.6.26` and the fact that `1.6.27`
remains below the 72-hour floor until 2026-08-14 are time-sensitive planning
inputs for FND-003E, not authority or package evidence for this ticket. Do not
persist either as an FND-003 selected version.

Preserve all other representation-retry requirements and prior failed-attempt
bytes unchanged.
