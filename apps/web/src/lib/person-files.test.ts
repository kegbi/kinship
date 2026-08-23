// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { mountPersonFiles } from "./person-files.ts";

const personId = "00000000-0000-4000-8000-000000000001";
const workspaceId = "00000000-0000-4000-8000-000000000002";
const fileId = "00000000-0000-4000-8000-000000000003";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function markup(): void {
  document.body.innerHTML = ["document", "photo"].map((kind) => `
    <section data-person-files="${kind}">
      <span data-file-badge>Loading</span>
      <p data-file-state></p>
      <button data-file-refresh type="button" hidden>Retry loading</button>
      <ul data-file-list></ul>
      <button data-file-add hidden>Add</button>
      <form data-file-form hidden>
        <input name="title" />
        <input name="file" type="file" />
        <button type="submit">Upload</button>
        <button data-file-cancel type="button">Cancel</button>
      </form>
    </section>
  `).join("");
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("FILES-001 person profile files", () => {
  it("does nothing when the profile has no complete files section", async () => {
    document.body.innerHTML =
      '<section data-person-files="document"></section>';
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await mountPersonFiles({ archived: false, personId, workspaceId });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("renders explicit available, missing, and quarantined states without object references", async () => {
    markup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({
        files: [
          {
            byteSize: 20,
            createdAt: "2026-08-23T08:00:00.000Z",
            fileId,
            filename: "care.pdf",
            kind: "document",
            mimeType: "application/pdf",
            personId,
            status: "available",
            title: "Care plan",
          },
          {
            byteSize: 30,
            createdAt: "2026-08-23T08:00:00.000Z",
            fileId: "00000000-0000-4000-8000-000000000004",
            filename: "missing.jpg",
            kind: "photo",
            mimeType: "image/jpeg",
            personId,
            status: "missing",
            title: "Old portrait",
          },
          {
            byteSize: 40,
            createdAt: "2026-08-23T08:00:00.000Z",
            fileId: "00000000-0000-4000-8000-000000000005",
            filename: "held.jpg",
            kind: "photo",
            mimeType: "image/jpeg",
            personId,
            status: "quarantined",
            title: "Held portrait",
          },
        ],
        status: "ready",
      })),
    );

    await mountPersonFiles({ archived: false, personId, workspaceId });
    expect(
      document.querySelector(
        '[data-file-id="00000000-0000-4000-8000-000000000004"]',
      )?.textContent,
    ).toContain("Bytes missing");
    expect(
      document.querySelector(
        '[data-file-id="00000000-0000-4000-8000-000000000005"]',
      )?.textContent,
    ).toContain("Quarantined");
    const available = document.querySelector(`[data-file-id="${fileId}"]`)!;
    expect(available.querySelector("a")?.getAttribute("href")).toBe(
      `/api/v1/people/${personId}/files/${fileId}/content`,
    );
    expect(document.body.textContent).not.toContain("storageKey");
  });

  it("serializes upload then refreshes the authoritative list", async () => {
    markup();
    const saved = {
      byteSize: 4,
      createdAt: "2026-08-23T08:00:00.000Z",
      fileId,
      filename: "care.pdf",
      kind: "document",
      mimeType: "application/pdf",
      personId,
      status: "available",
      title: "Care plan",
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ files: [], status: "ready" }))
      .mockResolvedValueOnce(response({ file: saved, status: "created" }, 201))
      .mockResolvedValueOnce(response({ files: [saved], status: "ready" }));
    vi.stubGlobal("fetch", fetchMock);
    await mountPersonFiles({ archived: false, personId, workspaceId });
    document.querySelector<HTMLButtonElement>(
      '[data-person-files="document"] [data-file-add]',
    )?.click();
    const form = document.querySelector<HTMLFormElement>(
      '[data-person-files="document"] [data-file-form]',
    )!;
    (form.elements.namedItem("title") as HTMLInputElement).value = "Care plan";
    const input = form.elements.namedItem("file") as HTMLInputElement;
    Object.defineProperty(input, "files", {
      value: [new File(["%PDF"], "care.pdf", { type: "application/pdf" })],
    });
    form.requestSubmit();
    await vi.waitFor(() =>
      expect(document.querySelector(`[data-file-id="${fileId}"]`)).not
        .toBeNull()
    );
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("POST");
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({
      "X-File-Kind": "document",
      "X-File-Name": "care.pdf",
      "X-Workspace-Id": workspaceId,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("keeps archived files read-only and reports unavailable loading", async () => {
    markup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({
        detail: "File storage is offline.",
        status: 503,
        title: "Unavailable",
        type: "https://kinship.test/problems/files_unavailable",
        code: "files_unavailable",
      }, 503)),
    );
    await mountPersonFiles({ archived: true, personId, workspaceId });
    expect(
      document.querySelector('[data-person-files="document"] [data-file-badge]')
        ?.textContent,
    ).toBe("Unavailable");
    expect(
      document.querySelector<HTMLButtonElement>(
        '[data-person-files="document"] [data-file-add]',
      )?.hidden,
    ).toBe(true);
    expect(
      document.querySelector('[data-person-files="document"] [data-file-state]')
        ?.textContent,
    ).toContain("offline");
  });

  it("validates, cancels, and reports a failed upload without a stale refresh", async () => {
    markup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ files: [], status: "ready" }))
      .mockResolvedValueOnce(response({
        code: "files_unavailable",
        detail: "Upload storage is offline.",
        status: 503,
        title: "Unavailable",
        type: "https://kinship.test/problems/files_unavailable",
      }, 503));
    vi.stubGlobal("fetch", fetchMock);
    await mountPersonFiles({ archived: false, personId, workspaceId });
    const root = document.querySelector<HTMLElement>(
      '[data-person-files="photo"]',
    )!;
    root.querySelector<HTMLButtonElement>("[data-file-add]")!.click();
    const form = root.querySelector<HTMLFormElement>("[data-file-form]")!;
    form.requestSubmit();
    expect(root.querySelector("[data-file-state]")?.textContent).toContain(
      "Choose a file",
    );
    root.querySelector<HTMLButtonElement>("[data-file-cancel]")!.click();
    expect(root.querySelector("[data-file-state]")?.textContent).toContain(
      "cancelled",
    );
    (form.elements.namedItem("title") as HTMLInputElement).value = "Portrait";
    Object.defineProperty(form.elements.namedItem("file"), "files", {
      configurable: true,
      value: [
        new File([new Uint8Array([0xff, 0xd8, 0xff])], "portrait.jpg", {
          type: "image/jpeg",
        }),
      ],
    });
    form.requestSubmit();
    await vi.waitFor(() =>
      expect(root.querySelector("[data-file-state]")?.textContent).toContain(
        "offline",
      )
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("restores a failed remove control, then refreshes after a successful remove", async () => {
    markup();
    const saved = {
      byteSize: 2048,
      createdAt: "2026-08-23T08:00:00.000Z",
      fileId,
      filename: "care.pdf",
      kind: "document",
      mimeType: "application/pdf",
      personId,
      status: "processing",
      title: "Care plan",
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ files: [saved], status: "ready" }))
      .mockResolvedValueOnce(response({
        code: "files_unavailable",
        detail: "Remove storage is offline.",
        status: 503,
        title: "Unavailable",
        type: "https://kinship.test/problems/files_unavailable",
      }, 503))
      .mockResolvedValueOnce(response({ fileId, status: "removed" }))
      .mockResolvedValueOnce(response({ files: [], status: "ready" }));
    vi.stubGlobal("fetch", fetchMock);
    await mountPersonFiles({ archived: false, personId, workspaceId });
    const button = document.querySelector<HTMLButtonElement>(
      `[data-file-remove="${fileId}"]`,
    )!;
    button.click();
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    expect(document.body.textContent).toContain("Remove storage is offline.");
    button.click();
    await vi.waitFor(() =>
      expect(document.querySelector(`[data-file-id="${fileId}"]`)).toBeNull()
    );
    expect(document.body.textContent).toContain("File removed.");
  });

  it("preserves an explicit retry state when post-upload refresh fails", async () => {
    markup();
    const saved = {
      byteSize: 4,
      createdAt: "2026-08-23T08:00:00.000Z",
      fileId,
      filename: "care.pdf",
      kind: "document",
      mimeType: "application/pdf",
      personId,
      status: "available",
      title: "Care plan",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response({ files: [], status: "ready" }))
        .mockResolvedValueOnce(
          response({ file: saved, status: "created" }, 201),
        )
        .mockResolvedValueOnce(
          response({
            code: "files_unavailable",
            detail: "Refresh offline.",
            status: 503,
            title: "Unavailable",
            type: "problem",
          }, 503),
        )
        .mockResolvedValueOnce(response({ files: [saved], status: "ready" })),
    );
    await mountPersonFiles({ archived: false, personId, workspaceId });
    const root = document.querySelector<HTMLElement>(
      '[data-person-files="document"]',
    )!;
    const form = root.querySelector<HTMLFormElement>("[data-file-form]")!;
    (form.elements.namedItem("title") as HTMLInputElement).value = "Care plan";
    Object.defineProperty(form.elements.namedItem("file"), "files", {
      value: [new File(["%PDF"], "care.pdf", { type: "application/pdf" })],
    });
    form.requestSubmit();
    await vi.waitFor(() =>
      expect(root.querySelector("[data-file-state]")?.textContent).toContain(
        "Refresh offline",
      )
    );
    expect(root.querySelector<HTMLButtonElement>("[data-file-refresh]")?.hidden)
      .toBe(false);
    root.querySelector<HTMLButtonElement>("[data-file-refresh]")!.click();
    await vi.waitFor(() =>
      expect(
        root.querySelector<HTMLButtonElement>("[data-file-refresh]")?.hidden,
      ).toBe(true)
    );
  });

  it("does not leave a stale disabled row when post-remove refresh fails", async () => {
    markup();
    const saved = {
      byteSize: 4,
      createdAt: "2026-08-23T08:00:00.000Z",
      fileId,
      filename: "care.pdf",
      kind: "document",
      mimeType: "application/pdf",
      personId,
      status: "available",
      title: "Care plan",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response({ files: [saved], status: "ready" }))
        .mockResolvedValueOnce(response({ fileId, status: "removed" }))
        .mockResolvedValueOnce(
          response({
            code: "files_unavailable",
            detail: "Refresh offline.",
            status: 503,
            title: "Unavailable",
            type: "problem",
          }, 503),
        ),
    );
    await mountPersonFiles({ archived: false, personId, workspaceId });
    const root = document.querySelector<HTMLElement>(
      '[data-person-files="document"]',
    )!;
    const button = root.querySelector<HTMLButtonElement>(
      `[data-file-remove="${fileId}"]`,
    )!;
    button.click();
    await vi.waitFor(() =>
      expect(root.querySelector("[data-file-state]")?.textContent).toContain(
        "Refresh offline",
      )
    );
    expect(button.disabled).toBe(false);
    expect(root.querySelector<HTMLButtonElement>("[data-file-refresh]")?.hidden)
      .toBe(false);
  });
});
