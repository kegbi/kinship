import {
  createJournalManagement,
  type JournalRepository,
  type StoredDayRating,
  type StoredJournalPost,
} from "../public.ts";
import { deriveJournalPostId } from "../domain/journal_rules.ts";
import * as fixtures from "../../../testing/fixtures.ts";
import {
  fixedClock,
  inMemoryRepository,
  sequentialIds,
} from "../../../testing/fakes.ts";

const actor = fixtures.actor();

Deno.test("[JOURNAL-001] posts and same-day ratings remain one ordered journal", async () => {
  const posts = inMemoryRepository<StoredJournalPost>((post) => post.id);
  const ratings = inMemoryRepository<StoredDayRating>((rating) => rating.id);
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
      posts.save(post);
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
    findPost: () => Promise.resolve(undefined),
    linkActivity: () => Promise.resolve({ status: "not-found" }),
    lockRequest: () => Promise.resolve(),
    saveDayRating: (command) => {
      const existing = ratings.list().find((value) =>
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
      ratings.save(rating);
      return Promise.resolve({
        rating,
        status: existing ? "updated" : "created",
      });
    },
    updatePost: (command) => {
      const existing = posts.find(command.postId);
      if (!existing) return Promise.resolve({ status: "not-found" });
      const post = {
        ...existing,
        body: command.body,
        occurredAt: command.occurredAt.toISOString(),
        ...(command.title ? { title: command.title } : {}),
        updatedAt: command.now.toISOString(),
      };
      posts.save(post);
      return Promise.resolve({ post, status: "updated" });
    },
  };
  const journal = createJournalManagement({
    actors: { revalidate: () => Promise.resolve("active" as const) },
    activities: { inspect: () => Promise.resolve({ status: "not-found" }) },
    audit: { record: () => Promise.resolve("audit-id") },
    clock: fixedClock("2026-08-23T10:00:00.000Z"),
    ids: sequentialIds(),
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
    findPost: () => Promise.resolve(undefined),
    linkActivity: () => Promise.resolve({ status: "not-found" }),
    lockRequest: () => Promise.resolve(),
    saveDayRating: () => Promise.reject(new Error("offline")),
    updatePost: () => Promise.resolve({ status: "not-found" }),
  };
  const journal = createJournalManagement({
    actors: { revalidate: () => Promise.resolve("active" as const) },
    activities: { inspect: () => Promise.resolve({ status: "not-found" }) },
    audit: { record: () => Promise.resolve("audit") },
    clock: fixedClock("2026-08-23T10:00:00.000Z"),
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
    findPost: () => Promise.resolve(undefined),
    linkActivity: () => Promise.resolve({ status: "not-found" }),
    lockRequest: () => Promise.resolve(),
    saveDayRating: () => Promise.resolve({ status: "forbidden" }),
    updatePost: () => Promise.resolve({ status: "not-found" }),
  };
  const journal = createJournalManagement({
    actors: { revalidate: () => Promise.resolve("active" as const) },
    activities: { inspect: () => Promise.resolve({ status: "not-found" }) },
    audit: {
      record: (command) => {
        auditedType = command.itemType;
        return Promise.resolve("audit");
      },
    },
    clock: fixedClock("2026-08-23T10:00:00.000Z"),
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

/**
 * A journal store that keeps what it wrote, so a retry or a second edit meets
 * the row the first call left (MCP-D4).
 */
function storedJournal(clock = "2026-11-22T10:00:00.000Z") {
  const effects: string[] = [];
  const posts = inMemoryRepository<StoredJournalPost>((post) => post.id);
  let now = new Date(clock);
  const repository: JournalRepository = {
    createPost: (command) => {
      effects.push(`create:${command.id}`);
      if (posts.find(command.id)) {
        return Promise.reject(new Error("duplicate primary key"));
      }
      const post = {
        body: command.body,
        createdAt: command.now.toISOString(),
        id: command.id,
        occurredAt: command.occurredAt.toISOString(),
        ...(command.title ? { title: command.title } : {}),
        updatedAt: command.now.toISOString(),
      };
      posts.save(post);
      return Promise.resolve({ post, status: "created" });
    },
    deleteItem: (command) =>
      Promise.resolve(
        posts.delete(command.itemId)
          ? { itemType: "post", status: "deleted" }
          : { status: "not-found" },
      ),
    findPost: (command) => {
      effects.push(`find:${command.id}:${command.lock ? "lock" : "read"}`);
      return Promise.resolve(posts.find(command.id));
    },
    linkActivity: () => Promise.resolve({ status: "not-found" }),
    lockRequest: (command) => {
      effects.push(`lock:${command.id}`);
      return Promise.resolve();
    },
    saveDayRating: () => Promise.resolve({ status: "forbidden" }),
    updatePost: (command) => {
      effects.push(`update:${command.postId}`);
      const existing = posts.find(command.postId);
      if (!existing) return Promise.resolve({ status: "not-found" });
      const post: StoredJournalPost = {
        body: command.body,
        createdAt: existing.createdAt,
        id: existing.id,
        occurredAt: command.occurredAt.toISOString(),
        ...(command.title ? { title: command.title } : {}),
        updatedAt: command.now.toISOString(),
      };
      posts.save(post);
      return Promise.resolve({ post, status: "updated" });
    },
  };
  const audits: string[] = [];
  const journal = createJournalManagement({
    actors: { revalidate: () => Promise.resolve("active" as const) },
    activities: { inspect: () => Promise.resolve({ status: "not-found" }) },
    audit: {
      record: (command) => {
        audits.push(`${command.action}:${command.itemId}`);
        return Promise.resolve("audit");
      },
    },
    clock: { now: () => now },
    ids: sequentialIds(),
    repository,
    transaction: { run: (work) => work({ opaque: {} }) },
  });
  return {
    advance(milliseconds: number) {
      now = new Date(now.valueOf() + milliseconds);
    },
    audits,
    effects,
    journal,
    posts,
  };
}

const JOURNAL_REQUEST = "5b8a3c1d-2e4f-4a6b-9c8d-7e6f5a4b3c2d";
const POST = {
  body: "Walked to the lighthouse.",
  occurredAt: "2026-11-21T18:00:00.000Z",
  title: "Evening",
};

Deno.test("MCP-D4 a journal post created with a requestId is created once and replayed by id", async () => {
  const store = storedJournal();
  const derived = await deriveJournalPostId(actor.workspaceId, JOURNAL_REQUEST);
  const first = await store.journal.createPost(actor, {
    ...POST,
    requestId: JOURNAL_REQUEST,
  });
  if (first.status !== "created") throw new Error(first.status);
  if (first.post.id !== derived) throw new Error("the request names the post");

  store.advance(1_000);
  const replay = await store.journal.createPost(actor, {
    ...POST,
    occurredAt: "2026-11-21T19:00:00.000+01:00",
    requestId: JOURNAL_REQUEST.toUpperCase(),
  });
  if (replay.status !== "created" || replay.post.id !== derived) {
    throw new Error(`replay: ${JSON.stringify(replay)}`);
  }
  if (replay.post.createdAt !== first.post.createdAt) {
    throw new Error("a replay returns the stored post, not a new one");
  }
  if (store.posts.size !== 1 || store.audits.length !== 1) {
    throw new Error("a replay writes and audits nothing new");
  }
  if (!store.effects.includes(`lock:${derived}`)) {
    throw new Error("retries of one request are serialized");
  }
});

Deno.test("MCP-D4 the same journal requestId with another post is an idempotency conflict", async () => {
  const store = storedJournal();
  await store.journal.createPost(actor, {
    ...POST,
    requestId: JOURNAL_REQUEST,
  });
  const untitled = { body: POST.body, occurredAt: POST.occurredAt };
  const changed = [
    { ...POST, body: "Walked to the harbour." },
    { ...POST, title: "Night" },
    untitled,
    { ...POST, occurredAt: "2026-11-21T18:00:00.001Z" },
  ];
  for (const input of changed) {
    const result = await store.journal.createPost(actor, {
      ...input,
      requestId: JOURNAL_REQUEST,
    });
    if (result.status !== "idempotency-conflict") {
      throw new Error(`${JSON.stringify(input)}: ${result.status}`);
    }
  }
  if (store.posts.size !== 1) throw new Error("a conflict writes nothing");
});

Deno.test("MCP-D4 a journal create without a requestId, or with a malformed one, behaves as before", async () => {
  const store = storedJournal();
  const first = await store.journal.createPost(actor, POST);
  const second = await store.journal.createPost(actor, POST);
  if (
    first.status !== "created" || second.status !== "created" ||
    first.post.id === second.post.id || store.posts.size !== 2
  ) {
    throw new Error("each create without a request identifier is a new post");
  }
  if (store.effects.some((effect) => effect.startsWith("lock:"))) {
    throw new Error("no request lock without a request identifier");
  }
  const malformed = await store.journal.createPost(actor, {
    ...POST,
    requestId: "retry-1",
  });
  if (malformed.status !== "validation-error" || store.posts.size !== 2) {
    throw new Error(`malformed request identifier: ${malformed.status}`);
  }
});

Deno.test("MCP-D4 a journal update with expectedUpdatedAt refuses a stale revision and accepts the current one", async () => {
  const store = storedJournal();
  const created = await store.journal.createPost(actor, POST);
  if (created.status !== "created") throw new Error(created.status);
  const revision = created.post.updatedAt;

  store.advance(1_000);
  const fresh = await store.journal.updatePost(actor, created.post.id, {
    ...POST,
    body: "Walked back.",
    expectedUpdatedAt: revision,
  });
  if (fresh.status !== "updated" || fresh.post.body !== "Walked back.") {
    throw new Error(`fresh revision: ${fresh.status}`);
  }
  if (!store.effects.includes(`find:${created.post.id}:lock`)) {
    throw new Error("the revision is read under lock");
  }

  store.advance(1_000);
  const stale = await store.journal.updatePost(actor, created.post.id, {
    ...POST,
    body: "Overwritten.",
    expectedUpdatedAt: revision,
  });
  if (stale.status !== "stale") throw new Error(`stale: ${stale.status}`);
  if (store.posts.find(created.post.id)?.body !== "Walked back.") {
    throw new Error("a stale edit changes nothing");
  }
  const updates = store.audits.filter((audit) => audit.startsWith("updated"));
  if (updates.length !== 1) throw new Error("a stale edit audits nothing");

  const missing = await store.journal.updatePost(
    actor,
    "00000000-0000-4000-8000-0000000000ff",
    { ...POST, expectedUpdatedAt: revision },
  );
  if (missing.status !== "not-found") {
    throw new Error(`missing post: ${missing.status}`);
  }
  const malformed = await store.journal.updatePost(actor, created.post.id, {
    ...POST,
    expectedUpdatedAt: "yesterday",
  });
  if (malformed.status !== "validation-error") {
    throw new Error(`malformed revision: ${malformed.status}`);
  }
});

Deno.test("MCP-D4 a journal update without expectedUpdatedAt overwrites as before", async () => {
  const store = storedJournal();
  const created = await store.journal.createPost(actor, POST);
  if (created.status !== "created") throw new Error(created.status);
  await store.journal.updatePost(actor, created.post.id, {
    ...POST,
    body: "First edit.",
  });
  const second = await store.journal.updatePost(actor, created.post.id, {
    ...POST,
    body: "Second edit.",
  });
  if (second.status !== "updated" || second.post.body !== "Second edit.") {
    throw new Error(`unchecked edit: ${second.status}`);
  }
  if (store.effects.some((effect) => effect.startsWith("find:"))) {
    throw new Error("no revision read without expectedUpdatedAt");
  }
});
