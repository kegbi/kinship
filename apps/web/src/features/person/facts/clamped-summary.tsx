/**
 * A long one-record summary clamped to a few lines in the rail (PRF-001).
 *
 * First meeting and food preferences are free text that can run long. The
 * rail shows the start of it, and only when the text overflows its clamp a
 * "More" control expands it in place; the control keeps its visible verb and
 * names the section after it for assistive technology.
 */

import { useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button.tsx";

export function ClampedSummary(
  props: {
    readonly text: string;
    /** What the control names after its verb: "food preferences". */
    readonly suffix: string;
  },
) {
  const paragraph = useRef<HTMLParagraphElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useLayoutEffect(() => {
    // The clamp applies once the row is laid out, so it is measured a frame
    // after it renders.
    const frame = requestAnimationFrame(() => {
      const element = paragraph.current;
      if (element && element.scrollHeight > element.clientHeight) {
        setOverflows(true);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [props.text]);
  return (
    <>
      <p
        className="profile-rail-clamped-summary"
        data-expanded={expanded ? "true" : undefined}
        ref={paragraph}
      >
        {props.text}
      </p>
      {overflows
        ? (
          <Button
            aria-expanded={expanded}
            className="profile-rail-summary-control"
            onClick={() => setExpanded((open) => !open)}
            type="button"
            variant="outline"
          >
            {expanded ? "Less" : "More"}
            <span className="sr-only">{` ${props.suffix}`}</span>
          </Button>
        )
        : null}
    </>
  );
}
