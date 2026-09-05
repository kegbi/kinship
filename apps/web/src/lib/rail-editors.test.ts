// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { registerRailEditors, requestRailEditorOpen } from "./rail-editors.ts";
import { mountUnsavedChangesGuard } from "./unsaved-changes.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function markup() {
  document.body.innerHTML =
    `<form id="current"><input name="name" value="Saved"><textarea name="notes"></textarea></form>
    <button id="opener">Open another editor</button><form id="target" hidden><input name="name"></form>
    <form id="hidden" hidden></form>`;
  const current = document.querySelector<HTMLFormElement>("#current")!;
  const target = document.querySelector<HTMLFormElement>("#target")!;
  const field = current.querySelector("textarea")!;
  const opener = document.querySelector<HTMLButtonElement>("#opener")!;
  const hidden = document.querySelector<HTMLFormElement>("#hidden")!;
  const close = vi.fn((form: HTMLFormElement) => {
    form.hidden = true;
    form.reset();
  });
  registerRailEditors(
    [current, target, hidden, document.createElement("form")],
    close,
  );
  mountUnsavedChangesGuard({
    confirmMessage: "Discard draft?",
    root: document.body,
  });
  field.focus();
  return { close, current, field, opener, target };
}

describe("rail editor coordination", () => {
  it.each(["clean", "declined", "accepted"])(
    "decides a %s switch before closing anything",
    (decision) => {
      const { close, current, field, opener, target } = markup();
      if (decision !== "clean") {
        field.value = "Keep my draft";
        field.dispatchEvent(new Event("input", { bubbles: true }));
      }
      const confirm = vi.fn(() => {
        expect(current.hidden).toBe(false);
        expect(field.value).toBe("Keep my draft");
        expect(close).not.toHaveBeenCalled();
        expect(target.hidden).toBe(true);
        return decision === "accepted";
      });
      vi.stubGlobal("confirm", confirm);
      opener.focus();
      const allowed = requestRailEditorOpen(target);
      if (allowed) {
        target.hidden = false;
        target.querySelector("input")!.focus();
      }
      expect(allowed).toBe(decision !== "declined");
      expect(confirm).toHaveBeenCalledTimes(decision === "clean" ? 0 : 1);
      if (decision === "declined") {
        expect(close).not.toHaveBeenCalled();
        expect(field.value).toBe("Keep my draft");
        expect(current.hidden).toBe(false);
        expect(target.hidden).toBe(true);
        expect(document.activeElement).toBe(field);
        expect(
          globalThis.dispatchEvent(
            new Event("beforeunload", { cancelable: true }),
          ),
        ).toBe(false);
      } else {
        expect(close).toHaveBeenCalledExactlyOnceWith(current);
        expect(field.value).toBe("");
        expect(current.hidden).toBe(true);
        expect(document.activeElement).toBe(target.querySelector("input"));
        expect(
          globalThis.dispatchEvent(
            new Event("beforeunload", { cancelable: true }),
          ),
        ).toBe(true);
      }
    },
  );

  it.each([false, true])(
    "blocks an inert pending editor even when hidden=%s without prompting",
    (hidden) => {
      const { close, current, field, target } = markup();
      field.value = "Saving draft";
      field.dispatchEvent(new Event("input", { bubbles: true }));
      current.inert = true;
      current.hidden = hidden;
      const confirm = vi.fn(() => true);
      vi.stubGlobal("confirm", confirm);
      expect(requestRailEditorOpen(target)).toBe(false);
      expect(requestRailEditorOpen(current, true)).toBe(false);
      expect(close).not.toHaveBeenCalled();
      expect(confirm).not.toHaveBeenCalled();
      expect(field.value).toBe("Saving draft");
      current.inert = false;
    },
  );

  it("reuses an active form without a prompt but guards replacement of its record", () => {
    const { close, current, field } = markup();
    field.value = "Draft";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    expect(requestRailEditorOpen(current)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(requestRailEditorOpen(current, true)).toBe(false);
    expect(confirm).toHaveBeenCalledOnce();
    expect(field.value).toBe("Draft");
  });

  it("removes registrations and ignores hidden or detached forms", () => {
    const { close, current, target } = markup();
    const other = vi.fn();
    const remove = registerRailEditors([current], other);
    remove();
    expect(requestRailEditorOpen(target)).toBe(true);
    expect(close).toHaveBeenCalledExactlyOnceWith(current);
    expect(other).not.toHaveBeenCalled();
    expect(requestRailEditorOpen(target)).toBe(true);
    expect(close).toHaveBeenCalledOnce();
  });
});
