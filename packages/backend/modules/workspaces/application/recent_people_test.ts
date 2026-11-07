import {
  createRecentPeopleManagement,
  type RecentPeopleRepository,
  type RecentPersonScope,
} from "../public.ts";
import { assert } from "../../../testing/assert.ts";
import * as fixtures from "../../../testing/fixtures.ts";

const actor = fixtures.actor();
const transaction = { opaque: {} };
const transactionRunner = {
  run<T>(work: (value: typeof transaction) => Promise<T>) {
    return work(transaction);
  },
};
const everyone: RecentPersonScope = {
  inWorkspace: () => Promise.resolve(true),
};
const manage = (
  repository: RecentPeopleRepository,
  people: RecentPersonScope = everyone,
) =>
  createRecentPeopleManagement({
    actors: { revalidate: () => Promise.resolve("active" as const) },
    people,
    repository,
    transaction: transactionRunner,
  });
const person = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, "0")}`;

Deno.test("TODAY-001 recent-person state preserves sparse UI state and stays bounded", async () => {
  let uiState: unknown = JSON.stringify({
    dismissedWelcome: true,
    recentPersonIds: ["bad", person(99).toUpperCase(), person(99)],
  });
  const repository: RecentPeopleRepository = {
    lock: () => Promise.resolve({ status: "ready", uiState }),
    save(command) {
      uiState = command.uiState;
      return Promise.resolve(true);
    },
  };
  const recent = manage(repository);

  for (let index = 1; index <= 9; index++) {
    const result = await recent.record(actor, person(index));
    assert(result.status === "recorded", `view ${index} was not recorded`);
    const state = uiState as Record<string, unknown>;
    assert(state.dismissedWelcome === true, "unrelated UI state was lost");
    const ids = state.recentPersonIds as unknown[];
    assert(
      ids.length === Math.min(index + 1, 8),
      "recent list was not bounded",
    );
    assert(ids[0] === person(index), "latest person did not move to front");
  }

  await recent.record(actor, person(3));
  const ids = (uiState as { recentPersonIds: string[] }).recentPersonIds;
  assert(ids[0] === person(3), "repeat did not move the person to front");
  assert(new Set(ids).size === ids.length, "repeat created a duplicate");

  const oversized = Array<string>(1_000);
  for (let index = 0; index < 8; index++) oversized[index] = person(index + 20);
  uiState = {
    recentPersonIds: new Proxy(oversized, {
      get(target, key) {
        if (key === "8") throw new Error("scanned beyond eight valid ids");
        return Reflect.get(target, key);
      },
    }),
  };
  await recent.record(actor, person(40));
  assert(
    (uiState as { recentPersonIds: string[] }).recentPersonIds.length === 8,
    "oversized recent list was not bounded",
  );
});

Deno.test("TODAY-001 recent-person state repairs malformed roots and fails closed", async () => {
  for (
    const malformed of [
      undefined,
      null,
      [],
      7,
      JSON.stringify("scalar"),
      "{",
    ] as const
  ) {
    let saved: unknown;
    const recent = manage({
      lock: () => Promise.resolve({ status: "ready", uiState: malformed }),
      save(command) {
        saved = command.uiState;
        return Promise.resolve(true);
      },
    });
    const result = await recent.record(actor, person(1));
    assert(result.status === "recorded", "malformed UI state was not repaired");
    assert(
      JSON.stringify(saved) ===
        JSON.stringify({ recentPersonIds: [person(1)] }),
      "malformed root leaked into the repaired state",
    );
  }

  let saved = false;
  const forbidden = await manage({
    lock: () => Promise.resolve({ status: "forbidden" }),
    save: () => {
      saved = true;
      return Promise.resolve(true);
    },
  }).record(actor, person(1));
  assert(
    forbidden.status === "forbidden" && !saved,
    "denial did not stop write",
  );
});

Deno.test("AUD-T1 a person outside the actor's workspace is never stored as recent", async () => {
  let saved = false;
  const asked: unknown[] = [];
  const recent = manage(
    {
      lock: () => Promise.resolve({ status: "ready", uiState: {} }),
      save: () => {
        saved = true;
        return Promise.resolve(true);
      },
    },
    {
      inWorkspace(command) {
        asked.push({
          personId: command.personId,
          transaction: command.transaction,
          workspaceId: command.workspaceId,
        });
        return Promise.resolve(false);
      },
    },
  );
  const result = await recent.record(actor, person(7).toUpperCase());
  assert(
    result.status === "forbidden" && !saved,
    "a person outside the workspace was recorded",
  );
  assert(
    JSON.stringify(asked) ===
      JSON.stringify([{
        personId: person(7),
        transaction,
        workspaceId: actor.workspaceId,
      }]),
    "the canonical id was not checked in the actor's workspace and transaction",
  );
});
