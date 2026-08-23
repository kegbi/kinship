// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountExports } from "./exports.ts";

const workspaceId = "00000000-0000-4000-8000-000000000003";
const exportId = "00000000-0000-4000-8000-000000000004";
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const session = {
  member: { id: "member", role: "admin" },
  principal: { userId: "user" },
  status: "authenticated",
  workspace: { id: workspaceId, name: "Circle" },
  workspaces: [],
};
const run = {
  completedAt: "2026-08-23T10:00:00.000Z",
  createdAt: "2026-08-23T10:00:00.000Z",
  expiresAt: "2026-08-30T10:00:00.000Z",
  exportId,
  format: "json",
  manifest: {
    attachments: { count: 0, items: [], sha256: "a".repeat(64) },
    limitations: [],
    profile: "monica-json",
    rows: { people: { count: 1, sha256: "b".repeat(64) } },
    version: 1,
  },
  status: "completed",
};
function markup() {
  return `<main data-export-settings><button data-export-create>Create export</button><p data-export-state></p><button data-export-retry hidden>Retry</button><ol data-export-history></ol></main>`;
}
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  sessionStorage.clear();
});

describe("EXPORT-001 settings export", () => {
  it("serializes creation, refreshes history, and mints a short-lived download", async () => {
    document.body.innerHTML = markup();
    let lists = 0;
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), "http://localhost").pathname;
        calls.push(`${init?.method ?? "GET"} ${path}`);
        if (path === "/api/v1/session") {
          return Promise.resolve(response(session));
        }
        if (path.endsWith("/downloads")) {
          return Promise.resolve(
            response({
              expiresAt: "2026-08-23T10:05:00.000Z",
              href: `/api/v1/exports/${exportId}/download?token=secret`,
              status: "ready",
            }, 201),
          );
        }
        if (
          path === "/api/v1/exports" && init?.method === "POST"
        ) return Promise.resolve(response(run, 201));
        lists++;
        return Promise.resolve(response({ exports: lists === 1 ? [] : [run] }));
      }),
    );
    await mountExports();
    document.querySelector<HTMLButtonElement>("[data-export-create]")!.click();
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain(
        "Export completed for 1 person",
      )
    );
    document.querySelector<HTMLButtonElement>("[data-export-history] button")!
      .click();
    await vi.waitFor(() =>
      expect(
        document.querySelector<HTMLAnchorElement>("[data-export-history] a")
          ?.href,
      ).toContain("token=secret")
    );
    expect(calls).toEqual([
      "GET /api/v1/session",
      "GET /api/v1/exports",
      "POST /api/v1/exports",
      "GET /api/v1/exports",
      `POST /api/v1/exports/${exportId}/downloads`,
    ]);
  });

  it("shows the admin-only state to a member without loading history", async () => {
    document.body.innerHTML = markup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          response({ ...session, member: { id: "member", role: "member" } }),
        )
      ),
    );
    await mountExports();
    expect(document.body.textContent).toContain(
      "requires owner or administrator",
    );
    expect(document.querySelector("[data-export-history]")).toBeNull();
  });

  it("renders session, history, retry, and download failure states honestly", async () => {
    document.body.innerHTML = markup();
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(response({}, 401))));
    await mountExports();
    expect(document.body.textContent).toContain(
      "session could not be confirmed",
    );

    document.body.innerHTML = markup();
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = new URL(String(input), "http://localhost").pathname;
        if (path === "/api/v1/session") {
          return Promise.resolve(response(session));
        }
        calls++;
        if (calls === 1) {
          return Promise.resolve(response({ detail: "down" }, 503));
        }
        if (path.endsWith("/downloads")) {
          return Promise.resolve(
            response({ detail: "Token service down" }, 503),
          );
        }
        return Promise.resolve(response({
          exports: [run, {
            ...run,
            exportId: "00000000-0000-4000-8000-000000000008",
            manifest: {
              ...run.manifest,
              rows: { people: { count: 2, sha256: "c".repeat(64) } },
            },
            status: "failed",
          }],
        }));
      }),
    );
    await mountExports();
    expect(document.body.textContent).toContain("could not be loaded");
    const retry = document.querySelector<HTMLButtonElement>(
      "[data-export-retry]",
    )!;
    expect(retry.hidden).toBe(false);
    retry.click();
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain("2 exports")
    );
    expect(document.body.textContent).toContain("2 persons");
    document.querySelector<HTMLButtonElement>("[data-export-history] button")!
      .click();
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain("Token service down")
    );
    expect(
      document.querySelector<HTMLButtonElement>("[data-export-history] button")
        ?.disabled,
    ).toBe(false);
  });

  it("keeps one creation owner and restores the action after an API failure", async () => {
    document.body.innerHTML = markup();
    let createCalls = 0;
    let resolveCreate!: (value: Response) => void;
    const pending = new Promise<Response>((resolve) => resolveCreate = resolve);
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), "http://localhost").pathname;
        if (path === "/api/v1/session") {
          return Promise.resolve(response(session));
        }
        if (init?.method === "POST") {
          createCalls++;
          return pending;
        }
        return Promise.resolve(response({ exports: [] }));
      }),
    );
    await mountExports();
    const create = document.querySelector<HTMLButtonElement>(
      "[data-export-create]",
    )!;
    create.click();
    create.click();
    expect(createCalls).toBe(1);
    resolveCreate(response({ detail: "Storage offline" }, 503));
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain("Storage offline")
    );
    expect(create.disabled).toBe(false);
  });

  it("settles transport failures for creation and download", async () => {
    document.body.innerHTML = markup();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), "http://localhost").pathname;
        if (path === "/api/v1/session") {
          return Promise.resolve(response(session));
        }
        if (init?.method === "POST") {
          return Promise.reject(new Error("offline"));
        }
        return Promise.resolve(response({ exports: [run] }));
      }),
    );
    await mountExports();
    document.querySelector<HTMLButtonElement>("[data-export-history] button")!
      .click();
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain(
        "download could not be prepared",
      )
    );
    document.querySelector<HTMLButtonElement>("[data-export-create]")!.click();
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain(
        "export could not be completed",
      )
    );
  });

  it("does nothing when the export surface is absent", async () => {
    document.body.innerHTML = "";
    await mountExports();
    expect(document.body.textContent).toBe("");
  });
});
