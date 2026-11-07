import {
  API_TOKEN_SCOPES,
  type ApiTokenDependencies,
  type ApiTokenRecord,
  createApiTokenManagement,
} from "../public.ts";
import {
  WebCryptoApiTokenSecrets,
} from "../adapters/crypto/api_token_secrets.ts";
import { assertEquals } from "../../../testing/assert.ts";
import {
  fixedClock,
  inMemoryRepository,
  recordingAudit,
} from "../../../testing/fakes.ts";

const owner = {
  memberId: "10000000-0000-4000-8000-000000000001",
  role: "owner" as const,
  userId: "10000000-0000-4000-8000-000000000002",
  workspaceId: "10000000-0000-4000-8000-000000000003",
};

function fixture(standing: "active" | "revoked" = "active") {
  const records = inMemoryRepository<ApiTokenRecord>((record) => record.id);
  const audit = recordingAudit<{ readonly action: string }, void>();
  const rawSecret = "first-secret-with-enough-entropy";
  const lookups: (readonly string[])[] = [];
  const held: { readonly userId: string; readonly workspaceId: string }[] = [];
  const dependencies: ApiTokenDependencies = {
    actorContext: { describe: () => Promise.resolve(owner) },
    actors: { revalidate: () => Promise.resolve(standing) },
    audit,
    clock: fixedClock("2026-08-24T10:00:00.000Z"),
    ids: { next: () => "10000000-0000-4000-8000-000000000004" },
    issuers: {
      listIdentityDisplaySummaries: ({ userIds }) => {
        lookups.push(userIds);
        return Promise.resolve([{
          email: "owner@example.test",
          name: "Ada Owner",
          userId: owner.userId,
        }]);
      },
    },
    repository: {
      create: (command) => {
        const record: ApiTokenRecord = {
          createdAt: command.occurredAt.toISOString(),
          ...(command.expiresAt
            ? { expiresAt: command.expiresAt.toISOString() }
            : {}),
          id: command.id,
          name: command.name,
          scopes: command.scopes,
        };
        records.save(record);
        return Promise.resolve({ record, status: "created" });
      },
      findForAuthentication: ({ id }) => {
        const record = records.find(id);
        return Promise.resolve(
          record
            ? {
              hash: "hash:first-secret-with-enough-entropy",
              record,
              status: "found" as const,
              userId: owner.userId,
              workspaceId: owner.workspaceId,
            }
            : { status: "not-found" as const },
        );
      },
      list: () =>
        Promise.resolve(
          records.list().map((record) => ({ ...record, userId: owner.userId })),
        ),
      markUsed: () => Promise.resolve(),
      revoke: ({ id, occurredAt }) => {
        const current = records.find(id);
        if (!current || current.revokedAt) {
          return Promise.resolve({ status: "not-found" as const });
        }
        const record = { ...current, revokedAt: occurredAt.toISOString() };
        records.save(record);
        return Promise.resolve({ record, status: "revoked" as const });
      },
      revokeHeldBy: ({ occurredAt, userId, workspaceId }) => {
        held.push({ userId, workspaceId });
        const revoked = records.list().filter((record) => !record.revokedAt)
          .map((record) => ({
            ...record,
            revokedAt: occurredAt.toISOString(),
          }));
        for (const record of revoked) records.save(record);
        return Promise.resolve(revoked);
      },
    },
    secrets: {
      create: () =>
        Promise.resolve({ hash: `hash:${rawSecret}`, raw: rawSecret }),
      matches: (raw, hash) => Promise.resolve(hash === `hash:${raw}`),
    },
    transaction: { run: (work) => work({} as never) },
  };
  return {
    audit,
    held,
    lookups,
    management: createApiTokenManagement(dependencies),
    records: records.entries,
  };
}

