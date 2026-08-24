import {
  createDavSyncManagement,
  type DavAuditEvent,
  type DavObjectCheckpoint,
  type DavRepository,
  type DavSubscription,
} from "./application/dav_sync.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`Expected ${right}, received ${left}`);
}

const actor = {
  memberId: "00000000-0000-4000-8000-000000000002",
  role: "admin" as const,
  userId: "00000000-0000-4000-8000-000000000003",
  workspaceId: "00000000-0000-4000-8000-000000000001",
};

function fixture(overrides: {
  readonly changes?:
    readonly import("./application/dav_sync.ts").DavRemoteChange[];
  readonly loseClaimAfterCheckpointRead?: boolean;
  readonly objects?:
    readonly (DavObjectCheckpoint & { readonly href: string })[];
  readonly people?: Parameters<typeof createDavSyncManagement>[0]["people"];
  readonly tasks?: Parameters<typeof createDavSyncManagement>[0]["tasks"];
} = {}) {
  let subscription: DavSubscription | undefined;
  let activeClaim: { token: string; at: Date } | undefined;
  const audits: DavAuditEvent[] = [];
  const objects = new Map<string, DavObjectCheckpoint>(
    overrides.objects?.map(({ href, ...checkpoint }) => [href, checkpoint]),
  );
  const repository: DavRepository = {
    authorize: ({ role }) => Promise.resolve(role !== "member"),
    claim: (_actor, _id, claimToken, claimedAt) => {
      if (
        !subscription?.isActive || activeClaim &&
          claimedAt.getTime() - activeClaim.at.getTime() <= 300_000
      ) return Promise.resolve(undefined);
      activeClaim = { at: claimedAt, token: claimToken };
      return Promise.resolve({
        ...subscription,
        claimToken,
        encryptedPassword: "encrypted:dav-secret",
      });
    },
    create: (command) => {
      subscription = {
        id: "00000000-0000-4000-8000-000000000010",
        isActive: true,
        lastOutcome: "never",
        name: command.name,
        remoteUrl: command.remoteUrl,
        ...(command.username ? { username: command.username } : {}),
      };
      return Promise.resolve(subscription);
    },
    disable: () => {
      subscription = subscription
        ? { ...subscription, isActive: false }
        : undefined;
      return Promise.resolve(subscription);
    },
    withClaimedObject: async (command, href, work) => {
      if (overrides.loseClaimAfterCheckpointRead) {
        activeClaim = { at: new Date(), token: "replacement-claim" };
      }
      if (
        command.claimToken !== activeClaim?.token || !subscription?.isActive
      ) return "claim-lost";
      const record = await work(objects.get(href), { opaque: "dav-test" });
      if (!record) return "skipped";
      objects.set(record.href, {
        coreId: record.coreId,
        etag: record.etag,
        kind: record.kind,
        status: record.status,
      });
      return "processed";
    },
    list: () => Promise.resolve(subscription ? [subscription] : []),
    recordAudit: (_actor, event) => {
      audits.push(event);
      return Promise.resolve(true);
    },
    recordOutcome: (command, outcome) => {
      if (
        command.claimToken !== activeClaim?.token || !subscription?.isActive
      ) return Promise.resolve(undefined);
      activeClaim = undefined;
      subscription = subscription
        ? {
          ...subscription,
          ...(outcome.error ? { lastError: outcome.error } : {}),
          lastOutcome: outcome.status,
          ...(outcome.remoteSyncToken
            ? { remoteSyncToken: outcome.remoteSyncToken }
            : {}),
        }
        : undefined;
      return Promise.resolve(subscription);
    },
  };
  const management = createDavSyncManagement({
    clock: { now: () => new Date("2026-08-24T12:00:00.000Z") },
    ids: {
      create: () => "00000000-0000-4000-8000-000000000099",
      fromRemote: () => "00000000-0000-4000-8000-000000000098",
    },
    people: overrides.people ?? {
      ensure: (_actor, input) =>
        Promise.resolve({
          person: { ...input, id: "00000000-0000-4000-8000-000000000020" },
          status: "ready" as const,
        }),
      archive: () => Promise.resolve({ status: "archived" as const }),
      restore: () => Promise.resolve({ status: "restored" as const }),
      update: () => Promise.resolve({ status: "updated" as const }),
    },
    remote: {
      pull: () =>
        Promise.resolve({
          changes: overrides.changes ?? [
            {
              changeType: "create" as const,
              etag: '"contact-1"',
              href: "/contacts/contact-1.vcf",
              kind: "person" as const,
              payload: { familyName: "Lovelace", givenName: "Ada" },
              uid: "contact-1",
            },
            {
              changeType: "create" as const,
              etag: '"task-1"',
              href: "/tasks/task-1.ics",
              kind: "task" as const,
              payload: { title: "Write notes" },
              uid: "task-1",
            },
          ],
          remoteSyncToken: "sync-2",
        }),
    },
    repository,
    secrets: {
      open: () => Promise.resolve("dav-secret"),
      seal: () => Promise.resolve("encrypted:dav-secret"),
    },
    tasks: overrides.tasks ?? {
      create: () =>
        Promise.resolve({
          status: "created" as const,
          task: { id: "00000000-0000-4000-8000-000000000030" },
        }),
      complete: () => Promise.resolve({ status: "saved" as const }),
      reopen: () => Promise.resolve({ status: "saved" as const }),
      update: () => Promise.resolve({ status: "saved" as const }),
    },
  });
  return { audits, management, objects, repository };
}

