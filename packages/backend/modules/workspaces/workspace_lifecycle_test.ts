import {
  createWorkspaceLifecycle,
  type WorkspaceLifecycleDependencies,
  type WorkspaceLifecycleSnapshot,
} from "./public.ts";
import { assert, assertRejects } from "../../testing/assert.ts";
import { fixedClock } from "../../testing/fakes.ts";

const actor = {
  memberId: "10000000-0000-4000-8000-000000000001",
  role: "owner" as const,
  userId: "20000000-0000-4000-8000-000000000001",
  workspaceId: "30000000-0000-4000-8000-000000000001",
  workspaceName: "Family",
};

const snapshot: WorkspaceLifecycleSnapshot = {
  activeSessionCount: 2,
  counts: {
    activities: 3,
    auditEvents: 0,
    calls: 0,
    debts: 0,
    exports: 1,
    files: 2,
    gifts: 0,
    imports: 1,
    integrations: 0,
    journalPosts: 4,
    lifeEvents: 0,
    members: 2,
    messages: 0,
    notes: 0,
    operations: 0,
    people: 5,
    relationships: 0,
    reminders: 6,
    tasks: 7,
  },
  impactToken: "current-impact",
  objectKeys: ["objects/a", "objects/b"],
  workspaceName: "Family",
};

function createTestCascadeParticipants(
  overrides: Partial<WorkspaceLifecycleDependencies["impact"]> = {},
): WorkspaceLifecycleDependencies["impact"] {
  const empty = (revision: string) => ({
    inspectBeforeCascade: () => Promise.resolve({ counts: {}, revision }),
  });
  return {
    files: empty("files-empty"),
    gifts: empty("gifts-empty"),
    governance: empty("governance-empty"),
    importExport: empty("import-export-empty"),
    integrations: empty("integrations-empty"),
    interactions: empty("interactions-empty"),
    journal: empty("journal-empty"),
    operations: empty("operations-empty"),
    people: empty("people-empty"),
    planning: empty("planning-empty"),
    relationships: empty("relationships-empty"),
    ...overrides,
  };
}

function setup(options: {
  failCompleteOnce?: boolean;
  failMutation?: boolean;
  failObject?: boolean;
  failTransactionalAudit?: boolean;
  missing?: boolean;
  operationsImpact?: boolean;
  rateLimited?: boolean;
  relationshipsImpact?: boolean;
} = {}) {
  const effects: string[] = [];
  const pending = new Map<string, readonly string[]>();
  let relationshipsRevision = "relationships-v1";
  let operationsRevision = "operations-v1";
  let failComplete = options.failCompleteOnce ?? false;
  let failObject = options.failObject ?? true;
  const dependencies: WorkspaceLifecycleDependencies = {
    activityAudit: {
      recordReset: () => {
        effects.push("activity-audit:reset");
        return Promise.resolve();
      },
    },
    attemptBudget: {
      finalize: ({ statusCode }) => {
        effects.push(`finalize:${statusCode}`);
        return Promise.resolve();
      },
      reserve: () =>
        Promise.resolve(
          options.rateLimited
            ? {
              reservationId: "reservation",
              retryAfterSeconds: 17,
              status: "rate-limited",
            }
            : { reservationId: "reservation", status: "admitted" },
        ),
    },
    audit: {
      record: ({ action, outcome }) => {
        effects.push(`attempt:${action}:${outcome}`);
        if (
          options.failTransactionalAudit && outcome === "transactional-failure"
        ) {
          return Promise.reject(new Error("audit unavailable"));
        }
        return Promise.resolve();
      },
    },
    authenticationAudit: {
      assertFailurePostcondition: () => Promise.resolve(),
      assertPostcondition: () => Promise.resolve(),
      record: () => Promise.resolve("audit-event"),
      recordFailure: () => Promise.resolve("audit-event"),
    },
    clock: fixedClock("2026-08-23T10:00:00.000Z"),
    identity: {
      verifyPassword: ({ password }) => Promise.resolve(password === "valid"),
    },
    ids: { create: () => crypto.randomUUID() },
    impact: createTestCascadeParticipants({
      ...(options.relationshipsImpact
        ? {
          relationships: {
            inspectBeforeCascade: () =>
              Promise.resolve({
                counts: { relationships: 1 },
                revision: relationshipsRevision,
              }),
          },
        }
        : {}),
      ...(options.operationsImpact
        ? {
          operations: {
            inspectBeforeCascade: () =>
              Promise.resolve({
                counts: { operations: 1 },
                revision: operationsRevision,
              }),
          },
        }
        : {}),
    }),
    repository: {
      completeCleanup: ({ recordId }) => {
        effects.push(`complete:${recordId}`);
        if (failComplete) {
          failComplete = false;
          return Promise.reject(new Error("cleanup marker unavailable"));
        }
        pending.delete(recordId);
        return Promise.resolve();
      },
      deleteWorkspace: ({ recordId }) => {
        effects.push(`delete:${recordId}`);
        if (options.failMutation) {
          return Promise.reject(new Error("forced mutation failure"));
        }
        pending.set(recordId, snapshot.objectKeys);
        return Promise.resolve();
      },
      inspect: () => Promise.resolve(options.missing ? undefined : snapshot),
      listPendingCleanups: () =>
        Promise.resolve([...pending].map(([recordId, objectKeys]) => ({
          objectKeys,
          recordId,
        }))),
      resetWorkspace: ({ recordId, objectKeys }) => {
        effects.push("reset");
        pending.set(recordId, objectKeys);
        return Promise.resolve();
      },
    },
    storage: {
      remove: ({ key }) => {
        effects.push(`remove:${key}`);
        if (failObject && key === "objects/b") {
          failObject = false;
          return Promise.reject(new Error("store unavailable"));
        }
        return Promise.resolve();
      },
    },
    transaction: {
      run: (work) => work({ opaque: {} }),
    },
  };
  return {
    effects,
    lifecycle: createWorkspaceLifecycle(dependencies),
    updateRelationships: () => {
      relationshipsRevision = "relationships-v2";
    },
    updateOperations: () => {
      operationsRevision = "operations-v2";
    },
  };
}

