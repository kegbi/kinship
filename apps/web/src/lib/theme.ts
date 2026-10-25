import {
  type MemberUiState,
  saveMemberUiState,
} from "../../../../packages/contracts/generated/auth-client.ts";
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
  const uiState = resolution.session.uiState ?? {};
  applyTheme(uiState.theme ?? "system");
  // A theme saved elsewhere (another tab) becomes the saver's durable one.
  void pageSaver?.then((saver) => saver?.adopt(uiState));
}

export async function mountThemeSync(): Promise<void> {
  reconcileTheme(await resolveWorkspaceSession());
  onSessionRevalidated(reconcileTheme);
}

export function themeLabel(theme: Theme): string {
  return `${theme.charAt(0).toUpperCase()}${theme.slice(1)}`;
}

/** What one theme control hears from the page's single saver. */
export type ThemeSaveEvent =
  /** The session now holds `theme`, saved elsewhere; nothing to announce. */
  | { readonly phase: "adopted"; readonly theme: Theme }
  | { readonly phase: "saving"; readonly theme: Theme }
  | { readonly phase: "saved"; readonly theme: Theme }
  | {
    readonly detail: string;
    readonly phase: "failed";
    /** The durable theme the page went back to. */
    readonly theme: Theme;
  };

export interface ThemeSaver {
  /**
   * Takes the session's revalidated UI state as durable, unless a save of
   * this page's own is in flight (its answer will settle the theme).
   */
  adopt(uiState: MemberUiState): void;
  /** Applies `theme` at once and saves it behind any save in flight. */
  choose(theme: Theme): void;
  /** The theme the member chose last, saved or still saving. */
  current(): Theme;
  subscribe(listener: (event: ThemeSaveEvent) => void): void;
}

let pageSaver: Promise<ThemeSaver | undefined> | undefined;

/**
 * The page's one theme saver, shared by the header toggle and the
 * preferences select so their saves never overlap. Rapid changes coalesce:
 * at most one save is in flight, and only the latest choice follows it. A
 * failed save restores the last durable theme. Answers `undefined` when the
 * session has no workspace to save into.
 */
export function themeSaver(): Promise<ThemeSaver | undefined> {
  pageSaver ??= resolveWorkspaceSession().then((resolution) =>
    resolution.status === "ready" ? createSaver(resolution) : undefined
  );
  return pageSaver;
}

function createSaver(
  resolution: Extract<WorkspaceSessionResolution, { status: "ready" }>,
): ThemeSaver {
  const workspaceId = resolution.session.workspace.id;
  const listeners = new Set<(event: ThemeSaveEvent) => void>();
  const emit = (event: ThemeSaveEvent) => listeners.forEach((l) => l(event));
  let durableTheme: Theme = resolution.session.uiState?.theme ?? "system";
  let durableUiState = resolution.session.uiState ?? {};
  let chosen = durableTheme;
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
      saveInFlight = false;
      chosen = durableTheme;
      applyTheme(durableTheme);
      if (result?.ok) {
        updateCachedSessionUiState(result.value.uiState);
        emit({ phase: "saved", theme: durableTheme });
      } else {
        updateCachedSessionUiState(durableUiState);
        emit({
          detail: result?.problem.detail ??
            "Your theme preference could not be saved.",
          phase: "failed",
          theme: durableTheme,
        });
      }
      return;
    }
  };

  return {
    adopt(uiState) {
      if (saveInFlight) return;
      durableUiState = uiState;
      durableTheme = uiState.theme ?? "system";
      chosen = durableTheme;
      emit({ phase: "adopted", theme: durableTheme });
    },
    choose(theme) {
      chosen = theme;
      applyTheme(theme);
      emit({ phase: "saving", theme });
      if (saveInFlight) {
        pendingTheme = theme;
        return;
      }
      void drainThemeSaves(theme);
    },
    current: () => chosen,
    subscribe(listener) {
      listeners.add(listener);
    },
  };
}

export async function mountThemePreferenceControl(): Promise<void> {
  const select = document.querySelector<HTMLSelectElement>("#theme-preference");
  const status = document.querySelector<HTMLElement>("#theme-status");
  if (!select || !status) return;

  const saver = await themeSaver();
  if (!saver) {
    status.textContent = "Your theme preference could not be loaded.";
    return;
  }

  saver.subscribe((event) => {
    select.value = event.theme;
    if (event.phase === "adopted") return;
    status.textContent = event.phase === "saving"
      ? `Saving ${themeLabel(event.theme)} theme…`
      : event.phase === "saved"
      ? `${themeLabel(event.theme)} theme saved.`
      : event.detail;
  });
  select.value = saver.current();
  select.addEventListener("change", () => {
    saver.choose(select.value as Theme);
  });
  select.disabled = false;
  status.textContent = "";
}
