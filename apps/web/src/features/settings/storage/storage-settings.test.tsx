// @vitest-environment happy-dom
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { expectNoAxeViolations } from "../../../testing/a11y.ts";
import {
  deferred,
  jsonResponse,
  problemResponse,
  stubApi,
  unreachable,
} from "../../../testing/api.ts";
import { ids, workspaceSession } from "../../../testing/fixtures.ts";
import {
  drawShell,
  element,
  mountPending,
  mountSettled,
} from "../../../testing/render.tsx";
import {
  mountStorageSettings,
  STORAGE_SETTINGS_ISLAND,
} from "./storage-settings.tsx";

const SESSION = "GET /api/v1/session";
const STORAGE = "GET /api/v1/settings/storage";
const SEARCH = (query: string) => `GET /api/v1/settings/storage?query=${query}`;
const file = {
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
};
const ready = (files: readonly unknown[] = [], overrides: object = {}) =>
  jsonResponse({
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
    ...overrides,
  });

function shell(): void {
  drawShell(
    "<main data-storage-settings><div data-storage-surface></div></main>",
  );
}

const mount = () => mountSettled(() => mountStorageSettings());
const hook = (name: string) => element(`[data-storage-${name}]`);
const form = () => element<HTMLFormElement>("[data-storage-search]");

function search(query: string): void {
  act(() => {
    fireEvent.input(
      screen.getByLabelText("File ID, filename, title, or person"),
      { target: { value: query } },
    );
    fireEvent.submit(form());
  });
}

afterEach(() => sessionStorage.clear());

