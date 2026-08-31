// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  announceRailEditorOpened,
  onForeignRailEditorOpened,
  RAIL_EDITOR_OPENED_EVENT,
} from "./rail-editors.ts";

afterEach(() => {
  document.body.replaceChildren();
});

describe("rail editor coordination", () => {
  it("announces the opened form on the document", () => {
    document.body.innerHTML = "<form></form>";
    const form = document.querySelector("form")!;
    const listener = vi.fn();
    document.addEventListener(RAIL_EDITOR_OPENED_EVENT, listener, {
      once: true,
    });

    announceRailEditorOpened(form);

    expect(listener).toHaveBeenCalledOnce();
    expect((listener.mock.calls[0]?.[0] as CustomEvent).detail).toBe(form);
  });

  it("closes only connected visible owned forms other than the opened form", () => {
    document.body.innerHTML = `
      <form id="opened"></form>
      <form id="foreign"></form>
      <form id="hidden" hidden></form>`;
    const opened = document.querySelector<HTMLFormElement>("#opened")!;
    const foreign = document.querySelector<HTMLFormElement>("#foreign")!;
    const hidden = document.querySelector<HTMLFormElement>("#hidden")!;
    const detached = document.createElement("form");
    const close = vi.fn();
    const unsubscribe = onForeignRailEditorOpened(
      [opened, foreign, hidden, detached],
      close,
    );

    document.dispatchEvent(
      new CustomEvent(RAIL_EDITOR_OPENED_EVENT, { detail: "not a form" }),
    );
    announceRailEditorOpened(opened);

    expect(close).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledWith(foreign);
    unsubscribe();
    announceRailEditorOpened(foreign);
    expect(close).toHaveBeenCalledOnce();
  });
});
