import { createGiftRoutes } from "./gifts.ts";

const id = "10000000-0000-4000-8000-000000000001";
const actor = {
  memberId: id,
  role: "member" as const,
  userId: id,
  workspaceId: id,
};

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
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
  assert(created.status === 201, `expected 201, got ${created.status}`);
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
  assert(changed.status === 409, `expected 409, got ${changed.status}`);
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
  assert(response.status === 200, `expected 200, got ${response.status}`);
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
