// @vitest-environment happy-dom
import { act, cleanup, render } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { IslandRoot, mountIsland } from "./mount.tsx";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function server(): HTMLElement {
  document.body.innerHTML =
    '<section id="card" aria-labelledby="card-heading"><h3 id="card-heading">Card</h3><p>Loading…</p></section>';
  return document.querySelector("#card")!;
}

describe("GAP-026 mountIsland", () => {
  it("replaces the server skeleton in the same task and marks readiness", () => {
    const container = server();
    const unmount = mountIsland(
      container,
      "card",
      <h3 id="card-heading">Card ready</h3>,
    );
    expect(container.textContent).toBe("Card ready");
    expect(container.dataset.island).toBe("card");
    expect(container.hasAttribute("data-island-ready")).toBe(true);
    expect(container.getAttribute("aria-labelledby")).toBe("card-heading");
    act(() => unmount());
  });

  it("reports ready only after every child has committed", () => {
    const container = server();
    let readyDuringChildCommit: boolean | undefined;
    function Child() {
      useLayoutEffect(() => {
        readyDuringChildCommit = container.hasAttribute("data-island-ready");
      }, []);
      return <p>child</p>;
    }
    const unmount = mountIsland(container, "card", <Child />);
    expect(readyDuringChildCommit).toBe(false);
    expect(container.hasAttribute("data-island-ready")).toBe(true);
    act(() => unmount());
  });

  it("unmounts the root and clears its markers", () => {
    const container = server();
    const unmount = mountIsland(container, "card", <p>content</p>);
    act(() => unmount());
    expect(container.textContent).toBe("");
    expect(container.hasAttribute("data-island")).toBe(false);
    expect(container.hasAttribute("data-island-ready")).toBe(false);
  });
});

describe("GAP-026 IslandRoot", () => {
  it("marks its own wrapper when Astro hydrates it without a container", () => {
    const { container, unmount } = render(
      <IslandRoot name="note">
        <p>note</p>
      </IslandRoot>,
    );
    const wrapper = container.querySelector<HTMLElement>(
      '[data-island="note"]',
    );
    expect(wrapper?.hasAttribute("data-island-ready")).toBe(true);
    expect(wrapper?.textContent).toBe("note");
    unmount();
  });
});
