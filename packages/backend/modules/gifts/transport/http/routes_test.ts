import { createGiftRoutes } from "./routes.ts";
import { assert, assertStatus } from "../../../../testing/assert.ts";
import { actor as memberActor, uuid } from "../../../../testing/fixtures.ts";

const id = uuid(100);
const giftId = uuid(200);
const debtId = uuid(300);
const actor = memberActor();

/** The problem `code` a guarded route reports, as the contract spells it. */
async function problemCode(response: Response): Promise<string | undefined> {
  return ((await response.json()) as { readonly code?: string }).code;
}

Deno.test("GIFTS-001 HTTP creates an unknown-amount idea and rejects an invalid transition", async () => {
  const calls: string[] = [];
  const app = createGiftRoutes({
    browserSecurity: { origin: "https://app.test", secureCookie: true },
    gifts: {
      createGift: (
        _actor: unknown,
        personId: string,
        input: { name: string; status: "idea" },
      ) => {
        calls.push(`${personId}:${input.name}`);
        return Promise.resolve({
          gift: {
            createdAt: "now",
            id,
            name: input.name,
            personId,
            status: input.status,
            updatedAt: "now",
          },
          status: "created",
        });
      },
      changeGiftStatus: () => Promise.resolve({ status: "invalid-transition" }),
    } as never,
    protectedSessions: { resolve: () => Promise.resolve(actor) as never },
  });
  const created = await app.request(`/api/v1/people/${id}/gifts`, {
    body: JSON.stringify({ name: "Train tickets", status: "idea" }),
    headers: {
      Cookie: "kinship_session=token",
      Origin: "https://app.test",
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  assertStatus(created, 201);
  assert(calls.length === 1, "expected create call");
  const changed = await app.request(`/api/v1/people/${id}/gifts/${id}/status`, {
    body: JSON.stringify({ status: "idea" }),
    headers: {
      Cookie: "kinship_session=token",
      Origin: "https://app.test",
      "Content-Type": "application/json",
    },
    method: "PATCH",
  });
  assertStatus(changed, 409);
});

Deno.test("GIFTS-001 HTTP lists gifts and debts without an Origin header", async () => {
  const app = createGiftRoutes({
    browserSecurity: { origin: "https://app.test", secureCookie: true },
    gifts: {
      list: () =>
        Promise.resolve({
          debts: [],
          gifts: [],
          status: "ready",
          supportedCurrencyCodes: ["EUR"],
        }),
    } as never,
    protectedSessions: { resolve: () => Promise.resolve(actor) as never },
  });
  const response = await app.request(`/api/v1/people/${id}/gifts`, {
    headers: { Cookie: "kinship_session=token" },
  });
  assertStatus(response, 200);
  assert(
    response.headers.get("Cache-Control") === "private, no-store",
    "expected private no-store",
  );
});

Deno.test("GIFTS-001 HTTP exposes debt create/change and guarded failures", async () => {
  const app = createGiftRoutes({
    browserSecurity: { origin: "https://app.test", secureCookie: true },
    gifts: {
      createDebt: (
        _actor: unknown,
        personId: string,
        input: { amount: string; direction: "i_owe"; status: "open" },
      ) =>
        Promise.resolve({
          debt: {
            amount: input.amount,
            createdAt: "now",
            direction: input.direction,
            id,
            personId,
            status: input.status,
            updatedAt: "now",
          },
          status: "created",
        }),
      changeDebtStatus: () =>
        Promise.resolve({
          debt: {
            amount: "2",
            createdAt: "now",
            direction: "i_owe",
            id,
            personId: id,
            status: "settled",
            updatedAt: "later",
          },
          status: "saved",
        }),
    } as never,
    protectedSessions: { resolve: () => Promise.resolve(actor) as never },
  });
  const headers = {
    Cookie: "kinship_session=token",
    Origin: "https://app.test",
    "Content-Type": "application/json",
  };
  assert(
    (await app.request(`/api/v1/people/${id}/debts`, {
      body: JSON.stringify({ amount: "2", direction: "i_owe", status: "open" }),
      headers,
      method: "POST",
    })).status === 400,
    "debt without currency is rejected",
  );
  assert(
    (await app.request(`/api/v1/people/${id}/debts`, {
      body: JSON.stringify({
        amount: "2",
        currencyCode: "EUR",
        direction: "i_owe",
        status: "open",
      }),
      headers,
      method: "POST",
    })).status === 201,
    "debt with currency is created",
  );
  assert(
    (await app.request(`/api/v1/people/${id}/debts/${id}/status`, {
      body: JSON.stringify({ status: "settled" }),
      headers,
      method: "PATCH",
    })).status === 200,
    "debt changed",
  );
  assert(
    (await app.request(`/api/v1/people/${id}/debts`, {
      body: "{}",
      headers,
      method: "POST",
    })).status === 400,
    "invalid debt rejected",
  );
  assert(
    (await app.request(`/api/v1/people/${id}/debts`, {
      body: "{}",
      headers: { ...headers, Origin: "https://wrong.test" },
      method: "POST",
    })).status === 403,
    "foreign origin rejected",
  );
});

Deno.test("GIFTS-001 HTTP requires a session and maps concealed/unavailable states", async () => {
  const anonymous = createGiftRoutes({
    browserSecurity: { origin: "https://app.test", secureCookie: true },
    gifts: {} as never,
    protectedSessions: { resolve: () => Promise.resolve(undefined) },
  });
  assert(
    (await anonymous.request(`/api/v1/people/${id}/gifts`, {
      headers: { Cookie: "kinship_session=bad" },
    })).status === 401,
    "session required",
  );

  for (
    const [result, expected] of [
      [{ status: "not-found" }, 404],
      [{ status: "forbidden" }, 403],
      [{ status: "unavailable" }, 503],
    ] as const
  ) {
    const app = createGiftRoutes({
      browserSecurity: { origin: "https://app.test", secureCookie: true },
      gifts: { list: () => Promise.resolve(result) } as never,
      protectedSessions: { resolve: () => Promise.resolve(actor) as never },
    });
    assert(
      (await app.request(`/api/v1/people/${id}/gifts`, {
        headers: { Cookie: "kinship_session=token" },
      })).status === expected,
      `maps ${result.status}`,
    );
  }
  assert(
    (await anonymous.request("/api/v1/people/not-a-uuid/gifts")).status === 404,
    "invalid id concealed",
  );
});

Deno.test("GIFTS-001 HTTP refuses every write that carries a foreign Origin", async () => {
  const app = createGiftRoutes({
    browserSecurity: { origin: "https://app.test", secureCookie: true },
    gifts: {} as never,
    protectedSessions: { resolve: () => Promise.resolve(actor) as never },
  });
  const headers = {
    Cookie: "kinship_session=token",
    Origin: "https://wrong.test",
    "Content-Type": "application/json",
  };
  const writes = [
    {
      body: { name: "Train tickets", status: "idea" },
      method: "POST",
      path: `/api/v1/people/${id}/gifts`,
    },
    {
      body: { status: "given" },
      method: "PATCH",
      path: `/api/v1/people/${id}/gifts/${giftId}/status`,
    },
    {
      body: { status: "settled" },
      method: "PATCH",
      path: `/api/v1/people/${id}/debts/${debtId}/status`,
    },
  ];
  for (const write of writes) {
    const response = await app.request(write.path, {
      body: JSON.stringify(write.body),
      headers,
      method: write.method,
    });
    assertStatus(response, 403, `${write.method} ${write.path}`);
    assert(
      (await problemCode(response)) === "origin_invalid",
      `${write.method} ${write.path} reports origin_invalid`,
    );
  }
});

Deno.test("GIFTS-001 HTTP rejects unparsable ids and bodies on every write route", async () => {
  const app = createGiftRoutes({
    browserSecurity: { origin: "https://app.test", secureCookie: true },
    gifts: {} as never,
    protectedSessions: { resolve: () => Promise.resolve(actor) as never },
  });
  const headers = {
    Cookie: "kinship_session=token",
    Origin: "https://app.test",
    "Content-Type": "application/json",
  };
  const writes = [
    { body: "{", method: "POST", path: `/api/v1/people/${id}/gifts` },
    { body: "{}", method: "POST", path: `/api/v1/people/${id}/gifts` },
    {
      body: JSON.stringify({ name: "Train tickets", status: "idea" }),
      method: "POST",
      path: "/api/v1/people/not-a-uuid/gifts",
    },
    {
      body: JSON.stringify({ status: "given" }),
      method: "PATCH",
      path: `/api/v1/people/not-a-uuid/gifts/${giftId}/status`,
    },
    {
      body: JSON.stringify({ status: "given" }),
      method: "PATCH",
      path: `/api/v1/people/${id}/gifts/not-a-uuid/status`,
    },
    {
      body: JSON.stringify({ status: "unheard-of" }),
      method: "PATCH",
      path: `/api/v1/people/${id}/gifts/${giftId}/status`,
    },
    {
      body: JSON.stringify({
        amount: "2",
        currencyCode: "EUR",
        direction: "i_owe",
        status: "open",
      }),
      method: "POST",
      path: "/api/v1/people/not-a-uuid/debts",
    },
    {
      body: JSON.stringify({ status: "settled" }),
      method: "PATCH",
      path: `/api/v1/people/not-a-uuid/debts/${debtId}/status`,
    },
    {
      body: JSON.stringify({ status: "settled" }),
      method: "PATCH",
      path: `/api/v1/people/${id}/debts/not-a-uuid/status`,
    },
    {
      body: JSON.stringify({ status: "unheard-of" }),
      method: "PATCH",
      path: `/api/v1/people/${id}/debts/${debtId}/status`,
    },
  ];
  for (const write of writes) {
    const response = await app.request(write.path, {
      body: write.body,
      headers,
      method: write.method,
    });
    assertStatus(response, 400, `${write.method} ${write.path}`);
    assert(
      (await problemCode(response)) === "gift_invalid",
      `${write.method} ${write.path} reports gift_invalid`,
    );
  }
});

Deno.test("GIFTS-001 HTTP answers every route without a session cookie with 401", async () => {
  const app = createGiftRoutes({
    browserSecurity: { origin: "https://app.test", secureCookie: true },
    gifts: {} as never,
    protectedSessions: {
      resolve: () => {
        throw new Error("the coordinator is never reached without a cookie");
      },
    },
  });
  const headers = {
    Origin: "https://app.test",
    "Content-Type": "application/json",
  };
  const requests = [
    { body: undefined, method: "GET", path: `/api/v1/people/${id}/gifts` },
    {
      body: JSON.stringify({ name: "Train tickets", status: "idea" }),
      method: "POST",
      path: `/api/v1/people/${id}/gifts`,
    },
    {
      body: JSON.stringify({ status: "given" }),
      method: "PATCH",
      path: `/api/v1/people/${id}/gifts/${giftId}/status`,
    },
    {
      body: JSON.stringify({
        amount: "2",
        currencyCode: "EUR",
        direction: "i_owe",
        status: "open",
      }),
      method: "POST",
      path: `/api/v1/people/${id}/debts`,
    },
    {
      body: JSON.stringify({ status: "settled" }),
      method: "PATCH",
      path: `/api/v1/people/${id}/debts/${debtId}/status`,
    },
  ];
  for (const request of requests) {
    const response = await app.request(request.path, {
      ...(request.body === undefined ? {} : { body: request.body }),
      headers,
      method: request.method,
    });
    assertStatus(response, 401, `${request.method} ${request.path}`);
    assert(
      (await problemCode(response)) === "session_invalid",
      `${request.method} ${request.path} reports session_invalid`,
    );
  }
});

Deno.test("GIFTS-001 HTTP maps a refused creation onto its problem", async () => {
  for (
    const [result, status, code] of [
      ["archived-write-rejected", 409, "archived_write_rejected"],
      ["not-found", 404, "gift_not_found"],
      ["validation-error", 400, "gift_invalid"],
      ["unavailable", 503, "gifts_unavailable"],
    ] as const
  ) {
    const app = createGiftRoutes({
      browserSecurity: { origin: "https://app.test", secureCookie: true },
      gifts: {
        createGift: () => Promise.resolve({ status: result }),
        createDebt: () => Promise.resolve({ status: result }),
      } as never,
      protectedSessions: { resolve: () => Promise.resolve(actor) as never },
    });
    const headers = {
      Cookie: "kinship_session=token",
      Origin: "https://app.test",
      "Content-Type": "application/json",
    };
    const gift = await app.request(`/api/v1/people/${id}/gifts`, {
      body: JSON.stringify({ name: "Train tickets", status: "idea" }),
      headers,
      method: "POST",
    });
    assertStatus(gift, status, `gift creation maps ${result}`);
    assert(
      (await problemCode(gift)) === code,
      `gift creation reports ${code}`,
    );
    const debt = await app.request(`/api/v1/people/${id}/debts`, {
      body: JSON.stringify({
        amount: "2",
        currencyCode: "EUR",
        direction: "i_owe",
        status: "open",
      }),
      headers,
      method: "POST",
    });
    assertStatus(debt, status, `debt creation maps ${result}`);
    assert(
      (await problemCode(debt)) === code,
      `debt creation reports ${code}`,
    );
  }
});

Deno.test("GIFTS-001 HTTP returns a saved gift status privately and maps a refused debt status", async () => {
  const app = createGiftRoutes({
    browserSecurity: { origin: "https://app.test", secureCookie: true },
    gifts: {
      changeGiftStatus: () =>
        Promise.resolve({
          gift: {
            createdAt: "now",
            id: giftId,
            name: "Train tickets",
            personId: id,
            status: "given",
            updatedAt: "later",
          },
          status: "saved",
        }),
      changeDebtStatus: () => Promise.resolve({ status: "unavailable" }),
    } as never,
    protectedSessions: { resolve: () => Promise.resolve(actor) as never },
  });
  const headers = {
    Cookie: "kinship_session=token",
    Origin: "https://app.test",
    "Content-Type": "application/json",
  };
  const saved = await app.request(
    `/api/v1/people/${id}/gifts/${giftId}/status`,
    {
      body: JSON.stringify({ status: "given" }),
      headers,
      method: "PATCH",
    },
  );
  assertStatus(saved, 200);
  assert(
    saved.headers.get("Cache-Control") === "private, no-store",
    "a saved gift status is not cached",
  );
  const refused = await app.request(
    `/api/v1/people/${id}/debts/${debtId}/status`,
    {
      body: JSON.stringify({ status: "settled" }),
      headers,
      method: "PATCH",
    },
  );
  assertStatus(refused, 503);
  assert(
    (await problemCode(refused)) === "gifts_unavailable",
    "a refused debt status reports gifts_unavailable",
  );
});

Deno.test("GIFTS-001 HTTP forwards every optional gift and debt field it accepts", async () => {
  const received: Record<string, unknown>[] = [];
  const app = createGiftRoutes({
    browserSecurity: { origin: "https://app.test", secureCookie: true },
    gifts: {
      createGift: (_actor: unknown, _personId: string, input: unknown) => {
        received.push(input as Record<string, unknown>);
        return Promise.resolve({ gift: { id }, status: "created" });
      },
      createDebt: (_actor: unknown, _personId: string, input: unknown) => {
        received.push(input as Record<string, unknown>);
        return Promise.resolve({ debt: { id }, status: "created" });
      },
    } as never,
    protectedSessions: { resolve: () => Promise.resolve(actor) as never },
  });
  const headers = {
    Cookie: "kinship_session=token",
    Origin: "https://app.test",
    "Content-Type": "application/json",
  };
  const gift = await app.request(`/api/v1/people/${id}/gifts`, {
    body: JSON.stringify({
      amount: "42.50",
      attachmentFileId: giftId,
      comment: "Wrapped already",
      currencyCode: "EUR",
      eventAt: "2026-09-01T10:00:00.000Z",
      name: "Train tickets",
      recipientPersonId: debtId,
      status: "planned",
      url: "https://example.test/tickets",
    }),
    headers,
    method: "POST",
  });
  const debt = await app.request(`/api/v1/people/${id}/debts`, {
    body: JSON.stringify({
      amount: "2",
      currencyCode: "EUR",
      direction: "they_owe",
      reason: "Concert ticket",
      status: "open",
    }),
    headers,
    method: "POST",
  });

  assertStatus(gift, 201);
  assertStatus(debt, 201);
  assert(
    Object.keys(received[0] ?? {}).sort().join(",") ===
      "amount,attachmentFileId,comment,currencyCode,eventAt,name,recipientPersonId,status,url",
    "every optional gift field reached the use case",
  );
  assert(
    (received[1] ?? {}).reason === "Concert ticket",
    "an optional debt reason reached the use case",
  );
});

Deno.test("[GAP-023] HTTP pages gifts and debts independently and refuses a malformed query", async () => {
  const received: unknown[] = [];
  const app = createGiftRoutes({
    browserSecurity: { origin: "https://app.test", secureCookie: true },
    gifts: {
      list: (_actor: unknown, _personId: string, input: {
        readonly debtCursor?: string;
        readonly giftCursor?: string;
        readonly limit?: number;
      }) => {
        received.push(input);
        return Promise.resolve(
          input.giftCursor === "foreign" ? { status: "validation-error" } : {
            debts: [],
            gifts: [],
            ...(input.giftCursor ? {} : { nextGiftCursor: "next-gifts" }),
            status: "ready",
            supportedCurrencyCodes: ["EUR"],
          },
        );
      },
    } as never,
    protectedSessions: { resolve: () => Promise.resolve(actor) as never },
  });
  const headers = { Cookie: "kinship_session=token" };
  const first = await app.request(`/api/v1/people/${id}/gifts`, { headers });
  assertStatus(first, 200);
  const firstBody = await first.json() as Record<string, unknown>;
  assert(
    firstBody.nextGiftCursor === "next-gifts" &&
      !("nextDebtCursor" in firstBody),
    "only the collection with more rows publishes a continuation",
  );
  const continued = await app.request(
    `/api/v1/people/${id}/gifts?giftCursor=g1&debtCursor=d1&limit=3`,
    { headers },
  );
  assertStatus(continued, 200);
  assert(
    JSON.stringify(received) ===
      JSON.stringify([{ limit: 20 }, {
        debtCursor: "d1",
        giftCursor: "g1",
        limit: 3,
      }]),
    "the default and each named cursor reached the use case",
  );
  for (
    const query of [
      "limit=0",
      "limit=51",
      "cursor=shared",
      "giftCursor=foreign",
    ]
  ) {
    const refused = await app.request(`/api/v1/people/${id}/gifts?${query}`, {
      headers,
    });
    assertStatus(refused, 400);
    assert(
      await problemCode(refused) === "gift_query_invalid",
      `${query} names the gift query`,
    );
  }
});
