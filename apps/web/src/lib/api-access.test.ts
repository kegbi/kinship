// @vitest-environment happy-dom

vi.mock("./time-presentation.ts", async (original) => ({
  ...await original<typeof import("./time-presentation.ts")>(),
  loadTimePreferences: vi.fn().mockResolvedValue({
    locale: "en",
    effectiveTimezone: "UTC",
  }),
}));

import { afterEach, describe, expect, it, vi } from "vitest";
import { mountApiAccess } from "./api-access.ts";

const workspaceId = "00000000-0000-4000-8000-000000000003";
const tokenId = "00000000-0000-4000-8000-000000000004";
const secret = `kin_pat_${tokenId}.secret-with-enough-entropy-for-a-token`;
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function markup() {
  return `<main data-api-access><p data-api-state></p>
    <form data-api-create><input name="name"><input name="expiresAt"><input name="scopes" type="checkbox" value="people:read"><button type="submit">Create</button></form>
    <section data-api-secret-panel hidden><input data-api-secret><button data-api-copy type="button">Copy</button><button data-api-dismiss type="button">Dismiss</button></section>
    <p data-api-empty hidden></p><ul data-api-list></ul></main>`;
}

const session = (role: "owner" | "member" = "owner") => ({
  member: { id: "member", role },
  principal: { userId: "user" },
  status: "authenticated",
  workspace: { id: workspaceId, name: "Circle" },
  workspaces: [{ id: workspaceId, name: "Circle" }],
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  sessionStorage.clear();
});

