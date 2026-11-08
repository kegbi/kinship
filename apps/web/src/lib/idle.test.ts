import { afterEach, describe, expect, it, vi } from "vitest";
import { IDLE_TIMEOUT_MS, whenIdle, whenInView } from "./idle.ts";

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

describe("FEQ-11 work that waits until its content is in view", () => {
  function observer() {
    const instances: {
      callback: IntersectionObserverCallback;
      options: IntersectionObserverInit | undefined;
      observed: Element[];
      disconnected: boolean;
    }[] = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        readonly record: (typeof instances)[number];
        constructor(
          callback: IntersectionObserverCallback,
          options?: IntersectionObserverInit,
        ) {
          this.record = {
            callback,
            disconnected: false,
            observed: [],
            options,
          };
          instances.push(this.record);
        }
        observe(target: Element) {
          this.record.observed.push(target);
        }
        disconnect() {
          this.record.disconnected = true;
        }
      },
    );
    const intersect = (isIntersecting: boolean) =>
      instances[0]!.callback(
        [{ isIntersecting } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    return { instances, intersect };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("runs at idle once the target comes near the viewport, once", () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    // @ts-expect-error: idle callbacks fall back to the next turn.
    globalThis.requestIdleCallback = undefined;
    const { instances, intersect } = observer();
    const target = {} as Element;
    const task = vi.fn();
    whenInView(target, task);
    expect(instances[0]!.observed).toEqual([target]);
    expect(instances[0]!.options).toEqual({ rootMargin: "200px" });
    intersect(false);
    vi.advanceTimersByTime(0);
    expect(task).not.toHaveBeenCalled();
    intersect(true);
    expect(instances[0]!.disconnected).toBe(true);
    expect(task).not.toHaveBeenCalled();
    vi.advanceTimersByTime(0);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("runs at idle where the browser cannot observe, and never once stopped", () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    // @ts-expect-error: idle callbacks fall back to the next turn.
    globalThis.requestIdleCallback = undefined;
    vi.stubGlobal("IntersectionObserver", undefined);
    const target = {} as Element;
    const task = vi.fn();
    whenInView(target, task);
    vi.advanceTimersByTime(0);
    expect(task).toHaveBeenCalledTimes(1);

    const stopped = vi.fn();
    whenInView(target, stopped)();
    vi.advanceTimersByTime(0);
    expect(stopped).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
    const { instances, intersect } = observer();
    const late = vi.fn();
    const stop = whenInView(target, late);
    intersect(true);
    stop();
    vi.advanceTimersByTime(0);
    expect(late).not.toHaveBeenCalled();
    stop();
    expect(instances[0]!.disconnected).toBe(true);
  });
});