describe("FILES-001 workspace storage settings", () => {
  it("does nothing when the storage surface is absent", async () => {
    drawShell("<p>Other page</p>");
    const api = stubApi();
    await mount();
    expect(api.calls()).toEqual([]);
    expect(STORAGE_SETTINGS_ISLAND).toBe("settings-storage");
  });

  it("renders safe usage and configuration and performs one bounded metadata search", async () => {
    shell();
    const api = stubApi({
      [SEARCH("care")]: ready([file]),
      [SEARCH("two")]: ready([
        file,
        {
          ...file,
          fileId: "other",
          personId: undefined,
          personName: undefined,
        },
      ]),
      [SESSION]: jsonResponse(workspaceSession()),
      [STORAGE]: ready(),
    });
    await mount();
    expect(hook("total-files").textContent).toBe("10");
    expect(hook("total-bytes").textContent).toBe("12 KB");
    expect(hook("limit").textContent).toBe("10 MB");
    expect(hook("available").textContent).toBe("4");
    expect(hook("missing").textContent).toBe("1");
    expect(hook("processing").textContent).toBe("2");
    expect(hook("quarantined").textContent).toBe("3");
    expect(hook("provider").textContent).toBe("s3");
    expect(hook("bucket").textContent).toBe("attachments");
    expect(hook("health").textContent).toBe("Available");
    expect(hook("state").textContent).toBe("Storage diagnostics are current.");
    expect(hook("search-state").textContent).toBe(
      "Search by file ID, filename, title, or person name.",
    );
    await expectNoAxeViolations(document.body);
    search(" care ");
    expect(hook("state").textContent).toBe(
      "Searching workspace file metadata…",
    );
    await waitFor(() =>
      expect(hook("search-state").textContent).toBe(
        "1 matching file. Results are limited to 20.",
      )
    );
    const result = within(hook("results")).getByRole("listitem");
    expect(result.textContent).toBe(
      `Care plancare-plan.pdfdocument · 2 KB · available · Ada Lovelace${file.fileId}`,
    );
    expect(document.body.textContent).not.toContain("storageKey");
    search("two");
    await waitFor(() =>
      expect(hook("search-state").textContent).toBe(
        "2 matching files. Results are limited to 20.",
      )
    );
    expect(hook("results").querySelectorAll("small")[1]?.textContent).toBe(
      "document · 2 KB · available",
    );
    expect(api.calls()).toEqual([
      SESSION,
      STORAGE,
      SEARCH("care"),
      SEARCH("two"),
    ]);
  });

  it("keeps a lookup submitted before the page loaded off the URL and runs it once loaded", async () => {
    shell();
    const session = deferred<Response>();
    const api = stubApi({
      [SEARCH("Ada")]: ready(),
      [SESSION]: session.promise,
      [STORAGE]: ready(),
    });
    const settled = mountPending(() => mountStorageSettings());
    act(() => {
      fireEvent.input(
        screen.getByLabelText("File ID, filename, title, or person"),
        { target: { value: "Ada" } },
      );
    });
    const early = new Event("submit", { bubbles: true, cancelable: true });
    act(() => {
      form().dispatchEvent(early);
    });
    expect(early.defaultPrevented).toBe(true);
    await act(async () => {
      session.resolve(jsonResponse(workspaceSession()));
      await settled;
    });
    await waitFor(() =>
      expect(hook("search-state").textContent).toBe(
        "No files match this workspace lookup.",
      )
    );
    expect(api.calls()).toEqual([SESSION, STORAGE, SEARCH("Ada")]);
  });

  it("shows forbidden access to a member without reading inventory", async () => {
    shell();
    const api = stubApi({
      [SESSION]: jsonResponse(
        workspaceSession({ member: { id: ids.member, role: "member" } }),
      ),
    });
    await mount();
    expect(hook("state").textContent).toBe(
      "Storage diagnostics require workspace owner or administrator access.",
    );
    expect(hook("total-files").textContent).toBe("");
    expect(document.querySelector("[data-storage-search]")).toBeNull();
    expect(api.calls()).toEqual([SESSION]);
  });

  it("retries an unavailable load and reports unhealthy configuration without losing control", async () => {
    shell();
    const api = stubApi({
      [SEARCH("none")]: [unreachable, ready()],
      [SESSION]: jsonResponse(workspaceSession()),
      [STORAGE]: [
        unreachable,
        ready([], {
          maximumUploadBytes: 1_099_511_627_776,
          provider: {
            bucket: "attachments",
            health: "unavailable",
            name: "s3",
          },
          usage: {
            available: 0,
            missing: 0,
            processing: 0,
            quarantined: 0,
            totalBytes: 512,
            totalFiles: 1,
          },
        }),
      ],
    });
    await mount();
    expect(hook("state").textContent).toBe(
      "Workspace storage diagnostics could not be loaded.",
    );
    const retry = hook("retry");
    expect(retry.hidden).toBe(false);
    act(() => {
      fireEvent.click(retry);
    });
    await waitFor(() => expect(hook("health").textContent).toBe("Unavailable"));
    expect(retry.hidden).toBe(true);
    expect(hook("state").textContent).toBe(
      "Metadata is current, but the configured provider is unavailable.",
    );
    expect(hook("total-bytes").textContent).toBe("512 B");
    expect(hook("limit").textContent).toBe("1 TB");
    act(() => {
      fireEvent.submit(form());
    });
    expect(hook("search-state").textContent).toBe(
      "Enter a file ID, filename, title, or person name.",
    );
    search("none");
    await waitFor(() =>
      expect(hook("state").textContent).toBe(
        "File metadata search could not be completed. Existing usage remains visible.",
      )
    );
    expect(hook("total-bytes").textContent).toBe("512 B");
    act(() => {
      fireEvent.click(retry);
    });
    await waitFor(() =>
      expect(hook("search-state").textContent).toBe(
        "No files match this workspace lookup.",
      )
    );
    expect(api.calls().filter((call) => call === SEARCH("none")))
      .toHaveLength(2);
  });

  it("clears already rendered inventory when admin permission is lost", async () => {
    shell();
    stubApi({
      [SEARCH("care")]: problemResponse(403, { detail: "Forbidden" }),
      [SESSION]: jsonResponse(workspaceSession()),
      [STORAGE]: ready(),
    });
    await mount();
    search("care");
    await waitFor(() =>
      expect(document.querySelector("[data-storage-search]")).toBeNull()
    );
    expect(hook("total-files").textContent).toBe("");
    expect(hook("retry").hidden).toBe(true);
  });

  it("retries an unconfirmed session from the start", async () => {
    shell();
    stubApi({
      [SESSION]: [unreachable, jsonResponse(workspaceSession())],
      [STORAGE]: ready(),
    });
    await mount();
    expect(hook("state").textContent).toBe(
      "Your session could not be confirmed.",
    );
    act(() => {
      fireEvent.click(hook("retry"));
    });
    await waitFor(() => expect(hook("total-files").textContent).toBe("10"));
  });
});
