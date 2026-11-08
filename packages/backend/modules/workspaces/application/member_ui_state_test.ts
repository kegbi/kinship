import { createMemberUiStateManagement } from "./member_ui_state.ts";
import type { MemberUiStateRepository } from "../ports/ui_state_repository.ts";
import { assert } from "../../../testing/assert.ts";
import * as fixtures from "../../../testing/fixtures.ts";

const actor = fixtures.actor();
const transaction = { opaque: {} };

/** A fake repository; the session read is optional where a suite skips it. */
type RepositoryFake =
  & Omit<MemberUiStateRepository, "readSession">
  & Partial<Pick<MemberUiStateRepository, "readSession">>;

function withSessionRead(repository: RepositoryFake): MemberUiStateRepository {
  return {
    readSession: () =>
      Promise.reject(new Error("this suite does not read the session")),
    ...repository,
  };
}

function management(repository: RepositoryFake) {
  return createMemberUiStateManagement({
    actors: { revalidate: () => Promise.resolve("active" as const) },
    repository: withSessionRead(repository),
    transaction: {
      run<T>(work: (value: typeof transaction) => Promise<T>) {
        return work(transaction);
      },
    },
  });
}

Deno.test("UXD-016C member UI-state projects a valid theme independently", async () => {
  const result = await management({
    read: () =>
      Promise.resolve({
        status: "ready",
        uiState: { personWorkspaceView: "garbage", theme: "dark" },
      }),
    lock: () => Promise.resolve({ status: "ready", uiState: {} }),
    save: () => Promise.resolve(true),
  }).read(actor);
  assert(result.status === "ready", "authorised stored state is ready");
  assert(
    (result.uiState as Readonly<Record<string, unknown>>).theme === "dark",
    "a corrupt sibling key discarded the valid stored theme",
  );
});

Deno.test("UXD-016C member UI-state merges owned keys without clobbering siblings", async () => {
  let stored: Readonly<Record<string, unknown>> = {
    personWorkspaceView: "timeline",
    recentPersonIds: ["00000000-0000-4000-8000-000000000010"],
    theme: "light",
  };
  const uiState = management({
    read: () => Promise.resolve({ status: "ready", uiState: stored }),
    lock: () => Promise.resolve({ status: "ready", uiState: stored }),
    save(command) {
      stored = command.uiState;
      return Promise.resolve(true);
    },
  });

  const themed = await uiState.save(actor, { theme: "dark" });
  assert(themed.status === "ready", "theme saves");
  assert(
    themed.uiState.theme === "dark" &&
      themed.uiState.personWorkspaceView === "timeline",
    "theme save did not return the complete recognised projection",
  );
  assert(
    JSON.stringify(stored.recentPersonIds) ===
      JSON.stringify(["00000000-0000-4000-8000-000000000010"]),
    "theme save clobbered recent-person history",
  );

  const viewed = await uiState.save(actor, { personWorkspaceView: "planning" });
  assert(viewed.status === "ready", "person-workspace view saves");
  assert(
    viewed.uiState.personWorkspaceView === "planning" &&
      viewed.uiState.theme === "dark",
    "person-workspace save clobbered the theme",
  );
  assert(
    JSON.stringify(stored.recentPersonIds) ===
      JSON.stringify(["00000000-0000-4000-8000-000000000010"]),
    "person-workspace save clobbered recent-person history",
  );
});

Deno.test("UXD-016C member UI-state accepts only non-empty recognised theme input", async () => {
  let locked = false;
  const uiState = management({
    read: () => Promise.resolve({ status: "ready", uiState: {} }),
    lock: () => {
      locked = true;
      return Promise.resolve({ status: "ready", uiState: {} });
    },
    save: () => Promise.resolve(true),
  });

  for (const theme of ["system", "light", "dark"] as const) {
    const result = await uiState.save(actor, { theme });
    assert(
      result.status === "ready" && result.uiState.theme === theme,
      `${theme} was not accepted`,
    );
  }
  locked = false;
  assert(
    (await uiState.save(actor, {})).status === "forbidden" &&
      (await uiState.save(actor, { theme: undefined } as never)).status ===
        "forbidden" &&
      (await uiState.save(actor, { theme: "sepia" } as never)).status ===
        "forbidden",
    "empty or invalid theme input reached persistence",
  );
  assert(!locked, "invalid theme input acquired a persistence lock");
});

const uiStateActor = fixtures.actor();
const uiStateTransaction = { opaque: {} };
const uiStateTransactionRunner = {
  run<T>(work: (value: typeof uiStateTransaction) => Promise<T>) {
    return work(uiStateTransaction);
  },
};
const manageUiState = (repository: RepositoryFake) =>
  createMemberUiStateManagement({
    actors: { revalidate: () => Promise.resolve("active" as const) },
    repository: withSessionRead(repository),
    transaction: uiStateTransactionRunner,
  });

