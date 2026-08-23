// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { mountStorageSettings } from "./storage-settings.ts";

const workspaceId = "00000000-0000-4000-8000-000000000003";
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function markup() {
  return `<main data-storage-settings>
    <p data-storage-state></p><button data-storage-retry hidden>Retry</button>
    <span data-storage-total-files></span><span data-storage-total-bytes></span>
    <span data-storage-available></span><span data-storage-missing></span>
    <span data-storage-processing></span><span data-storage-quarantined></span>
    <span data-storage-limit></span><span data-storage-provider></span>
    <span data-storage-bucket></span><span data-storage-health></span>
    <form data-storage-search><input name="query" maxlength="100"><button>Search</button></form>
    <p data-storage-search-state></p><ul data-storage-results></ul>
  </main>`;
}

const session = (role: "admin" | "member" = "admin") => ({
  member: { id: "member", role },
  principal: { userId: "user" },
  status: "authenticated",
  workspace: { id: workspaceId, name: "Circle" },
  workspaces: [{ id: workspaceId, name: "Circle" }],
});

const ready = (files: readonly unknown[] = []) => ({
  files,
  maximumUploadBytes: 10_485_760,
  provider: { bucket: "attachments", health: "available", name: "s3" },
  status: "ready",
  usage: {
    available: 4,
    missing: 1,
    processing: 2,
    quarantined: 3,
    totalBytes: 12_288,
    totalFiles: 10,
  },
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  sessionStorage.clear();
});

describe("FILES-001 workspace storage settings", () => {
  it("renders safe usage/configuration and performs one bounded metadata search", async () => {
    document.body.innerHTML = markup();
    const calls: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(String(input), "http://localhost");
        calls.push(url);
        if (url.pathname === "/api/v1/session") {
          return Promise.resolve(response(session()));
        }
        return Promise.resolve(response(ready(
          url.searchParams.has("query")
            ? [{
              byteSize: 2048,
              createdAt: "2026-08-23T08:00:00.000Z",
              fileId: "00000000-0000-4000-8000-000000000004",
              filename: "care-plan.pdf",
              kind: "document",
              mimeType: "application/pdf",
              personId: "00000000-0000-4000-8000-000000000005",
              personName: "Ada Lovelace",
              status: "available",
              title: "Care plan",
            }]
            : [],
        )));
      }),
    );

    await mountStorageSettings();
    expect(document.querySelector("[data-storage-total-files]")?.textContent)
      .toBe("10");
    expect(document.querySelector("[data-storage-total-bytes]")?.textContent)
      .toContain("12");
    expect(document.querySelector("[data-storage-provider]")?.textContent)
      .toBe("s3");
    const form = document.querySelector<HTMLFormElement>(
      "[data-storage-search]",
    )!;
    (form.elements.namedItem("query") as HTMLInputElement).value = "care";
    form.requestSubmit();
    await vi.waitFor(() => expect(calls).toHaveLength(3));
    expect(calls[2]?.searchParams.get("query")).toBe("care");
    await vi.waitFor(() =>
      expect(document.querySelector("[data-storage-results]")?.textContent)
        .toContain("Care plan")
    );
    expect(document.body.textContent).not.toContain("storageKey");
  });

  it("shows forbidden access without rendering workspace inventory", async () => {
    document.body.innerHTML = markup();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(String(input), "http://localhost");
        return Promise.resolve(
          url.pathname === "/api/v1/session"
            ? response(session("member"))
            : response({
              code: "storage_settings_forbidden",
              detail: "Only administrators may view storage diagnostics.",
              status: 403,
              title: "Forbidden",
              type: "about:blank",
            }, 403),
        );
      }),
    );

    await mountStorageSettings();

    expect(document.querySelector("[data-storage-state]")?.textContent)
      .toMatch(/owner or administrator/i);
    expect(document.querySelector("[data-storage-total-files]")?.textContent)
      .toBe("");
    expect(document.querySelector("[data-storage-search]")).toBeNull();
  });

  it("retries an unavailable load and reports unhealthy configuration without losing control", async () => {
    document.body.innerHTML = markup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(session()))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(response({
        ...ready(),
        maximumUploadBytes: 1_099_511_627_776,
        provider: {
          bucket: "attachments",
          health: "unavailable",
          name: "s3",
        },
        usage: { ...ready().usage, totalBytes: 512 },
      }))
      .mockResolvedValueOnce(response(ready([])));
    vi.stubGlobal("fetch", fetchMock);

    await mountStorageSettings();
    expect(document.querySelector("[data-storage-state]")?.textContent)
      .toMatch(/could not be loaded/i);
    document.querySelector<HTMLButtonElement>("[data-storage-retry]")!.click();
    await vi.waitFor(() =>
      expect(document.querySelector("[data-storage-health]")?.textContent)
        .toBe("Unavailable")
    );
    expect(document.querySelector("[data-storage-total-bytes]")?.textContent)
      .toBe("512 B");
    expect(document.querySelector("[data-storage-limit]")?.textContent)
      .toContain("TB");

    const form = document.querySelector<HTMLFormElement>(
      "[data-storage-search]",
    )!;
    form.requestSubmit();
    expect(document.querySelector("[data-storage-search-state]")?.textContent)
      .toMatch(/enter a file/i);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    (form.elements.namedItem("query") as HTMLInputElement).value = "none";
    form.requestSubmit();
    await vi.waitFor(() =>
      expect(document.querySelector("[data-storage-search-state]")?.textContent)
        .toMatch(/no files match/i)
    );
  });

  it("clears already rendered inventory when admin permission is lost", async () => {
    document.body.innerHTML = markup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(session()))
      .mockResolvedValueOnce(response(ready()))
      .mockResolvedValueOnce(response({
        code: "storage_settings_forbidden",
        detail: "Forbidden",
        status: 403,
        title: "Forbidden",
        type: "about:blank",
      }, 403));
    vi.stubGlobal("fetch", fetchMock);

    await mountStorageSettings();
    const form = document.querySelector<HTMLFormElement>(
      "[data-storage-search]",
    )!;
    (form.elements.namedItem("query") as HTMLInputElement).value = "care";
    form.requestSubmit();
    await vi.waitFor(() =>
      expect(document.querySelector("[data-storage-search]")).toBeNull()
    );
    expect(document.querySelector("[data-storage-total-files]")?.textContent)
      .toBe("");
  });

  it("does nothing when the storage surface is absent", async () => {
    await expect(mountStorageSettings()).resolves.toBeUndefined();
  });
});