describe("API-001 personal API tokens", () => {
  it("shows a created secret once, copies it, lists metadata, and revokes", async () => {
    document.body.innerHTML = markup();
    let revoked = false;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/v1/session") {
        return Promise.resolve(response(session()));
      }
      if (path.endsWith(tokenId) && init?.method === "DELETE") {
        revoked = true;
        return Promise.resolve(response({ status: "revoked" }));
      }
      if (path === "/api/v1/settings/api-tokens" && init?.method === "POST") {
        return Promise.resolve(response({ secret, status: "created" }, 201));
      }
      return Promise.resolve(response({
        records: fetchMock.mock.calls.length <= 2 ? [] : [{
          createdAt: "2026-08-24T10:00:00.000Z",
          expiresAt: "2026-09-24T10:00:00.000Z",
          id: tokenId,
          name: "Desktop read",
          ...(revoked ? { revokedAt: "2026-08-24T11:00:00.000Z" } : {}),
          scopes: ["people:read"],
        }],
        status: "ready",
      }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    await mountApiAccess();
    const form = document.querySelector<HTMLFormElement>("[data-api-create]")!;
    (form.elements.namedItem("name") as HTMLInputElement).value =
      "Desktop read";
    (form.elements.namedItem("expiresAt") as HTMLInputElement).value =
      "2026-09-24T10:00";
    (form.elements.namedItem("scopes") as HTMLInputElement).checked = true;
    form.requestSubmit();
    await vi.waitFor(() =>
      expect(
        document.querySelector<HTMLInputElement>("[data-api-secret]")?.value,
      ).toBe(secret)
    );
    expect(document.querySelector("[data-api-list]")?.textContent).toContain(
      "Desktop read",
    );
    expect(document.querySelector("[data-api-list]")?.textContent).not
      .toContain(secret);
    document.querySelector<HTMLButtonElement>("[data-api-copy]")!.click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(secret));
    document.querySelector<HTMLButtonElement>("[data-api-dismiss]")!.click();
    expect(document.body.textContent).not.toContain(secret);

    document.querySelector<HTMLButtonElement>("[data-api-list] button")!
      .click();
    await vi.waitFor(() =>
      expect(document.querySelector("[data-api-list]")?.textContent).toContain(
        "Revoked",
      )
    );
    expect(
      fetchMock.mock.calls.some(([input, init]) =>
        String(input).endsWith(tokenId) &&
        (init as RequestInit | undefined)?.method === "DELETE"
      ),
    ).toBe(true);
  });

  it("serializes a non-expiring create and omits the optional expiry", async () => {
    document.body.innerHTML = markup();
    let release!: (value: Response) => void;
    const pending = new Promise<Response>((resolve) => release = resolve);
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/v1/session") {
        return Promise.resolve(response(session()));
      }
      if (init?.method === "POST") return pending;
      return Promise.resolve(response({ records: [], status: "ready" }));
    });
    vi.stubGlobal("fetch", fetchMock);
    await mountApiAccess();
    const form = document.querySelector<HTMLFormElement>("[data-api-create]")!;
    (form.elements.namedItem("name") as HTMLInputElement).value = "No expiry";
    (form.elements.namedItem("scopes") as HTMLInputElement).checked = true;
    form.requestSubmit();
    form.requestSubmit();
    const submit = form.querySelector<HTMLButtonElement>("button")!;
    expect(submit.disabled).toBe(true);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST"))
      .toHaveLength(1);
    const body = JSON.parse(
      String(
        (fetchMock.mock.calls.find(([, init]) => init?.method === "POST")
          ?.[1] as RequestInit).body,
      ),
    );
    expect(body).toEqual({ name: "No expiry", scopes: ["people:read"] });
    release(response({ secret, status: "created" }, 201));
    await vi.waitFor(() => expect(submit.disabled).toBe(false));
  });

  it("keeps a token created before the page loaded off the URL and creates it once loaded", async () => {
    document.body.innerHTML = markup();
    let resolveSession!: (value: Response) => void;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/v1/session") {
        return new Promise<Response>((resolve) => resolveSession = resolve);
      }
      if (init?.method === "POST") {
        return Promise.resolve(response({ secret, status: "created" }, 201));
      }
      return Promise.resolve(response({ records: [], status: "ready" }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const mounted = mountApiAccess();
    const form = document.querySelector<HTMLFormElement>("[data-api-create]")!;
    (form.elements.namedItem("name") as HTMLInputElement).value = "Early";
    (form.elements.namedItem("scopes") as HTMLInputElement).checked = true;
    const early = new Event("submit", { bubbles: true, cancelable: true });
    form.dispatchEvent(early);
    expect(early.defaultPrevented).toBe(true);
    resolveSession(response(session()));
    await mounted;
    await vi.waitFor(() =>
      expect(
        document.querySelector<HTMLInputElement>("[data-api-secret]")?.value,
      ).toBe(secret)
    );
    const posts = fetchMock.mock.calls.filter(([, init]) =>
      init?.method === "POST"
    );
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String(posts[0]![1]!.body))).toEqual({
      name: "Early",
      scopes: ["people:read"],
    });
  });

  it("does not expose token management to a regular member", async () => {
    document.body.innerHTML = markup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(response(session("member")))),
    );
    await mountApiAccess();
    expect(document.querySelector("[data-api-create]")).toBeNull();
    expect(document.querySelector("[data-api-state]")?.textContent).toMatch(
      /owner or administrator/i,
    );
  });

  it("keeps validation and unavailable management failures actionable", async () => {
    document.body.innerHTML = markup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(session()))
      .mockResolvedValueOnce(response({ detail: "Tokens offline" }, 503))
      .mockResolvedValueOnce(response({ detail: "Expiry rejected" }, 400));
    vi.stubGlobal("fetch", fetchMock);
    await mountApiAccess();
    expect(document.querySelector("[data-api-state]")?.textContent).toBe(
      "Tokens offline",
    );
    const form = document.querySelector<HTMLFormElement>("[data-api-create]")!;
    form.requestSubmit();
    expect(document.querySelector("[data-api-state]")?.textContent).toMatch(
      /name.*scope/i,
    );
    (form.elements.namedItem("name") as HTMLInputElement).value = "Expired";
    (form.elements.namedItem("expiresAt") as HTMLInputElement).value =
      "2026-09-24T10:00";
    (form.elements.namedItem("scopes") as HTMLInputElement).checked = true;
    form.requestSubmit();
    await vi.waitFor(() =>
      expect(document.querySelector("[data-api-state]")?.textContent).toBe(
        "Expiry rejected",
      )
    );
  });

  it("reports clipboard and revoke failures without losing the visible token metadata", async () => {
    document.body.innerHTML = markup();
    const record = {
      createdAt: "2026-08-24T10:00:00.000Z",
      id: tokenId,
      name: "Desktop read",
      scopes: ["people:read"],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(session()))
      .mockResolvedValueOnce(
        response({
          records: [record],
          scopes: ["people:read"],
          status: "ready",
        }),
      )
      .mockResolvedValueOnce(response({ detail: "Revocation offline" }, 503));
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("denied")) },
    });
    await mountApiAccess();
    document.querySelector<HTMLInputElement>("[data-api-secret]")!.value =
      secret;
    document.querySelector<HTMLButtonElement>("[data-api-copy]")!.click();
    await vi.waitFor(() =>
      expect(document.querySelector("[data-api-state]")?.textContent).toMatch(
        /copy failed/i,
      )
    );
    const revoke = document.querySelector<HTMLButtonElement>(
      "[data-api-list] button",
    )!;
    revoke.click();
    revoke.click();
    expect(revoke.disabled).toBe(true);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE"))
      .toHaveLength(1);
    await vi.waitFor(() =>
      expect(document.querySelector("[data-api-state]")?.textContent).toBe(
        "Revocation offline",
      )
    );
    expect(document.querySelector("[data-api-list]")?.textContent).toContain(
      "Desktop read",
    );
  });

  it("does nothing when the API access surface is absent", async () => {
    await expect(mountApiAccess()).resolves.toBeUndefined();
  });
});
