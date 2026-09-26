/**
 * The island form of GAP-023's "Load more" control.
 *
 * It keeps `lib/load-more.ts`'s contract for the reader: the button shows only
 * while the last answer offered a cursor; while a page is in flight it stays
 * focusable but is marked unavailable and busy, and its label says so; and a
 * control that hides while it holds focus hands focus to the list it extends,
 * named by `aria-controls`, so a keyboard user lands on what they loaded.
 */

import { useLayoutEffect, useRef, useState } from "react";
import { buttonVariants } from "@/components/ui/variants.ts";

export const LOADING_LABEL = "Loading…";

export function LoadMore(
  props: {
    /** The id of the list this control extends. */
    readonly controls: string;
    /** The cursor the last answer offered; `undefined` hides the control. */
    readonly cursor: string | undefined;
    readonly label: string;
    /** The `data-load-more` name surfaces and tests look the control up by. */
    readonly list: string;
    /** Fetches the page after `cursor`; its failure is the surface's to tell. */
    readonly onLoad: (cursor: string) => Promise<unknown>;
  },
) {
  const [loading, setLoading] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const hidden = props.cursor === undefined;
  useLayoutEffect(() => {
    if (!hidden || button.current !== document.activeElement) return;
    const list = document.getElementById(props.controls);
    if (!list) return;
    if (!list.hasAttribute("tabindex")) list.setAttribute("tabindex", "-1");
    list.focus();
  }, [hidden, props.controls]);
  const activate = async () => {
    const cursor = props.cursor;
    if (loading || cursor === undefined) return;
    setLoading(true);
    try {
      await props.onLoad(cursor);
    } catch {
      // The surface reports its own failure; the control only stops being busy.
    } finally {
      setLoading(false);
    }
  };
  return (
    <button
      ref={button}
      aria-busy={loading ? "true" : undefined}
      aria-controls={props.controls}
      aria-disabled={loading ? "true" : undefined}
      className={buttonVariants({ className: "load-more", variant: "outline" })}
      data-load-more={props.list}
      hidden={hidden}
      onClick={() => void activate()}
      type="button"
    >
      {loading ? LOADING_LABEL : props.label}
    </button>
  );
}
