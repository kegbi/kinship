/**
 * The header's theme switch: one button that steps the member's theme from
 * System to Light to Dark and back, so the choice is one click from every
 * page instead of three levels into settings. It saves through the page's one
 * theme saver (`lib/theme.ts`), the same one the preferences page's select
 * uses, so the two never race and each shows what the other chose. The
 * button's `data-theme-choice` picks which glyph `shell.css` shows.
 */

import { type Theme, themeLabel, themeSaver } from "../../../lib/theme.ts";
import { showToast } from "../toasts/toasts.ts";

const NEXT: Readonly<Record<Theme, Theme>> = {
  dark: "system",
  light: "dark",
  system: "light",
};

function show(button: HTMLButtonElement, theme: Theme): void {
  button.dataset.themeChoice = theme;
  const label = `Theme: ${themeLabel(theme)}. Switch to ${
    themeLabel(NEXT[theme])
  } theme`;
  button.setAttribute("aria-label", label);
  button.title = label;
}

export async function mountThemeToggle(): Promise<void> {
  const button = document.querySelector<HTMLButtonElement>(
    "[data-theme-toggle]",
  );
  if (!button) return;
  const saver = await themeSaver();
  if (!saver) return;

  saver.subscribe((event) => {
    show(button, event.theme);
    if (event.phase === "failed") {
      showToast({ message: event.detail, tone: "error" });
    }
  });
  show(button, saver.current());
  button.addEventListener("click", () => saver.choose(NEXT[saver.current()]));
  button.disabled = false;
}
