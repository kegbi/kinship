/**
 * Work that can wait for the page (FER-01, FEQ-09): `task` runs once the
 * browser is idle, or on the next turn of the event loop in a browser that
 * cannot say when it is idle.
 */
export function whenIdle(task: () => void): void {
  if (typeof globalThis.requestIdleCallback === "function") {
    globalThis.requestIdleCallback(() => task());
  } else {
    globalThis.setTimeout(task, 0);
  }
}
