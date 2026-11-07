import { afterEach, describe, expect, it, vi } from "vitest";
import { IDLE_TIMEOUT_MS, whenIdle } from "./idle.ts";

const original = globalThis.requestIdleCallback;

afterEach(() => {
  vi.useRealTimers();
  globalThis.requestIdleCallback = original;
});

describe("FER-01 work that waits for an idle browser", () => {
  it("runs once the browser says it is idle, waiting at most two seconds", () => {
    const callbacks: IdleRequestCallback[] = [];
    const options: (IdleRequestOptions | undefined)[] = [];
    globalThis.requestIdleCallback = (callback, option) => {
      callbacks.push(callback);
      options.push(option);
      return callbacks.length;
    };
    const task = vi.fn();
    whenIdle(task);
    expect(task).not.toHaveBeenCalled();
    expect(IDLE_TIMEOUT_MS).toBe(2_000);
    expect(options).toEqual([{ timeout: IDLE_TIMEOUT_MS }]);
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
