/**
 * Listening to a document event from an island.
 *
 * Vanilla surfaces talk to each other through document events such as
 * `person-lifecycle-changed`. An island subscribes for as long as it is
 * mounted and always runs the handler from its latest render, so the handler
 * sees current state without re-subscribing on every change.
 */

import { useEffect, useEffectEvent } from "react";

export function useDocumentEvent<E extends Event = CustomEvent>(
  name: string,
  handler: (event: E) => void,
): void {
  const onEvent = useEffectEvent(handler);
  useEffect(() => {
    const listener = (event: Event) => onEvent(event as E);
    document.addEventListener(name, listener);
    return () => document.removeEventListener(name, listener);
  }, [name]);
}
