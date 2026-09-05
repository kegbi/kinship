// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { WorkspaceSessionResolution } from "./workspace-context.ts";

const mocks = vi.hoisted(() => ({
  preferences: vi.fn(),
  save: vi.fn(),
  session: vi.fn(),
  revalidated: vi.fn(),
}));
vi.mock(
  "../../../../packages/contracts/generated/auth-client.ts",
  async (original) => ({
    ...await original<
      typeof import("../../../../packages/contracts/generated/auth-client.ts")
    >(),
    getMemberPreferences: mocks.preferences,
    updateMemberPreferences: mocks.save,
  }),
);
vi.mock("./workspace-context.ts", async (original) => ({
  ...await original<typeof import("./workspace-context.ts")>(),
  resolveWorkspaceSession: mocks.session,
  onSessionRevalidated: mocks.revalidated,
}));

import { mountApplicationShell } from "./app-shell.ts";
import { mountPreferenceSettings } from "./settings.ts";

function ready(
  workspaceId = "first",
  memberId = "member",
): WorkspaceSessionResolution {
  return {
    status: "ready",
    session: {
      status: "authenticated",
      principal: { userId: "user" },
      requiredLegalDocuments: [],
      workspace: { id: workspaceId, name: workspaceId },
      member: { id: memberId, role: "owner" },
      workspaces: [{ id: workspaceId, name: workspaceId }],
    },
  };
}

function preferences(fluidLayout: boolean) {
  return {
    ok: true,
    value: {
      status: "ready",
      preferences: {
        fluidLayout,
        contactNameOrder: "given_family_nickname",
        contactSortOrder: "given_name_asc",
        locale: "en",
        temperatureScale: "celsius",
        measurementSystem: "metric",
        effectiveTimezone: "UTC",
      },
    },
  };
}

function markup(): HTMLElement {
  document.body.innerHTML =
    `<section id="access-state"></section><div id="protected-shell" hidden><select id="workspace-switcher"></select><button id="member-sign-out"></button><div id="workspace-switcher-container"></div></div>`;
  return document.querySelector<HTMLElement>("#protected-shell")!;
}

function revalidate(resolution: WorkspaceSessionResolution): void {
  mocks.revalidated.mock.calls[0]![0](resolution);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => resolve = done);
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue(ready());
  mocks.preferences.mockResolvedValue(preferences(false));
  mocks.save.mockResolvedValue(preferences(true));
  document.body.dataset.pageId = "settings.preferences";
});

afterEach(() => {
  document.body.innerHTML = "";
  sessionStorage.clear();
});