Deno.test("DAV sync persists object checkpoints before advancing the collection token", async () => {
  const { management, objects } = fixture();
  const created = await management.configure(actor, {
    name: "Personal DAV",
    password: "dav-secret",
    remoteUrl: "https://dav.example.test/addressbooks/me/contacts/",
    username: "ada",
  });
  assertEquals(created.status, "configured");
  if (created.status !== "configured") return;

  const synced = await management.synchronize(actor, created.subscription.id);
  assertEquals(synced.status, "success");
  if (synced.status !== "success") return;
  assertEquals(synced.processed, 2);
  assertEquals(synced.subscription.remoteSyncToken, "sync-2");
  assertEquals(objects.size, 2);

  const replay = await management.synchronize(actor, created.subscription.id);
  assertEquals(replay.status, "success");
  assertEquals(objects.size, 2);
});

Deno.test("DAV sync retains the prior token on partial failure and disables without deleting core records", async () => {
  const { management, repository } = fixture();
  const created = await management.configure(actor, {
    name: "Personal DAV",
    password: "dav-secret",
    remoteUrl: "https://dav.example.test/addressbooks/me/contacts/",
    username: "ada",
  });
  if (created.status !== "configured") throw new Error("fixture setup failed");

  const failing = createDavSyncManagement({
    clock: { now: () => new Date("2026-08-24T12:00:00.000Z") },
    ids: {
      create: () => crypto.randomUUID(),
      fromRemote: () => crypto.randomUUID(),
    },
    people: {
      ensure: () => Promise.resolve({ status: "forbidden" as const }),
      archive: () => Promise.resolve({ status: "forbidden" as const }),
      restore: () => Promise.resolve({ status: "forbidden" as const }),
      update: () => Promise.resolve({ status: "forbidden" as const }),
    },
    remote: {
      pull: () =>
        Promise.resolve({
          changes: [{
            changeType: "create" as const,
            etag: '"contact-2"',
            href: "/contact-2.vcf",
            kind: "person" as const,
            payload: { givenName: "Grace" },
            uid: "contact-2",
          }],
          remoteSyncToken: "sync-3",
        }),
    },
    repository,
    secrets: {
      open: () => Promise.resolve("dav-secret"),
      seal: (value) => Promise.resolve(value),
    },
    tasks: {
      create: () => Promise.resolve({ status: "forbidden" as const }),
      complete: () => Promise.resolve({ status: "forbidden" as const }),
      reopen: () => Promise.resolve({ status: "forbidden" as const }),
      update: () => Promise.resolve({ status: "forbidden" as const }),
    },
  });
  const partial = await failing.synchronize(actor, created.subscription.id);
  assertEquals(partial.status, "partial");
  if (partial.status !== "partial") return;
  assertEquals(partial.subscription.remoteSyncToken, undefined);

  const disabled = await management.disable(actor, created.subscription.id);
  assertEquals(disabled.status, "disabled");
  assertEquals(
    (await management.list(actor)).subscriptions[0]?.isActive,
    false,
  );
});

