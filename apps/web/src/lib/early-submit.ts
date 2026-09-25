/**
 * Binds a form's submission before its page's startup reads (REL-041).
 *
 * A page module that attaches its `submit` listener only after awaiting the
 * session or preferences leaves a window in which a submission falls through
 * to the browser's native one. The listener installed here is attached before
 * the first await, blocks the native submission, and holds the latest early
 * submission until `handle` installs the real handler.
 */
export interface EarlySubmission {
  /**
   * Installs the handler every later submission reaches. An early submission
   * is replayed to it unless `replay` is false, for a page whose first load
   * already reads the fields that submission carried.
   */
  handle(
    handler: (event: SubmitEvent) => unknown,
    options?: { readonly replay?: boolean },
  ): void;
}

const bound = new WeakMap<HTMLFormElement, EarlySubmission>();

export function bindSubmitEarly(form: HTMLFormElement): EarlySubmission {
  const existing = bound.get(form);
  if (existing) return existing;
  let handler: ((event: SubmitEvent) => unknown) | undefined;
  let early: SubmitEvent | undefined;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (handler) void handler(event as SubmitEvent);
    else early = event as SubmitEvent;
  });
  const submission: EarlySubmission = {
    handle(next, options) {
      handler = next;
      const pending = early;
      early = undefined;
      if (pending && options?.replay !== false) void next(pending);
    },
  };
  bound.set(form, submission);
  return submission;
}
