import {
  createPersonalizationManagement,
  type PersonalizationDependencies,
} from "./application/personalization.ts";
import type { PersonalizationMutation } from "./domain/personalization_rules.ts";
import type { PersonalizationTransaction } from "./ports/context.ts";
import { assert } from "../../testing/assert.ts";
import { fixedClock } from "../../testing/fakes.ts";

const owner = {
  memberId: "member-a",
  role: "owner" as const,
  userId: "user-a",
  workspaceId: "workspace-a",
};

function fixture() {
  const effects: string[] = [];
  const mutations: unknown[] = [];
  const transaction: PersonalizationTransaction = { opaque: {} };
  const dependencies: PersonalizationDependencies = {
    audit: {
      record(command) {
        assert(command.transaction === transaction, "audit shares transaction");
        effects.push(`audit:${command.action}`);
        return Promise.resolve();
      },
    },
    clock: fixedClock("2026-08-16T12:00:00Z"),
    repository: {
      inspect(command) {
        effects.push(`inspect:${command.section}:${command.id}`);
        return Promise.resolve({
          entry: {
            capabilities: {
              delete: true,
              disable: false,
              editValue: false,
              rename: true,
              reorder: false,
              replace: true,
              setDefault: false,
            },
            canDelete: true,
            id: command.id,
            isActive: true,
            isDefault: false,
            kind: "named" as const,
            name: "Friend",
            readOnly: false,
            referenceCount: 2,
            sortOrder: 0,
            updatedAt: "2026-08-16T11:00:00.000000Z",
          },
          status: "ready" as const,
        });
      },
      list(command) {
        effects.push(`list:${command.section}`);
        return Promise.resolve({
          capabilities: { create: true, editValue: false },
          entries: [],
          readOnly: false,
          status: "ready" as const,
        });
      },
      mutate(command) {
        mutations.push(command);
        effects.push(`mutate:${command.section}:${command.action}`);
        const name = command.action === "delete"
          ? "Friend"
          : command.name ?? "Friend";
        const sortOrder = command.action === "delete"
          ? 0
          : command.sortOrder ?? 0;
        return Promise.resolve({
          entry: {
            capabilities: {
              delete: true,
              disable: false,
              editValue: false,
              rename: true,
              reorder: false,
              replace: true,
              setDefault: false,
            },
            canDelete: true,
            id: "option-a",
            isActive: true,
            isDefault: false,
            kind: "named" as const,
            name,
            readOnly: false,
            referenceCount: 0,
            sortOrder,
            updatedAt: "2026-08-16T12:00:00.000000Z",
          },
          status: "saved" as const,
        });
      },
    },
    transaction: {
      async run(work) {
        effects.push("tx:begin");
        const result = await work(transaction);
        effects.push("tx:commit");
        return result;
      },
    },
  };
  return {
    effects,
    mutations,
    service: createPersonalizationManagement(dependencies),
  };
}

Deno.test("WORKSPACE-003 validates sections and denies members before storage", async () => {
  const { effects, service } = fixture();
  const memberResult = await service.list({ ...owner, role: "member" }, "tags");
  assert(
    memberResult.status === "forbidden",
    "members cannot manage vocabulary",
  );
  assert(effects.length === 0, "denial does not enter storage");
  assert(
    service.isSection("profile-modules") &&
      service.isSection("reminder-rules") &&
      !service.isSection("separate-crud-route"),
    "only accepted stable section ids are allowed",
  );
});

Deno.test("WORKSPACE-003 previews references before destructive mutation", async () => {
  const { effects, service } = fixture();
  const result = await service.mutate(owner, "tags", {
    action: "delete",
    expectedUpdatedAt: "2026-08-16T11:00:00.000000Z",
    id: "option-a",
  });
  assert(result.status === "replacement-required", "in-use option is retained");
  assert(result.referenceCount === 2, "impact count is returned");
  assert(
    !effects.some((effect) => effect.startsWith("mutate:")),
    "no write occurs",
  );
});

Deno.test("WORKSPACE-003 writes and audits once in the same transaction", async () => {
  const { effects, service } = fixture();
  const result = await service.mutate(owner, "tags", {
    action: "create",
    name: "  Close friends  ",
    sortOrder: 0,
  });
  assert(result.status === "saved", "create succeeds");
  assert(result.entry.name === "Close friends", "name is normalized");
  assert(
    effects.join(",") ===
      "tx:begin,mutate:tags:create,audit:workspace-personalization-updated,tx:commit",
    "write and governance audit are atomic",
  );
});

Deno.test("WORKSPACE-003 preserves directional labels and validates reminder lead time", async () => {
  const { mutations, service } = fixture();
  const relationship = await service.mutate(owner, "relationship-types", {
    action: "create",
    forwardLabel: "  Mentor ",
    reverseLabel: " Mentee  ",
    sortOrder: 4,
  });
  assert(relationship.status === "saved", "directional relationship saves");
  const command = mutations[0] as {
    readonly forwardLabel?: string;
    readonly reverseLabel?: string;
  };
  assert(
    command.forwardLabel === "Mentor" && command.reverseLabel === "Mentee",
    "direction labels stay distinct and normalized",
  );
  const invalid = await service.mutate(owner, "reminder-rules", {
    action: "create",
    sortOrder: 0,
  });
  assert(
    invalid.status === "invalid",
    "reminder rule requires canonical daysBefore",
  );
});

Deno.test("WORKSPACE-003 rejects section-incompatible mutations before a transaction", async () => {
  const scenarios = [
    {
      input: {
        action: "update" as const,
        expectedUpdatedAt: "2026-08-16T11:00:00.000000Z",
        id: "option-a",
        name: "Ignored reminder name",
      },
      section: "reminder-rules" as const,
    },
    {
      input: {
        action: "update" as const,
        expectedUpdatedAt: "2026-08-16T11:00:00.000000Z",
        id: "option-a",
        name: "Ignored relationship name",
      },
      section: "relationship-types" as const,
    },
    {
      input: {
        action: "update" as const,
        expectedUpdatedAt: "2026-08-16T11:00:00.000000Z",
        id: "option-a",
        sortOrder: 1,
      },
      section: "tags" as const,
    },
    {
      input: {
        action: "update" as const,
        expectedUpdatedAt: "2026-08-16T11:00:00.000000Z",
        id: "option-a",
        name: "Mutable global",
      },
      section: "emotion-options" as const,
    },
  ];
  for (const scenario of scenarios) {
    const { effects, service } = fixture();
    const result = await service.mutate(
      owner,
      scenario.section,
      scenario.input,
    );
    assert(result.status === "invalid", `${scenario.section} fails closed`);
    assert(effects.length === 0, "invalid input never opens a transaction");
  }
});

Deno.test("WORKSPACE-003 rejects false default and invalid sort orders before a transaction", async () => {
  const invalidInputs: readonly PersonalizationMutation[] = [
    {
      action: "update",
      expectedUpdatedAt: "2026-08-16T11:00:00.000000Z",
      id: "option-a",
      isDefault: false,
    } as unknown as PersonalizationMutation,
    ...[
      -1,
      1.5,
      10_001,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ].map((sortOrder) => ({
      action: "update" as const,
      expectedUpdatedAt: "2026-08-16T11:00:00.000000Z",
      id: "option-a",
      sortOrder,
    })),
  ];
  for (const input of invalidInputs) {
    const { effects, service } = fixture();
    const result = await service.mutate(owner, "gender-options", input);
    assert(result.status === "invalid", "invalid mutation fails closed");
    assert(effects.length === 0, "invalid mutation never opens a transaction");
  }
});
