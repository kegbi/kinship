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
