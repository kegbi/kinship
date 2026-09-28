// @vitest-environment happy-dom

import { act, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { expectNoAxeViolations } from "../../../testing/a11y.ts";
import {
  deferred,
  jsonResponse,
  problemResponse,
  stubApi,
} from "../../../testing/api.ts";
import { ids, sectionProps } from "../../../testing/fixtures.ts";
import {
  drawShell,
  element,
  mountPending,
  mountSection,
} from "../../../testing/render.tsx";
import { mountPersonFiles } from "./person-files.tsx";

const { person: personId, workspace: workspaceId } = ids;
const fileId = "00000000-0000-4000-8000-000000000003";
const FILES = "GET /api/v1/people/:personId/files";
const UPLOAD = "POST /api/v1/people/:personId/files";
const REMOVE = "DELETE /api/v1/people/:personId/files/:fileId";

/** Both cards as `FilesSection.astro` draws them before hydration. */
function markup(): void {
  drawShell(
    `<main>${
      [["documents", "document", "Documents"], ["photos", "photo", "Photos"]]
        .map(([id, kind, title]) => `
    <section id="profile-section-${id}" class="profile-section-card person-files-card" data-profile-section="${id}" data-person-files="${kind}" data-section-state="loading" tabindex="-1" aria-labelledby="profile-section-${id}-heading">
      <header class="profile-section-heading"><div class="profile-section-title"><h3 id="profile-section-${id}-heading">${title}</h3><span data-file-badge>Loading</span></div>
      <button data-file-add type="button" hidden>Attach ${kind}</button></header>
      <p data-file-state class="section-state"><span class="sr-only">Loading ${id}…</span></p>
      <button data-file-refresh type="button" hidden>Retry loading</button>
      <ul id="${id}-list" data-file-list aria-label="Saved ${id}"></ul>
      <button data-load-more="files" hidden>Load more files</button>
      <form method="post" data-file-form hidden novalidate>
        <label>Title <input name="title" /></label>
        <label>File <input name="file" type="file" /></label>
        <button type="submit">Upload</button>
        <button data-file-cancel type="button">Cancel</button>
      </form>
    </section>`).join("")
    }</main>`,
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
  mountSection(mountPersonFiles, sectionProps({ archived }));

const cardOf = (kind: "document" | "photo") =>
  element(`[data-person-files="${kind}"]`);
const card = (kind: "document" | "photo") => within(cardOf(kind));
const stateOf = (kind: "document" | "photo") =>
  cardOf(kind).querySelector("[data-file-state]")!.textContent;
const hook = <T extends HTMLElement>(
  kind: "document" | "photo",
  selector: string,
) => cardOf(kind).querySelector<T>(selector)!;

/** Chooses `file` in a card's file field, as a reader picking one does. */
function choose(kind: "document" | "photo", file: File): void {
  const input = hook<HTMLInputElement>(kind, 'input[name="file"]');
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
}

const pdf = () => new File(["%PDF"], "care.pdf", { type: "application/pdf" });

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
    const more = card("document").getByRole("button", {
      name: "Load more files",
    });
    expect(more.getAttribute("aria-controls")).toBe("documents-list");
    await userEvent.setup().click(more);
    await waitFor(() =>
      expect(document.body.textContent).toContain("Second page")
    );
    expect(api.calls().at(-1)).toContain("cursor=file-cursor");
    expect(document.body.textContent).toContain("First page");
    for (
      const control of document.querySelectorAll<HTMLButtonElement>(
        '[data-load-more="files"]',
      )
    ) expect(control.hidden).toBe(true);
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
    const more = card("photo").getByRole("button", { name: "Load more files" });
    await userEvent.setup().click(more);
    await waitFor(() => expect(more.hidden).toBe(true));
    expect(stateOf("document")).toBe(
      "Reload the first page of files before continuing.",
    );
    expect(document.body.textContent).toContain("Care plan");
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
    const api = stubApi({
      [FILES]: listed([
        storedFile(),
        storedFile({
          byteSize: 3 * 1024 * 1024,
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
        storedFile({
          fileId: "00000000-0000-4000-8000-000000000006",
          status: "processing",
          title: "Scan",
        }),
      ]),
    });

    await mount();
    expect(cardOf("document").dataset.island).toBe("person-files");
    expect(cardOf("document").dataset.sectionState).toBe("ready");
    expect(cardOf("photo").dataset.sectionState).toBe("ready");
    const missing = element(
      '[data-file-id="00000000-0000-4000-8000-000000000004"]',
    );
    expect(missing.textContent).toContain("Bytes missing");
    expect(missing.textContent).toContain("missing.jpg · 3.0 MB");
    expect(missing.dataset.fileStatus).toBe("missing");
    expect(within(missing).queryByRole("link")).toBeNull();
    expect(
      element('[data-file-id="00000000-0000-4000-8000-000000000005"]')
        .textContent,
    ).toContain("Quarantined");
    expect(
      element('[data-file-id="00000000-0000-4000-8000-000000000006"]')
        .textContent,
    ).toContain("Processing");
    const available = within(element(`[data-file-id="${fileId}"]`));
    expect(
      available.getByRole("link", { name: "Download" }).getAttribute(
        "href",
      ),
    ).toBe(`/api/v1/people/${personId}/files/${fileId}/content`);
    expect(available.getByText("care.pdf · 20 B")).toBeTruthy();
    expect(stateOf("document")).toBe("2 documents saved.");
    expect(stateOf("photo")).toBe("2 photos saved.");
    expect(hook("photo", "[data-file-badge]").textContent).toBe("2 saved");
    expect(document.body.textContent).not.toContain("storageKey");
    expect(api.requests()[0]?.headers.get("X-Workspace-Id")).toBe(
      workspaceId,
    );
    await expectNoAxeViolations(element("main"));
  });

  it("counts one saved file and an empty card honestly", async () => {
    markup();
    stubApi({ [FILES]: listed([storedFile()]) });
    await mount();
    expect(stateOf("document")).toBe("1 document saved.");
    expect(stateOf("photo")).toBe("No photos saved.");
    expect(cardOf("photo").dataset.sectionState).toBe("empty");
  });

  it("serializes upload then refreshes the authoritative list", async () => {
    markup();
    const saved = storedFile({ byteSize: 4 });
    const api = stubApi({
      [FILES]: [listed([]), listed([saved])],
      [UPLOAD]: jsonResponse({ file: saved, status: "created" }, 201),
    });
    await mount();
    const user = userEvent.setup();
    await user.click(
      card("document").getByRole("button", { name: "Attach document" }),
    );
    const title = card("document").getByLabelText("Title");
    expect(document.activeElement).toBe(title);
    await user.type(title, "Care plan");
    choose("document", pdf());
    await user.click(card("document").getByRole("button", { name: "Upload" }));
    await waitFor(() =>
      expect(document.querySelector(`[data-file-id="${fileId}"]`)).not
        .toBeNull()
    );
    expect(stateOf("document")).toBe("File uploaded.");
    expect(hook<HTMLFormElement>("document", "[data-file-form]").hidden).toBe(
      true,
    );
    expect(api.requests()[1]?.method).toBe("POST");
    expect(api.requests()[1]?.init?.headers).toMatchObject({
      "X-File-Kind": "document",
      "X-File-Name": "care.pdf",
      "X-Workspace-Id": workspaceId,
    });
    expect(api.fetch).toHaveBeenCalledTimes(3);
  });

  it("says a quarantined upload cannot be downloaded", async () => {
    markup();
    const held = storedFile({ kind: "photo", status: "quarantined" });
    stubApi({
      [FILES]: [listed([]), listed([held])],
      [UPLOAD]: jsonResponse({ file: held, status: "created" }, 201),
    });
    await mount();
    const user = userEvent.setup();
    await user.click(
      card("photo").getByRole("button", { name: "Attach photo" }),
    );
    await user.type(card("photo").getByLabelText("Title"), "Portrait");
    choose("photo", new File(["x"], "held.jpg", { type: "image/jpeg" }));
    await user.click(card("photo").getByRole("button", { name: "Upload" }));
    await waitFor(() =>
      expect(stateOf("photo")).toBe(
        "File saved in quarantine and cannot be downloaded.",
      )
    );
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
    expect(hook("document", "[data-file-badge]").textContent).toBe(
      "Unavailable",
    );
    expect(hook<HTMLButtonElement>("document", "[data-file-add]").hidden).toBe(
      true,
    );
    expect(stateOf("document")).toContain("offline");
    expect(cardOf("document").dataset.sectionState).toBe("error");
  });

  it("offers nothing to attach before any list has answered", async () => {
    markup();
    stubApi({ [FILES]: () => Promise.reject(new Error("offline")) });
    await mount();
    expect(stateOf("photo")).toBe("Files are temporarily unavailable.");
    expect(hook<HTMLButtonElement>("photo", "[data-file-add]").hidden).toBe(
      true,
    );
    expect(hook<HTMLButtonElement>("photo", "[data-file-refresh]").hidden)
      .toBe(false);
  });

  it("repaints existing file controls across in-page archive and restore", async () => {
    markup();
    const api = stubApi({ [FILES]: listed([storedFile()]) });
    await mount();
    const add = hook<HTMLButtonElement>("document", "[data-file-add]");
    const user = userEvent.setup();
    await user.click(add);
    expect(hook<HTMLFormElement>("document", "[data-file-form]").hidden).toBe(
      false,
    );
    const staleRemove = element<HTMLButtonElement>(
      `[data-file-remove="${fileId}"]`,
    );

    act(() => {
      document.dispatchEvent(
        new CustomEvent("person-lifecycle-changed", {
          detail: { archived: true, personId, state: "archived" },
        }),
      );
    });

    expect(add.hidden).toBe(true);
    expect(hook<HTMLFormElement>("document", "[data-file-form]").hidden).toBe(
      true,
    );
    expect(document.querySelector(`[data-file-id="${fileId}"]`)).not.toBeNull();
    expect(document.querySelector(`[data-file-remove="${fileId}"]`)).toBeNull();
    fireEvent.click(staleRemove);
    await Promise.resolve();
    expect(api.fetch).toHaveBeenCalledTimes(1);
    // A reader cannot open an editor on an archived person either.
    fireEvent.click(add);
    expect(hook<HTMLFormElement>("document", "[data-file-form]").hidden).toBe(
      true,
    );

    act(() => {
      document.dispatchEvent(
        new CustomEvent("person-lifecycle-changed", {
          detail: { archived: false, personId, state: "active" },
        }),
      );
      // Another person's change is not this card's.
      document.dispatchEvent(
        new CustomEvent("person-lifecycle-changed", {
          detail: { archived: true, personId: "someone-else" },
        }),
      );
    });
    expect(add.hidden).toBe(false);
    expect(document.querySelector(`[data-file-remove="${fileId}"]`)).not
      .toBeNull();
  });

  it("validates, cancels, and reports a failed upload without a stale refresh", async () => {
    markup();
    const api = stubApi({
      [FILES]: listed([]),
      [UPLOAD]: [
        unavailable(
          "Upload storage is offline.",
          "https://kinship.test/problems/files_unavailable",
        ),
        () => Promise.reject(new Error("offline")),
      ],
    });
    await mount();
    const user = userEvent.setup();
    const add = card("photo").getByRole("button", { name: "Attach photo" });
    await user.click(add);
    await user.click(card("photo").getByRole("button", { name: "Upload" }));
    expect(stateOf("photo")).toContain("Choose a file");
    await user.click(card("photo").getByRole("button", { name: "Cancel" }));
    expect(stateOf("photo")).toContain("cancelled");
    expect(document.activeElement).toBe(add);
    expect(hook<HTMLFormElement>("photo", "[data-file-form]").hidden).toBe(
      true,
    );
    await user.click(add);
    await user.type(card("photo").getByLabelText("Title"), "Portrait");
    choose(
      "photo",
      new File([new Uint8Array([0xff, 0xd8, 0xff])], "portrait.jpg", {
        type: "image/jpeg",
      }),
    );
    await user.click(card("photo").getByRole("button", { name: "Upload" }));
    await waitFor(() => expect(stateOf("photo")).toContain("offline"));
    expect(api.fetch).toHaveBeenCalledTimes(2);
    await user.click(card("photo").getByRole("button", { name: "Upload" }));
    await waitFor(() =>
      expect(stateOf("photo")).toBe("The file could not be uploaded.")
    );
    expect(api.fetch).toHaveBeenCalledTimes(3);
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
        () => Promise.reject(new Error("offline")),
        jsonResponse({ fileId, status: "removed" }),
      ],
    });
    await mount();
    const user = userEvent.setup();
    const button = card("document").getByRole("button", { name: "Remove" });
    await user.click(button);
    await waitFor(() => expect(button).toHaveProperty("disabled", false));
    expect(document.body.textContent).toContain("Remove storage is offline.");
    await user.click(button);
    await waitFor(() =>
      expect(stateOf("document")).toBe("The file could not be removed.")
    );
    await user.click(button);
    await waitFor(() =>
      expect(document.querySelector(`[data-file-id="${fileId}"]`)).toBeNull()
    );
    expect(document.body.textContent).toContain("File removed.");
  });

  it("holds every remove and the paging control while a removal owns the list", async () => {
    markup();
    const removed = deferred<Response>();
    const second = storedFile({
      fileId: "00000000-0000-4000-8000-000000000007",
      title: "Second",
    });
    const api = stubApi({
      [FILES]: [listed([storedFile(), second], "more"), listed([second])],
      [REMOVE]: removed.promise,
    });
    await mount();
    const [first, other] = card("document").getAllByRole("button", {
      name: "Remove",
    });
    const more = hook<HTMLButtonElement>(
      "document",
      '[data-load-more="files"]',
    );
    expect(more.hidden).toBe(false);
    await userEvent.setup().click(first!);
    expect(stateOf("document")).toBe("Removing file…");
    expect(first).toHaveProperty("disabled", true);
    expect(first!.getAttribute("aria-busy")).toBe("true");
    expect(other).toHaveProperty("disabled", true);
    expect(more.hidden).toBe(true);
    // Every upload waits too, and says so rather than looking live.
    for (const kind of ["document", "photo"] as const) {
      expect(
        hook<HTMLButtonElement>(kind, '[data-file-form] [type="submit"]')
          .disabled,
      ).toBe(true);
    }
    fireEvent.click(other!);
    await act(async () => {
      removed.resolve(jsonResponse({ fileId, status: "removed" }));
      await removed.promise;
    });
    await waitFor(() => expect(stateOf("document")).toBe("File removed."));
    expect(
      hook<HTMLButtonElement>("photo", '[data-file-form] [type="submit"]')
        .disabled,
    ).toBe(false);
    expect(api.requests().filter((call) => call.method === "DELETE"))
      .toHaveLength(1);
  });

  it("preserves an explicit retry state when post-upload refresh fails", async () => {
    markup();
    const saved = storedFile({ byteSize: 4 });
    stubApi({
      [FILES]: [listed([]), unavailable("Refresh offline."), listed([saved])],
      [UPLOAD]: jsonResponse({ file: saved, status: "created" }, 201),
    });
    await mount();
    const user = userEvent.setup();
    await user.click(
      card("document").getByRole("button", { name: "Attach document" }),
    );
    await user.type(card("document").getByLabelText("Title"), "Care plan");
    choose("document", pdf());
    await user.click(card("document").getByRole("button", { name: "Upload" }));
    await waitFor(() =>
      expect(stateOf("document")).toContain("Refresh offline")
    );
    const retry = card("document").getByRole("button", {
      name: "Retry loading",
    });
    await user.click(retry);
    await waitFor(() => expect(retry.hidden).toBe(true));
    expect(stateOf("document")).toBe("1 document saved.");
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
    const button = card("document").getByRole("button", { name: "Remove" });
    await userEvent.setup().click(button);
    await waitFor(() =>
      expect(stateOf("document")).toContain("Refresh offline")
    );
    expect(button).toHaveProperty("disabled", false);
    expect(hook<HTMLButtonElement>("document", "[data-file-refresh]").hidden)
      .toBe(false);
  });
});

describe("REL-052 person files status lines", () => {
  // Mounted during the initial fan-out, the line waits for the workspace's
  // promotion (UXD-003B); mounted after it, the line is its own live region
  // from the first commit.
  it.each([false, true])(
    "owns each card's live region from its first commit only once states are live (%s)",
    async (live) => {
      markup();
      const list = deferred<Response>();
      stubApi({ [FILES]: list.promise });
      const settled = mountPending(() =>
        mountPersonFiles(
          document.body,
          sectionProps({ statesLive: () => live }),
        )
      );
      const lines = (["document", "photo"] as const).map((kind) =>
        hook(kind, "[data-file-state]")
      );
      for (const line of lines) {
        expect(line.getAttribute("role")).toBe(live ? "status" : null);
        expect(line.getAttribute("aria-live")).toBe(live ? "polite" : null);
      }
      await act(async () => {
        list.resolve(listed([]));
        await settled;
      });
      // The region that announces the answer is the one that was there first.
      expect(lines.map((line) => line.isConnected)).toEqual([true, true]);
    },
  );
});
