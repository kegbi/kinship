import { deterministicId, type IdGenerator } from "./ids.ts";
import { assert } from "../testing/assert.ts";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const workspaceId = "00000000-0000-4000-8000-000000000003";
const requestId = "11111111-2222-4333-8444-555555555555";

Deno.test("[GAP-006] a derived identifier is a stable canonical UUID", async () => {
  const id = await deterministicId("kinship.people.external-id.v1", [
    workspaceId,
    requestId,
  ]);
  assert(UUID.test(id), `expected a canonical derived UUID, got ${id}`);
  const again = await deterministicId("kinship.people.external-id.v1", [
    workspaceId,
    requestId,
  ]);
  assert(id === again, "the same namespace and parts derive the same id");
});

Deno.test("[GAP-006] derivation folds case so a retry matches", async () => {
  const lower = await deterministicId("kinship.planning.task-id.v1", [
    workspaceId,
    requestId,
  ]);
  const upper = await deterministicId("kinship.planning.task-id.v1", [
    workspaceId.toUpperCase(),
    requestId.toUpperCase(),
  ]);
  assert(lower === upper, "a re-sent request identifier derives one id");
});

Deno.test("[GAP-006] the namespace and each part separate the id space", async () => {
  const task = await deterministicId("kinship.planning.task-id.v1", [
    workspaceId,
    requestId,
  ]);
  const reminder = await deterministicId("kinship.planning.reminder-id.v1", [
    workspaceId,
    requestId,
  ]);
  const otherWorkspace = await deterministicId("kinship.planning.task-id.v1", [
    "00000000-0000-4000-8000-000000000004",
    requestId,
  ]);
  const otherRequest = await deterministicId("kinship.planning.task-id.v1", [
    workspaceId,
    "11111111-2222-4333-8444-555555555556",
  ]);
  const derived = new Set([task, reminder, otherWorkspace, otherRequest]);
  assert(derived.size === 4, "namespace and parts must all separate ids");

  // The separator keeps neighbouring parts from running together.
  const split = await deterministicId("n", ["ab", "c"]);
  const joined = await deterministicId("n", ["a", "bc"]);
  assert(split !== joined, "parts are delimited, not concatenated");
});

Deno.test("[GAP-006] the derivation is pinned to identifiers already stored", async () => {
  // Fixed vectors taken from the per-module derivations people and planning
  // each carried before GAP-006. They pin the whole recipe — namespace, the
  // NUL separator, case folding, the version and variant nibbles, and the
  // hyphenation — so an idempotent replay of a request sent before the kernel
  // existed still resolves to the row it created. Changing any of it breaks
  // idempotency against live data, so these must never be "updated to match".
  for (
    const [namespace, parts, expected] of [
      [
        "kinship.people.external-id.v1",
        ["0F5B9C2A-1111-4222-8333-444455556666", "Req-ABC"],
        "cadade8f-3984-8b3d-9f7f-4d0a4e08bd91",
      ],
      [
        "kinship.planning.task-id.v1",
        ["ws-1", "r-1"],
        "a646eafa-542f-876e-932f-3a2fa49f0467",
      ],
      [
        "kinship.planning.reminder-id.v1",
        ["WS", "REQ"],
        "c73820f8-a28e-8e2d-bfc7-1909796264a9",
      ],
    ] as const
  ) {
    const derived = await deterministicId(namespace, parts);
    assert(
      derived === expected,
      `${namespace} must keep deriving ${expected}, got ${derived}`,
    );
  }
});

Deno.test("[GAP-006] the derivation reproduces the pre-kernel people and planning ids", async () => {
  const legacy = async (
    namespace: string,
    workspace: string,
    request: string,
  ): Promise<string> => {
    const digest = new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(
          `${namespace}\u0000${workspace.toLowerCase()}\u0000${request.toLowerCase()}`,
        ),
      ),
    );
    digest[6] = (digest[6]! & 0x0f) | 0x80;
    digest[8] = (digest[8]! & 0x3f) | 0x80;
    const hex = [...digest.slice(0, 16)].map((value) =>
      value.toString(16).padStart(2, "0")
    ).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${
      hex.slice(16, 20)
    }-${hex.slice(20)}`;
  };
  for (
    const namespace of [
      "kinship.people.external-id.v1",
      "kinship.planning.task-id.v1",
      "kinship.planning.cadence-id.v1",
      "kinship.planning.reminder-id.v1",
    ]
  ) {
    assert(
      await deterministicId(namespace, [workspaceId, requestId]) ===
        await legacy(namespace, workspaceId, requestId),
      `${namespace} must keep deriving the identifiers already stored`,
    );
  }
});

Deno.test("[GAP-006] an id generator is any create() source", () => {
  let issued = 0;
  const generator: IdGenerator = {
    create: () => `00000000-0000-4000-8000-00000000000${issued += 1}`,
  };
  assert(
    generator.create() !== generator.create(),
    "the injected generator issues fresh identifiers",
  );
});
