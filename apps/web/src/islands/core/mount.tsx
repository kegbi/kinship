/**
 * Mounting an island and telling the page it is ready.
 *
 * ADR 0006 allows two mounting modes. A page that can pass props at render
 * time uses an Astro `client:*` island, wrapped in `IslandRoot`. A section
 * inside a static shell cannot: the shell is built once, the person id comes
 * from the URL, the workspace from the session, and the section activates
 * lazily with its zone. `mountIsland` serves that second mode. It renders a
 * React root into the section the shell already drew, keeping the section
 * element and its attributes — id, `data-profile-section`, `aria-labelledby` —
 * that navigation, deep links, and the gateway contract rely on.
 *
 * Readiness is an attribute, `data-island-ready`, set once the first render
 * has committed and every handler is attached. End-to-end tests wait on it
 * (`waitForIsland`) before interacting, which is what closes REL-039's
 * click-before-wired class of failure.
 */

import { type ReactNode, useLayoutEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

const READY = "data-island-ready";

function markReady(element: HTMLElement): () => void {
  element.setAttribute(READY, "");
  return () => element.removeAttribute(READY);
}

/**
 * Sets `data-island-ready` once its children have committed. Given the
 * container a `mountIsland` root renders into, it marks that element;
 * otherwise it renders a `display: contents` wrapper named `name` and marks
 * that, which is the form an Astro `client:*` island takes.
 */
export function IslandRoot(
  props: {
    readonly children: ReactNode;
    readonly container?: HTMLElement;
    readonly name: string;
  },
) {
  const wrapper = useRef<HTMLDivElement>(null);
  const { container } = props;
  useLayoutEffect(() => {
    // Without a container the wrapper below is rendered, so its ref is set.
    return markReady(container ?? wrapper.current!);
  }, [container]);
  if (container) return props.children;
  return (
    <div ref={wrapper} data-island={props.name} style={{ display: "contents" }}>
      {props.children}
    </div>
  );
}

/**
 * Renders `element` as the content of `container`, replacing the server
 * skeleton in the same task so the page never shows an empty section, and
 * names the island `name` in `data-island`. Answers the function that
 * unmounts it again.
 */
export function mountIsland(
  container: HTMLElement,
  name: string,
  element: ReactNode,
): () => void {
  container.dataset.island = name;
  const root = createRoot(container);
  flushSync(() => {
    root.render(
      <IslandRoot container={container} name={name}>{element}</IslandRoot>,
    );
  });
  return () => {
    root.unmount();
    container.removeAttribute("data-island");
  };
}
