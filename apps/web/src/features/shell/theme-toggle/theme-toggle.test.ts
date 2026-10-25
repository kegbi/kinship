// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  onSessionRevalidated: vi.fn(),
  resolveWorkspaceSession: vi.fn(),
  saveMemberUiState: vi.fn(),
  showToast: vi.fn(),
  updateCachedSessionUiState: vi.fn(),
}));

vi.mock("../../../lib/workspace-context.ts", () => ({
  onSessionRevalidated: mocks.onSessionRevalidated,
  resolveWorkspaceSession: mocks.resolveWorkspaceSession,
  updateCachedSessionUiState: mocks.updateCachedSessionUiState,
}));
vi.mock(
  "../../../../../../packages/contracts/generated/auth-client.ts",
  () => ({
    saveMemberUiState: mocks.saveMemberUiState,
  }),
);
vi.mock("../toasts/toasts.ts", () => ({ showToast: mocks.showToast }));

function ready(theme?: "system" | "light" | "dark") {
  return {
    session: {
      uiState: theme === undefined ? undefined : { theme },
      workspace: { id: "workspace-a", name: "Trusted circle" },
    },
    status: "ready",
  } as const;
}

function saved(theme: "system" | "light" | "dark") {
  return { ok: true, value: { uiState: { theme } } } as const;
}

const toggle = () =>
  document.querySelector<HTMLButtonElement>("[data-theme-toggle]")!;

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  document.documentElement.removeAttribute("data-theme");
  localStorage.clear();
  document.head.innerHTML = "";
  document.body.innerHTML = `
    <button data-theme-toggle type="button" aria-label="Theme" disabled></button>
  `;
  vi.stubGlobal(
    "getComputedStyle",
    vi.fn(() => ({ getPropertyValue: () => "surface" })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("header theme toggle", () => {
  it("shows the member's saved theme once the session resolves", async () => {
    mocks.resolveWorkspaceSession.mockResolvedValue(ready("dark"));
    const { mountThemeToggle } = await import("./theme-toggle.ts");

    expect(toggle().disabled).toBe(true);
    await mountThemeToggle();

    expect(toggle().disabled).toBe(false);
    expect(toggle().dataset.themeChoice).toBe("dark");
    expect(toggle().getAttribute("aria-label")).toBe(
      "Theme: Dark. Switch to System theme",
    );
  });

  it("cycles system, light, and dark, saving each choice", async () => {
    mocks.resolveWorkspaceSession.mockResolvedValue(ready());
    mocks.saveMemberUiState.mockImplementation(async (input) =>
      saved(input.theme)
    );
    const { mountThemeToggle } = await import("./theme-toggle.ts");
    await mountThemeToggle();
    expect(toggle().dataset.themeChoice).toBe("system");

    toggle().click();
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(toggle().dataset.themeChoice).toBe("light");
    await vi.waitFor(() =>
      expect(mocks.updateCachedSessionUiState).toHaveBeenLastCalledWith({
        theme: "light",
      })
    );

    toggle().click();
    expect(document.documentElement.dataset.theme).toBe("dark");
    await vi.waitFor(() =>
      expect(mocks.updateCachedSessionUiState).toHaveBeenLastCalledWith({
        theme: "dark",
      })
    );

    toggle().click();
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    await vi.waitFor(() =>
      expect(mocks.saveMemberUiState).toHaveBeenLastCalledWith(
        { theme: "system" },
        "workspace-a",
      )
    );
    expect(toggle().dataset.themeChoice).toBe("system");
  });

  it("reverts and explains a choice the server refused", async () => {
    mocks.resolveWorkspaceSession.mockResolvedValue(ready("light"));
    mocks.saveMemberUiState.mockRejectedValue(new Error("offline"));
    const { mountThemeToggle } = await import("./theme-toggle.ts");
    await mountThemeToggle();

    toggle().click();
    expect(document.documentElement.dataset.theme).toBe("dark");
    await vi.waitFor(() => expect(toggle().dataset.themeChoice).toBe("light"));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(mocks.showToast).toHaveBeenCalledWith({
      message: "Your theme preference could not be saved.",
      tone: "error",
    });
  });

  it("follows a theme another tab saved once the session revalidates", async () => {
    mocks.resolveWorkspaceSession.mockResolvedValue(ready("system"));
    let revalidate!: (resolution: ReturnType<typeof ready>) => void;
    mocks.onSessionRevalidated.mockImplementation((handler) => {
      revalidate = handler;
    });
    mocks.saveMemberUiState.mockImplementation(async (input) =>
      saved(input.theme)
    );
    const { mountThemeToggle } = await import("./theme-toggle.ts");
    const { mountThemeSync } = await import("../../../lib/theme.ts");
    await mountThemeSync();
    await mountThemeToggle();

    revalidate(ready("dark"));
    await vi.waitFor(() => expect(toggle().dataset.themeChoice).toBe("dark"));
    expect(document.documentElement.dataset.theme).toBe("dark");

    // The next step starts from the theme the member now has.
    toggle().click();
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    await vi.waitFor(() =>
      expect(mocks.saveMemberUiState).toHaveBeenLastCalledWith(
        { theme: "system" },
        "workspace-a",
      )
    );
  });

  it("stays disabled without a workspace session", async () => {
    mocks.resolveWorkspaceSession.mockResolvedValue({ status: "access-lost" });
    const { mountThemeToggle } = await import("./theme-toggle.ts");
    await mountThemeToggle();
    expect(toggle().disabled).toBe(true);
  });

  it("keeps the preferences select in step with the header", async () => {
    document.body.insertAdjacentHTML(
      "beforeend",
      `<select id="theme-preference" disabled>
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select><p id="theme-status"></p>`,
    );
    mocks.resolveWorkspaceSession.mockResolvedValue(ready("system"));
    mocks.saveMemberUiState.mockImplementation(async (input) =>
      saved(input.theme)
    );
    const { mountThemeToggle } = await import("./theme-toggle.ts");
    const { mountThemePreferenceControl } = await import(
      "../../../lib/theme.ts"
    );
    await mountThemeToggle();
    await mountThemePreferenceControl();
    const select = document.querySelector<HTMLSelectElement>(
      "#theme-preference",
    )!;

    toggle().click();
    expect(select.value).toBe("light");
    await vi.waitFor(() =>
      expect(document.querySelector("#theme-status")?.textContent).toBe(
        "Light theme saved.",
      )
    );

    select.value = "dark";
    select.dispatchEvent(new Event("change"));
    expect(toggle().dataset.themeChoice).toBe("dark");
    await vi.waitFor(() =>
      expect(mocks.saveMemberUiState).toHaveBeenLastCalledWith(
        { theme: "dark" },
        "workspace-a",
      )
    );
    expect(mocks.saveMemberUiState).toHaveBeenCalledTimes(2);
  });
});
