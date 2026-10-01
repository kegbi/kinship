import { describe, expect, it } from "vitest";
import {
  badgeVariants,
  breadcrumbVariants,
  buttonVariants,
  cardVariants,
  formActionsVariants,
  segmentVariants,
  skeletonLinesVariants,
  skeletonVariants,
} from "./variants.ts";

const classes = (value: string) => value.split(/\s+/).filter(Boolean);

describe("GAP-027 Kinship button variants", () => {
  it("draws every variant with the Kinship control box", () => {
    for (const variant of ["default", "outline", "destructive"] as const) {
      expect(classes(buttonVariants({ variant }))).toEqual(
        expect.arrayContaining([
          "inline-flex",
          "items-center",
          "justify-center",
          // 44px touch target, var(--space-2) var(--space-4) padding.
          "min-h-11",
          "py-(--space-2)",
          "px-(--space-4)",
          "border",
          "rounded-(--radius-sm)",
          "font-semibold",
          "leading-[1.2]",
          "no-underline",
          "hover:brightness-95",
          "disabled:opacity-55",
          "disabled:cursor-not-allowed",
          "aria-disabled:opacity-55",
          "aria-disabled:pointer-events-none",
        ]),
      );
    }
  });

  it("maps the former button classes onto shadcn's variant names over the tokens", () => {
    expect(buttonVariants()).toBe(buttonVariants({ variant: "default" }));
    expect(classes(buttonVariants())).toEqual(
      expect.arrayContaining([
        "border-primary",
        "bg-primary",
        "text-primary-foreground",
      ]),
    );
    expect(classes(buttonVariants({ variant: "outline" }))).toEqual(
      expect.arrayContaining(["border-input", "bg-card", "text-foreground"]),
    );
    expect(classes(buttonVariants({ variant: "destructive" }))).toEqual(
      expect.arrayContaining([
        "border-(--danger)",
        "bg-(--danger)",
        "text-(--ink-inverse)",
      ]),
    );
  });

  it("gives the former button-link its pill and lets a caller override one utility", () => {
    const pill = classes(buttonVariants({ shape: "pill" }));
    expect(pill).toContain("rounded-full");
    expect(pill).not.toContain("rounded-(--radius-sm)");
    const tighter = classes(buttonVariants({ className: "px-(--space-3)" }));
    expect(tighter).toContain("px-(--space-3)");
    expect(tighter).not.toContain("px-(--space-4)");
  });

  it("draws a segmented filter's pressed choice as the default variant", () => {
    const segment = classes(segmentVariants());
    expect(segment).toEqual(
      expect.arrayContaining([
        "bg-card",
        "aria-pressed:bg-primary",
        "aria-pressed:text-primary-foreground",
        "aria-pressed:border-primary",
      ]),
    );
    expect(classes(segmentVariants({ className: "min-w-11" }))).toContain(
      "min-w-11",
    );
  });
});

describe("GAP-027 Kinship badge, card, and layout variants", () => {
  it("keeps the state badge tones", () => {
    const base = [
      "inline-flex",
      "rounded-full",
      "px-(--space-3)",
      "py-(--space-1)",
      "text-[.7rem]",
      "font-bold",
    ];
    expect(classes(badgeVariants())).toEqual(
      expect.arrayContaining([
        ...base,
        "bg-(--accent-soft)",
        "text-(--accent-hover)",
      ]),
    );
    expect(classes(badgeVariants({ variant: "secondary" }))).toEqual(
      expect.arrayContaining([
        ...base,
        "bg-(--positive-soft)",
        "text-(--ink-2)",
      ]),
    );
    expect(classes(badgeVariants({ variant: "warning" }))).toEqual(
      expect.arrayContaining(["bg-(--warning-soft)", "text-(--warning)"]),
    );
    expect(classes(badgeVariants({ className: "justify-self-start" })))
      .toContain("justify-self-start");
  });

  it("calms a section status chip unless its section is in trouble", () => {
    const chip = classes(badgeVariants({ variant: "status" }));
    expect(chip).toEqual(
      expect.arrayContaining([
        "px-(--space-2)",
        "text-[.66rem]",
        "whitespace-nowrap",
        "bg-muted",
        "text-muted-foreground",
      ]),
    );
    expect(chip).not.toContain("px-(--space-3)");
    expect(chip).not.toContain("text-[.7rem]");
    for (const state of ["error", "forbidden", "unavailable"]) {
      expect(chip).toContain(
        `in-data-[section-state=${state}]:bg-(--danger-soft)`,
      );
    }
  });

  it("draws a card, a form-action row, and a breadcrumb from the tokens", () => {
    expect(classes(cardVariants())).toEqual([
      "rounded-(--radius-lg)",
      "border",
      "border-solid",
      "border-(--line-hairline)",
      "bg-card",
      "p-(--pad-card)",
    ]);
    expect(cardVariants({ className: "today-section" })).toContain(
      "today-section",
    );
    expect(formActionsVariants()).toBe("flex flex-wrap gap-(--space-3)");
    expect(formActionsVariants({ className: "col-span-full" })).toContain(
      "col-span-full",
    );
    expect(classes(breadcrumbVariants.list)).toContain("text-[.82rem]");
    expect(classes(breadcrumbVariants.link)).toContain("min-h-11");
  });

  it("sweeps a skeleton unless the reader prefers reduced motion", () => {
    const line = classes(skeletonVariants());
    expect(line).toEqual(
      expect.arrayContaining([
        "animate-skeleton",
        "motion-reduce:animate-none",
        "block",
        "w-full",
      ]),
    );
    expect(classes(skeletonVariants({ shape: "line-80" }))).toContain("w-4/5");
    expect(classes(skeletonVariants({ shape: "line-60" }))).toContain("w-3/5");
    expect(classes(skeletonVariants({ shape: "chip" }))).toEqual(
      expect.arrayContaining(["inline-block", "w-20", "rounded-full"]),
    );
    expect(classes(skeletonVariants({ shape: "avatar", className: "w-12" })))
      .toContain("w-12");
    expect(skeletonLinesVariants).toBe("grid w-full gap-(--space-2)");
  });
});
