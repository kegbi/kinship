import {
  createRelationshipManagement,
  PostgresRelationshipRepository,
  type RelationshipDependencies,
  type RelationshipRecord,
} from "./public.ts";
import type { PeopleTransaction } from "../people/public.ts";
import type { WorkspaceRelationshipTypeRecord } from "../workspaces/public.ts";
import { PostgresRelationshipAudit } from "../governance/public.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("relationship adapter reads and writes only relationships-owned storage", () => {
  const source = Object.getOwnPropertyNames(
    PostgresRelationshipRepository.prototype,
  ).map((name) =>
    String(
      PostgresRelationshipRepository.prototype[
        name as keyof PostgresRelationshipRepository
      ],
    )
  ).join("\n");
  for (
    const forbidden of [
      "crm.people",
      "crm.relationship_types",
      "crm.users",
      "crm.workspace_members",
      "crm.workspace_profile_modules",
      "crm.workspaces",
    ]
  ) {
    assert(
      !source.includes(forbidden),
      `relationship adapter crossed ownership into ${forbidden}`,
    );
  }
});

async function directDependencies(target: string) {
  const output = await new Deno.Command(Deno.execPath(), {
    args: ["info", "--json", target],
    env: { DENO_NO_PACKAGE_JSON: "1" },
  }).output();
  assert(output.success, "governance dependency graph could not be read");
  const graph = JSON.parse(new TextDecoder().decode(output.stdout)) as {
    readonly modules: readonly {
      readonly dependencies?: readonly {
        readonly code?: { readonly specifier: string };
        readonly type?: { readonly specifier: string };
      }[];
      readonly specifier: string;
    }[];
  };
  return graph.modules.find((module) => module.specifier === target)
    ?.dependencies?.map((dependency) =>
      dependency.code?.specifier ?? dependency.type?.specifier ?? ""
    ) ?? [];
}

Deno.test("relationships and governance have no direct dependency edge", async () => {
  const governance = new URL(
    "../governance/adapters/postgres/relationship_audit.ts",
    import.meta.url,
  ).href;
  const relationships = new URL(
    "./application/manage_relationships.ts",
    import.meta.url,
  ).href;
  const [governanceDependencies, relationshipDependencies] = await Promise.all([
    directDependencies(governance),
    directDependencies(relationships),
  ]);
  assert(
    !governanceDependencies.some((dependency) =>
      dependency.includes("/modules/relationships/")
    ),
    "governance adapter imports the relationships module",
  );
  assert(
    !relationshipDependencies.some((dependency) =>
      dependency.includes("/modules/governance/")
    ),
    "relationships application imports the governance module",
  );
});

Deno.test("API composition can inject governance audit structurally", () => {
  const audit: RelationshipDependencies["audit"] =
    new PostgresRelationshipAudit();
  assert(
    typeof audit.record === "function" &&
      typeof audit.assertPostcondition === "function",
    "governance audit does not satisfy the relationship-owned port",
  );
});

const actor = {
  memberId: "00000000-0000-4000-8000-000000000002",
  role: "member" as const,
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000003",
};
const sourceId = "00000000-0000-4000-8000-000000000100";
const targetId = "00000000-0000-4000-8000-000000000101";
const typeId = "00000000-0000-4000-8000-000000000200";
const relationshipId = "00000000-0000-4000-8000-000000000300";