Deno.test("DAV configuration rejects unsafe remote URLs and members", async () => {
  const { audits, management } = fixture();
  assertEquals(
    (await management.configure(actor, {
      name: "Unsafe",
      password: "secret",
      remoteUrl: "http://dav.example.test",
      username: "ada",
    })).status,
    "invalid",
  );
  assertEquals(
    (await management.configure({ ...actor, role: "member" }, {
      name: "DAV",
      password: "secret",
      remoteUrl: "https://dav.example.test",
      username: "ada",
    })).status,
    "forbidden",
  );
  assertEquals(
    (await management.configure(actor, {
      name: "Too long",
      password: "secret",
      remoteUrl: `https://dav.example.test/${"a".repeat(2_100)}`,
    })).status,
    "invalid",
  );
  const expanded = `https://dav.example.test/${"é".repeat(400)}`;
  assertEquals(new TextEncoder().encode(expanded).length < 2_048, true);
  assertEquals(
    (await management.configure(actor, {
      name: "Canonical expansion",
      password: "secret",
      remoteUrl: expanded,
    })).status,
    "invalid",
  );
  assertEquals(audits, [{
    action: "configure",
    code: "dav_sync_failed",
    occurredAt: new Date("2026-08-24T12:00:00.000Z"),
    outcome: "failure",
    subscriptionId: "00000000-0000-4000-8000-000000000099",
  }, {
    action: "configure",
    code: "dav_sync_failed",
    occurredAt: new Date("2026-08-24T12:00:00.000Z"),
    outcome: "failure",
    subscriptionId: "00000000-0000-4000-8000-000000000099",
  }, {
    action: "configure",
    code: "dav_sync_failed",
    occurredAt: new Date("2026-08-24T12:00:00.000Z"),
    outcome: "failure",
    subscriptionId: "00000000-0000-4000-8000-000000000099",
  }]);
});

Deno.test("DAV lost claim cannot perform a core mutation", async () => {
  for (const changeType of ["create", "update", "delete"] as const) {
    let coreEffects = 0;
    const change: import("./application/dav_sync.ts").DavRemoteChange =
      changeType === "delete"
        ? {
          changeType,
          etag: '"deleted"',
          href: "/fenced.vcf",
          kind: "person",
          uid: "fenced",
        }
        : {
          changeType,
          etag: '"changed"',
          href: "/fenced.vcf",
          kind: "person",
          payload: { givenName: "Fenced" },
          uid: "fenced",
        };
    const { management } = fixture({
      changes: [change],
      loseClaimAfterCheckpointRead: true,
      ...(changeType === "create" ? {} : {
        objects: [{
          coreId: "person-id",
          etag: '"original"',
          href: "/fenced.vcf",
          kind: "person" as const,
          status: "synced" as const,
        }],
      }),
      people: {
        ensure: () => {
          coreEffects++;
          return Promise.resolve({
            person: { id: "person-id" },
            status: "ready" as const,
          });
        },
        archive: () => {
          coreEffects++;
          return Promise.resolve({ status: "archived" as const });
        },
        restore: () => Promise.resolve({ status: "restored" as const }),
        update: () => {
          coreEffects++;
          return Promise.resolve({ status: "updated" as const });
        },
      },
    });
    const created = await management.configure(actor, {
      name: "Fenced",
      password: "secret",
      remoteUrl: "https://dav.example.test/",
    });
    if (created.status !== "configured") {
      throw new Error("fixture setup failed");
    }
    assertEquals(
      (await management.synchronize(actor, created.subscription.id)).status,
      "busy",
    );
    assertEquals(coreEffects, 0);
  }
});

Deno.test("DAV rejects a stale claimant after expiry, reclaim, disable, or role revocation", async () => {
  const { management, repository } = fixture();
  const created = await management.configure(actor, {
    name: "Fenced DAV",
    password: "secret",
    remoteUrl: "https://dav.example.test/",
  });
  if (created.status !== "configured") throw new Error("fixture setup failed");
  const first = await repository.claim(
    actor,
    created.subscription.id,
    "claim-a",
    new Date("2026-08-24T12:00:00.000Z"),
  );
  const second = await repository.claim(
    actor,
    created.subscription.id,
    "claim-b",
    new Date("2026-08-24T12:06:00.000Z"),
  );
  assertEquals(first?.claimToken, "claim-a");
  assertEquals(second?.claimToken, "claim-b");
  assertEquals(
    await repository.withClaimedObject(
      {
        ...actor,
        claimToken: "claim-a",
        subscriptionId: created.subscription.id,
      },
      "/stale.vcf",
      () =>
        Promise.resolve({
          coreId: crypto.randomUUID(),
          etag: '"stale"',
          href: "/stale.vcf",
          kind: "person",
          payload: "BEGIN:VCARD\nEND:VCARD",
          status: "synced",
          uid: "stale",
        }),
    ),
    "claim-lost",
  );
  await management.disable(actor, created.subscription.id);
  assertEquals(
    await repository.recordOutcome(
      {
        ...actor,
        claimToken: "claim-b",
        subscriptionId: created.subscription.id,
      },
      { occurredAt: new Date(), status: "success" },
    ),
    undefined,
  );
});

