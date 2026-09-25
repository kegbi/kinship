// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { bindSubmitEarly } from "./early-submit.ts";

function form(): HTMLFormElement {
  document.body.innerHTML =
    `<form method="post"><input name="email"><button type="submit">Send</button></form>`;
  return document.querySelector("form")!;
}

function submit(target: HTMLFormElement): Event {
  const event = new Event("submit", { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("REL-041 early form submission", () => {
  it("blocks a submission that arrives before the handler and replays it once handled", () => {
    const target = form();
    const submission = bindSubmitEarly(target);
    const early = submit(target);
    expect(early.defaultPrevented).toBe(true);
    const handler = vi.fn();
    submission.handle(handler);
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(early);
    const later = submit(target);
    expect(later.defaultPrevented).toBe(true);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("drops an early submission when the page's first load already serves it", () => {
    const target = form();
    const submission = bindSubmitEarly(target);
    expect(submit(target).defaultPrevented).toBe(true);
    const handler = vi.fn();
    submission.handle(handler, { replay: false });
    expect(handler).not.toHaveBeenCalled();
    submit(target);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("keeps one listener per form when a page mounts again", () => {
    const target = form();
    const first = vi.fn();
    const second = vi.fn();
    bindSubmitEarly(target).handle(first);
    bindSubmitEarly(target).handle(second);
    submit(target);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });
});
