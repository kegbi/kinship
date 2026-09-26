// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearToasts } from "../../lib/toasts.ts";
import { drawShell } from "../../testing/render.tsx";
import { toast } from "./toast.ts";
import { useDocumentEvent } from "./document-event.ts";

afterEach(clearToasts);

describe("GAP-026 useDocumentEvent", () => {
  it("calls the latest handler and stops listening on unmount", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ handler }: { handler: (event: CustomEvent<number>) => void }) =>
        useDocumentEvent("kinship:test", handler),
      { initialProps: { handler: first } },
    );
    act(() => {
      document.dispatchEvent(new CustomEvent("kinship:test", { detail: 1 }));
    });
    rerender({ handler: second });
    act(() => {
      document.dispatchEvent(new CustomEvent("kinship:test", { detail: 2 }));
    });
    unmount();
    document.dispatchEvent(new CustomEvent("kinship:test", { detail: 3 }));
    expect(first.mock.calls.map(([event]) => event.detail)).toEqual([1]);
    expect(second.mock.calls.map(([event]) => event.detail)).toEqual([2]);
  });
});

describe("GAP-026 toast", () => {
  it("writes to the application's toast region the way the vanilla code does", () => {
    drawShell('<ol id="app-toasts"></ol>');
    toast("Gift saved.", "success");
    toast("Saved without a tone.");
    const items = [...document.querySelectorAll<HTMLElement>(".app-toast")];
    expect(items.map((item) => item.dataset.tone)).toEqual([
      "success",
      "info",
    ]);
    expect(items[0]?.querySelector(".app-toast-message")?.textContent).toBe(
      "Gift saved.",
    );
  });

  it("does nothing on a page without the region", () => {
    expect(() => toast("Nowhere to go.", "error")).not.toThrow();
    expect(document.querySelector(".app-toast")).toBeNull();
  });
});
