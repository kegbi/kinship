/**
 * One Today placeholder as an island draws it until its first answer lands
 * (FER-06); `components/today/TodayPlaceholder.astro` draws the same markup
 * into the static page.
 */

import { skeletonVariants } from "@/components/ui/variants.ts";
import { placeholderRows, type TodayPlaceholderKind } from "./placeholder.ts";

export function TodayPlaceholder(
  props: { readonly kind: TodayPlaceholderKind },
) {
  return (
    <div
      aria-hidden="true"
      className="today-placeholder"
      data-today-placeholder={props.kind}
    >
      {placeholderRows(props.kind).map((row) => (
        <span className="today-placeholder-row" key={row}>
          <span
            className={skeletonVariants({ shape: "line-80" })}
            data-slot="skeleton"
          />
          <span
            className={skeletonVariants({ shape: "line-60" })}
            data-slot="skeleton"
          />
        </span>
      ))}
    </div>
  );
}
