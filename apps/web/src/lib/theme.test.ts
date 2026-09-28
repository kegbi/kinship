// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  onSessionRevalidated: vi.fn(),
  resolveWorkspaceSession: vi.fn(),
  saveMemberUiState: vi.fn(),
  updateCachedSessionUiState: vi.fn(),
}));

vi.mock("./workspace-context.ts", () => ({
  onSessionRevalidated: mocks.onSessionRevalidated,
  resolveWorkspaceSession: mocks.resolveWorkspaceSession,
  updateCachedSessionUiState: mocks.updateCachedSessionUiState,
}));
vi.mock("../../../../packages/contracts/generated/auth-client.ts", () => ({
  saveMemberUiState: mocks.saveMemberUiState,
}));

function ready(theme?: "system" | "light" | "dark") {
  return {
    session: {
      uiState: theme === undefined ? undefined : { theme },
      workspace: { id: "workspace-a", name: "Trusted circle" },
    },
    status: "ready",
  } as const;
}

async function loadTheme() {
  return await import("./theme.ts");
}

beforeEach(() => {
  vi.resetModules();
  // Implementations too, so no test inherits another's answers.
  vi.resetAllMocks();
  document.documentElement.removeAttribute("data-theme");
  document.head.innerHTML = `
    <meta name="theme-color" media="(prefers-color-scheme: light)" content="light-original" />
    <meta name="theme-color" media="(prefers-color-scheme: dark)" content="dark-original" />
  `;
  document.body.innerHTML = "";
  localStorage.clear();
  mocks.resolveWorkspaceSession.mockResolvedValue(ready());
  vi.stubGlobal(
    "getComputedStyle",
    vi.fn(() => ({
      getPropertyValue: () =>
        document.documentElement.dataset.theme === "dark"
          ? "dark-surface"
          : "light-surface",
    })),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("explicit application theme", () => {
  it("applies forced themes and restores system-owned DOM state", async () => {
    const { applyTheme } = await loadTheme();
    const metaContents = () =>
      Array.from(
        document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'),
        (meta) => meta.content,
      );

    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("kinship.theme")).toBe("dark");
    expect(metaContents()).toEqual(["dark-surface", "dark-surface"]);

    applyTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("kinship.theme")).toBe("light");
    expect(metaContents()).toEqual(["light-surface", "light-surface"]);

    applyTheme("system");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(localStorage.getItem("kinship.theme")).toBeNull();
    expect(metaContents()).toEqual(["light-original", "dark-original"]);
  });

  it("still reconciles the DOM when local storage is disabled", async () => {
    const { applyTheme } = await loadTheme();
    // A stand-in, not a spy on `Storage.prototype`: happy-dom binds a
    // storage method to the instance the first time it is read, so a
    // prototype spy works or leaks depending on which test read it first.
    const disabled = vi.fn(() => {
      throw new Error("storage disabled");
    });
    vi.stubGlobal("localStorage", {
      getItem: () => "dark",
      removeItem: disabled,
      setItem: disabled,
    });

    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");

    applyTheme("system");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(disabled).toHaveBeenCalledTimes(2);
  });

  it("lets durable session state repair stale cache on resolution and revalidation", async () => {
    localStorage.setItem("kinship.theme", "dark");
    document.documentElement.dataset.theme = "dark";
    mocks.resolveWorkspaceSession.mockResolvedValue(ready());
    let revalidate!: (resolution: ReturnType<typeof ready>) => void;
    mocks.onSessionRevalidated.mockImplementation((handler) => {
      revalidate = handler;
    });
    const { mountThemeSync } = await loadTheme();

    await mountThemeSync();
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(localStorage.getItem("kinship.theme")).toBeNull();

    revalidate(ready("light"));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("kinship.theme")).toBe("light");
  });

  it("leaves first-paint state untouched when session resolution is not ready", async () => {
    localStorage.setItem("kinship.theme", "dark");
    document.documentElement.dataset.theme = "dark";
    mocks.resolveWorkspaceSession.mockResolvedValue({ status: "unavailable" });
    const { mountThemeSync } = await loadTheme();

    await mountThemeSync();

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("kinship.theme")).toBe("dark");
    expect(mocks.onSessionRevalidated).toHaveBeenCalledOnce();
  });

  it("enables the preference only after session resolution and saves immediately", async () => {
    document.body.innerHTML = `
      <label>Theme<select id="theme-preference" disabled>
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select></label>
      <p id="theme-status"></p>
    `;
    mocks.resolveWorkspaceSession.mockResolvedValue(ready("system"));
    mocks.saveMemberUiState.mockResolvedValue({
      ok: true,
      value: { uiState: { theme: "dark" } },
    });
    const { mountThemePreferenceControl } = await loadTheme();

    await mountThemePreferenceControl();
    const select = document.querySelector<HTMLSelectElement>(
      "#theme-preference",
    )!;
    expect(select.value).toBe("system");
    expect(select.disabled).toBe(false);

    select.value = "dark";
    select.dispatchEvent(new Event("change"));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(select.disabled).toBe(false);
    await vi.waitFor(() =>
      expect(document.querySelector("#theme-status")?.textContent).toBe(
        "Dark theme saved.",
      )
    );
    expect(mocks.saveMemberUiState).toHaveBeenCalledWith(
      { theme: "dark" },
      "workspace-a",
    );
    expect(mocks.updateCachedSessionUiState).toHaveBeenCalledWith({
      theme: "dark",
    });
    expect(select.disabled).toBe(false);
  });

  it("coalesces rapid changes without disabling or overlapping saves", async () => {
    document.body.innerHTML = `
      <label>Theme<select id="theme-preference" disabled>
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select></label>
      <p id="theme-status"></p>
    `;
    type SaveSuccess = {
      readonly ok: true;
      readonly value: {
        readonly uiState: { readonly theme: "light" | "dark" };
      };
    };
    let resolveFirst!: (value: SaveSuccess) => void;
    let resolveSecond!: (value: SaveSuccess) => void;
    const firstSave = new Promise<SaveSuccess>((resolve) => {
      resolveFirst = resolve;
    });
    const secondSave = new Promise<SaveSuccess>((resolve) => {
      resolveSecond = resolve;
    });
    mocks.resolveWorkspaceSession.mockResolvedValue(ready("system"));
    mocks.saveMemberUiState
      .mockReturnValueOnce(firstSave)
      .mockReturnValueOnce(secondSave);
    const { mountThemePreferenceControl } = await loadTheme();
    await mountThemePreferenceControl();
    const select = document.querySelector<HTMLSelectElement>(
      "#theme-preference",
    )!;
    select.focus();

    select.value = "light";
    select.dispatchEvent(new Event("change"));
    expect(select.disabled).toBe(false);
    expect(document.activeElement).toBe(select);
    expect(mocks.saveMemberUiState).toHaveBeenCalledTimes(1);

    select.value = "dark";
    select.dispatchEvent(new Event("change"));
    expect(select.disabled).toBe(false);
    expect(document.activeElement).toBe(select);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(mocks.saveMemberUiState).toHaveBeenCalledTimes(1);

    resolveFirst({ ok: true, value: { uiState: { theme: "light" } } });
    await vi.waitFor(() =>
      expect(mocks.saveMemberUiState).toHaveBeenCalledTimes(2)
    );
    expect(mocks.saveMemberUiState.mock.calls.map(([input]) => input)).toEqual([
      { theme: "light" },
      { theme: "dark" },
    ]);
    expect(document.querySelector("#theme-status")?.textContent).toBe(
      "Saving Dark theme…",
    );
    expect(mocks.updateCachedSessionUiState).not.toHaveBeenCalled();

    resolveSecond({ ok: true, value: { uiState: { theme: "dark" } } });
    await vi.waitFor(() =>
      expect(document.querySelector("#theme-status")?.textContent).toBe(
        "Dark theme saved.",
      )
    );
    expect(select.disabled).toBe(false);
    expect(document.activeElement).toBe(select);
    expect(select.value).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(mocks.updateCachedSessionUiState).toHaveBeenCalledOnce();
    expect(mocks.updateCachedSessionUiState).toHaveBeenCalledWith({
      theme: "dark",
    });
  });

  it("reverts a failed preference save to the durable session theme", async () => {
    document.body.innerHTML = `
      <select id="theme-preference" disabled>
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
      <p id="theme-status"></p>
    `;
    document.documentElement.dataset.theme = "light";
    localStorage.setItem("kinship.theme", "light");
    mocks.resolveWorkspaceSession.mockResolvedValue(ready("light"));
    mocks.saveMemberUiState.mockRejectedValue(new Error("offline"));
    const { mountThemePreferenceControl } = await loadTheme();
    await mountThemePreferenceControl();
    const select = document.querySelector<HTMLSelectElement>(
      "#theme-preference",
    )!;

    select.value = "dark";
    select.dispatchEvent(new Event("change"));
    expect(document.documentElement.dataset.theme).toBe("dark");
    await vi.waitFor(() => expect(select.value).toBe("light"));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("kinship.theme")).toBe("light");
    expect(document.querySelector("#theme-status")?.textContent).toBe(
      "Your theme preference could not be saved.",
    );
  });

  it("announces a server preference failure and restores system mode", async () => {
    document.body.innerHTML = `
      <select id="theme-preference" disabled>
        <option value="system">System</option>
        <option value="light">Light</option>
      </select>
      <p id="theme-status"></p>
    `;
    mocks.resolveWorkspaceSession.mockResolvedValue(ready());
    mocks.saveMemberUiState.mockResolvedValue({
      ok: false,
      problem: { detail: "The theme service refused the change." },
    });
    const { mountThemePreferenceControl } = await loadTheme();
    await mountThemePreferenceControl();
    const select = document.querySelector<HTMLSelectElement>(
      "#theme-preference",
    )!;

    select.value = "light";
    select.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(select.value).toBe("system"));
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(localStorage.getItem("kinship.theme")).toBeNull();
    expect(document.querySelector("#theme-status")?.textContent).toBe(
      "The theme service refused the change.",
    );
  });

  it("keeps a missing or unavailable preference control disabled", async () => {
    const { mountThemePreferenceControl } = await loadTheme();
    await expect(mountThemePreferenceControl()).resolves.toBeUndefined();

    document.body.innerHTML = `
      <select id="theme-preference" disabled><option value="system">System</option></select>
      <p id="theme-status"></p>
    `;
    mocks.resolveWorkspaceSession.mockResolvedValue({ status: "access-lost" });
    await mountThemePreferenceControl();
    expect(
      document.querySelector<HTMLSelectElement>("#theme-preference")?.disabled,
    )
      .toBe(true);
    expect(document.querySelector("#theme-status")?.textContent).toContain(
      "could not be loaded",
    );
  });
});