Deno.test("UXD-002C3 member UI-state write preserves every unowned stored key", async () => {
  let stored: unknown = JSON.stringify({
    dismissedWelcome: true,
    recentPersonIds: ["00000000-0000-4000-8000-000000000010"],
  });
  const uiState = manageUiState({
    read: () => Promise.resolve({ status: "ready", uiState: stored }),
    lock: () => Promise.resolve({ status: "ready", uiState: stored }),
    save(command) {
      stored = command.uiState;
      return Promise.resolve(true);
    },
  });

  const saved = await uiState.save(uiStateActor, {
    personWorkspaceView: "planning",
  });
  assert(saved.status === "ready", "valid presentation state saves");
  assert(
    saved.uiState.personWorkspaceView === "planning",
    "save returns the recognised projection",
  );
  const value = stored as Readonly<Record<string, unknown>>;
  assert(value.dismissedWelcome === true, "unknown stored key was clobbered");
  assert(
    JSON.stringify(value.recentPersonIds) ===
      JSON.stringify(["00000000-0000-4000-8000-000000000010"]),
    "recent-person history was clobbered",
  );
});

Deno.test("UXD-002C3 member UI-state rejects invalid input before persistence", async () => {
  let locked = false;
  let saved = false;
  const uiState = manageUiState({
    read: () => Promise.resolve({ status: "ready", uiState: {} }),
    lock: () => {
      locked = true;
      return Promise.resolve({ status: "ready", uiState: {} });
    },
    save: () => {
      saved = true;
      return Promise.resolve(true);
    },
  });

  const result = await uiState.save(uiStateActor, {
    personWorkspaceView: "unknown",
  } as never);
  assert(result.status === "forbidden", "invalid view fails closed");
  assert(!locked && !saved, "invalid input reached persistence");
});

Deno.test("UXD-002C3 member UI-state reads missing preferences as empty state", async () => {
  const result = await manageUiState({
    read: () => Promise.resolve({ status: "ready", uiState: undefined }),
    lock: () => Promise.resolve({ status: "ready", uiState: undefined }),
    save: () => Promise.resolve(true),
  }).read(uiStateActor);
  assert(result.status === "ready", "authorised missing row is ready");
  assert(
    Object.keys(result.uiState).length === 0,
    "missing preference row projects empty state",
  );
});

Deno.test("UXD-002C3 member UI-state ignores unknown reads and stops forbidden access", async () => {
  let saved = false;
  const unknown = await manageUiState({
    read: () =>
      Promise.resolve({
        status: "ready",
        uiState: { personWorkspaceView: "invalid", recentPersonIds: [] },
      }),
    lock: () => Promise.resolve({ status: "forbidden" }),
    save: () => {
      saved = true;
      return Promise.resolve(true);
    },
  }).read(uiStateActor);
  assert(
    unknown.status === "ready" && Object.keys(unknown.uiState).length === 0,
    "read leaked unrecognised presentation state",
  );

  const deniedRepository: RepositoryFake = {
    read: () => Promise.resolve({ status: "forbidden" }),
    lock: () => Promise.resolve({ status: "forbidden" }),
    save: () => {
      saved = true;
      return Promise.resolve(true);
    },
  };
  const denied = manageUiState(deniedRepository);
  assert(
    (await denied.read(uiStateActor)).status === "forbidden",
    "read allowed denial",
  );
  assert(
    (await denied.save(uiStateActor, { personWorkspaceView: "things" }))
      .status === "forbidden",
    "write allowed denial",
  );
  assert(!saved, "denied write reached save");
});

Deno.test("UXD-002C3 member UI-state repairs malformed storage and fails closed", async () => {
  for (const malformed of [null, [], "{"] as const) {
    const result = await manageUiState({
      read: () => Promise.resolve({ status: "ready", uiState: malformed }),
      lock: () => Promise.resolve({ status: "ready", uiState: malformed }),
      save: () => Promise.resolve(true),
    }).read(uiStateActor);
    assert(
      result.status === "ready" && Object.keys(result.uiState).length === 0,
      "malformed stored state leaked through the projection",
    );
  }

  const inputGuard = manageUiState({
    read: () => Promise.resolve({ status: "ready", uiState: {} }),
    lock: () => Promise.resolve({ status: "ready", uiState: {} }),
    save: () => Promise.resolve(true),
  });
  assert(
    (await inputGuard.save(uiStateActor, null as never)).status ===
        "forbidden" &&
      (await inputGuard.save(uiStateActor, {
          personWorkspaceView: "all",
          recentPersonIds: [],
        } as never)).status === "forbidden",
    "loose UI-state input reached persistence",
  );

  for (
    const personWorkspaceView of [
      "all",
      "timeline",
      "planning",
      "things",
      "admin",
    ] as const
  ) {
    const result = await inputGuard.save(uiStateActor, { personWorkspaceView });
    assert(
      result.status === "ready" &&
        result.uiState.personWorkspaceView === personWorkspaceView,
      `${personWorkspaceView} was not accepted`,
    );
  }

  const rejected = await manageUiState({
    read: () => Promise.resolve({ status: "ready", uiState: {} }),
    lock: () =>
      Promise.resolve({
        status: "ready",
        uiState: { personWorkspaceView: "admin" },
      }),
    save: () => Promise.resolve(false),
  }).save(uiStateActor, {});
  assert(rejected.status === "forbidden", "repository refusal reported ready");
});

