import { saveMemberUiState } from "../../../../packages/contracts/generated/auth-client.ts";
import {
  onSessionRevalidated,
  resolveWorkspaceSession,
  updateCachedSessionUiState,
  type WorkspaceSessionResolution,
} from "./workspace-context.ts";

export type Theme = "system" | "light" | "dark";

const THEME_STORAGE_KEY = "kinship.theme";
const themeColorMetas = Array.from(
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'),
);
const originalThemeColors = themeColorMetas.map((meta) => meta.content);

export function applyTheme(theme: Theme): void {
  const forcedTheme = theme === "light" || theme === "dark" ? theme : undefined;
  if (forcedTheme) {
    document.documentElement.dataset.theme = forcedTheme;
  } else {
    document.documentElement.removeAttribute("data-theme");
  }

  try {
    if (forcedTheme) localStorage.setItem(THEME_STORAGE_KEY, forcedTheme);
    else localStorage.removeItem(THEME_STORAGE_KEY);
  } catch {
    // Disabled storage cannot prevent the in-document theme from changing.
  }

  if (forcedTheme) {
    const surface = getComputedStyle(document.documentElement)
      .getPropertyValue("--surface-page").trim();
    for (const meta of themeColorMetas) meta.content = surface;
  } else {
    themeColorMetas.forEach((meta, index) => {
      meta.content = originalThemeColors[index] ?? "";
    });
  }
}

function reconcileTheme(resolution: WorkspaceSessionResolution): void {
  if (resolution.status !== "ready") return;
  applyTheme(resolution.session.uiState?.theme ?? "system");
}

export async function mountThemeSync(): Promise<void> {
  reconcileTheme(await resolveWorkspaceSession());
  onSessionRevalidated(reconcileTheme);
}

function themeLabel(theme: Theme): string {
  return `${theme.charAt(0).toUpperCase()}${theme.slice(1)}`;
}

export async function mountThemePreferenceControl(): Promise<void> {
  const select = document.querySelector<HTMLSelectElement>("#theme-preference");
  const status = document.querySelector<HTMLElement>("#theme-status");
  if (!select || !status) return;

  const resolution = await resolveWorkspaceSession();
  if (resolution.status !== "ready") {
    status.textContent = "Your theme preference could not be loaded.";
    return;
  }

  const workspaceId = resolution.session.workspace.id;
  let durableTheme = resolution.session.uiState?.theme ?? "system";
  let durableUiState = resolution.session.uiState ?? {};
  let pendingTheme: Theme | undefined;
  let saveInFlight = false;
  const drainThemeSaves = async (theme: Theme): Promise<void> => {
    saveInFlight = true;
    let savingTheme = theme;
    while (true) {
      pendingTheme = undefined;
      const result = await saveMemberUiState(
        { theme: savingTheme },
        workspaceId,
      ).catch(() => undefined);
      if (result?.ok) {
        durableUiState = result.value.uiState;
        durableTheme = result.value.uiState.theme ?? "system";
      }

      const nextTheme = pendingTheme;
      if (nextTheme !== undefined && nextTheme !== savingTheme) {
        savingTheme = nextTheme;
        continue;
      }

      pendingTheme = undefined;
      if (result?.ok) {
        updateCachedSessionUiState(result.value.uiState);
        select.value = durableTheme;
        applyTheme(durableTheme);
        status.textContent = `${themeLabel(durableTheme)} theme saved.`;
      } else {
        updateCachedSessionUiState(durableUiState);
        applyTheme(durableTheme);
        select.value = durableTheme;
        status.textContent = result?.problem.detail ??
          "Your theme preference could not be saved.";
      }
      saveInFlight = false;
      return;
    }
  };

  select.value = durableTheme;
  select.addEventListener("change", () => {
    const selectedTheme = select.value as Theme;
    applyTheme(selectedTheme);
    pendingTheme = selectedTheme;
    status.textContent = `Saving ${themeLabel(selectedTheme)} theme…`;
    if (saveInFlight) return;
    pendingTheme = undefined;
    void drainThemeSaves(selectedTheme);
  });
  select.disabled = false;
  status.textContent = "";
}