describe("APR-010 membership application width", () => {
  it.each([true, false])(
    "loads the selected membership's fluidLayout=%s",
    async (fluid) => {
      const root = markup();
      mocks.preferences.mockResolvedValue(preferences(fluid));
      await mountApplicationShell(vi.fn());
      await vi.waitFor(() =>
        expect(root.dataset.fluidLayout).toBe(String(fluid))
      );
      expect(mocks.preferences).toHaveBeenCalledWith("first");
    },
  );

  it("reads preferences again on navigation instead of retaining the previous page's value", async () => {
    const oldRoot = markup();
    mocks.preferences.mockResolvedValueOnce(preferences(true));
    await mountApplicationShell(vi.fn());
    await vi.waitFor(() => expect(oldRoot.dataset.fluidLayout).toBe("true"));
    const newRoot = markup();
    await mountApplicationShell(vi.fn());
    await vi.waitFor(() => expect(newRoot.dataset.fluidLayout).toBe("false"));
    expect(mocks.preferences).toHaveBeenCalledTimes(2);
  });

  it("refreshes changed memberships and ignores the previous membership's late read", async () => {
    const root = markup();
    const pending = deferred<ReturnType<typeof preferences>>();
    mocks.preferences.mockReturnValueOnce(pending.promise);
    await mountApplicationShell(vi.fn());
    revalidate(ready("second", "other-member"));
    await vi.waitFor(() =>
      expect(mocks.preferences).toHaveBeenCalledWith("second")
    );
    pending.resolve(preferences(true));
    await pending.promise;
    await vi.waitFor(() => expect(root.dataset.fluidLayout).toBe("false"));
  });

  it("keeps a membership's width when only workspace presentation is revalidated", async () => {
    const root = markup();
    mocks.preferences.mockResolvedValue(preferences(true));
    await mountApplicationShell(vi.fn());
    await vi.waitFor(() => expect(root.dataset.fluidLayout).toBe("true"));
    revalidate(ready());
    expect(mocks.preferences).toHaveBeenCalledTimes(1);
    expect(root.dataset.fluidLayout).toBe("true");
  });

  it.each(["access-lost", "forbidden"])(
    "clears width on %s even when an old read completes",
    async (state) => {
      const root = markup();
      const pending = deferred<ReturnType<typeof preferences>>();
      mocks.preferences.mockReturnValueOnce(pending.promise);
      await mountApplicationShell(vi.fn());
      if (state === "access-lost") revalidate({ status: "access-lost" });
      else {
        document.body.dataset.pageId = "settings.workspace";
        const resolution = ready();
        if (resolution.status === "ready") {
          revalidate({
            ...resolution,
            session: {
              ...resolution.session,
              member: { id: "member", role: "member" },
            },
          });
        }
      }
      pending.resolve(preferences(true));
      await pending.promise;
      await vi.waitFor(() => expect(root.dataset.fluidLayout).toBe("false"));
      expect(root.hidden).toBe(true);
    },
  );

  it.each(["response", "network"])(
    "uses constrained width when the next membership read fails: %s",
    async (failure) => {
      const root = markup();
      mocks.preferences.mockResolvedValueOnce(preferences(true));
      await mountApplicationShell(vi.fn());
      await vi.waitFor(() => expect(root.dataset.fluidLayout).toBe("true"));
      if (failure === "network") {
        mocks.preferences.mockRejectedValueOnce(new Error("offline"));
      } else {mocks.preferences.mockResolvedValueOnce({
          ok: false,
          problem: { status: 503 },
        });}
      revalidate(ready("second"));
      await vi.waitFor(() => expect(root.dataset.fluidLayout).toBe("false"));
      expect(root.hidden).toBe(false);
    },
  );

  it("drops late saves after access loss and late reads after the page is removed", async () => {
    const root = markup();
    mocks.preferences.mockResolvedValueOnce(preferences(true));
    await mountApplicationShell(vi.fn());
    await vi.waitFor(() => expect(root.dataset.fluidLayout).toBe("true"));
    root.dispatchEvent(
      new CustomEvent("kinship:member-layout-saved", {
        detail: { workspaceId: "other", fluidLayout: false },
      }),
    );
    expect(root.dataset.fluidLayout).toBe("true");
    revalidate({ status: "access-lost" });
    root.dispatchEvent(
      new CustomEvent("kinship:member-layout-saved", {
        detail: { workspaceId: "first", fluidLayout: true },
      }),
    );
    expect(root.dataset.fluidLayout).toBe("false");
    const nextRoot = markup();
    const pending = deferred<ReturnType<typeof preferences>>();
    mocks.preferences.mockReturnValueOnce(pending.promise);
    await mountApplicationShell(vi.fn());
    nextRoot.remove();
    pending.resolve(preferences(true));
    await pending.promise;
    await Promise.resolve();
    expect(nextRoot.dataset.fluidLayout).toBe("false");
  });

  it.each([true, false])(
    "applies only successfully saved preferences (success=%s), ahead of a slow initial read",
    async (success) => {
      const root = markup();
      const formMarkup = readFileSync(
        "apps/web/src/pages/app/settings/preferences.astro",
        "utf8",
      )
        .match(/<form id="preferences-form"[\s\S]*?<\/form>/)![0];
      root.insertAdjacentHTML("beforeend", formMarkup);
      const pending = deferred<ReturnType<typeof preferences>>();
      mocks.preferences.mockReturnValueOnce(pending.promise)
        .mockResolvedValueOnce(preferences(false));
      if (!success) {
        mocks.save.mockResolvedValueOnce({
          ok: false,
          problem: { status: 503 },
        });
      }
      await mountApplicationShell(vi.fn());
      await mountPreferenceSettings();
      const checkbox = root.querySelector<HTMLInputElement>(
        '[name="fluidLayout"]',
      )!;
      checkbox.click();
      expect(root.dataset.fluidLayout).not.toBe("true");
      root.querySelector("form")!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await vi.waitFor(() =>
        expect(root.querySelector("#settings-status")?.textContent)
          .toBe(
            success ? "Preferences saved." : "Preferences could not be saved.",
          )
      );
      expect(mocks.save).toHaveBeenCalledWith(
        expect.objectContaining({ fluidLayout: true }),
        "first",
      );
      if (success) expect(root.dataset.fluidLayout).toBe("true");
      pending.resolve(preferences(false));
      await pending.promise;
      await vi.waitFor(() =>
        expect(root.dataset.fluidLayout).toBe(String(success))
      );
    },
  );
});
