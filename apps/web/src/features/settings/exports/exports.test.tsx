// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { expectNoAxeViolations } from "../../../testing/a11y.ts";
import {
  deferred,
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
import {
  drawShell,
  element,
  mountPending,
  mountSettled,
} from "../../../testing/render.tsx";
import { EXPORTS_ISLAND, mountExports } from "./exports.tsx";

const SESSION = "GET /api/v1/session";
const PREFERENCES = "GET /api/v1/settings/preferences";
const LIST = "GET /api/v1/exports";
const CREATE = "POST /api/v1/exports";
const DOWNLOAD = "POST /api/v1/exports/:id/downloads";
const exportId = "00000000-0000-4000-8000-000000000004";
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
const failedRun = {
  ...run,
  exportId: "00000000-0000-4000-8000-000000000008",
  manifest: {
    ...run.manifest,
    rows: { people: { count: 2, sha256: "c".repeat(64) } },
  },
  status: "failed",
};
const listed = (...exports: object[]) => jsonResponse({ exports });
const base = {
  [PREFERENCES]: jsonResponse({ preferences: preferences(), status: "ready" }),
  [SESSION]: jsonResponse(workspaceSession()),
};

function shell(): void {
  drawShell(
    "<main data-export-settings><div data-export-surface></div></main>",
  );
}

const mount = () => mountSettled(() => mountExports());
const state = () => element("[data-export-state]");
const create = () =>
  screen.getByRole<HTMLButtonElement>("button", { name: "Create export" });

function click(target: HTMLElement): void {
  act(() => {
    fireEvent.click(target);
  });
}

afterEach(() => sessionStorage.clear());

describe("EXPORT-001 settings export", () => {
  it("does nothing when the export surface is absent", async () => {
    drawShell("<p>Other page</p>");
    const api = stubApi();
    await mount();
    expect(api.calls()).toEqual([]);
    expect(EXPORTS_ISLAND).toBe("settings-exports");
  });

  it("serializes creation, refreshes history, and mints a short-lived download", async () => {
    shell();
    const created = deferred<Response>();
    const api = stubApi({
      ...base,
      [CREATE]: created.promise,
      [DOWNLOAD]: jsonResponse({
        expiresAt: "2026-08-23T10:05:00.000Z",
        href: `/api/v1/exports/${exportId}/download?token=secret`,
        status: "ready",
      }, 201),
      [LIST]: [listed(), listed(run)],
    });
    await mount();
    expect(state().textContent).toBe("No exports yet.");
    await expectNoAxeViolations(document.body);
    click(create());
    expect(state().textContent).toBe("Creating portable export…");
    expect(create().disabled).toBe(true);
    click(create());
    await act(async () => {
      created.resolve(jsonResponse(run, 201));
      await created.promise;
    });
    await waitFor(() =>
      expect(state().textContent).toBe("Export completed for 1 person.")
    );
    expect(create().disabled).toBe(false);
    const history = element("[data-export-history]");
    expect(history.textContent).toContain(
      "1 personCompleted · Aug 23, 2026, 10:00 AM",
    );
    click(screen.getByRole("button", { name: "Prepare download" }));
    expect(state().textContent).toBe("Creating a short-lived download…");
    const link = await screen.findByRole<HTMLAnchorElement>("link", {
      name: "Download export",
    });
    expect(link.getAttribute("href")).toBe(
      `/api/v1/exports/${exportId}/download?token=secret`,
    );
    expect(link.hasAttribute("download")).toBe(true);
    expect(document.activeElement).toBe(link);
    expect(state().textContent).toBe(
      "Download ready until Aug 23, 2026, 10:05 AM.",
    );
    expect(api.calls()).toEqual([
      SESSION,
      PREFERENCES,
      LIST,
      CREATE,
      LIST,
      `POST /api/v1/exports/${exportId}/downloads`,
    ]);
  });

  it("keeps creation unavailable until its action is wired", async () => {
    expect(
      readFileSync("apps/web/src/pages/app/settings/export.astro", "utf8"),
    ).toMatch(/<button data-export-create[^>]*\sdisabled>/);
    shell();
    const session = deferred<Response>();
    stubApi({ ...base, [LIST]: listed(), [SESSION]: session.promise });
    const settled = mountPending(() => mountExports());
    expect(create().disabled).toBe(true);
    await act(async () => {
      session.resolve(jsonResponse(workspaceSession()));
      await settled;
    });
    expect(create().disabled).toBe(false);
  });

  it("shows the admin-only state to a member without loading history", async () => {
    shell();
    const api = stubApi({
      [SESSION]: jsonResponse(
        workspaceSession({ member: { id: ids.member, role: "member" } }),
      ),
    });
    await mount();
    expect(state().textContent).toBe(
      "Workspace export requires owner or administrator access.",
    );
    expect(document.querySelector("[data-export-history]")).toBeNull();
    expect(document.querySelector("[data-export-create]")).toBeNull();
    expect(api.calls()).toEqual([SESSION]);
  });

  it("renders session, history, retry, and download failure states honestly", async () => {
    shell();
    stubApi({ [SESSION]: unreachable });
    let unmount = await mount();
    expect(state().textContent).toBe("Your session could not be confirmed.");
    expect(create().disabled).toBe(true);
    unmount();

    shell();
    stubApi({
      ...base,
      [DOWNLOAD]: [
        problemResponse(503, { detail: "Token service down" }),
        unreachable,
      ],
      [LIST]: [unreachable, listed(run, failedRun)],
    });
    unmount = await mount();
    expect(state().textContent).toBe("Export history could not be loaded.");
    const retry = element("[data-export-retry]");
    expect(retry.hidden).toBe(false);
    click(retry);
    await waitFor(() => expect(state().textContent).toBe("2 exports."));
    expect(retry.hidden).toBe(true);
    expect(element("[data-export-history]").textContent).toContain(
      "2 personsFailed ·",
    );
    expect(screen.getAllByRole("button", { name: "Prepare download" }))
      .toHaveLength(1);
    const prepare = screen.getByRole<HTMLButtonElement>("button", {
      name: "Prepare download",
    });
    click(prepare);
    expect(prepare.disabled).toBe(true);
    await waitFor(() => expect(state().textContent).toBe("Token service down"));
    expect(prepare.disabled).toBe(false);
    click(prepare);
    await waitFor(() =>
      expect(state().textContent).toBe("A download could not be prepared.")
    );
    unmount();
  });

  it("keeps one creation owner and restores the action after a refusal or no answer", async () => {
    shell();
    const api = stubApi({
      ...base,
      [CREATE]: [
        problemResponse(503, { detail: "Storage offline" }),
        unreachable,
      ],
      [LIST]: listed(),
    });
    await mount();
    click(create());
    await waitFor(() => expect(state().textContent).toBe("Storage offline"));
    expect(create().disabled).toBe(false);
    click(create());
    await waitFor(() =>
      expect(state().textContent).toBe("The export could not be completed.")
    );
    expect(create().disabled).toBe(false);
    expect(api.calls().filter((call) => call === CREATE)).toHaveLength(2);
  });
});
