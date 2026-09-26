/**
 * Label and status-line helpers the vanilla rail blocks share until they
 * migrate (GAP-031). The rail's counts and the hero's vitals are the
 * islands' now (`features/person/profile-summary.ts`).
 */

/** Visible verb plus screen-reader context, so rows stay compact but fully named. */
export function setQuietLabel(
  button: HTMLButtonElement,
  action: string,
  context: string,
): void {
  const suffix = document.createElement("span");
  suffix.className = "sr-only";
  suffix.textContent = ` ${context}`;
  button.replaceChildren(action, suffix);
}

/**
 * Publish a rail block's status line. Plain summaries ("4 saved.") stay in the
 * accessibility tree but collapse visually once the block lists its rows;
 * feedback (errors, confirmations, loading) always shows.
 */
export function setRailState(
  state: HTMLElement,
  text: string,
  kind: "summary" | "feedback" = "feedback",
): void {
  state.textContent = text;
  if (kind === "summary") state.dataset.railSummary = "true";
  else delete state.dataset.railSummary;
}
