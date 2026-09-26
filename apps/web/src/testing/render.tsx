/**
 * Test support: putting an island on the page and taking it off again.
 *
 * An island reaches the page in one of the two modes ADR 0006 allows. A
 * section of a static shell is mounted into markup the shell already drew
 * (`drawShell`, then `mountSettled` or `mountPending` around the section's
 * own mount function); a component rendered with its props is wrapped in
 * `IslandRoot` (`renderIsland`). Either way the island is ready once
 * `data-island-ready` is set.
 *
 * Whatever a test puts on the page here is removed when it finishes: every
 * island it mounted is unmounted, Testing Library's roots are cleaned up, and
 * the document body is emptied. No suite needs its own `afterEach` for that.
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  type RenderResult,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { onTestFinished } from "vitest";
import { IslandRoot } from "../islands/core/index.ts";

const mounted: Array<() => void> = [];
let tearingDown = false;

function teardown(): void {
  tearingDown = false;
  act(() => {
    for (const unmount of mounted.splice(0).reverse()) unmount();
  });
  cleanup();
  document.body.innerHTML = "";
}

/** Registers the teardown once for the running test. */
function track(): void {
  if (tearingDown) return;
  tearingDown = true;
  onTestFinished(teardown);
}

function keep(unmount: () => void): () => void {
  mounted.push(unmount);
  return () => {
    const index = mounted.indexOf(unmount);
    if (index < 0) return;
    mounted.splice(index, 1);
    act(() => unmount());
  };
}

/**
 * Draws `html` as the whole document body, as a static shell draws it before
 * any island hydrates, and answers the body.
 */
export function drawShell(html: string): HTMLElement {
  track();
  document.body.innerHTML = html;
  return document.body;
}

/** The element `selector` finds, failing loudly when the shell lacks it. */
export function element<T extends HTMLElement = HTMLElement>(
  selector: string,
  root: ParentNode = document,
): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`no element matches ${selector}`);
  return found;
}

/** A mount function's call: it resolves, once settled, with its unmount. */
export type MountCall = () => Promise<() => void>;

/**
 * Runs `start` inside `act` and waits for its first answer to settle.
 * Answers the function that unmounts it early; the test's end unmounts it
 * otherwise.
 */
export async function mountSettled(start: MountCall): Promise<() => void> {
  track();
  let unmount!: () => void;
  await act(async () => {
    unmount = keep(await start());
  });
  return unmount;
}

/**
 * Hands a mount the test made itself — outside `act`, for a test that proves
 * what happens without it — to the same teardown. Answers the early unmount.
 */
export function adoptMount(unmount: () => void): () => void {
  track();
  return keep(unmount);
}

/**
 * Mounts a person section's owner — a `SectionMount` — into `container` with
 * `props` and waits for its first answer, as `mountSettled` does.
 */
export function mountSection<P>(
  mount: (container: HTMLElement, props: P) => Promise<() => void>,
  props: P,
  container: HTMLElement = document.body,
): Promise<() => void> {
  return mountSettled(() => mount(container, props));
}

/**
 * Starts `start` without waiting for its first answer, for a test that holds
 * that answer back. The promise resolves, with the unmount, once it settles;
 * settle it inside `act` when the island renders on the way.
 */
export function mountPending(start: MountCall): Promise<() => void> {
  track();
  let settled!: Promise<() => void>;
  act(() => {
    settled = start();
  });
  return settled.then(keep);
}

/**
 * Renders `ui` as an Astro `client:*` island named `name` renders it, and
 * waits until the island marked itself ready.
 */
export async function renderIsland(
  ui: ReactNode,
  name = "test-island",
): Promise<RenderResult & { readonly island: HTMLElement }> {
  track();
  const result = render(<IslandRoot name={name}>{ui}</IslandRoot>);
  const island = element(`[data-island="${name}"]`, result.container);
  await waitFor(() => {
    if (!island.hasAttribute("data-island-ready")) {
      throw new Error(`${name} is not ready`);
    }
  });
  return { ...result, island };
}

/**
 * Adds `values` to what the multiple `select` has chosen, all at once, as a
 * browser's picker (and Playwright) does. user-event's multi-select
 * misbehaves under happy-dom, and happy-dom caches `selectedOptions` until an
 * option's attributes change, so each chosen option is also marked.
 */
export function chooseOptions(
  select: HTMLSelectElement,
  values: readonly string[],
): void {
  for (const option of select.options) {
    if (!values.includes(option.value)) continue;
    option.selected = true;
    option.toggleAttribute("data-chosen", true);
  }
  fireEvent.change(select);
}
