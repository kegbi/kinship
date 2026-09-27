// @vitest-environment happy-dom
import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Avatar, readableInk } from "./avatar.tsx";

/** An `Image` that loads, or fails, as soon as it is given a source. */
function stubImages(outcome: "error" | "load") {
  class LoadingImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    complete = false;
    naturalWidth = 0;
    crossOrigin: string | null = null;
    set src(_value: string) {
      queueMicrotask(() =>
        outcome === "load" ? this.onload?.() : this.onerror?.()
      );
    }
  }
  vi.stubGlobal("Image", LoadingImage);
}

afterEach(() => vi.unstubAllGlobals());

describe("Avatar (GAP-045)", () => {
  it("draws the initials on the person's colour, hidden from assistive technology", () => {
    const { container } = render(
      <Avatar
        avatar={{ color: "#1f6f5c" }}
        id="person-profile-avatar"
        initials="AL"
      />,
    );
    const root = container.querySelector<HTMLElement>(
      "#person-profile-avatar",
    )!;
    expect(root.textContent).toBe("AL");
    expect(root.getAttribute("aria-hidden")).toBe("true");
    expect(root.style.backgroundColor).toBe("#1f6f5c");
    expect(root.style.color).toBe("#ffffff");
    expect(root.querySelector("img")).toBeNull();
  });

  it("keeps the theme's colour when the reader knows none", () => {
    const { container } = render(<Avatar initials="?" size="sm" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute("style")).toBeNull();
    expect(root.className).toContain("size-7");
    expect(root.textContent).toBe("?");
  });

  it("shows the image once it loads, and the initials until then", async () => {
    stubImages("load");
    const { container } = render(
      <Avatar
        avatar={{
          color: "#1f6f5c",
          imageUrl: "/api/v1/people/p/files/f/content",
        }}
        initials="AL"
      />,
    );
    expect(container.textContent).toBe("AL");
    await act(async () => {
      await Promise.resolve();
    });
    const image = container.querySelector("img")!;
    expect(image.getAttribute("src")).toBe("/api/v1/people/p/files/f/content");
    expect(image.getAttribute("alt")).toBe("");
    expect(container.textContent).toBe("");
  });

  it("falls back to the initials when the image cannot be drawn", async () => {
    stubImages("error");
    const { container } = render(
      <Avatar
        avatar={{
          color: "#1f6f5c",
          imageUrl: "/api/v1/people/p/files/f/content",
        }}
        initials="AL"
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent, "a missing object shows initials").toBe("AL");
  });
});

describe("readableInk (GAP-045)", () => {
  it("chooses the initials' ink that keeps the stronger contrast", () => {
    expect(readableInk("#1f6f5c")).toBe("#ffffff");
    expect(readableInk("#b3d5fe")).toBe("#111111");
    expect(readableInk("#ffffff")).toBe("#111111");
    expect(readableInk("#000000")).toBe("#ffffff");
    expect(readableInk("not a colour")).toBe("#ffffff");
  });
});