Deno.test("DAV retry binds the deterministic remote person instead of a similar person", async () => {
  const ensured: string[] = [];
  const people: Parameters<typeof createDavSyncManagement>[0]["people"] = {
    ensure: (_actor, input) => {
      ensured.push(input.requestId);
      return Promise.resolve({
        person: { id: "00000000-0000-4000-8000-000000000077" },
        status: "ready" as const,
      });
    },
    archive: () => Promise.resolve({ status: "archived" as const }),
    restore: () => Promise.resolve({ status: "restored" as const }),
    update: () => Promise.resolve({ status: "updated" as const }),
  };
  const { management } = fixture({ people });
  const created = await management.configure(actor, {
    name: "Recovery",
    password: "secret",
    remoteUrl: "https://dav.example.test/",
  });
  if (created.status !== "configured") throw new Error("fixture setup failed");
  await management.synchronize(actor, created.subscription.id);
  const restarted = fixture({ people }).management;
  const recreated = await restarted.configure(actor, {
    name: "Recovery",
    password: "secret",
    remoteUrl: "https://dav.example.test/",
  });
  if (recreated.status !== "configured") {
    throw new Error("restart setup failed");
  }
  await restarted.synchronize(actor, recreated.subscription.id);
  assertEquals(ensured[0], ensured[1]);
});

Deno.test("DAV applies remote updates and tombstones through owning facades", async () => {
  const actions: string[] = [];
  const { management } = fixture({
    changes: [
      {
        changeType: "create",
        etag: '"person-1"',
        href: "/person.vcf",
        kind: "person",
        payload: { givenName: "Original" },
        uid: "person",
      },
      {
        changeType: "update",
        etag: '"person-2"',
        href: "/person.vcf",
        kind: "person",
        payload: { givenName: "Updated" },
        uid: "person",
      },
      {
        changeType: "delete",
        etag: '"person-deleted"',
        href: "/person.vcf",
        kind: "person",
        uid: "person",
      },
      {
        changeType: "update",
        etag: '"person-restored"',
        href: "/person.vcf",
        kind: "person",
        payload: { givenName: "Returned" },
        uid: "person",
      },
      {
        changeType: "create",
        etag: '"task-1"',
        href: "/task.ics",
        kind: "task",
        payload: { title: "Original" },
        uid: "task",
      },
      {
        changeType: "delete",
        etag: '"task-deleted"',
        href: "/task.ics",
        kind: "task",
        uid: "task",
      },
      {
        changeType: "update",
        etag: '"task-restored"',
        href: "/task.ics",
        kind: "task",
        payload: { title: "Returned" },
        uid: "task",
      },
    ],
    people: {
      ...{
        restore: () => {
          actions.push("person-restore");
          return Promise.resolve({ status: "restored" as const });
        },
      },
      ensure: () =>
        Promise.resolve({
          person: { id: "person-id" },
          status: "ready" as const,
        }),
      archive: () => {
        actions.push("person-archive");
        return Promise.resolve({ status: "archived" as const });
      },
      update: () => {
        actions.push("person-update");
        return Promise.resolve({ status: "updated" as const });
      },
    },
    tasks: {
      ...{
        reopen: () => {
          actions.push("task-reopen");
          return Promise.resolve({ status: "saved" as const });
        },
      },
      create: () =>
        Promise.resolve({
          status: "created" as const,
          task: { id: "task-id" },
        }),
      complete: () => {
        actions.push("task-complete");
        return Promise.resolve({ status: "saved" as const });
      },
      update: () => {
        actions.push("task-update");
        return Promise.resolve({ status: "saved" as const });
      },
    },
  });
  const created = await management.configure(actor, {
    name: "Changes",
    password: "secret",
    remoteUrl: "https://dav.example.test/",
  });
  if (created.status !== "configured") throw new Error("fixture setup failed");
  await management.synchronize(actor, created.subscription.id);
  assertEquals(actions, [
    "person-update",
    "person-archive",
    "person-restore",
    "person-update",
    "task-complete",
    "task-reopen",
    "task-update",
  ]);
});
