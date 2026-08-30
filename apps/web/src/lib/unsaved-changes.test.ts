// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { mountUnsavedChangesGuard } from "./unsaved-changes.ts";
import { requestWorkspaceChange } from "./workspace-context.ts";

function markup(): {
  readonly first: HTMLFormElement;
  readonly firstName: HTMLInputElement;
  readonly root: HTMLElement;
  readonly second: HTMLFormElement;
  readonly secondName: HTMLInputElement;
} {
  document.body.innerHTML = `
    <main id="guard-root">
      <form id="first"><input name="name"><input name="selected" type="checkbox"></form>
      <section><form id="second"><input name="name"></form></section>
    </main>
    <form id="outside"><input name="name"></form>`;
  const first = document.querySelector<HTMLFormElement>("#first")!;
  const second = document.querySelector<HTMLFormElement>("#second")!;
  return {
    first,
    firstName: first.elements.namedItem("name") as HTMLInputElement,
    root: document.querySelector<HTMLElement>("#guard-root")!,
    second,
    secondName: second.elements.namedItem("name") as HTMLInputElement,
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
  document.body.innerHTML = "";
});

describe("person workspace unsaved-changes guard", () => {
  it("uses the first focused values as the baseline and evaluates visible connected dirtiness lazily", () => {
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
    expect(beforeUnload().defaultPrevented).toBe(false);
    first.hidden = false;
    first.parentElement!.hidden = true;
    expect(beforeUnload().defaultPrevented).toBe(false);
    first.parentElement!.hidden = false;
    expect(beforeUnload().defaultPrevented).toBe(true);
    first.remove();
    expect(beforeUnload().defaultPrevented).toBe(false);
  });

  it("re-baselines bubbling submit and reset events", async () => {
    const { first, firstName, root } = markup();
    mountUnsavedChangesGuard({
      confirmMessage: "Discard person changes?",
      root,
    });
    firstName.value = "Loaded";
    firstName.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));

    edit(firstName, "Submitted draft");
    first.dispatchEvent(new Event("submit", { bubbles: true }));
    expect(beforeUnload().defaultPrevented).toBe(false);
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