function fixture(
  context: "archived" | "forbidden" | "not-found" | "ready" = "ready",
  listContext: "archived" | "forbidden" | "hidden" | "not-found" | "ready" =
    "ready",
  failAt?:
    | "commit"
    | "person-audit"
    | "relationship-audit"
    | "relationship-postcondition",
  typeRecords: readonly WorkspaceRelationshipTypeRecord[] = [],
  hydrationContext: "forbidden" | "hidden" | "ready" = "ready",
  missingSummaryId?: string,
) {
  const effects: string[] = [];
  let saved: RelationshipRecord | undefined;
  let personSaved = false;
  const transaction: PeopleTransaction = { opaque: "relationship-test" };
  const dependencies: RelationshipDependencies = {
    audit: {
      record(command) {
        if (failAt === "relationship-audit") {
          throw new Error("relationship audit failed");
        }
        effects.push(`audit:${command.action}`);
        return Promise.resolve("00000000-0000-4000-8000-000000000400");
      },
      assertPostcondition() {
        effects.push("audit.assert");
        return Promise.resolve();
      },
    },
    clock: { now: () => new Date("2026-08-16T12:00:00.000Z") },
    ids: { create: () => relationshipId },
    people: {
      inspect(
        command: Parameters<RelationshipDependencies["people"]["inspect"]>[0],
      ) {
        const state = command.lock ? context : listContext;
        if (state === "archived") {
          return Promise.resolve({ status: "archived" });
        }
        if (state === "not-found") {
          return Promise.resolve({ status: "not-found" });
        }
        return Promise.resolve({ status: "ready" });
      },
      summarize(command) {
        effects.push(`people.summarize:${command.personIds.length}`);
        return Promise.resolve(
          command.personIds.filter((id) => id !== missingSummaryId).map((
            id,
          ) => ({
            archived: false,
            id,
            name: id === targetId ? "Ada Lovelace" : "Related person",
          })),
        );
      },
    },
    peopleCreation: {
      createInTransaction(_actor, input) {
        personSaved = true;
        effects.push("person.create", "person.audit", "person.assert");
        if (failAt === "person-audit") {
          throw new Error("person audit failed");
        }
        return Promise.resolve({
          person: {
            ...(input.familyName ? { familyName: input.familyName } : {}),
            givenName: input.givenName,
            id: targetId,
            isPartial: input.isPartial,
          },
          status: "created",
        });
      },
    },
    repository: {
      list() {
        return Promise.resolve({
          records: saved ? [saved] : [],
          status: "ready" as const,
        });
      },
      get() {
        return Promise.resolve(saved);
      },
      findExact() {
        return Promise.resolve(saved);
      },
      lockRelationship() {
        return Promise.resolve(
          saved
            ? { relationship: saved, status: "ready" as const }
            : { status: "not-found" as const },
        );
      },
      create(command) {
        effects.push("relationship.create");
        if (saved) return Promise.resolve(undefined);
        saved = {
          createdAt: command.occurredAt.toISOString(),
          forwardLabel: "parent",
          fromPersonId: sourceId,
          id: command.id,
          reverseLabel: "child",
          relationshipTypeId: typeId,
          relationshipTypeArchived: false,
          status: "active",
          toPersonId: targetId,
          updatedAt: command.occurredAt.toISOString(),
        };
        return Promise.resolve(saved);
      },
      update(command) {
        effects.push("relationship.update");
        saved = saved && {
          ...saved,
          forwardLabel: "guardian",
          relationshipTypeId: command.type.id,
          reverseLabel: "ward",
          updatedAt: "2026-08-16T12:00:00.000001Z",
        };
        return Promise.resolve(saved);
      },
      delete() {
        effects.push("relationship.delete");
        saved = undefined;
        return Promise.resolve(true);
      },
      assertPostcondition(command) {
        if (failAt === "relationship-postcondition") {
          throw new Error("relationship postcondition failed");
        }
        effects.push(`relationship.assert:${command.action}`);
        return Promise.resolve();
      },
    },
    transaction: {
      async run(work) {
        const beforePerson = personSaved;
        const beforeRelationship = saved;
        try {
          const result = await work(transaction);
          if (failAt === "commit") throw new Error("commit failed");
          return result;
        } catch (error) {
          personSaved = beforePerson;
          saved = beforeRelationship;
          throw error;
        }
      },
    },
    workspace: Object.assign({
      inspect(
        command: Parameters<
          RelationshipDependencies["workspace"]["inspect"]
        >[0],
      ) {
        if (command.lock) effects.push("context.lock");
        const state = command.lock ? context : listContext;
        if (
          state === "forbidden" || state === "hidden" || state === "not-found"
        ) {
          return Promise.resolve({ status: state });
        }
        return Promise.resolve({
          status: "ready" as const,
          ...(command.relationshipTypeId
            ? {
              type: {
                archived: false,
                forwardLabel: saved ? "guardian" : "parent",
                id: command.relationshipTypeId,
                reverseLabel: saved ? "ward" : "child",
              },
            }
            : {}),
        });
      },
      listTypes(
        command: Parameters<
          RelationshipDependencies["workspace"]["listTypes"]
        >[0],
      ) {
        if (listContext === "hidden" || listContext === "forbidden") {
          return Promise.resolve({ status: listContext });
        }
        const search = command.search?.toLocaleLowerCase() ?? "";
        const active = typeRecords.filter((type) =>
          !type.archived && (!search ||
            type.forwardLabel.toLocaleLowerCase().includes(search) ||
            type.reverseLabel.toLocaleLowerCase().includes(search))
        );
        let start = 0;
        if (command.after) {
          const anchor = active.findIndex((type) =>
            type.id === command.after?.id &&
            type.cursor.forwardLabel === command.after.forwardLabel &&
            type.cursor.sortOrder === command.after.sortOrder
          );
          if (anchor < 0) {
            return Promise.resolve({ status: "stale-cursor" as const });
          }
          start = anchor + 1;
        }
        return Promise.resolve({
          records: active.slice(start, start + command.limit),
          status: "ready" as const,
        });
      },
      hydrateTypes(
        command: Parameters<
          RelationshipDependencies["workspace"]["hydrateTypes"]
        >[0],
      ) {
        effects.push("types.hydrate");
        if (hydrationContext !== "ready") {
          return Promise.resolve({ status: hydrationContext });
        }
        if (typeRecords.length) {
          return Promise.resolve({
            records: typeRecords.filter((type) =>
              command.relationshipTypeIds.includes(type.id)
            ),
            status: "ready" as const,
          });
        }
        return Promise.resolve({
          records: saved
            ? [{
              archived: false,
              forwardLabel: saved.forwardLabel,
              id: saved.relationshipTypeId,
              reverseLabel: saved.reverseLabel,
            }]
            : [],
          status: "ready" as const,
        });
      },
    }, {
      ensureDefaultRelationshipTypes() {
        effects.push("types.ensure-defaults");
        if (listContext === "hidden" || listContext === "forbidden") {
          return Promise.resolve({ status: listContext });
        }
        return Promise.resolve({ status: "ready" as const });
      },
    }),
  };
  return {
    effects,
    management: createRelationshipManagement(dependencies),
    personSaved: () => personSaved,
    relationshipSaved: () => saved !== undefined,
  };
}