Deno.test("[WORKSPACE-002] operations snapshots participate in locked impact revalidation", async () => {
  const { lifecycle, updateOperations } = setup({ operationsImpact: true });
  const preview = await lifecycle.preview(actor);
  assert(preview.status === "ready", "operations impact preview missing");
  updateOperations();
  const stale = await lifecycle.deleteWorkspace(actor, {
    confirmation: "DELETE Family",
    impactToken: preview.impactToken,
    password: "valid",
  }, { clientAddress: "203.0.113.18" });
  assert(
    stale.status === "stale-impact",
    "snapshot change kept a valid impact",
  );
});

Deno.test("[WORKSPACE-002] committed mutation survives cleanup marker retry", async () => {
  const { lifecycle } = setup({
    failCompleteOnce: true,
    failObject: false,
  });
  const preview = await lifecycle.preview(actor);
  assert(preview.status === "ready", "cleanup preview missing");
  const deleted = await lifecycle.deleteWorkspace(actor, {
    confirmation: preview.deleteConfirmation,
    impactToken: preview.impactToken,
    password: "valid",
  });
  assert(
    deleted.status === "deleted" && deleted.cleanupStatus === "pending",
    "committed deletion was reported as failed",
  );
  const reconciled = await lifecycle.reconcilePendingCleanup();
  assert(
    reconciled.inspected === 1 && reconciled.completed === 1,
    "pending cleanup receipt was not reconciled",
  );
  assert(
    (await lifecycle.reconcilePendingCleanup()).inspected === 0,
    "completed cleanup receipt was not closed",
  );
});

Deno.test("[WORKSPACE-002] rolled-back primary mutation records a separate redacted failure", async () => {
  const { effects, lifecycle } = setup({ failMutation: true });
  const preview = await lifecycle.preview(actor);
  assert(preview.status === "ready", "failure preview missing");
  await assertRejects(async () => {
    await lifecycle.deleteWorkspace(actor, {
      confirmation: "DELETE Family",
      impactToken: preview.impactToken,
      password: "valid",
    }, { clientAddress: "203.0.113.19" });
  }, "primary mutation failure was hidden");
  assert(
    effects.filter((effect) =>
      effect === "attempt:delete:transactional-failure"
    ).length === 1,
    "post-rollback transactional failure was not recorded exactly once",
  );
});

