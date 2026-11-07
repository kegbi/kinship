import { afterEach, describe, expect, it, vi } from "vitest";
import { whenIdle } from "./idle.ts";

const original = globalThis.requestIdleCallback;

afterEach(() => {
  vi.useRealTimers();
  globalThis.requestIdleCallback = original;
});

describe("FER-01 work that waits for an idle browser", () => {
  it("runs once the browser says it is idle", () => {
    const callbacks: IdleRequestCallback[] = [];
    globalThis.requestIdleCallback = (callback) => {
      callbacks.push(callback);
      return callbacks.length;
    };
    const task = vi.fn();
    whenIdle(task);
    expect(task).not.toHaveBeenCalled();
    callbacks[0]!({ didTimeout: false, timeRemaining: () => 10 });
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("runs on the next turn where the browser cannot say", () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    // @ts-expect-error: a browser without idle callbacks (Safari).
    globalThis.requestIdleCallback = undefined;
    const task = vi.fn();
    whenIdle(task);
    expect(task).not.toHaveBeenCalled();
    vi.advanceTimersByTime(0);
    expect(task).toHaveBeenCalledTimes(1);
  });
});