Deno.test("AUD-F3 the session read projects the UI state and passes the preferences through", async () => {
  const preferences = {
    contactNameOrder: "family_given_nickname",
    contactSortOrder: "family_name_asc",
    effectiveTimezone: "Europe/Belgrade",
    fluidLayout: true,
    locale: "sr-Latn",
    measurementSystem: "metric",
    reminderDelivery: "in_app",
    temperatureScale: "celsius",
  } as const;
  const commands: unknown[] = [];
  const scopes: ({ readonly workspaceId: string } | undefined)[] = [];
  const connection = { opaque: "connection" };
  const reads = createMemberUiStateManagement({
    actors: { revalidate: () => Promise.resolve("active" as const) },
    connection: {
      run<T>(
        work: (value: typeof connection) => Promise<T>,
        scope?: { readonly workspaceId: string },
      ) {
        scopes.push(scope);
        return work(connection);
      },
    },
    repository: withSessionRead({
      read: () => Promise.reject(new Error("the session reads once")),
      readSession: (command) => {
        commands.push(command);
        return Promise.resolve({
          preferences,
          status: "ready",
          uiState: { recentPersonIds: ["hidden"], theme: "dark" },
        });
      },
      lock: () => Promise.resolve({ status: "ready", uiState: {} }),
      save: () => Promise.resolve(true),
    }),
    transaction: {
      run<T>(work: (value: typeof transaction) => Promise<T>) {
        return work(transaction);
      },
    },
  });

  const result = await reads.readSession(actor);
  assert(
    result.status === "ready" &&
      JSON.stringify(result.uiState) === JSON.stringify({ theme: "dark" }) &&
      result.preferences === preferences,
    `the session read changed what it was given: ${JSON.stringify(result)}`,
  );
  assert(commands.length === 1, "the session read was not one statement");
  const [command] = commands as [Record<string, unknown>];
  assert(
    command.memberId === actor.memberId &&
      command.workspaceId === actor.workspaceId &&
      command.userId === actor.userId && command.transaction === connection,
    "the session read was not bound to the actor's membership on the plain connection",
  );
  assert(
    scopes.length === 1 && scopes[0]?.workspaceId === actor.workspaceId,
    `the session read did not run in the actor's workspace (ADR 0008): ${
      JSON.stringify(scopes)
    }`,
  );

  const blank = await management({
    read: () => Promise.reject(new Error("the session reads once")),
    readSession: () => Promise.resolve({ status: "ready", uiState: undefined }),
    lock: () => Promise.resolve({ status: "ready", uiState: {} }),
    save: () => Promise.resolve(true),
  }).readSession(actor);
  assert(
    blank.status === "ready" && !("preferences" in blank) &&
      Object.keys(blank.uiState).length === 0,
    "a membership without a preference row invented preferences",
  );

  const refused = await management({
    read: () => Promise.reject(new Error("the session reads once")),
    readSession: () => Promise.resolve({ status: "forbidden" }),
    lock: () => Promise.resolve({ status: "ready", uiState: {} }),
    save: () => Promise.resolve(true),
  }).readSession(actor);
  assert(refused.status === "forbidden", "a refused read was reported ready");

  let reached = false;
  const revoked = await createMemberUiStateManagement({
    actors: { revalidate: () => Promise.resolve("revoked" as const) },
    repository: withSessionRead({
      read: () => Promise.reject(new Error("the session reads once")),
      readSession: () => {
        reached = true;
        return Promise.resolve({ status: "ready", uiState: {} });
      },
      lock: () => Promise.resolve({ status: "ready", uiState: {} }),
      save: () => Promise.resolve(true),
    }),
    transaction: {
      run<T>(work: (value: typeof transaction) => Promise<T>) {
        return work(transaction);
      },
    },
  }).readSession(actor);
  assert(
    revoked.status === "forbidden" && !reached,
    "a revoked actor reached the session read",
  );
});