Deno.test("[WORKSPACE-002] fallback audit cannot mask the primary failure", async () => {
  const { lifecycle } = setup({
    failMutation: true,
    failTransactionalAudit: true,
  });
  const preview = await lifecycle.preview(actor);
  assert(preview.status === "ready", "failure preview missing");
  let message = "";
  try {
    await lifecycle.deleteWorkspace(actor, {
      confirmation: "DELETE Family",
      impactToken: preview.impactToken,
      password: "valid",
    });
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assert(
    message === "forced mutation failure",
    "fallback masked primary error",
  );
});

Deno.test("[WORKSPACE-002] contributed module changes invalidate the current impact", async () => {
  const { lifecycle, updateRelationships } = setup({
    relationshipsImpact: true,
  });
  const preview = await lifecycle.preview(actor);
  assert(preview.status === "ready", "owner preview missing");
  updateRelationships();
  const stale = await lifecycle.deleteWorkspace(actor, {
    confirmation: "DELETE Family",
    impactToken: preview.impactToken,
    password: "valid",
  }, { clientAddress: "203.0.113.12" });
  assert(
    stale.status === "stale-impact",
    "relationship change kept a valid impact",
  );
});

Deno.test("[WORKSPACE-002] destructive step-up is bounded and durably audited", async () => {
  const { effects, lifecycle } = setup({ rateLimited: true });
  const result = await lifecycle.deleteWorkspace(actor, {
    confirmation: "DELETE Family",
    impactToken: "current-impact",
    password: "wrong",
  }, { clientAddress: "203.0.113.13" });
  assert(result.status === "rate-limited", "rate limit was not enforced");
  assert(result.retryAfterSeconds === 17, "retry delay changed");
  assert(
    effects.includes("attempt:delete:rate-limited") &&
      effects.includes("finalize:429"),
    "redacted rate-limit result was not durably recorded",
  );
});

Deno.test("[WORKSPACE-002] lifecycle rejects non-owner and invalid confirmations", async () => {
  const { lifecycle } = setup();
  const member = { ...actor, role: "member" as const };
  assert(
    (await lifecycle.preview(member)).status === "forbidden",
    "member preview allowed",
  );
  assert(
    (await lifecycle.resetWorkspace(member, {
      confirmation: "RESET Family",
      impactToken: snapshot.impactToken,
      password: "valid",
    })).status === "forbidden",
    "member reset allowed",
  );
  assert(
    (await lifecycle.deleteWorkspace(member, {
      confirmation: "DELETE Family",
      impactToken: snapshot.impactToken,
      password: "valid",
    })).status === "forbidden",
    "member deletion allowed",
  );

  assert(
    (await lifecycle.resetWorkspace(actor, {
      confirmation: "RESET Family",
      impactToken: snapshot.impactToken,
      password: "wrong",
    })).status === "reauthentication-required",
    "wrong reset password allowed",
  );
  assert(
    (await lifecycle.deleteWorkspace(actor, {
      confirmation: "Family",
      impactToken: snapshot.impactToken,
      password: "valid",
    })).status === "confirmation-invalid",
    "inexact deletion confirmation allowed",
  );
  assert(
    (await lifecycle.resetWorkspace(actor, {
      confirmation: "Family",
      impactToken: snapshot.impactToken,
      password: "valid",
    })).status === "confirmation-invalid",
    "inexact reset confirmation allowed",
  );
});

Deno.test("[WORKSPACE-002] reset revalidates impact and completes object cleanup", async () => {
  const { effects, lifecycle } = setup({ failObject: false });
  const preview = await lifecycle.preview(actor);
  assert(preview.status === "ready", "reset preview missing");
  assert(
    (await lifecycle.resetWorkspace(actor, {
      confirmation: "RESET Family",
      impactToken: "stale-impact",
      password: "valid",
    })).status === "stale-impact",
    "stale reset impact allowed",
  );

  const reset = await lifecycle.resetWorkspace(actor, {
    confirmation: "RESET Family",
    impactToken: preview.impactToken,
    password: "valid",
  });
  assert(
    reset.status === "reset" && reset.cleanupStatus === "complete",
    "reset failed",
  );
  assert(
    effects.indexOf("reset") < effects.indexOf("remove:objects/a"),
    "database reset must happen before cleanup",
  );
});

Deno.test("[WORKSPACE-002] lifecycle hides missing locked workspace", async () => {
  const { lifecycle } = setup({ missing: true });
  assert(
    (await lifecycle.preview(actor)).status === "forbidden",
    "missing preview exposed",
  );
  assert(
    (await lifecycle.deleteWorkspace(actor, {
      confirmation: "DELETE Family",
      impactToken: snapshot.impactToken,
      password: "valid",
    })).status === "forbidden",
    "missing deletion was accepted",
  );
  assert(
    (await lifecycle.reconcilePendingCleanup(1)).inspected === 0,
    "empty cleanup changed",
  );
});

Deno.test("[WORKSPACE-002] delete is owner-only, versioned, durable, and object cleanup retries", async () => {
  const { effects, lifecycle } = setup();
  const preview = await lifecycle.preview(actor);
  assert(preview.status === "ready", "owner preview should be ready");
  assert(
    preview.deleteConfirmation === "DELETE Family" &&
      preview.resetConfirmation === "RESET Family",
    "preview should provide exact confirmations",
  );

  const stale = await lifecycle.deleteWorkspace(actor, {
    confirmation: "DELETE Family",
    impactToken: "stale-impact",
    password: "valid",
  });
  assert(stale.status === "stale-impact", "stale preview must be rejected");

  const deleted = await lifecycle.deleteWorkspace(actor, {
    confirmation: "DELETE Family",
    impactToken: preview.impactToken,
    password: "valid",
  });
  assert(deleted.status === "deleted", "workspace should be deleted");
  assert(deleted.cleanupStatus === "pending", "failed cleanup remains pending");
  assert(
    effects.findIndex((effect) => effect.startsWith("delete:")) <
        effects.indexOf("remove:objects/a") &&
      effects.includes("remove:objects/a") &&
      effects.includes("remove:objects/b"),
    "durable record must be written before object removal",
  );

  const reconciled = await lifecycle.reconcilePendingCleanup();
  assert(reconciled.completed === 1, "pending cleanup should retry and finish");
  assert(
    effects.some((effect) => effect.startsWith("complete:")),
    "successful retry must durably complete cleanup",
  );
});
