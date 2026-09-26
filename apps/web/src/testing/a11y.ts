/**
 * Test support: axe-core over an island's markup.
 *
 * happy-dom has no layout engine, so axe runs the rules that read the
 * document's structure — names, roles, ARIA, labels, lists, landmarks inside
 * the island, duplicate ids — and skips the ones that need rendered boxes or
 * colours. Those (`LAYOUT_RULES`) stay with the end-to-end suites, which run
 * the full rule set in a real browser.
 */

import axe from "axe-core";

/** Rules that measure rendered geometry or colour, which happy-dom lacks. */
export const LAYOUT_RULES = [
  "color-contrast",
  "color-contrast-enhanced",
  "link-in-text-block",
  "scrollable-region-focusable",
  "target-size",
] as const;

/**
 * Rules about the whole page rather than one island: a fragment under test
 * has no `<html lang>`, title, or top-level landmarks of its own.
 */
export const PAGE_RULES = [
  "document-title",
  "html-has-lang",
  "landmark-one-main",
  "page-has-heading-one",
  "region",
] as const;

/** One violation, reduced to what a failure message needs. */
export interface AxeFinding {
  readonly id: string;
  readonly impact: string | null | undefined;
  readonly targets: readonly string[];
}

/** Runs axe's structural rules over `root` and answers what it found. */
export async function axeFindings(
  root: Element = document.body,
): Promise<readonly AxeFinding[]> {
  const rules = Object.fromEntries(
    [...LAYOUT_RULES, ...PAGE_RULES].map((id) => [id, { enabled: false }]),
  );
  const results = await axe.run(root, { resultTypes: ["violations"], rules });
  return results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    targets: violation.nodes.map((node) => node.target.join(" ")),
  }));
}

/** Fails with each finding when axe's structural rules find any in `root`. */
export async function expectNoAxeViolations(
  root: Element = document.body,
): Promise<void> {
  const findings = await axeFindings(root);
  if (findings.length === 0) return;
  throw new Error(
    `axe found ${findings.length} violation(s):\n${
      findings.map((finding) =>
        `- ${finding.id} (${finding.impact ?? "unknown"}): ${
          finding.targets.join(", ")
        }`
      ).join("\n")
    }`,
  );
}
