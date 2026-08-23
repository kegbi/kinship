// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountWorkspaceDanger } from "./workspace-lifecycle.ts";

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const markup =
  `<main data-workspace-danger><p data-danger-status></p><strong data-danger-sessions></strong><code data-reset-confirmation></code><code data-delete-confirmation></code><dl data-danger-counts hidden></dl><form data-danger-reset><input name="confirmation"><input name="password"><button>Reset</button></form><form data-danger-delete><input name="confirmation"><input name="password"><button>Delete</button></form></main>`;

const ownerSession = {
  member: { id: "member", role: "owner" },
  principal: { userId: "user" },
  status: "authenticated",
  workspace: { id: "workspace", name: "Family" },
  workspaces: [],
};

const preview = {
  activeSessionCount: 2,
  confirmations: {
    deleteWorkspace: "DELETE Family",
    resetWorkspace: "RESET Family",
  },
  counts: {
    activities: 1,
    auditEvents: 0,
    calls: 0,
    debts: 0,
    exports: 0,
    files: 2,
    gifts: 0,
    imports: 0,
    integrations: 0,
    journalPosts: 3,
    lifeEvents: 0,
    members: 2,
    messages: 0,
    notes: 0,
    people: 4,
    relationships: 0,
    reminders: 5,
    tasks: 6,
  },
  impactToken: "a".repeat(64),
  status: "ready",
  workspace: { id: "workspace", name: "Family" },
};

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  sessionStorage.clear();
});

describe("WORKSPACE-002 workspace danger zone", () => {
  it("keeps destructive submissions disabled until current impact is ready", async () => {
    document.body.innerHTML = markup;
    let resolvePreview!: (value: Response) => void;
    const previewResponse = new Promise<Response>((resolve) => {
      resolvePreview = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = new URL(String(input), "http://localhost").pathname;
        return path === "/api/v1/session"
          ? Promise.resolve(response(ownerSession))
          : previewResponse;
      }),
    );

    const mounted = mountWorkspaceDanger();

    expect(
      document.querySelector<HTMLButtonElement>(
        "[data-danger-delete] button",
      )?.disabled,
    ).toBe(true);
    resolvePreview(response(preview));
    await mounted;
    expect(
      document.querySelector<HTMLButtonElement>(
        "[data-danger-delete] button",
      )?.disabled,
    ).toBe(false);
  });

  it("renders current impact and submits its authoritative token once", async () => {
    document.body.innerHTML = markup;
    sessionStorage.setItem("kinship.active-workspace", "workspace");
    const calls: Array<{ path: string; body?: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), "http://localhost").pathname;
        calls.push({
          path,
          ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
        });
        if (path === "/api/v1/session") {
          return Promise.resolve(response(ownerSession));
        }
        if (init?.method === "DELETE") {
          return Promise.resolve(
            response({
              cleanupStatus: "complete",
              next: "/auth/sign-in",
              status: "deleted",
            }),
          );
        }
        return Promise.resolve(response(preview));
      }),
    );
    const navigate = vi.fn();
    await mountWorkspaceDanger(navigate);
    expect(document.querySelector("[data-danger-counts]")?.textContent)
      .toContain("people4");
    const form = document.querySelector<HTMLFormElement>(
      "[data-danger-delete]",
    )!;
    (form.elements.namedItem("confirmation") as HTMLInputElement).value =
      "DELETE Family";
    (form.elements.namedItem("password") as HTMLInputElement).value = "current";
    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("/auth/sign-in")
    );
    expect(calls.at(-1)?.body).toEqual({
      confirmation: "DELETE Family",
      impactToken: "a".repeat(64),
      password: "current",
    });
    expect(sessionStorage.getItem("kinship.active-workspace")).toBeNull();
  });

  it("hides destructive controls when the active member is not an owner", async () => {
    document.body.innerHTML = markup;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({
        ...ownerSession,
        member: { id: "member", role: "admin" },
      })),
    );

    await mountWorkspaceDanger();

    expect(document.querySelector("[data-danger-status]")?.textContent)
      .toContain(
        "owner session",
      );
    expect(
      document.querySelector<HTMLFormElement>("[data-danger-reset]")?.hidden,
    )
      .toBe(true);
    expect(
      document.querySelector<HTMLFormElement>("[data-danger-delete]")?.hidden,
    )
      .toBe(true);
  });

  it("hides controls when the authoritative impact cannot be loaded", async () => {
    document.body.innerHTML = markup;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = new URL(String(input), "http://localhost").pathname;
        return Promise.resolve(
          path === "/api/v1/session"
            ? response(ownerSession)
            : response({ detail: "Impact unavailable", status: 503 }, 503),
        );
      }),
    );

    await mountWorkspaceDanger();

    expect(document.querySelector("[data-danger-status]")?.textContent).toBe(
      "Impact unavailable",
    );
    expect(
      document.querySelector<HTMLFormElement>("[data-danger-reset]")?.hidden,
    )
      .toBe(true);
  });

  it("hides controls when impact transport is unavailable", async () => {
    document.body.innerHTML = markup;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = new URL(String(input), "http://localhost").pathname;
        return path === "/api/v1/session"
          ? Promise.resolve(response(ownerSession))
          : Promise.reject(new Error("offline"));
      }),
    );

    await mountWorkspaceDanger();

    expect(document.querySelector("[data-danger-status]")?.textContent).toBe(
      "Current workspace impact could not be loaded.",
    );
  });

  it("re-enables reset after server revalidation rejects the mutation", async () => {
    document.body.innerHTML = markup;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), "http://localhost").pathname;
        if (path === "/api/v1/session") {
          return Promise.resolve(response(ownerSession));
        }
        if (init?.method === "POST") {
          return Promise.resolve(
            response({ detail: "Impact changed", status: 409 }, 409),
          );
        }
        return Promise.resolve(response(preview));
      }),
    );
    await mountWorkspaceDanger();
    const form = document.querySelector<HTMLFormElement>(
      "[data-danger-reset]",
    )!;
    (form.elements.namedItem("confirmation") as HTMLInputElement).value =
      "RESET Family";
    (form.elements.namedItem("password") as HTMLInputElement).value = "current";

    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );

    await vi.waitFor(() =>
      expect(document.querySelector("[data-danger-status]")?.textContent).toBe(
        "Impact changed",
      )
    );
    expect(form.querySelector("button")?.disabled).toBe(false);
  });

  it("recovers the reset control after mutation transport failure", async () => {
    document.body.innerHTML = markup;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), "http://localhost").pathname;
        if (path === "/api/v1/session") {
          return Promise.resolve(response(ownerSession));
        }
        if (init?.method === "POST") {
          return Promise.reject(new Error("offline"));
        }
        return Promise.resolve(response(preview));
      }),
    );
    await mountWorkspaceDanger();
    const form = document.querySelector<HTMLFormElement>(
      "[data-danger-reset]",
    )!;

    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );

    await vi.waitFor(() =>
      expect(document.querySelector("[data-danger-status]")?.textContent).toBe(
        "The workspace was not changed.",
      )
    );
    expect(form.querySelector("button")?.disabled).toBe(false);
  });

  it("returns without a mounted danger surface", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await mountWorkspaceDanger();
    expect(fetch).not.toHaveBeenCalled();
  });
});
