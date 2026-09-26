// @vitest-environment happy-dom
import { act, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type CapturedProfileSummary,
  captureProfileSummary,
} from "../profile-summary.test-helper.ts";
import { mountUnsavedChangesGuard } from "../../../lib/unsaved-changes.ts";
import { buttonVariants } from "@/components/ui/variants.ts";
import { stubApi } from "../../../testing/api.ts";
import {
  anyRoute,
  block,
  fact,
  factDeleted,
  factRead,
  mountFacts,
  railBlock,
  shell,
} from "./facts.test-helper.ts";
import { mountFoodPreferences } from "./food.tsx";

let summary: CapturedProfileSummary;
beforeEach(() => {
  summary = captureProfileSummary();
});
afterEach(() => {
  summary.stop();
  vi.unstubAllGlobals();
});

const section = () => within(block("food-preferences"));
const stateLine = () =>
  block("food-preferences").querySelector("[data-profile-fact-state]")!;
const unloadBlocked = () =>
  !globalThis.dispatchEvent(new Event("beforeunload", { cancelable: true }));

describe("GAP-029 food preferences island", () => {
  it("clears saved preferences and shows an honest empty section", async () => {
    shell(railBlock("food-preferences"));
    let present = true;
    const api = stubApi({
      "DELETE /api/v1/*": () => {
        present = false;
        return factDeleted();
      },
      "GET /api/v1/*": () =>
        factRead(
          present ? [fact("food-preferences", { foodPreferences: "Tea" })] : [],
        ),
    });
    await mountFacts(mountFoodPreferences);
    const add = section().getByRole("button", {
      name: "Edit food preferences",
    });
    expect(add.textContent).toBe("+");
    expect(stateLine().textContent).toBe("1 saved.");
    const clear = section().getByRole("button", {
      name: "Clear food preferences",
    });
    expect(clear.className).toBe(buttonVariants({
      className: "profile-rail-remove",
      variant: "destructive",
    }));
    const user = userEvent.setup();
    await user.click(clear);
    expect(stateLine().textContent).toBe(
      "Press the delete button again to confirm.",
    );
    await user.click(
      section().getByRole("button", { name: "Confirm clear food preferences" }),
    );
    await waitFor(() =>
      expect(stateLine().textContent).toBe("Profile fact deleted.")
    );
    expect(api.calls().filter((call) => call.startsWith("DELETE")))
      .toHaveLength(1);
    expect(api.bodies()).toEqual([{
      expectedPersonUpdatedAt: "2026-08-16T12:00:00.000000Z",
      expectedUpdatedAt: "2026-08-16T12:00:00.000000Z",
      section: "food-preferences",
    }]);
    expect(block("food-preferences").textContent).not.toContain("Tea");
    expect(section().getByRole("button", { name: "Add food preferences" }))
      .toBeTruthy();
    expect(summary.railEmpty("food-preferences")).toBe(true);
  });

  it("refuses white space before sending it and keeps the draft protected", async () => {
    shell(railBlock("food-preferences"));
    mountUnsavedChangesGuard({
      confirmMessage: "Discard?",
      root: document.body,
    });
    const api = stubApi({ [anyRoute]: factRead([]) });
    await mountFacts(mountFoodPreferences);
    const user = userEvent.setup();
    await user.click(
      section().getByRole("button", { name: "Add food preferences" }),
    );
    const field = section().getByLabelText(
      "Food, allergy, and dietary preferences",
    );
    await waitFor(() => expect(document.activeElement).toBe(field));
    await user.type(field, "   ");
    await user.click(
      section().getByRole("button", { name: "Save profile fact" }),
    );
    await waitFor(() =>
      expect(
        block("food-preferences").querySelector(
          "[data-profile-fact-field-error]",
        )?.textContent,
      ).toBe("Enter food preferences.")
    );
    expect(api.calls().some((call) => !call.startsWith("GET"))).toBe(false);
    expect(unloadBlocked()).toBe(true);
  });

  it("clamps long preferences only when they overflow, naming the section", async () => {
    shell(railBlock("food-preferences"));
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    stubApi({
      [anyRoute]: factRead([
        fact("food-preferences", {
          foodPreferences:
            "Tea; no shellfish; vegetarian meals preferred when sharing dinner",
        }),
      ]),
    });
    const unmount = await mountFacts(mountFoodPreferences);
    const text = block("food-preferences").querySelector<HTMLElement>(
      "[data-profile-fact-list] p",
    )!;
    const measure = (scrollHeight: number) => {
      Object.defineProperties(text, {
        clientHeight: { configurable: true, value: 32 },
        scrollHeight: { configurable: true, value: scrollHeight },
      });
      act(() => {
        for (const frame of frames.splice(0)) frame(0);
      });
    };
    measure(32);
    expect(section().queryByRole("button", { name: /^More/ })).toBeNull();
    // The same text in a narrower block overflows its clamp.
    unmount();
    shell(railBlock("food-preferences"));
    await mountFacts(mountFoodPreferences);
    const long = block("food-preferences").querySelector<HTMLElement>(
      "[data-profile-fact-list] p",
    )!;
    Object.defineProperties(long, {
      clientHeight: { configurable: true, value: 32 },
      scrollHeight: { configurable: true, value: 64 },
    });
    act(() => {
      for (const frame of frames.splice(0)) frame(0);
    });
    const more = section().getByRole("button", {
      name: "More food preferences",
    });
    expect(more.hasAttribute("aria-label")).toBe(false);
    expect(more.firstChild?.textContent).toBe("More");
    await userEvent.setup().click(more);
    expect(long.dataset.expanded).toBe("true");
    expect(long.textContent).toBe(
      "Tea; no shellfish; vegetarian meals preferred when sharing dinner",
    );
  });
});
