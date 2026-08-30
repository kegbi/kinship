// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearToasts, showToast } from "./toasts.ts";

function region(): HTMLUListElement {
  return document.querySelector<HTMLUListElement>("#app-toasts")!;
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML =
    '<ul id="app-toasts" aria-live="polite" aria-label="Notifications"></ul>';
});

afterEach(() => {
  clearToasts();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("application toasts", () => {
  it("is a no-op when the permanent region is absent", () => {
    document.body.innerHTML = "";

    expect(() => showToast({ message: "Saved" })).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("appends the documented item structure and removes it after its action", () => {
    const onSelect = vi.fn();

    showToast({
      action: { label: "Undo", onSelect },
      message: "Person archived.",
      tone: "success",
    });

    const item = region().querySelector<HTMLLIElement>(":scope > li")!;
    expect(item.className).toBe("app-toast");
    expect(item.dataset.tone).toBe("success");
    expect([...item.children].map((child) => child.className)).toEqual([
      "app-toast-message",
      "app-toast-action",
      "app-toast-dismiss",
    ]);
    expect(item.querySelector(".app-toast-message")?.textContent).toBe(
      "Person archived.",
    );
    const action = item.querySelector<HTMLButtonElement>(".app-toast-action")!;
    expect(action.type).toBe("button");
    expect(action.textContent).toBe("Undo");
    const dismiss = item.querySelector<HTMLButtonElement>(
      ".app-toast-dismiss",
    )!;
    expect(dismiss.type).toBe("button");
    expect(dismiss.getAttribute("aria-label")).toBe("Dismiss notification");
    expect(dismiss.children).toHaveLength(1);
    expect(dismiss.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
    expect(dismiss.firstElementChild?.textContent).toBe("×");

    action.click();

    expect(onSelect).toHaveBeenCalledOnce();
    expect(region().children).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("defaults to info, auto-dismisses after six seconds, and keeps errors", () => {
    showToast({ message: "Working" });
    showToast({ message: "Failed", tone: "error" });

    expect(
      region().querySelector<HTMLLIElement>(":scope > li")?.dataset.tone,
    ).toBe("info");
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(5_999);
    expect(region().children).toHaveLength(2);
    vi.advanceTimersByTime(1);

    expect(region().children).toHaveLength(1);
    expect(region().textContent).toContain("Failed");
    vi.advanceTimersByTime(60_000);
    expect(region().children).toHaveLength(1);
  });

  it("caps the stack at three, including errors, and clears the oldest timer", () => {
    showToast({ message: "Oldest" });
    showToast({ message: "Second" });
    showToast({ message: "Third" });
    showToast({ message: "Newest" });

    expect(
      [...region().children].map((item) => item.textContent),
    ).toEqual([
      "Second×",
      "Third×",
      "Newest×",
    ]);
    expect(vi.getTimerCount()).toBe(3);

    clearToasts();
    showToast({ message: "Persistent error", tone: "error" });
    showToast({ message: "Second" });
    showToast({ message: "Third" });
    showToast({ message: "Newest" });
    expect(region().textContent).not.toContain("Persistent error");
    expect(region().children).toHaveLength(3);
  });

  it("pauses all timers while hovered and restarts the full duration", () => {
    showToast({ message: "First" });
    showToast({ message: "Second" });
    vi.advanceTimersByTime(5_000);

    region().dispatchEvent(new Event("pointerenter"));
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10_000);
    expect(region().children).toHaveLength(2);

    region().dispatchEvent(new Event("pointerleave"));
    vi.advanceTimersByTime(5_999);
    expect(region().children).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(region().children).toHaveLength(0);
  });

  it("pauses all timers while focused and waits for focus to leave", () => {
    showToast({ message: "First" });
    const dismiss = region().querySelector<HTMLButtonElement>(
      ".app-toast-dismiss",
    )!;
    const outside = document.createElement("button");
    document.body.append(outside);

    dismiss.focus();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10_000);
    expect(region().children).toHaveLength(1);

    outside.focus();
    vi.advanceTimersByTime(5_999);
    expect(region().children).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(region().children).toHaveLength(0);
  });

  it("dismisses directly and moves contained focus to the last remaining toast", () => {
    showToast({ message: "First" });
    showToast({ message: "Second" });
    const dismissButtons = region().querySelectorAll<HTMLButtonElement>(
      ".app-toast-dismiss",
    );
    dismissButtons[0]!.focus();

    dismissButtons[0]!.click();

    expect(region().children).toHaveLength(1);
    expect(document.activeElement).toBe(dismissButtons[1]);

    dismissButtons[1]!.click();
    expect(region().children).toHaveLength(0);
  });

  it("clears every toast and pending timer", () => {
    showToast({ message: "One" });
    showToast({ message: "Two", tone: "error" });

    clearToasts();

    expect(region().children).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
