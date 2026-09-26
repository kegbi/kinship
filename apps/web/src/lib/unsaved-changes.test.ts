// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { drawShell, element } from "../testing/render.tsx";
import {
  markFormSaved,
  mountUnsavedChangesGuard,
  requestFormDiscard,
  saveWithLockedForm,
} from "./unsaved-changes.ts";
import { requestWorkspaceChange } from "./workspace-context.ts";

function markup() {
  drawShell(`
    <main id="guard-root">
      <form id="first"><input name="name"><input name="selected" type="checkbox"></form>
      <section><form id="second"><input name="name"></form></section>
    </main>
    <form id="outside"><input name="name"></form>`);
  const first = element<HTMLFormElement>("#first");
  const second = element<HTMLFormElement>("#second");
  return {
    first,
    firstName: element<HTMLInputElement>('[name="name"]', first),
    root: element("#guard-root"),
    second,
    secondName: element<HTMLInputElement>('[name="name"]', second),
  };
}

function beforeUnload(): Event {
  const event = new Event("beforeunload", { cancelable: true });
  globalThis.dispatchEvent(event);
  return event;
}

function edit(control: HTMLInputElement, value: string): void {
  control.value = value;
  control.dispatchEvent(new Event("input", { bubbles: true }));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("person workspace unsaved-changes guard", () => {
  it("limits a local discard decision to its forms and keeps navigation protected until reset", () => {
    const { first, firstName, root, second } = markup();
    mountUnsavedChangesGuard({ confirmMessage: "Switch workspaces?", root });
    firstName.focus();
    edit(firstName, "Unsaved first form");
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    expect(requestFormDiscard([second], "Discard this editor?")).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(requestFormDiscard([first], "Discard this editor?")).toBe(false);
    expect(confirm).toHaveBeenCalledWith("Discard this editor?");
    confirm.mockReturnValue(true);
    expect(requestFormDiscard([first], "Discard this editor?")).toBe(true);
    expect(firstName.value).toBe("Unsaved first form");
    expect(beforeUnload().defaultPrevented).toBe(true);
    first.reset();
    expect(beforeUnload().defaultPrevented).toBe(false);
  });

  it("restores a remaining control if the previously focused draft field was removed", () => {
    const { first, firstName, root } = markup();
    mountUnsavedChangesGuard({ confirmMessage: "Switch workspaces?", root });
    firstName.focus();
    edit(firstName, "Draft");
    firstName.remove();
    vi.stubGlobal("confirm", vi.fn(() => false));
    expect(requestFormDiscard([first], "Discard this editor?")).toBe(false);
    expect(document.activeElement).toBe(first.querySelector("input"));
  });

  it.each([false, true])(
    "restores prior inert=%s after a failed pending save without clearing the draft",
    async (wasInert) => {
      const { first, firstName, root } = markup();
      mountUnsavedChangesGuard({ confirmMessage: "Discard?", root });
      firstName.focus();
      edit(firstName, "Pending draft");
      first.inert = wasInert;
      let reject!: (reason: Error) => void;
      const request = new Promise<void>((_resolve, rejectRequest) =>
        reject = rejectRequest
      );
      const saved = saveWithLockedForm(first, () => request);
      expect(first.inert).toBe(true);
      expect(new FormData(first).get("name")).toBe("Pending draft");
      expect(beforeUnload().defaultPrevented).toBe(true);
      reject(new Error("Network unavailable"));
      await expect(saved).rejects.toThrow("Network unavailable");
      expect(first.inert).toBe(wasInert);
      expect(beforeUnload().defaultPrevented).toBe(true);
    },
  );
  it("uses the first focused values as the baseline and protects hidden connected drafts", () => {
    const { first, firstName, root } = markup();
    mountUnsavedChangesGuard({
      confirmMessage: "Discard person changes?",
      root,
    });

    firstName.value = "Loaded after mount";
    firstName.focus();
    firstName.dispatchEvent(new Event("input", { bubbles: true }));
    expect(beforeUnload().defaultPrevented).toBe(false);

    edit(firstName, "Draft");
    expect(beforeUnload().defaultPrevented).toBe(true);
    edit(firstName, "Loaded after mount");
    expect(beforeUnload().defaultPrevented).toBe(false);

    edit(firstName, "Another draft");
    first.hidden = true;
    expect(beforeUnload().defaultPrevented).toBe(true);
    first.hidden = false;
    first.parentElement!.hidden = true;
    expect(beforeUnload().defaultPrevented).toBe(true);
    first.parentElement!.hidden = false;
    expect(beforeUnload().defaultPrevented).toBe(true);
    first.remove();
    expect(beforeUnload().defaultPrevented).toBe(false);
  });

  it("keeps submitted drafts dirty until an explicit reset", async () => {
    const { first, firstName, root } = markup();
    mountUnsavedChangesGuard({
      confirmMessage: "Discard person changes?",
      root,
    });
    firstName.value = "Loaded";
    firstName.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));

    edit(firstName, "Submitted draft");
    first.dispatchEvent(new Event("submit", { bubbles: true }));
    expect(beforeUnload().defaultPrevented).toBe(true);
    edit(firstName, "Reset draft");
    expect(beforeUnload().defaultPrevented).toBe(true);

    first.reset();
    await Promise.resolve();
    expect(beforeUnload().defaultPrevented).toBe(false);
    edit(firstName, "Reset draft");
    expect(beforeUnload().defaultPrevented).toBe(true);
  });

  it("blocks a refused workspace switch and re-baselines every tracked form after acceptance", () => {
    const { firstName, root, second, secondName } = markup();
    mountUnsavedChangesGuard({
      confirmMessage: "Discard person changes?",
      root,
    });
    firstName.focus();
    secondName.focus();
    edit(firstName, "First draft");
    edit(secondName, "Hidden draft");
    second.hidden = true;

    const confirm = vi.fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    vi.stubGlobal("confirm", confirm);
    expect(requestWorkspaceChange("workspace-a", "workspace-b").allowed).toBe(
      false,
    );
    expect(confirm).toHaveBeenNthCalledWith(1, "Discard person changes?");
    expect(beforeUnload().defaultPrevented).toBe(true);

    const accepted = requestWorkspaceChange("workspace-a", "workspace-b");
    expect(accepted.allowed).toBe(true);
    accepted.proceed();
    expect(confirm).toHaveBeenCalledTimes(2);
    second.hidden = false;
    expect(beforeUnload().defaultPrevented).toBe(false);
  });

  it("clears only the acknowledged form and protects subsequent edits", () => {
    const { first, firstName, root, second, secondName } = markup();
    mountUnsavedChangesGuard({ confirmMessage: "Discard?", root });
    firstName.focus();
    secondName.focus();
    edit(firstName, "First draft");
    edit(secondName, "Second draft");

    markFormSaved(first);
    expect(beforeUnload().defaultPrevented).toBe(true);
    markFormSaved(second);
    expect(beforeUnload().defaultPrevented).toBe(false);
    edit(firstName, "First draft");
    expect(beforeUnload().defaultPrevented).toBe(false);
    edit(firstName, "Another edit");
    expect(beforeUnload().defaultPrevented).toBe(true);
  });

  it("replaces global listeners when mounted twice", () => {
    const { firstName, root } = markup();
    mountUnsavedChangesGuard({
      confirmMessage: "First message",
      root,
    });
    mountUnsavedChangesGuard({
      confirmMessage: "Second message",
      root,
    });
    firstName.focus();
    edit(firstName, "Draft");
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);

    expect(requestWorkspaceChange("workspace-a", "workspace-b").allowed).toBe(
      false,
    );
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith("Second message");
  });
});
