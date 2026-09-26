import type { Page } from "@playwright/test";

/**
 * Records every Content-Security-Policy refusal the page reports (GAP-040).
 *
 * The gateway allows inline scripts only by hash, so a blocked theme script,
 * inline handler, or injected script shows up as a console report rather than
 * a failure. A spec asserts the list is still empty after its pages ran.
 */
export function recordPolicyViolations(page: Page): string[] {
  const violations: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (/Content[ -]Security[ -]Policy/i.test(text)) violations.push(text);
  });
  return violations;
}
