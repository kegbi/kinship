import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const breadcrumb = readFileSync(
  resolve("apps/web/src/components/Breadcrumb.astro"),
  "utf8",
);

describe("breadcrumb component", () => {
  it("UXD-009 renders the shared accessible markup contract", () => {
    expect(breadcrumb).toContain('aria-label="Breadcrumb"');
    expect(breadcrumb).toContain(
      "<a class={breadcrumbVariants.link} href={entry.href}>{entry.label}</a>",
    );
    expect(breadcrumb).toContain(
      "<a class={breadcrumbVariants.link} data-breadcrumb-person href={entry.href}>",
    );
    expect(breadcrumb).toContain(
      '<nav class={cn(breadcrumbVariants.list, className)} aria-label="Breadcrumb">',
    );
    expect(breadcrumb).toContain('data-slot="skeleton"');
    expect(breadcrumb).toContain(
      '<span aria-hidden="true">/</span>',
    );
    expect(breadcrumb).toContain(
      '<span aria-current="page">{entry.label}</span>',
    );
  });
});
