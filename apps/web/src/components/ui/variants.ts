/**
 * The Kinship primitives' class strings (GAP-027): the one definition of how a
 * button, badge, card, text field, form-action row, segmented filter,
 * breadcrumb, and skeleton look.
 *
 * The vendored shadcn/ui components render these classes, the Astro templates
 * write them into static markup (`class={buttonVariants({ variant:
 * "outline" })}` in frontmatter), and the vanilla modules assign them to the
 * elements they build, so static, vanilla, and island markup cannot drift.
 * Every value is a UXD-001 token, directly or through the shadcn theme
 * variables `tokens.css` maps onto the tokens, which keeps the Kinship look in
 * both themes.
 *
 * The variant names are shadcn's: `default` is the former `button-primary`,
 * `outline` the bordered `button-secondary`, and `destructive` the former
 * `button-danger`. A `pill` shape carries the former `button-link`, and `wrap`
 * a label that may be long (the former `today-touch-target` on a button).
 */

import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils.ts";

const button = cva(
  "m-0 inline-flex min-h-11 cursor-pointer items-center justify-center border border-solid px-(--space-4) py-(--space-3) text-center leading-[1.2] font-semibold no-underline hover:brightness-96 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-55 aria-disabled:pointer-events-none aria-disabled:cursor-not-allowed aria-disabled:opacity-55",
  {
    variants: {
      variant: {
        default: "border-primary bg-primary text-primary-foreground",
        outline: "border-input bg-card text-foreground",
        destructive: "border-(--accent) bg-(--accent) text-(--ink-inverse)",
      },
      shape: {
        default: "rounded-[.65rem]",
        pill: "rounded-full",
      },
      // A label that may be long, such as a person's name on Today: it wraps
      // inside its container instead of overflowing it.
      wrap: {
        false: "",
        true: "max-w-full min-w-11 whitespace-normal wrap-anywhere",
      },
    },
    defaultVariants: { shape: "default", variant: "default", wrap: false },
  },
);

export type ButtonVariantProps = VariantProps<typeof button>;

/** A button, or a link that looks like one. */
export function buttonVariants(
  props: ButtonVariantProps & { readonly className?: string } = {},
): string {
  const { className, ...variants } = props;
  return cn(button(variants), className);
}

/**
 * A segmented filter: one outline button per choice, the pressed one
 * (`aria-pressed="true"`) drawn as the default variant. The vanilla module
 * that owns the filter only moves `aria-pressed`.
 */
export function segmentVariants(
  props: { readonly className?: string } = {},
): string {
  return buttonVariants({
    className: cn(
      "aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground",
      props.className,
    ),
    variant: "outline",
  });
}

const badge = cva(
  "inline-flex flex-none rounded-full px-(--space-3) py-(--space-1) text-[.7rem] font-bold",
  {
    variants: {
      variant: {
        default: "bg-(--accent-soft) text-(--accent-hover)",
        secondary: "bg-(--positive-soft) text-(--ink-2)",
        warning: "bg-(--warning-soft) text-(--warning)",
        // A person section's status chip: calm unless its section card is in
        // trouble.
        status:
          "bg-muted px-(--space-2) text-[.66rem] whitespace-nowrap text-muted-foreground in-data-[section-state=error]:bg-(--accent-soft) in-data-[section-state=error]:text-(--accent-hover) in-data-[section-state=forbidden]:bg-(--accent-soft) in-data-[section-state=forbidden]:text-(--accent-hover) in-data-[section-state=unavailable]:bg-(--accent-soft) in-data-[section-state=unavailable]:text-(--accent-hover)",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export type BadgeVariantProps = VariantProps<typeof badge>;

/** A state badge: `default` draws attention, `secondary` is calm. */
export function badgeVariants(
  props: BadgeVariantProps & { readonly className?: string } = {},
): string {
  const { className, ...variants } = props;
  return cn(badge(variants), className);
}

/** A card: the surface every Today and settings section sits on. */
export function cardVariants(
  props: { readonly className?: string } = {},
): string {
  return cn(
    "rounded-(--radius-lg) border border-solid border-(--line-hairline) bg-card p-(--pad-card)",
    props.className,
  );
}

/**
 * A text field. `multiline` is a textarea that the reader can make taller.
 */
export function fieldVariants(
  props: { readonly className?: string; readonly multiline?: boolean } = {},
): string {
  return cn(
    "box-border w-full max-w-full min-w-0 rounded-[.65rem] border border-solid border-input bg-card px-(--space-3) py-(--space-3) text-inherit",
    props.multiline ? "min-h-24 resize-y" : "min-h-11",
    props.className,
  );
}

/** A row of form actions that wraps on a narrow screen. */
export function formActionsVariants(
  props: { readonly className?: string } = {},
): string {
  return cn("flex flex-wrap gap-(--space-3)", props.className);
}

/** The parts of a breadcrumb trail. */
export const breadcrumbVariants = {
  list:
    "flex items-center gap-(--space-2) text-[.82rem] font-semibold text-muted-foreground",
  link: "inline-flex min-h-11 items-center underline-offset-[.2em]",
} as const;

const skeleton = cva(
  "animate-skeleton rounded-(--radius-sm) bg-[linear-gradient(90deg,var(--surface-2)_0%,var(--surface-3)_50%,var(--surface-2)_100%)] bg-size-[200%_100%] motion-reduce:animate-none",
  {
    variants: {
      shape: {
        line: "block h-[.9rem] w-full",
        "line-80": "block h-[.9rem] w-4/5",
        "line-60": "block h-[.9rem] w-3/5",
        avatar: "block size-full rounded-[inherit]",
        chip: "inline-block h-6 w-20 rounded-full",
      },
    },
    defaultVariants: { shape: "line" },
  },
);

export type SkeletonVariantProps = VariantProps<typeof skeleton>;

/**
 * A loading placeholder. It carries `data-slot="skeleton"` in markup so the
 * modules that replace it can find it.
 */
export function skeletonVariants(
  props: SkeletonVariantProps & { readonly className?: string } = {},
): string {
  const { className, ...variants } = props;
  return cn(skeleton(variants), className);
}

/** The stack several skeleton lines sit in. */
export const skeletonLinesVariants = "grid w-full gap-(--space-2)";
