/// <reference lib="dom" />
import {
  type Browser,
  type BrowserContext,
  expect,
  test as base,
} from "@playwright/test";

/*
 * The `test` every spec uses (AUD-G3). Each test's browser contexts report
 * every Content-Security-Policy refusal through the DOM's
 * `securitypolicyviolation` event, and the test fails at teardown if any was
 * reported. The gateway allows no inline style and only hashed inline
 * scripts, so a `style="…"` attribute in markup, a `<style>` element, or an
 * unhashed script that a later change ships fails the suite instead of
 * silently losing its effect. Styles set through the CSSOM
 * (`element.style.x = …`, which React and Base UI use) are not refused.
 */

/** One refusal, as the page's `securitypolicyviolation` event reported it. */
export interface PolicyViolation {
  /** The directive that refused, such as `style-src-attr` or `script-src-elem`. */
  readonly directive: string;
  /** What was refused: `inline`, `eval`, or a URL. */
  readonly blocked: string;
  /** The document the refusal happened in. */
  readonly document: string;
  /** The script or stylesheet location the browser attributes it to, if any. */
  readonly source: string;
  /** The first characters of the refused inline content, if any. */
  readonly sample: string;
}

/** Collects the refusals of every context created during one test. */
export interface PolicyViolations {
  /**
   * Returns and clears the refusals reported so far, after a round trip to
   * each open page so a refusal already queued in it is delivered first.
   */
  take(): Promise<PolicyViolation[]>;
}

const BINDING = "__kinshipPolicyViolation";

/** Reports every refusal in each document of `context` to `sink`. */
async function collectPolicyViolations(
  context: BrowserContext,
  sink: PolicyViolation[],
): Promise<void> {
  await context.exposeBinding(
    BINDING,
    (_source, violation: PolicyViolation) => {
      sink.push(violation);
    },
  );
  // Init scripts run in every document before its own scripts and markup are
  // processed, so a refusal during parsing is reported too.
  await context.addInitScript((binding: string) => {
    document.addEventListener(
      "securitypolicyviolation",
      (event) => {
        const report = (globalThis as unknown as Record<
          string,
          ((violation: PolicyViolation) => void) | undefined
        >)[binding];
        report?.({
          directive: event.effectiveDirective,
          blocked: event.blockedURI,
          document: event.documentURI,
          source: event.sourceFile
            ? `${event.sourceFile}:${event.lineNumber}:${event.columnNumber}`
            : "",
          sample: event.sample,
        });
      },
      true,
    );
  }, BINDING);
}

/** Lets every open page of `contexts` deliver the refusals it has queued. */
async function settle(contexts: Iterable<BrowserContext>): Promise<void> {
  const pages = [...contexts].flatMap((context) => context.pages());
  await Promise.all(
    pages.map((page) =>
      page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)))
        .catch(() => undefined)
    ),
  );
}

/**
 * Makes `browser.newContext` collect into `sink` until the returned function
 * restores it, so a spec's own second context (another member, an anonymous
 * visitor) is guarded like the default one.
 */
function collectFromNewContexts(
  browser: Browser,
  sink: PolicyViolation[],
  contexts: Set<BrowserContext>,
): () => void {
  const newContext = browser.newContext;
  browser.newContext = async (...args: Parameters<Browser["newContext"]>) => {
    const context = await newContext.apply(browser, args);
    await collectPolicyViolations(context, sink);
    contexts.add(context);
    context.on("close", () => contexts.delete(context));
    return context;
  };
  return () => {
    browser.newContext = newContext;
  };
}

export const test = base.extend<{
  policyViolations: PolicyViolations;
}>({
  policyViolations: [async ({ browser, context }, use) => {
    const sink: PolicyViolation[] = [];
    const contexts = new Set<BrowserContext>([context]);
    await collectPolicyViolations(context, sink);
    const restore = collectFromNewContexts(browser, sink, contexts);
    const take = async () => {
      await settle(contexts);
      return sink.splice(0);
    };
    try {
      await use({ take });
    } finally {
      restore();
    }
    expect(await take(), "Content-Security-Policy refusals").toEqual([]);
  }, { auto: true }],
});

export { expect };