Deno.test("relationship facade creates once, displays the inverse, updates, and unlinks with audit", async () => {
  const { effects, management } = fixture();
  const created = await management.create(actor, sourceId, {
    relationshipTypeId: typeId,
    targetPersonId: targetId,
  });
  assert(created.status === "created", "expected relationship creation");
  assert(
    created.relationship.forwardLabel === "parent",
    "forward label missing",
  );
  assert(created.inverse.label === "child", "inverse display missing");
  assert(
    created.forward.label === "parent" &&
      created.forward.personId === targetId,
    "forward display missing",
  );
  assert(created.inverse.personId === sourceId, "inverse endpoint incorrect");
  assert(
    created.affectedPersonIds.join(",") === `${sourceId},${targetId}`,
    "affected profiles missing",
  );
  assert(
    effects.join(",") ===
      "types.ensure-defaults,context.lock,relationship.create,audit:create,relationship.assert:create,audit.assert",
    "create effects out of transaction order",
  );

  effects.length = 0;
  const duplicate = await management.create(actor, sourceId, {
    relationshipTypeId: typeId,
    targetPersonId: targetId,
  });
  assert(
    duplicate.status === "existing",
    "duplicate edge should be idempotent",
  );
  assert(
    !effects.includes("audit:create"),
    "idempotent retry must not audit a create",
  );

  const changed = await management.update(actor, sourceId, relationshipId, {
    expectedUpdatedAt: created.relationship.updatedAt,
    relationshipTypeId: "00000000-0000-4000-8000-000000000201",
  });
  assert(changed.status === "updated", "expected relationship update");
  assert(changed.inverse.label === "ward", "updated inverse display missing");

  const removed = await management.delete(actor, sourceId, relationshipId, {
    expectedUpdatedAt: changed.relationship.updatedAt,
  });
  assert(removed.status === "deleted", "expected unlink-only delete");
  assert(
    removed.affectedPersonIds.includes(targetId),
    "target profile was not invalidated",
  );
  assert(effects.includes("audit:delete"), "delete audit missing");
});