Deno.test("API tokens reveal a scoped secret once and expose metadata afterward", async () => {
  const state = fixture();
  const created = await state.management.create(owner, {
    expiresAt: "2026-09-24T10:00:00.000Z",
    name: "Desktop export",
    scopes: [API_TOKEN_SCOPES[0]],
  });
  assertEquals(created, {
    record: {
      createdAt: "2026-08-24T10:00:00.000Z",
      expiresAt: "2026-09-24T10:00:00.000Z",
      id: "10000000-0000-4000-8000-000000000004",
      name: "Desktop export",
      scopes: ["people:read"],
    },
    secret:
      "kin_pat_10000000-0000-4000-8000-000000000004.first-secret-with-enough-entropy",
    status: "created",
  });
  assertEquals(await state.management.list(owner), {
    records: [{
      createdAt: "2026-08-24T10:00:00.000Z",
      expiresAt: "2026-09-24T10:00:00.000Z",
      id: "10000000-0000-4000-8000-000000000004",
      name: "Desktop export",
      scopes: ["people:read"],
      issuer: { email: "owner@example.test", name: "Ada Owner" },
    }],
    status: "ready",
  });
  assertEquals(state.lookups, [[owner.userId]]);
  assertEquals(state.audit.actions, ["created"]);
});

Deno.test("[AUD-M4] an administrator lists every token with its issuer, asking once per issuer", async () => {
  const state = fixture();
  await state.management.create(owner, {
    name: "First",
    scopes: ["people:read"],
  });
  state.records.set("10000000-0000-4000-8000-000000000005", {
    createdAt: "2026-08-24T10:00:00.000Z",
    id: "10000000-0000-4000-8000-000000000005",
    name: "Second",
    scopes: ["tasks:read"],
  });
  const listed = await state.management.list({ ...owner, role: "admin" });
  assertEquals(
    listed.status === "ready"
      ? listed.records.map((record) => record.issuer.name)
      : listed.status,
    ["Ada Owner", "Ada Owner"],
  );
  assertEquals(state.lookups, [[owner.userId]]);
});

Deno.test("[AUD-M4] a removed member's credentials are revoked and each one audited", async () => {
  const state = fixture();
  await state.management.create(owner, {
    name: "Held",
    scopes: ["people:read"],
  });
  const admin = {
    ...owner,
    memberId: crypto.randomUUID(),
    role: "admin" as const,
  };
  await state.management.revokeMemberCredentials({
    actor: admin,
    occurredAt: new Date("2026-08-24T11:00:00.000Z"),
    subjectUserId: owner.userId,
    transaction: {} as never,
  });
  assertEquals(state.held, [{
    userId: owner.userId,
    workspaceId: owner.workspaceId,
  }]);
  assertEquals(
    [...state.records.values()].map((record) => record.revokedAt),
    ["2026-08-24T11:00:00.000Z"],
  );
  assertEquals(state.audit.actions, ["created", "revoked"]);
  await state.management.revokeMemberCredentials({
    actor: admin,
    occurredAt: new Date("2026-08-24T12:00:00.000Z"),
    subjectUserId: owner.userId,
    transaction: {} as never,
  });
  assertEquals(state.audit.actions, ["created", "revoked"]);
});

Deno.test("owners and administrators deliberately mint independent person read grants; members cannot", async () => {
  for (const role of ["owner", "admin", "member"] as const) {
    const state = fixture();
    const result = await state.management.create({ ...owner, role }, {
      name: "Detailed connector",
      scopes: ["people:profile:read", "relationships:read"],
    });
    assertEquals(result.status, role === "member" ? "forbidden" : "created");
    if (result.status === "created") {
      assertEquals(result.record.scopes, [
        "people:profile:read",
        "relationships:read",
      ]);
      assertEquals(
        await state.management.authenticate(result.secret, "people:read"),
        { status: "invalid" },
      );
      assertEquals(
        (await state.management.authenticate(
          result.secret,
          "people:profile:read",
        )).status,
        "authenticated",
      );
      assertEquals(
        (await state.management.authenticate(
          result.secret,
          "relationships:read",
        )).status,
        "authenticated",
      );
    }
  }
});

