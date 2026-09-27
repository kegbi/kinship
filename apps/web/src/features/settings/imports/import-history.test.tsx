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
  jsonResponse,
  problemResponse,
  stubApi,
  unreachable,
} from "../../../testing/api.ts";
import {
  ids,
  preferences,
  workspaceSession,
} from "../../../testing/fixtures.ts";
import { drawShell, element, mountSettled } from "../../../testing/render.tsx";
import {
  IMPORT_HISTORY_ISLAND,
  mountImportHistory,
} from "./import-history.tsx";
import { IMPORT_REPORT_ISLAND, mountImportReport } from "./import-report.tsx";

const SESSION = "GET /api/v1/session";
const PREFERENCES = "GET /api/v1/settings/preferences";
const LIST = "GET /api/v1/imports";
const REPORT = "GET /api/v1/imports/:id";
const importId = "00000000-0000-4000-8000-000000000010";
const report = {
  counts: {
    contacts: 2,
    legacyCredentialsDiscarded: 0,
    missingFiles: 0,
    orphans: 1,
    unsupported: 3,
  },
  diagnostics: [],
};
const summary = (overrides: object = {}) => ({
  createdAt: "2026-08-23T10:00:00Z",
  importId,
  report,
  sourceProfile: "json_export",
  status: "dry_run",
  ...overrides,
});
const base = {
  [PREFERENCES]: jsonResponse({ preferences: preferences(), status: "ready" }),
  [SESSION]: jsonResponse(workspaceSession()),
};
const member = jsonResponse(
  workspaceSession({ member: { id: ids.member, role: "member" } }),
);
const state = () => element("[data-import-state]");

afterEach(() => sessionStorage.clear());

describe("IMPORT-001 import history", () => {
  const shell = () =>
    drawShell(
      "<main data-import-index><div data-import-history-surface></div></main>",
    );
  const mount = () => mountSettled(() => mountImportHistory());

  it("does nothing without its region", async () => {
    drawShell("<p>Other page</p>");
    const api = stubApi();
    await mount();
    expect(api.calls()).toEqual([]);
    expect(IMPORT_HISTORY_ISLAND).toBe("settings-import-history");
  });

  it("lists resumable import history, each linked to its report", async () => {
    shell();
    stubApi({
      ...base,
      [LIST]: jsonResponse({
        imports: [
          summary(),
          summary({
            importId: "00000000-0000-4000-8000-000000000011",
            report: { ...report, counts: { ...report.counts, contacts: 1 } },
            status: "completed",
          }),
          summary({
            importId: "00000000-0000-4000-8000-000000000012",
            status: "failed",
          }),
        ],
      }),
    });
    await mount();
    expect(state().textContent).toBe("3 imports.");
    const rows = within(element("[data-import-history]")).getAllByRole(
      "listitem",
    );
    expect(rows.map((row) => row.textContent)).toEqual([
      "2 contactsDry run · Aug 23, 2026, 10:00 AM",
      "1 contactCompleted · Aug 23, 2026, 10:00 AM",
      "2 contactsFailed · Aug 23, 2026, 10:00 AM",
    ]);
    expect(within(rows[0]!).getByRole("link").getAttribute("href")).toBe(
      `/app/settings/import/${importId}`,
    );
    await expectNoAxeViolations(document.body);
  });

  it("retries an unavailable history and says when there is none", async () => {
    shell();
    stubApi({
      ...base,
      [LIST]: [unreachable, jsonResponse({ imports: [summary()] })],
    });
    await mount();
    expect(state().textContent).toBe("Import history could not be loaded.");
    const retry = element("[data-import-retry]");
    expect(retry.hidden).toBe(false);
    act(() => {
      fireEvent.click(retry);
    });
    await waitFor(() => expect(state().textContent).toBe("1 import."));
    expect(retry.hidden).toBe(true);

    shell();
    stubApi({ ...base, [LIST]: jsonResponse({ imports: [] }) });
    await mount();
    expect(state().textContent).toBe("No imports yet.");
  });

  it("keeps member data hidden and says when the session is unconfirmed", async () => {
    shell();
    const api = stubApi({ [SESSION]: member });
    let unmount = await mount();
    expect(state().textContent).toBe(
      "Workspace import requires owner or administrator access.",
    );
    expect(document.querySelector("[data-import-history]")).toBeNull();
    expect(api.calls()).toEqual([SESSION]);
    unmount();

    shell();
    stubApi({ [SESSION]: unreachable });
    unmount = await mount();
    expect(state().textContent).toBe("Your session could not be confirmed.");
    unmount();
  });
});

