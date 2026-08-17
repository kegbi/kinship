import { createTodayInteractions } from "./public.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("INTERACTION-001 Today delegates a bounded read-only projection", async () => {
  let favoriteLimit = 0;
  let recentLimit = 0;
  const projection = createTodayInteractions({
    repository: {
      getFavoriteNotes(command) {
        favoriteLimit = command.favoriteLimit;
        return Promise.resolve({
          items: [],
          status: "ready",
        });
      },
      getRecentActivity(command) {
        recentLimit = command.recentLimit;
        return Promise.resolve({
          items: [],
          status: "ready",
        });
      },
    },
  });
  const actor = {
    memberId: crypto.randomUUID(),
    role: "owner",
    userId: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
  } as const;
  const [favorites, recent] = await Promise.all([
    projection.getFavoriteNotes(actor),
    projection.getRecentActivity(actor),
  ]);
  assert(
    favorites.status === "ready" && recent.status === "ready" &&
      favoriteLimit === 8 && recentLimit === 20,
    "Today regions were not independently bounded",
  );
});

Deno.test("INTERACTION-001 Today application keeps region failures independent", async () => {
  const actor = {
    memberId: crypto.randomUUID(),
    role: "owner" as const,
    userId: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
  };
  const projection = createTodayInteractions({
    repository: {
      getFavoriteNotes: () => Promise.reject(new Error("favorite offline")),
      getRecentActivity: () => Promise.resolve({ items: [], status: "ready" }),
    },
  });
  const [favoriteFailure, recentReady] = await Promise.allSettled([
    projection.getFavoriteNotes(actor),
    projection.getRecentActivity(actor),
  ]);
  assert(
    favoriteFailure.status === "rejected" &&
      recentReady.status === "fulfilled" &&
      recentReady.value.status === "ready",
    "favorite failure concealed recent activity",
  );

  const reverse = createTodayInteractions({
    repository: {
      getFavoriteNotes: () => Promise.resolve({ items: [], status: "ready" }),
      getRecentActivity: () => Promise.reject(new Error("recent offline")),
    },
  });
  const [favoriteReady, recentFailure] = await Promise.allSettled([
    reverse.getFavoriteNotes(actor),
    reverse.getRecentActivity(actor),
  ]);
  assert(
    favoriteReady.status === "fulfilled" &&
      favoriteReady.value.status === "ready" &&
      recentFailure.status === "rejected",
    "recent failure concealed favorite notes",
  );
});
