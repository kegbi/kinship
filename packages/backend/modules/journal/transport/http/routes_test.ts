import { createJournalRoutes } from "./routes.ts";
import {
  createJournalManagement,
  type JournalRepository,
} from "../../public.ts";
import { createJournalTimeline } from "../../../../read-models/journal-timeline/public.ts";
import * as fixtures from "../../../../testing/fixtures.ts";
import { fixedClock } from "../../../../testing/fakes.ts";

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
      read: (_actor, query) =>
        Promise.resolve({
          activities: [{ happenedAt: now, id, summary: "Shared a walk" }],
          items: [{
            id: query.itemId ?? id,
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
      read: (_actor, query) =>
        Promise.resolve(
          query.itemId ? { status: "not-found" } : { status: "forbidden" },
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

Deno.test("[JOURNAL-001] journal HTTP forwards optional prose and conceals unparsable items", async () => {
  const received: Record<string, unknown>[] = [];
  const session = { ...actor, workspaceName: "Journal" };
  const app = createJournalRoutes({
    browserSecurity: { origin: "http://localhost", secureCookie: false },
    journal: {
      createPost: (_actor: unknown, input: unknown) => {
        received.push(input as Record<string, unknown>);
        return Promise.resolve({ post: { id }, status: "created" });
      },
      updatePost: (_actor: unknown, _postId: string, input: unknown) => {
        received.push(input as Record<string, unknown>);
        return Promise.resolve({ post: { id }, status: "updated" });
      },
      saveDayRating: (_actor: unknown, input: unknown) => {
        received.push(input as Record<string, unknown>);
        return Promise.resolve({ rating: { id }, status: "updated" });
      },
    } as never,
    protectedSessions: {
      resolve: () =>
        Promise.resolve({ ...session, accessibleWorkspaces: [session] }),
    },
    timeline: {} as never,
  });
  const headers = {
    cookie: "kinship_session=valid",
    "content-type": "application/json",
    origin: "http://localhost",
  };
  const created = await app.request("http://localhost/api/v1/journal/posts", {
    body: JSON.stringify({ body: "Entry", occurredAt: now, title: "A title" }),
    headers,
    method: "POST",
  });
  const updated = await app.request(
    `http://localhost/api/v1/journal/posts/${id}`,
    {
      body: JSON.stringify({
        body: "Edited",
        occurredAt: now,
        title: "Another title",
      }),
      headers,
      method: "PUT",
    },
  );
  const rated = await app.request(
    "http://localhost/api/v1/journal/day-ratings",
    {
      body: JSON.stringify({
        comment: "A good day",
        ratedOn: "2026-08-23",
        rating: 5,
      }),
      headers,
      method: "PUT",
    },
  );
  const unparsableRead = await app.request(
    "http://localhost/api/v1/journal/items/not-a-uuid",
    { headers },
  );
  const unparsableDelete = await app.request(
    "http://localhost/api/v1/journal/items/not-a-uuid",
    { headers, method: "DELETE" },
  );

  if (
    created.status !== 201 || updated.status !== 200 || rated.status !== 200
  ) {
    throw new Error("an optional field was refused");
  }
  if (received[0]?.title !== "A title") {
    throw new Error("a post title was not forwarded");
  }
  if (received[1]?.title !== "Another title") {
    throw new Error("an edited post title was not forwarded");
  }
  if (received[2]?.comment !== "A good day") {
    throw new Error("a day rating comment was not forwarded");
  }
  if (unparsableRead.status !== 404) {
    throw new Error("an unparsable item identifier was not concealed");
  }
  if (unparsableDelete.status !== 400) {
    throw new Error("an unparsable deletion was not rejected");
  }
});

Deno.test("[GAP-023] journal HTTP forwards one page and refuses a malformed query", async () => {
  const received: unknown[] = [];
  const session = { ...actor, workspaceName: "Journal" };
  const app = createJournalRoutes({
    browserSecurity: { origin: "http://localhost", secureCookie: false },
    journal: {} as never,
    protectedSessions: {
      resolve: () =>
        Promise.resolve({ ...session, accessibleWorkspaces: [session] }),
    },
    timeline: {
      list: (_actor: unknown, input: unknown) => {
        received.push(input);
        return Promise.resolve(
          (input as { readonly cursor?: string }).cursor === "foreign"
            ? { status: "validation-error" }
            : {
              activities: [],
              items: [],
              nextCursor: "next-journal-page",
              status: "ready",
            },
        );
      },
    } as never,
  });
  const headers = { cookie: "kinship_session=valid" };
  const first = await app.request("http://localhost/api/v1/journal", {
    headers,
  });
  const body = await first.json() as { readonly nextCursor?: string };
  if (first.status !== 200 || body.nextCursor !== "next-journal-page") {
    throw new Error("the journal continuation was not published");
  }
  const second = await app.request(
    "http://localhost/api/v1/journal?limit=7&cursor=resume",
    { headers },
  );
  if (second.status !== 200) throw new Error("a continued page was refused");
  if (
    JSON.stringify(received) !==
      JSON.stringify([{ limit: 20 }, { cursor: "resume", limit: 7 }])
  ) throw new Error("the page did not reach the read model");
  for (const query of ["limit=0", "limit=51", "extra=1", "cursor=foreign"]) {
    const refused = await app.request(
      `http://localhost/api/v1/journal?${query}`,
      { headers },
    );
    const problem = await refused.json() as { readonly code?: string };
    if (refused.status !== 400 || problem.code !== "journal_query_invalid") {
      throw new Error(`${query} was not refused as a journal query`);
    }
  }
});

Deno.test("[GAP-023] the journal timeline pages behind a workspace-bound cursor", async () => {
  const anchor = {
    createdAt: now,
    id,
    occurredAt: now,
  };
  const asked: string[] = [];
  const timeline = createJournalTimeline({
    actors: { revalidate: () => Promise.resolve("active" as const) },
    transaction: { run: (work) => work({ opaque: undefined }) },
    repository: {
      read: (_actor, query) => {
        asked.push(`${query.after?.id ?? "-"} ${query.limit}`);
        return Promise.resolve({
          activities: [],
          items: [],
          ...(query.after ? {} : { next: anchor }),
          status: "ready",
        });
      },
    },
  });
  const first = await timeline.list(actor);
  if (first.status !== "ready" || !("nextCursor" in first)) {
    throw new Error("a page with more items did not publish its continuation");
  }
  const cursor = first.nextCursor as string;
  const second = await timeline.list(actor, { cursor, limit: 500 });
  if (second.status !== "ready" || "nextCursor" in second) {
    throw new Error("the last page published a continuation");
  }
  const foreign = await timeline.list(
    { ...actor, workspaceId: "00000000-0000-4000-8000-0000000000ff" },
    { cursor },
  );
  const forged = await timeline.list(actor, { cursor: "forged" });
  if (
    foreign.status !== "validation-error" ||
    forged.status !== "validation-error"
  ) throw new Error("a foreign or malformed journal cursor was answered");
  if (asked.join(",") !== `- 20,${id} 50`) {
    throw new Error(`the timeline was asked for ${asked.join(",")}`);
  }
});

Deno.test("[MCP-B6] journal grants admit bearer reads and writes independently and never borrow the cookie", async () => {
  const tokenId = "00000000-0000-4000-8000-0000000000aa";
  const asked: string[] = [];
  const acted: (string | undefined)[] = [];
  const answer = (value: unknown) => (who: { apiTokenId?: string }) => {
    acted.push(who.apiTokenId);
    return Promise.resolve(value);
  };
  const session = { ...actor, workspaceName: "Journal" };
  const app = createJournalRoutes({
    apiTokens: {
      authenticate: (token: string, scope: string) => {
        asked.push(scope);
        return Promise.resolve(
          token === scope
            ? { actor, status: "authenticated" as const, tokenId }
            : { status: "invalid" as const },
        );
      },
    },
    browserSecurity: { origin: "http://localhost", secureCookie: false },
    journal: {
      createPost: answer({ post: { id }, status: "created" }),
      deleteItem: answer({ itemType: "post", status: "deleted" }),
      linkActivity: answer({
        activityId: id,
        id,
        occurredAt: now,
        status: "created",
      }),
      saveDayRating: answer({ rating: { id }, status: "created" }),
      updatePost: answer({ post: { id }, status: "updated" }),
    } as never,
    protectedSessions: {
      resolve: () =>
        Promise.resolve({ ...session, accessibleWorkspaces: [session] }),
    },
    timeline: {
      get: answer({ item: { id }, status: "ready" }),
      list: answer({ activities: [], items: [], status: "ready" }),
    } as never,
  });
  const routes = [
    ["GET", "/api/v1/journal", "journal:read", undefined, 200],
    ["GET", `/api/v1/journal/items/${id}`, "journal:read", undefined, 200],
    ["POST", "/api/v1/journal/posts", "journal:write", {
      body: "Entry",
      occurredAt: now,
    }, 201],
    ["PUT", `/api/v1/journal/posts/${id}`, "journal:write", {
      body: "Edited",
      occurredAt: now,
    }, 200],
    ["PUT", "/api/v1/journal/day-ratings", "journal:write", {
      ratedOn: "2026-08-23",
      rating: 5,
    }, 201],
    ["POST", "/api/v1/journal/activities", "journal:write", {
      activityId: id,
    }, 201],
    ["DELETE", `/api/v1/journal/items/${id}`, "journal:write", undefined, 200],
  ] as const;
  for (const [method, path, grant, body, status] of routes) {
    const send = (headers: Record<string, string>, payload: unknown = body) =>
      app.request(`http://localhost${path}`, {
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
        headers: { "content-type": "application/json", ...headers },
        method,
      });
    const label = `${method} ${path}`;
    acted.length = 0;
    const admitted = await send({ authorization: `Bearer ${grant}` });
    if (admitted.status !== status || acted[0] !== tokenId) {
      throw new Error(`${label} bearer answered ${admitted.status}`);
    }
    for (
      const wrong of ["journal:read", "journal:write", "people:write"].filter(
        (scope) => scope !== grant,
      )
    ) {
      const refused = await send({
        authorization: `Bearer ${wrong}`,
        cookie: "kinship_session=valid",
        origin: "http://localhost",
      });
      if (refused.status !== 401) {
        throw new Error(`${label} admitted ${wrong}: ${refused.status}`);
      }
    }
    const invalid = await send({
      authorization: "Bearer revoked",
      cookie: "kinship_session=valid",
      origin: "http://localhost",
    });
    if (invalid.status !== 401) {
      throw new Error(`${label} borrowed the cookie: ${invalid.status}`);
    }
    if (method === "GET") continue;
    const unparsable = path.includes("/items/")
      ? undefined
      : { unexpected: true };
    if (unparsable) {
      const early = await send(
        { authorization: "Bearer people:write" },
        unparsable,
      );
      if (early.status !== 401) {
        throw new Error(`${label} judged a refused token's body first`);
      }
    }
    for (const origin of [undefined, "http://attacker.test"]) {
      const foreign = await send({
        cookie: "kinship_session=valid",
        ...(origin ? { origin } : {}),
      });
      if (foreign.status !== 403) {
        throw new Error(`${label} cookie write without Origin admitted`);
      }
    }
    acted.length = 0;
    const cookie = await send({
      cookie: "kinship_session=valid",
      origin: "http://localhost",
    });
    if (cookie.status !== status || acted[0] !== undefined) {
      throw new Error(`${label} cookie write answered ${cookie.status}`);
    }
  }
  if (!asked.includes("journal:read") || !asked.includes("journal:write")) {
    throw new Error(`each grant was not checked: ${asked}`);
  }
});

Deno.test("[MCP-B6] cookie journal writes keep their check order", async () => {
  const app = createJournalRoutes({
    browserSecurity: { origin: "http://localhost", secureCookie: false },
    journal: {} as never,
    protectedSessions: { resolve: () => Promise.resolve(undefined) },
    timeline: {} as never,
  });
  const send = (headers: Record<string, string>) =>
    app.request("http://localhost/api/v1/journal/posts", {
      body: JSON.stringify({ body: "" }),
      headers: { "content-type": "application/json", ...headers },
      method: "POST",
    });
  const statuses = [
    (await send({ origin: "http://attacker.test" })).status,
    (await send({
      origin: "http://localhost",
      "x-workspace-id": "not-a-workspace",
    })).status,
    (await send({ origin: "http://localhost" })).status,
  ];
  if (JSON.stringify(statuses) !== JSON.stringify([403, 400, 400])) {
    throw new Error(`cookie order changed: ${statuses}`);
  }
  const unparsableRead = await app.request(
    "http://localhost/api/v1/journal/items/not-a-uuid",
  );
  if (unparsableRead.status !== 404) {
    throw new Error("an unparsable item now asks for a session first");
  }
  const malformedQuery = await app.request(
    "http://localhost/api/v1/journal?limit=0",
  );
  if (malformedQuery.status !== 400) {
    throw new Error("a malformed query now asks for a session first");
  }
});
