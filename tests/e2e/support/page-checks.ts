import { expect, type Page } from "@playwright/test";
import axe from "axe-core";

/*
 * Page-level checks shared by the specs: axe accessibility scans, loaded with
 * `page.evaluate(axe.source)` because the gateway's CSP allows no injected
 * script tag, and the Content-Security-Policy report guard.
 */

interface AxeNode {
  readonly target: unknown;
}

interface AxeViolation {
  readonly help: string;
  readonly id: string;
  readonly impact: string | null;
  readonly nodes: readonly AxeNode[];
}

/**
 * Loads axe into the page and returns the violations of a full scan, or, with
 * `runOnly`, of a scan limited to those tags, reported as help, id, impact,
 * and node targets.
 */
export async function runAxe(
  page: Page,
  options: { readonly runOnly?: readonly string[] } = {},
): Promise<unknown[]> {
  await page.evaluate(axe.source);
  const runOnly = options.runOnly;
  if (!runOnly) {
    return await page.evaluate(async () =>
      (await (globalThis as typeof globalThis & {
        axe: { run(): Promise<{ violations: unknown[] }> };
      }).axe.run()).violations
    );
  }
  return await page.evaluate(async (tags) => {
    const scanner = (
      window as typeof window & {
        axe: {
          run: (
            context: Document,
            options: { runOnly: readonly string[] },
          ) => Promise<{ violations: AxeViolation[] }>;
        };
      }
    ).axe;

    const result = await scanner.run(document, { runOnly: tags });
    return result.violations.map(({ help, id, impact, nodes }) => ({
      help,
      id,
      impact,
      targets: nodes.map((node) => node.target),
    }));
  }, runOnly);
}

/**
 * Expects an axe scan to report no violations. With `networkIdle`, it first
 * waits for the page's network to go idle; with `runOnly`, it scans only
 * those tags.
 */
export async function expectAccessible(
  page: Page,
  options: {
    readonly networkIdle?: boolean;
    readonly runOnly?: readonly string[];
  } = {},
): Promise<void> {
  if (options.networkIdle) await page.waitForLoadState("networkidle");
  expect(await runAxe(page, { runOnly: options.runOnly })).toEqual([]);
}

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
