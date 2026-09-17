import { createJournalRoutes } from "./journal.ts";
import {
  createJournalManagement,
  type JournalRepository,
} from "../../packages/backend/modules/journal/public.ts";
import { createJournalTimeline } from "../../packages/backend/read-models/journal-timeline/public.ts";
import * as fixtures from "../../packages/backend/testing/fixtures.ts";
import { fixedClock } from "../../packages/backend/testing/fakes.ts";

const id = "00000000-0000-4000-8000-000000000010";
const actor = fixtures.actor();
const now = "2026-08-23T10:00:00.000Z";

Deno.test("[JOURNAL-001] journal HTTP routes protect and expose the complete CRUD surface", async () => {
  let ratingSaved = false;
  const repository: JournalRepository = {
    createPost: (command) =>
      Promise.resolve({
        post: {
          body: command.body,
          createdAt: now,
          id: command.id,
          occurredAt: command.occurredAt.toISOString(),
          ...(command.title ? { title: command.title } : {}),
          updatedAt: now,
        },
        status: "created",
      }),
    deleteItem: () => Promise.resolve({ itemType: "post", status: "deleted" }),
    linkActivity: (command) =>
      Promise.resolve({
        activityId: command.activityId,
        id: command.id,
        occurredAt: command.occurredAt.toISOString(),
        status: "created",
      }),
    saveDayRating: (command) => {
      const status = ratingSaved ? "updated" as const : "created" as const;
      ratingSaved = true;
      return Promise.resolve({
        rating: {
          ...(command.comment ? { comment: command.comment } : {}),
          createdAt: now,
          id: command.id,
          ratedOn: command.ratedOn,
          rating: command.rating,
          updatedAt: now,
        },
        status,
      });
    },
    updatePost: (command) =>
      Promise.resolve({
        post: {
          body: command.body,
          createdAt: now,
          id: command.postId,
          occurredAt: command.occurredAt.toISOString(),
          ...(command.title ? { title: command.title } : {}),
          updatedAt: now,
        },
        status: "updated",
      }),
  };
  const journal = createJournalManagement({
    actors: { revalidate: () => Promise.resolve("active" as const) },
    activities: {
      inspect: () => Promise.resolve({ occurredAt: now, status: "ready" }),
    },
    audit: { record: () => Promise.resolve(id) },
    clock: fixedClock(now),
    ids: { next: () => id },
    repository,
    transaction: { run: (work) => work({ opaque: {} }) },
  });
  const timeline = createJournalTimeline({
    actors: { revalidate: () => Promise.resolve("active" as const) },
    transaction: { run: (work) => work({ opaque: undefined }) },
    repository: {
      read: (_actor, itemId) =>
        Promise.resolve({
          activities: [{ happenedAt: now, id, summary: "Shared a walk" }],
          items: [{
            id: itemId ?? id,
            occurredAt: now,
            post: { body: "Entry", id, updatedAt: now },
            type: "post",
          }],
          status: "ready",
        }),
    },
  });
  const app = createJournalRoutes({
    browserSecurity: { origin: "http://localhost", secureCookie: false },
    journal,
    protectedSessions: {
      resolve: () => {
        const context = { ...actor, workspaceName: "Journal" };
        return Promise.resolve({ ...context, accessibleWorkspaces: [context] });
      },
    },
    timeline,
  });
  const request = (
    path: string,
    method = "GET",
    body?: unknown,
    origin = "http://localhost",
  ) =>
    app.request(`http://localhost${path}`, {
      ...(body ? { body: JSON.stringify(body) } : {}),
      headers: {
        cookie: "kinship_session=valid",
        "content-type": "application/json",
        origin,
      },
      method,
    });

  if ((await app.request("http://localhost/api/v1/journal")).status !== 401) {
    throw new Error("journal read did not require a session");
  }
  if (
    (await request("/api/v1/journal/posts", "POST", {
      body: "Entry",
      occurredAt: now,
    }, "http://evil.test")).status !== 403
  ) throw new Error("journal mutation did not require same origin");
  if ((await request("/api/v1/journal", "GET")).status !== 200) {
    throw new Error("journal list unavailable");
  }
  if ((await request(`/api/v1/journal/items/${id}`, "GET")).status !== 200) {
    throw new Error("journal item unavailable");
  }
  if (
    (await request("/api/v1/journal/posts", "POST", {
      body: "Entry",
      occurredAt: now,
    })).status !== 201
  ) throw new Error("post create unavailable");
  if (
    (await request(`/api/v1/journal/posts/${id}`, "PUT", {
      body: "Edited",
      occurredAt: now,
    })).status !== 200
  ) throw new Error("post update unavailable");
  if (
    (await request("/api/v1/journal/day-ratings", "PUT", {
      ratedOn: "2026-08-23",
      rating: 5,
    })).status !== 201
  ) throw new Error("day rating unavailable");
  if (
    (await request("/api/v1/journal/day-ratings", "PUT", {
      ratedOn: "2026-08-23",
      rating: 4,
    })).status !== 200
  ) throw new Error("day rating update unavailable");
  if (
    (await request("/api/v1/journal/activities", "POST", { activityId: id }))
      .status !== 201
  ) throw new Error("activity link unavailable");
  if (
    (await request(`/api/v1/journal/items/${id}`, "DELETE"))
      .status !== 200
  ) throw new Error("journal delete unavailable");
  if (
    (await request("/api/v1/journal/day-ratings", "PUT", {
      ratedOn: "2026-02-31",
      rating: 7,
    })).status !== 400
  ) throw new Error("invalid rating accepted");
});

