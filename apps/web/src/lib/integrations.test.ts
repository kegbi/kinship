// @vitest-environment happy-dom

vi.mock("./time-presentation.ts", async (original) => ({
  ...await original<typeof import("./time-presentation.ts")>(),
  loadTimePreferences: vi.fn().mockResolvedValue({
    locale: "en",
    effectiveTimezone: "UTC",
  }),
}));

import { afterEach, describe, expect, it, vi } from "vitest";
import { mountIntegrations } from "./integrations.ts";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const subscriptionId = "00000000-0000-4000-8000-000000000010";
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });

function markup() {
  return `<main data-integrations><p data-integration-state></p>
    <form data-integration-create><input name="name"><input name="remoteUrl"><input name="username"><input name="password"><button type="submit">Add</button></form>
    <p data-integration-empty hidden></p><ul data-integration-list></ul></main>`;
}

function session(role: "member" | "owner" = "owner") {
  return {
    member: { id: "member", role },
    principal: { userId: "user" },
    status: "authenticated",
    workspace: { id: workspaceId, name: "Circle" },
    workspaces: [{ id: workspaceId, name: "Circle" }],
  };
}

afterEach(() => {
  document.body.innerHTML = "";
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe("INTEGRATION-001 DAV settings", () => {
  it("configures, synchronizes, shows partial retry state, and disables serially", async () => {
    document.body.innerHTML = markup();
    let record: Record<string, unknown> | undefined;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/v1/session") {
        return Promise.resolve(response(session()));
      }
      if (init?.method === "POST" && path.endsWith("/dav")) {
        record = {
          id: subscriptionId,
          isActive: true,
          lastOutcome: "never",
          name: "Personal DAV",
          remoteUrl: "https://dav.example.test/collection/",
        };
        return Promise.resolve(
          response({ status: "configured", subscription: record }, 201),
        );
      }
      if (path.endsWith("/sync")) {
        record = {
          ...record,
          lastError: "dav_sync_failed",
          lastOutcome: "partial",
        };
        return Promise.resolve(
          response({ processed: 1, status: "partial", subscription: record }),
        );
      }
      if (init?.method === "DELETE") {
        record = { ...record, isActive: false };
        return Promise.resolve(
          response({ status: "disabled", subscription: record }),
        );
      }
      return Promise.resolve(
        response({ status: "ready", subscriptions: record ? [record] : [] }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    await mountIntegrations();
    const form = document.querySelector<HTMLFormElement>("form")!;
    (form.elements.namedItem("name") as HTMLInputElement).value =
      "Personal DAV";
    (form.elements.namedItem("remoteUrl") as HTMLInputElement).value =
      "https://dav.example.test/collection/";
    (form.elements.namedItem("username") as HTMLInputElement).value = "ada";
    (form.elements.namedItem("password") as HTMLInputElement).value =
      "remote-secret";
    form.requestSubmit();
    await vi.waitFor(() =>
      expect(document.querySelector("ul")?.textContent).toContain(
        "Personal DAV",
      )
    );
    expect(document.body.textContent).not.toContain("remote-secret");
    document.querySelector<HTMLButtonElement>("ul button")!.click();
    await vi.waitFor(() =>
      expect(document.querySelector("ul")?.textContent).toContain("Retry")
    );
    expect(document.body.textContent).not.toContain("dav_sync_failed");
    document.querySelectorAll<HTMLButtonElement>("ul button")[1]!.click();
    await vi.waitFor(() =>
      expect(document.querySelector("ul")?.textContent).toContain("Disabled")
    );
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE"))
      .toBe(true);
  });

  it("keeps a DAV secret submitted before the page loaded off the URL and adds it once loaded", async () => {
    document.body.innerHTML = markup();
    let resolveSession!: (value: Response) => void;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/v1/session") {
        return new Promise<Response>((resolve) => resolveSession = resolve);
      }
      if (init?.method === "POST") {
        return Promise.resolve(response({
          status: "configured",
          subscription: {
            id: subscriptionId,
            isActive: true,
            lastOutcome: "never",
            name: "Early DAV",
            remoteUrl: "https://dav.example.test/collection/",
          },
        }, 201));
      }
      return Promise.resolve(
        response({ status: "ready", subscriptions: [] }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const mounted = mountIntegrations();
    const form = document.querySelector<HTMLFormElement>(
      "[data-integration-create]",
    )!;
    (form.elements.namedItem("name") as HTMLInputElement).value = "Early DAV";
    (form.elements.namedItem("remoteUrl") as HTMLInputElement).value =
      "https://dav.example.test/collection/";
    (form.elements.namedItem("password") as HTMLInputElement).value =
      "dav-secret";
    const early = new Event("submit", { bubbles: true, cancelable: true });
    form.dispatchEvent(early);
    expect(early.defaultPrevented).toBe(true);
    resolveSession(response(session()));
    await mounted;
    const posts = () =>
      fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    await vi.waitFor(() => expect(posts()).toHaveLength(1));
    await vi.waitFor(() =>
      expect(form.querySelector("button")?.disabled).toBe(false)
    );
    expect(JSON.parse(String(posts()[0]![1]!.body))).toEqual({
      name: "Early DAV",
      password: "dav-secret",
      remoteUrl: "https://dav.example.test/collection/",
    });
  });

  it("hides management from a regular member", async () => {
    document.body.innerHTML = markup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(response(session("member")))),
    );
    await mountIntegrations();
    expect(document.querySelector("form")).toBeNull();
    expect(document.querySelector("[data-integration-state]")?.textContent)
      .toMatch(/owner or administrator/i);
  });
});
