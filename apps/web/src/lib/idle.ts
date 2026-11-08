/** The longest work waits for an idle moment on a busy page. */
export const IDLE_TIMEOUT_MS = 2_000;

/**
 * Work that can wait for the page (FER-01, FEQ-09): `task` runs once the
 * browser is idle, or after {@link IDLE_TIMEOUT_MS} on a page that never is,
 * or on the next turn of the event loop in a browser that cannot say when it
 * is idle.
 */
export function whenIdle(task: () => void): void {
  if (typeof globalThis.requestIdleCallback === "function") {
    globalThis.requestIdleCallback(() => task(), { timeout: IDLE_TIMEOUT_MS });
  } else {
    globalThis.setTimeout(task, 0);
  }
}

/**
 * Work for content the reader may never reach (FEQ-11): `task` runs at idle
 * (see {@link whenIdle}) once `target` comes within 200 px of the viewport,
 * and at idle straight away in a browser that cannot observe it. Answers the
 * function that stops waiting; once called, `task` never runs.
 */
export function whenInView(target: Element, task: () => void): () => void {
  let waiting = true;
  const run = () => {
    if (waiting) task();
  };
  if (typeof globalThis.IntersectionObserver !== "function") {
    whenIdle(run);
    return () => {
      waiting = false;
    };
  }
  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    observer.disconnect();
    whenIdle(run);
  }, { rootMargin: "200px" });
  observer.observe(target);
  return () => {
    waiting = false;
    observer.disconnect();
  };
}
