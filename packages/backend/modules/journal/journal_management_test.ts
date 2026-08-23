import {
  createJournalManagement,
  type JournalRepository,
  type StoredDayRating,
  type StoredJournalPost,
} from "./public.ts";

const actor = {
  memberId: "00000000-0000-4000-8000-000000000002",
  role: "member" as const,
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000003",
};

Deno.test("[JOURNAL-001] posts and same-day ratings remain one ordered journal", async () => {
  const posts = new Map<string, StoredJournalPost>();
  const ratings = new Map<string, StoredDayRating>();
  const repository: JournalRepository = {
    createPost: (command) => {
      const post = {
        body: command.body,
        createdAt: command.now.toISOString(),
        id: command.id,
        occurredAt: command.occurredAt.toISOString(),
        ...(command.title ? { title: command.title } : {}),
        updatedAt: command.now.toISOString(),
      };
      posts.set(post.id, post);
      return Promise.resolve({ post, status: "created" });
    },
    deleteItem: (command) => {
      if (posts.delete(command.itemId)) {
        return Promise.resolve({ itemType: "post", status: "deleted" });
      }
      if (ratings.delete(command.itemId)) {
        return Promise.resolve({
          itemType: "day-rating",
          status: "deleted",
        });
      }
      return Promise.resolve({ status: "not-found" });
    },
    linkActivity: () => Promise.resolve({ status: "not-found" }),
    saveDayRating: (command) => {
      const existing = [...ratings.values()].find((value) =>
        value.ratedOn === command.ratedOn
      );
      const rating = {
        createdAt: existing?.createdAt ?? command.now.toISOString(),
        id: existing?.id ?? command.id,
        ratedOn: command.ratedOn,
        rating: command.rating,
        ...(command.comment ? { comment: command.comment } : {}),
        updatedAt: command.now.toISOString(),
      };
      ratings.set(rating.id, rating);
      return Promise.resolve({
        rating,
        status: existing ? "updated" : "created",
      });
    },
    updatePost: (command) => {
      const existing = posts.get(command.postId);
      if (!existing) return Promise.resolve({ status: "not-found" });
      const post = {
        ...existing,
        body: command.body,
        occurredAt: command.occurredAt.toISOString(),
        ...(command.title ? { title: command.title } : {}),
        updatedAt: command.now.toISOString(),
      };
      posts.set(post.id, post);
      return Promise.resolve({ post, status: "updated" });
    },
  };
  let id = 0;
  const journal = createJournalManagement({
    activities: { inspect: () => Promise.resolve({ status: "not-found" }) },
    audit: { record: () => Promise.resolve("audit-id") },
    clock: { now: () => new Date("2026-08-23T10:00:00.000Z") },
    ids: {
      next: () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
    },
    repository,
    transaction: { run: (work) => work({ opaque: {} }) },
  });

  const created = await journal.createPost(actor, {
    body: "Built the analytical engine.",
    occurredAt: "1843-12-10T18:30:00.000Z",
    title: "A useful day",
  });
  if (created.status !== "created") throw new Error(created.status);
  const firstRating = await journal.saveDayRating(actor, {
    comment: "Promising",
    ratedOn: "2026-08-23",
    rating: 4,
  });
  const replacement = await journal.saveDayRating(actor, {
    ratedOn: "2026-08-23",
    rating: 5,
  });

  if (firstRating.status !== "created" || replacement.status !== "updated") {
    throw new Error("same-day rating was not updated in place");
  }
  if (firstRating.rating.id !== replacement.rating.id || ratings.size !== 1) {
    throw new Error("same-day rating created a duplicate");
  }
  const removed = await journal.deleteItem(actor, created.post.id);
  if (removed.status !== "deleted" || posts.size !== 0) {
    throw new Error("journal post was not removed with its ordered item");
  }
});

Deno.test("[JOURNAL-001] journal validation and dependency failures do not write", async () => {
  const repository: JournalRepository = {
    createPost: () => Promise.reject(new Error("offline")),
    deleteItem: () => Promise.reject(new Error("offline")),
    linkActivity: () => Promise.resolve({ status: "not-found" }),
    saveDayRating: () => Promise.reject(new Error("offline")),
    updatePost: () => Promise.resolve({ status: "not-found" }),
  };
  const journal = createJournalManagement({
    activities: { inspect: () => Promise.resolve({ status: "not-found" }) },
    audit: { record: () => Promise.resolve("audit") },
    clock: { now: () => new Date("2026-08-23T10:00:00.000Z") },
    ids: { next: () => "00000000-0000-4000-8000-000000000099" },
    repository,
    transaction: { run: (work) => work({ opaque: {} }) },
  });
  const results = await Promise.all([
    journal.createPost(actor, { body: "", occurredAt: "invalid" }),
    journal.createPost(actor, {
      body: "valid",
      occurredAt: "2026-08-23T10:00:00.000Z",
    }),
    journal.saveDayRating(actor, { ratedOn: "23-08-2026", rating: 3 }),
    journal.saveDayRating(actor, { ratedOn: "2026-02-31", rating: 3 }),
    journal.saveDayRating(actor, { ratedOn: "2026-08-23", rating: 0 }),
    journal.linkActivity(actor, "00000000-0000-4000-8000-000000000098"),
    journal.deleteItem(actor, "00000000-0000-4000-8000-000000000097"),
    journal.updatePost(actor, "00000000-0000-4000-8000-000000000096", {
      body: "valid",
      occurredAt: "2026-08-23T10:00:00.000Z",
    }),
  ]);
  const statuses = results.map((result) => result.status);
  if (
    !statuses.includes("validation-error") ||
    !statuses.includes("unavailable") || !statuses.includes("not-found")
  ) {
    throw new Error(`unexpected journal failures: ${statuses.join(",")}`);
  }
});

Deno.test("[JOURNAL-001] deletion audit uses the stored journal item type", async () => {
  let auditedType: "activity" | "day-rating" | "post" | undefined;
  const repository: JournalRepository = {
    createPost: () => Promise.resolve({ status: "forbidden" }),
    deleteItem: () =>
      Promise.resolve({ itemType: "activity", status: "deleted" } as const),
    linkActivity: () => Promise.resolve({ status: "not-found" }),
    saveDayRating: () => Promise.resolve({ status: "forbidden" }),
    updatePost: () => Promise.resolve({ status: "not-found" }),
  };
  const journal = createJournalManagement({
    activities: { inspect: () => Promise.resolve({ status: "not-found" }) },
    audit: {
      record: (command) => {
        auditedType = command.itemType;
        return Promise.resolve("audit");
      },
    },
    clock: { now: () => new Date("2026-08-23T10:00:00.000Z") },
    ids: { next: () => "00000000-0000-4000-8000-000000000099" },
    repository,
    transaction: { run: (work) => work({ opaque: {} }) },
  });

  const result = await journal.deleteItem(
    actor,
    "00000000-0000-4000-8000-000000000098",
  );
  if (result.status !== "deleted" || auditedType !== "activity") {
    throw new Error(`stored deletion type was not audited: ${auditedType}`);
  }
});