Deno.test("[JOURNAL-001] journal HTTP failures preserve concealment and problem details", async () => {
  const repository: JournalRepository = {
    createPost: () => Promise.resolve({ status: "forbidden" }),
    deleteItem: () => Promise.resolve({ status: "not-found" }),
    linkActivity: () => Promise.resolve({ status: "not-found" }),
    saveDayRating: () => Promise.resolve({ status: "forbidden" }),
    updatePost: () => Promise.resolve({ status: "not-found" }),
  };
  const journal = createJournalManagement({
    actors: { revalidate: () => Promise.resolve("active" as const) },
    activities: {
      inspect: () => Promise.resolve({ occurredAt: now, status: "ready" }),
    },
    audit: { record: () => Promise.resolve(id) },
    clock: fixedClock(now),
    ids: { next: () => id },
    repository,
    transaction: { run: (work) => work({ opaque: {} }) },
  });
  const timeline = createJournalTimeline({
    actors: { revalidate: () => Promise.resolve("active" as const) },
    transaction: { run: (work) => work({ opaque: undefined }) },
    repository: {
      read: (_actor, itemId) =>
        Promise.resolve(
          itemId ? { status: "not-found" } : { status: "forbidden" },
        ),
    },
  });
  const context = { ...actor, workspaceName: "Journal" };
  const app = createJournalRoutes({
    browserSecurity: { origin: "http://localhost", secureCookie: false },
    journal,
    protectedSessions: {
      resolve: () =>
        Promise.resolve({ ...context, accessibleWorkspaces: [context] }),
    },
    timeline,
  });
  const call = (
    path: string,
    method = "GET",
    body?: unknown,
    cookie = true,
    origin = "http://localhost",
  ) =>
    app.request(`http://localhost${path}`, {
      ...(body ? { body: JSON.stringify(body) } : {}),
      headers: {
        ...(cookie ? { cookie: "kinship_session=valid" } : {}),
        "content-type": "application/json",
        origin,
      },
      method,
    });
  const cases = await Promise.all([
    call("/api/v1/journal", "GET"),
    call(`/api/v1/journal/items/${id}`, "GET"),
    call("/api/v1/journal/items/not-a-uuid", "GET"),
    call("/api/v1/journal/posts", "POST", { body: "", occurredAt: now }),
    call("/api/v1/journal/posts", "POST", { body: "Entry", occurredAt: now }),
    call(`/api/v1/journal/posts/${id}`, "PUT", {
      body: "Entry",
      occurredAt: now,
    }),
    call(
      `/api/v1/journal/posts/${id}`,
      "PUT",
      { body: "Entry", occurredAt: now },
      true,
      "http://evil.test",
    ),
    call("/api/v1/journal/day-ratings", "PUT", {
      ratedOn: "2026-08-23",
      rating: 5,
    }),
    call(
      "/api/v1/journal/day-ratings",
      "PUT",
      { ratedOn: "2026-08-23", rating: 5 },
      true,
      "http://evil.test",
    ),
    call("/api/v1/journal/activities", "POST", { activityId: id }),
    call("/api/v1/journal/activities", "POST", { activityId: "bad" }),
    call(`/api/v1/journal/items/${id}`, "DELETE"),
    call("/api/v1/journal/items/bad", "DELETE"),
    call(
      "/api/v1/journal/posts",
      "POST",
      { body: "Entry", occurredAt: now },
      false,
    ),
  ]);
  const statuses = cases.map((response) => response.status);
  for (const expected of [400, 401, 403, 404]) {
    if (!statuses.includes(expected)) {
      throw new Error(`missing HTTP failure ${expected}`);
    }
  }

  const unavailableTimeline = createJournalTimeline({
    actors: { revalidate: () => Promise.resolve("active" as const) },
    transaction: { run: (work) => work({ opaque: undefined }) },
    repository: { read: () => Promise.reject(new Error("offline")) },
  });
  const unavailableApp = createJournalRoutes({
    browserSecurity: { origin: "http://localhost", secureCookie: false },
    journal,
    protectedSessions: {
      resolve: () =>
        Promise.resolve({ ...context, accessibleWorkspaces: [context] }),
    },
    timeline: unavailableTimeline,
  });
  if (
    (await unavailableApp.request("http://localhost/api/v1/journal", {
      headers: { cookie: "kinship_session=valid" },
    })).status !== 503
  ) throw new Error("timeline outage not exposed as unavailable");
  if (
    (await unavailableApp.request(
      `http://localhost/api/v1/journal/items/${id}`,
      { headers: { cookie: "kinship_session=valid" } },
    )).status !== 503
  ) throw new Error("item outage not exposed as unavailable");
});