Deno.test("relationship facade exposes bounded read states and stale mutation failures", async () => {
  for (const state of ["forbidden", "not-found", "hidden"] as const) {
    const result = await fixture("ready", state).management.list(
      actor,
      sourceId,
    );
    assert(result.status === state, `relationship list lost ${state}`);
  }
  const current = fixture();
  assert(
    (await current.management.listTypes(actor)).status === "ready",
    "type list failed",
  );
  const created = await current.management.create(actor, sourceId, {
    relationshipTypeId: typeId,
    targetPersonId: targetId,
  });
  assert(created.status === "created", "fixture create failed");
  const list = await current.management.list(actor, sourceId);
  assert(
    list.status === "ready" && "relationships" in list &&
      list.relationships[0]?.display.label === "parent" &&
      list.relationships[0].display.name === "Ada Lovelace" &&
      current.effects.filter((effect) => effect.startsWith("people.summarize"))
          .length === 1,
    "forward read projection failed",
  );
  const malformed = fixture(
    "ready",
    "ready",
    undefined,
    [],
    "ready",
    targetId,
  );
  assert(
    (await malformed.management.create(actor, sourceId, {
      relationshipTypeId: typeId,
      targetPersonId: targetId,
    })).status === "created",
    "malformed fixture create failed",
  );
  const concealed = await malformed.management.list(actor, sourceId);
  assert(
    concealed.status === "ready" && "relationships" in concealed &&
      concealed.relationships.length === 0,
    "an unresolved endpoint must conceal the complete edge",
  );
  assert(
    (await current.management.list(actor, sourceId, { cursor: "forged" }))
      .status === "stale-cursor",
    "forged relationship cursor reached persistence",
  );
  assert(
    (await current.management.update(actor, sourceId, relationshipId, {
      expectedUpdatedAt: "invalid",
      relationshipTypeId: typeId,
    })).status === "validation-error",
    "invalid update version accepted",
  );
  assert(
    (await current.management.update(actor, sourceId, relationshipId, {
      expectedUpdatedAt: "2020-01-01T00:00:00.000Z",
      relationshipTypeId: typeId,
    })).status === "stale",
    "stale update accepted",
  );
  assert(
    (await current.management.delete(actor, sourceId, relationshipId, {
      expectedUpdatedAt: "invalid",
    })).status === "validation-error",
    "invalid delete version accepted",
  );
  assert(
    (await current.management.delete(actor, sourceId, relationshipId, {
      expectedUpdatedAt: "2020-01-01T00:00:00.000Z",
    })).status === "stale",
    "stale delete accepted",
  );
});

Deno.test("relationship type pages are bounded, selected-aware, and reject stale context", async () => {
  const unicodeSearch = "Родство关系😀";
  const types = Array.from({ length: 46 }, (_, index) => {
    const id = `00000000-0000-4000-8001-${String(index + 1).padStart(12, "0")}`;
    const forwardLabel = `${unicodeSearch} ${
      String(index + 1).padStart(2, "0")
    }`;
    return {
      archived: index === 45,
      cursor: { forwardLabel, id, sortOrder: index + 1 },
      forwardLabel,
      id,
      reverseLabel: `Обратно关系🧭 ${String(index + 1).padStart(2, "0")}`,
    } satisfies WorkspaceRelationshipTypeRecord;
  });
  const management = fixture("ready", "ready", undefined, types).management;
  const first = await management.listTypes(actor, {
    search: unicodeSearch,
    selectedTypeIds: [types[40]!.id, types[45]!.id, crypto.randomUUID()],
  });
  assert(
    first.status === "ready" && first.options.length === 20 &&
      first.selected.length === 2 && first.selected[1]?.archived === true &&
      Boolean(first.nextCursor),
    "first type page lost bounds or selected descriptors",
  );
  if (first.status !== "ready" || !first.nextCursor) {
    throw new Error("type continuation fixture missing");
  }
  const second = await management.listTypes(actor, {
    cursor: first.nextCursor,
    search: unicodeSearch,
    selectedTypeIds: [types[40]!.id],
  });
  assert(
    second.status === "ready" && second.options.length === 20 &&
      second.selected[0]?.id === types[40]!.id,
    "second type page or current selected hydration is incomplete",
  );
  assert(
    (await management.listTypes(actor, {
          cursor: first.nextCursor,
          search: "different",
        })).status === "stale-cursor" &&
      (await management.listTypes(actor, { cursor: "forged" })).status ===
        "stale-cursor",
    "forged or context-mismatched type cursor reached persistence",
  );
  types[19]!.cursor.forwardLabel = "Renamed anchor";
  types[19]!.forwardLabel = "Renamed anchor";
  assert(
    (await management.listTypes(actor, {
      cursor: first.nextCursor,
      search: unicodeSearch,
    })).status === "stale-cursor",
    "mutable type anchor silently changed continuation membership",
  );
});

Deno.test("relationship type access ensures versioned workspace defaults first", async () => {
  const current = fixture();
  const result = await current.management.listTypes(actor);
  assert(result.status === "ready", "relationship types are available");
  assert(
    current.effects.indexOf("types.ensure-defaults") >= 0 &&
      current.effects.indexOf("types.ensure-defaults") <
        current.effects.indexOf("types.hydrate"),
    "workspace defaults were not ensured before relationship type hydration",
  );
});

