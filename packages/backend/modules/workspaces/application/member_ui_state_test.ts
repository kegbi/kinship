import {
  createMemberUiStateManagement,
  type MemberUiStateRepository,
} from "./member_ui_state.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const actor = {
  memberId: "00000000-0000-4000-8000-000000000002",
  role: "member" as const,
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000003",
};
const transaction = { opaque: {} };

function management(repository: MemberUiStateRepository) {
  return createMemberUiStateManagement({
    repository,
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
