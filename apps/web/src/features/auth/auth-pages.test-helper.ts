/**
 * Test support for the public auth pages (GAP-033): each suite draws the
 * page's own `<main>` markup, read from its `.astro` source, so the markup a
 * module toggles and clones is the markup the page ships.
 */

import { readFileSync } from "node:fs";
import { drawShell } from "../../testing/render.tsx";

/** The `<main>` element of `pages/<page>.astro`, exactly as written. */
export function pageMain(page: string): string {
  const source = readFileSync(`apps/web/src/pages/${page}.astro`, "utf8");
  const main = /<main\b[\s\S]*?<\/main>/.exec(source)?.[0];
  if (!main) throw new Error(`pages/${page}.astro draws no <main>`);
  if (main.includes("{")) {
    throw new Error(`pages/${page}.astro's <main> carries an expression`);
  }
  return main;
}

/** Draws `pages/<page>.astro`'s `<main>` as the document body. */
export function drawPage(page: string): HTMLElement {
  return drawShell(pageMain(page));
}

/** Types `value` into `field`, as a reader would. */
export function fill(field: HTMLInputElement, value: string): void {
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
}
