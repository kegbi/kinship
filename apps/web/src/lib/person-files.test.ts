// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { jsonResponse, problemResponse, stubApi } from "../testing/api.ts";
import { ids } from "../testing/fixtures.ts";
import { drawShell } from "../testing/render.tsx";
import { mountPersonFiles } from "./person-files.ts";

const { person: personId, workspace: workspaceId } = ids;
const fileId = "00000000-0000-4000-8000-000000000003";
const FILES = "GET /api/v1/people/:personId/files";
const UPLOAD = "POST /api/v1/people/:personId/files";
const REMOVE = "DELETE /api/v1/people/:personId/files/:fileId";

function markup(): void {
  drawShell(
    ["document", "photo"].map((kind) => `
    <section data-person-files="${kind}">
      <span data-file-badge>Loading</span>
      <p data-file-state></p>
      <button data-file-refresh type="button" hidden>Retry loading</button>
      <ul data-file-list></ul>
      <button data-load-more="files" hidden>Load more files</button>
      <button data-file-add hidden>Add</button>
      <form data-file-form hidden>
        <input name="title" />
        <input name="file" type="file" />
        <button type="submit">Upload</button>
        <button data-file-cancel type="button">Cancel</button>
      </form>
    </section>
  `).join(""),
  );
}

function storedFile(overrides: Record<string, unknown> = {}) {
  return {
    byteSize: 20,
    createdAt: "2026-08-23T08:00:00.000Z",
    fileId,
    filename: "care.pdf",
    kind: "document",
    mimeType: "application/pdf",
    personId,
    status: "available",
    title: "Care plan",
    ...overrides,
  };
}

const listed = (files: readonly unknown[], nextCursor?: string) =>
  jsonResponse({
    files,
    ...(nextCursor ? { nextCursor } : {}),
    status: "ready",
  });

const unavailable = (detail: string, type = "problem") =>
  problemResponse(503, {
    code: "files_unavailable",
    detail,
    title: "Unavailable",
    type,
  });

const mount = (archived = false) =>
  mountPersonFiles({ archived, personId, workspaceId });

describe("GAP-023 person file paging", () => {
  it("appends the next page and retires the control when the last one answers", async () => {
    markup();
    const api = stubApi({
      [FILES]: [
        listed([storedFile({ title: "First page" })], "file-cursor"),
        listed([
          storedFile({
            fileId: "00000000-0000-4000-8000-000000000009",
            title: "Second page",
          }),
        ]),
      ],
    });
    await mount();
    const more = document.querySelector<HTMLButtonElement>(
      '[data-load-more="files"]',
    )!;
    expect(more.hidden).toBe(false);
    more.click();
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain("Second page")
    );
    expect(api.calls().at(-1)).toContain("cursor=file-cursor");
    expect(document.body.textContent).toContain("First page");
    expect(more.hidden).toBe(true);
  });

  it("hides the control when a continued page fails", async () => {
    markup();
    stubApi({
      [FILES]: [
        listed([storedFile()], "file-cursor"),
        problemResponse(400, {
          code: "file_query_invalid",
          detail: "Reload the first page of files before continuing.",
          title: "Invalid file query",
          type: "problem",
        }),
      ],
    });
    await mount();
    const more = document.querySelector<HTMLButtonElement>(
      '[data-load-more="files"]',
    )!;
    more.click();
    await vi.waitFor(() => expect(more.hidden).toBe(true));
    expect(document.body.textContent).toContain(
      "Reload the first page of files before continuing.",
    );
  });
});