Deno.test("hidden relationship types never hydrate selected descriptors", async () => {
  const hidden = fixture("ready", "hidden");
  const result = await hidden.management.listTypes(actor, {
    selectedTypeIds: [typeId],
  });
  assert(
    result.status === "hidden" && result.options.length === 0 &&
      result.selected.length === 0,
    "hidden module disclosed a selected relationship type",
  );
  assert(
    !hidden.effects.includes("types.hydrate"),
    "hidden type page attempted selected hydration",
  );
  const forbidden = fixture("ready", "forbidden");
  assert(
    (await forbidden.management.listTypes(actor, {
          selectedTypeIds: [typeId],
        })).status === "forbidden" &&
      !forbidden.effects.includes("types.hydrate"),
    "forbidden type page was not propagated distinctly",
  );
  const changedDuringHydration = fixture(
    "ready",
    "ready",
    undefined,
    [],
    "hidden",
  );
  const changed = await changedDuringHydration.management.listTypes(actor, {
    selectedTypeIds: [typeId],
  });
  assert(
    changed.status === "hidden" && changed.options.length === 0 &&
      changed.selected.length === 0 &&
      changedDuringHydration.effects.includes("types.hydrate"),
    "selected hydration did not fail closed after module visibility changed",
  );
});

Deno.test("relationship facade rejects self links and conceals invalid tenant/type context", async () => {
  const ready = fixture();
  const self = await ready.management.create(actor, sourceId, {
    relationshipTypeId: typeId,
    targetPersonId: sourceId,
  });
  assert(self.status === "validation-error", "self link accepted");
  assert(ready.effects.length === 0, "self link reached persistence");

  for (const state of ["not-found", "forbidden"] as const) {
    const scoped = fixture(state);
    const result = await scoped.management.create(actor, sourceId, {
      relationshipTypeId: typeId,
      targetPersonId: targetId,
    });
    assert(result.status === state, `did not conceal ${state} context`);
  }

  const archived = fixture("archived");
  const result = await archived.management.create(actor, sourceId, {
    relationshipTypeId: typeId,
    targetPersonId: targetId,
  });
  assert(
    result.status === "archived-write-rejected",
    "archived endpoint remained writable",
  );
});

Deno.test("atomic related-person coordination commits both owners or rolls everything back", async () => {
  const created = fixture();
  const result = await created.management.createRelatedPerson(
    actor,
    sourceId,
    {
      person: { givenName: "Grace", isPartial: false },
      relationshipTypeId: typeId,
    },
  );
  assert(
    result.status === "created" && created.personSaved(),
    "coordinated person and edge did not commit",
  );
  assert(
    created.effects.join(",").startsWith(
      "types.ensure-defaults,person.create,person.audit,person.assert,types.ensure-defaults,context.lock,relationship.create,audit:create",
    ),
    "workspace initialization lock did not precede people row locks in the shared transaction",
  );

  const hidden = fixture("ready", "hidden");
  const concealed = await hidden.management.createRelatedPerson(
    actor,
    sourceId,
    {
      person: { givenName: "Grace", isPartial: false },
      relationshipTypeId: typeId,
    },
  );
  assert(
    concealed.status === "forbidden" && !hidden.personSaved() &&
      hidden.effects.join(",") === "types.ensure-defaults",
    "unavailable workspace initialization reached people row locks",
  );

  const invalidType = fixture("not-found");
  const rejected = await invalidType.management.createRelatedPerson(
    actor,
    sourceId,
    {
      person: { givenName: "Grace", isPartial: false },
      relationshipTypeId: typeId,
    },
  );
  assert(
    rejected.status === "not-found" && !invalidType.personSaved(),
    "invalid type left an orphan person",
  );

  for (
    const failure of [
      "person-audit",
      "relationship-audit",
      "relationship-postcondition",
      "commit",
    ] as const
  ) {
    const failing = fixture("ready", "ready", failure);
    let threw = false;
    try {
      await failing.management.createRelatedPerson(actor, sourceId, {
        person: { givenName: "Grace", isPartial: false },
        relationshipTypeId: typeId,
      });
    } catch {
      threw = true;
    }
    assert(threw && !failing.personSaved(), `${failure} did not roll back`);
    assert(
      !failing.relationshipSaved(),
      `${failure} retained a partial relationship`,
    );
  }
});