Deno.test("API token authorization fails closed for malformed, expired, missing-scope, and inactive use", async () => {
  const state = fixture();
  const member = { ...owner, role: "member" as const };
  assertEquals(
    await state.management.create(member, {
      name: "No",
      scopes: ["people:read"],
    }),
    { status: "forbidden" },
  );
  assertEquals(await state.management.list(member), { status: "forbidden" });
  assertEquals(await state.management.revoke(member, crypto.randomUUID()), {
    status: "forbidden",
  });
  assertEquals(
    await state.management.authenticate("malformed", "people:read"),
    { status: "invalid" },
  );
  const missing =
    `kin_pat_${crypto.randomUUID()}.secret-with-enough-entropy-value`;
  assertEquals(await state.management.authenticate(missing, "people:read"), {
    status: "invalid",
  });
  await state.management.create(owner, {
    expiresAt: "2026-08-24T10:00:00.001Z",
    name: "Short lived",
    scopes: ["people:read"],
  });
  const record = state.records.values().next().value!;
  const secret = `kin_pat_${record.id}.first-secret-with-enough-entropy`;
  state.records.set(record.id, {
    ...record,
    expiresAt: "2026-08-24T09:59:59.000Z",
  });
  assertEquals(await state.management.authenticate(secret, "people:read"), {
    status: "invalid",
  });
  state.records.set(record.id, { ...record, scopes: [] });
  assertEquals(await state.management.authenticate(secret, "people:read"), {
    status: "invalid",
  });
  state.records.set(record.id, record);
  assertEquals(
    await state.management.authenticate(
      `kin_pat_${record.id}.different-secret-with-enough-entropy`,
      "people:read",
    ),
    { status: "invalid" },
  );
  assertEquals(
    await state.management.create(owner, {
      expiresAt: "2026-08-24T09:59:59.000Z",
      name: "Expired",
      scopes: ["people:read"],
    }),
    { status: "invalid" },
  );
});

Deno.test("WebCrypto API token verifier compares hashes without storing plaintext", async () => {
  const secrets = new WebCryptoApiTokenSecrets();
  const created = await secrets.create();
  assertEquals(await secrets.matches(created.raw, created.hash), true);
  assertEquals(await secrets.matches(`${created.raw}x`, created.hash), false);
  assertEquals(await secrets.matches(created.raw, "not-a-hash"), false);
});

Deno.test("API tokens reject invalid grants and stop authenticating after revocation", async () => {
  const state = fixture();
  assertEquals(
    await state.management.create(owner, {
      name: "Too broad",
      scopes: ["people:write" as never],
    }),
    { status: "invalid" },
  );
  await state.management.create(owner, {
    expiresAt: "2026-09-24T10:00:00.000Z",
    name: "Read people",
    scopes: ["people:read"],
  });
  const secret =
    "kin_pat_10000000-0000-4000-8000-000000000004.first-secret-with-enough-entropy";
  assertEquals(
    await state.management.authenticate(
      secret,
      "people:read",
      owner.workspaceId,
    ),
    { actor: owner, status: "authenticated" },
  );
  assertEquals(
    await state.management.authenticate(
      secret,
      "people:read",
      crypto.randomUUID(),
    ),
    { status: "invalid" },
  );
  assertEquals(
    await state.management.revoke(owner, state.records.keys().next().value!),
    {
      record: {
        createdAt: "2026-08-24T10:00:00.000Z",
        expiresAt: "2026-09-24T10:00:00.000Z",
        id: "10000000-0000-4000-8000-000000000004",
        name: "Read people",
        scopes: ["people:read"],
        revokedAt: "2026-08-24T10:00:00.000Z",
      },
      status: "revoked",
    },
  );
  assertEquals(await state.management.authenticate(secret, "people:read"), {
    status: "invalid",
  });
  assertEquals(state.audit.actions, ["created", "revoked"]);
});

Deno.test("[AUD-M4] a caller who lost their standing reaches no token, and an unknown one is not found", async () => {
  const lapsed = fixture("revoked");
  assertEquals(
    await lapsed.management.create(owner, {
      name: "Lapsed",
      scopes: ["people:read"],
    }),
    { status: "forbidden" },
  );
  assertEquals(await lapsed.management.list(owner), { status: "forbidden" });
  assertEquals(await lapsed.management.revoke(owner, crypto.randomUUID()), {
    status: "forbidden",
  });
  assertEquals(lapsed.audit.actions, []);
  const current = fixture();
  assertEquals(await current.management.revoke(owner, crypto.randomUUID()), {
    status: "not-found",
  });
  assertEquals(current.audit.actions, []);
});