describe("IMPORT-001 import report", () => {
  const shell = () =>
    drawShell(
      "<main data-import-report-page><div data-import-report-surface></div></main>",
    );
  const mount = (path = `/app/settings/import/${importId}`) =>
    mountSettled(() => mountImportReport(document, path));

  it("does nothing without its region", async () => {
    drawShell("<p>Other page</p>");
    const api = stubApi();
    await mount();
    expect(api.calls()).toEqual([]);
    expect(IMPORT_REPORT_ISLAND).toBe("settings-import-report");
  });

  it("reads the import its path names and shows its report", async () => {
    for (
      const [status, outcome] of [
        ["completed", "Completed"],
        ["dry_run", "Awaiting confirmation"],
        ["failed", "Failed"],
      ] as const
    ) {
      shell();
      const api = stubApi({
        [REPORT]: jsonResponse(summary({ status })),
        [SESSION]: jsonResponse(workspaceSession()),
      });
      const unmount = await mount();
      expect(state().textContent).toBe("Import report is current.");
      expect(element("[data-import-report]").hidden).toBe(false);
      expect(element("[data-import-status]").textContent).toBe(outcome);
      expect(element("[data-import-contacts]").textContent).toBe("2");
      expect(element("[data-import-unsupported]").textContent).toBe("3");
      expect(api.requests()[1]?.params).toEqual({ id: importId });
      unmount();
    }
    await expectNoAxeViolations(document.body);
  });

  it("says when the import is missing or unreadable, and retries", async () => {
    shell();
    stubApi({
      [REPORT]: [
        problemResponse(404),
        unreachable,
        jsonResponse(summary({ status: "completed" })),
      ],
      [SESSION]: jsonResponse(workspaceSession()),
    });
    await mount();
    expect(state().textContent).toBe(
      "This import does not exist in the active workspace.",
    );
    const retry = element("[data-import-retry]");
    act(() => {
      fireEvent.click(retry);
    });
    await waitFor(() =>
      expect(state().textContent).toBe("The import report could not be loaded.")
    );
    act(() => {
      fireEvent.click(retry);
    });
    await waitFor(() =>
      expect(screen.getByText("Completed", { exact: true })).toBeTruthy()
    );
    expect(retry.hidden).toBe(true);
  });

  it("refuses a path without an import, a member, and an unconfirmed session", async () => {
    for (
      const [answer, path, message] of [
        [
          jsonResponse(workspaceSession()),
          "/app/settings/import/not-an-import",
          "This import report is unavailable.",
        ],
        [
          member,
          `/app/settings/import/${importId}`,
          "Workspace import requires owner or administrator access.",
        ],
        [
          unreachable,
          `/app/settings/import/${importId}`,
          "Your session could not be confirmed.",
        ],
      ] as const
    ) {
      shell();
      const api = stubApi({ [SESSION]: answer });
      const unmount = await mount(path);
      expect(state().textContent).toBe(message);
      expect(element("[data-import-report]").hidden).toBe(true);
      expect(api.calls()).toEqual([SESSION]);
      unmount();
    }
  });

  it("reads the page's own path by default", async () => {
    shell();
    history.replaceState(null, "", `/app/settings/import/${importId}`);
    stubApi({
      [REPORT]: jsonResponse(summary()),
      [SESSION]: jsonResponse(workspaceSession()),
    });
    await mountSettled(() => mountImportReport());
    expect(state().textContent).toBe("Import report is current.");
    history.replaceState(null, "", "/");
  });
});