describe("FILES-001 person profile files", () => {
  it("does nothing when the profile has no complete files section", async () => {
    drawShell('<section data-person-files="document"></section>');
    const api = stubApi();
    await mount();
    expect(api.fetch).not.toHaveBeenCalled();
  });
  it("renders explicit available, missing, and quarantined states without object references", async () => {
    markup();
    stubApi({
      [FILES]: listed([
        storedFile(),
        storedFile({
          byteSize: 30,
          fileId: "00000000-0000-4000-8000-000000000004",
          filename: "missing.jpg",
          kind: "photo",
          mimeType: "image/jpeg",
          status: "missing",
          title: "Old portrait",
        }),
        storedFile({
          byteSize: 40,
          fileId: "00000000-0000-4000-8000-000000000005",
          filename: "held.jpg",
          kind: "photo",
          mimeType: "image/jpeg",
          status: "quarantined",
          title: "Held portrait",
        }),
      ]),
    });

    await mount();
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
    const saved = storedFile({ byteSize: 4 });
    const api = stubApi({
      [FILES]: [listed([]), listed([saved])],
      [UPLOAD]: jsonResponse({ file: saved, status: "created" }, 201),
    });
    await mount();
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
    expect(api.requests()[1]?.method).toBe("POST");
    expect(api.requests()[1]?.init?.headers).toMatchObject({
      "X-File-Kind": "document",
      "X-File-Name": "care.pdf",
      "X-Workspace-Id": workspaceId,
    });
    expect(api.fetch).toHaveBeenCalledTimes(3);
  });

  it("keeps archived files read-only and reports unavailable loading", async () => {
    markup();
    stubApi({
      [FILES]: unavailable(
        "File storage is offline.",
        "https://kinship.test/problems/files_unavailable",
      ),
    });
    await mount(true);
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

  it("repaints existing file controls across in-page archive and restore", async () => {
    markup();
    const api = stubApi({ [FILES]: listed([storedFile()]) });
    await mount();
    const add = document.querySelector<HTMLButtonElement>(
      '[data-person-files="document"] [data-file-add]',
    )!;
    const staleRemove = document.querySelector<HTMLButtonElement>(
      `[data-file-remove="${fileId}"]`,
    )!;

    document.dispatchEvent(
      new CustomEvent("person-lifecycle-changed", {
        detail: { archived: true, personId, state: "archived" },
      }),
    );

    expect(add.hidden).toBe(true);
    expect(document.querySelector(`[data-file-id="${fileId}"]`))?.not
      .toBeNull();
    expect(document.querySelector(`[data-file-remove="${fileId}"]`)).toBeNull();
    staleRemove.click();
    await Promise.resolve();
    expect(api.fetch).toHaveBeenCalledTimes(1);

    document.dispatchEvent(
      new CustomEvent("person-lifecycle-changed", {
        detail: { archived: false, personId, state: "active" },
      }),
    );
    expect(add.hidden).toBe(false);
    expect(document.querySelector(`[data-file-remove="${fileId}"]`)).not
      .toBeNull();
  });

  it("validates, cancels, and reports a failed upload without a stale refresh", async () => {
    markup();
    const api = stubApi({
      [FILES]: listed([]),
      [UPLOAD]: unavailable(
        "Upload storage is offline.",
        "https://kinship.test/problems/files_unavailable",
      ),
    });
    await mount();
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
    expect(api.fetch).toHaveBeenCalledTimes(2);
  });

  it("restores a failed remove control, then refreshes after a successful remove", async () => {
    markup();
    stubApi({
      [FILES]: [
        listed([storedFile({ byteSize: 2048, status: "processing" })]),
        listed([]),
      ],
      [REMOVE]: [
        unavailable(
          "Remove storage is offline.",
          "https://kinship.test/problems/files_unavailable",
        ),
        jsonResponse({ fileId, status: "removed" }),
      ],
    });
    await mount();
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
    const saved = storedFile({ byteSize: 4 });
    stubApi({
      [FILES]: [listed([]), unavailable("Refresh offline."), listed([saved])],
      [UPLOAD]: jsonResponse({ file: saved, status: "created" }, 201),
    });
    await mount();
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
    stubApi({
      [FILES]: [
        listed([storedFile({ byteSize: 4 })]),
        unavailable("Refresh offline."),
      ],
      [REMOVE]: jsonResponse({ fileId, status: "removed" }),
    });
    await mount();
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
