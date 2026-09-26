/**
 * The status-line skeleton the static shell draws in a person section, drawn
 * again by the island that takes the section over until its first answer
 * arrives, so hydration never flashes an empty line.
 */

import {
  skeletonLinesVariants,
  skeletonVariants,
} from "@/components/ui/variants.ts";

export function SectionLoading(props: { readonly label: string }) {
  return (
    <>
      <span className="sr-only">{props.label}</span>
      <span aria-hidden="true" className={skeletonLinesVariants}>
        {(["line", "line-80", "line-60"] as const).map((shape) => (
          <span
            aria-hidden="true"
            className={skeletonVariants({ shape })}
            data-slot="skeleton"
            key={shape}
          />
        ))}
      </span>
    </>
  );
}
