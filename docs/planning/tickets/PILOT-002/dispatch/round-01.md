# PILOT-002 implementation dispatch, round 1

Input base: `de45825cf6a087e98a9fdb0338176ad6d82ad2a8`\
Required next state: RED

Add one static contract test to `tools/workflows/workflow_assets_test.ts`. It
must require these exact sentences:

> For ordinary ticket work, `.git`, `.codex`, and `.agents` are protected
> control paths.

> Spawned workspace-write implementers must route any required change to those
> paths to a trusted top-level maintenance context.

Run `deno test --allow-read tools/workflows/workflow_assets_test.ts` and confirm
that existing tests pass while the new assertion fails only because the first
sentence is absent. Do not edit documentation or production during RED. Stop for
the trusted controller to freeze the RED revision and SHA-256 test blob.

After the controller resumes GREEN, leave the frozen test byte-identical and add
only the two exact sentences to the existing worktree/controller guidance in
`docs/development/autonomous-delivery.md`. Do not modify `.git`, `.codex`,
`.agents`, ticket authority, or Git metadata. The text documents authority
routing; it does not claim repository configuration can override Codex sandbox
enforcement.
