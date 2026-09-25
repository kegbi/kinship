import { describe, expect, it } from "vitest";
import { cn } from "./utils.ts";

describe("GAP-026 cn", () => {
  it("joins conditional classes and lets the later utility win", () => {
    expect(cn("h-8 px-2", false && "hidden", { "font-medium": true }, "h-auto"))
      .toBe("px-2 font-medium h-auto");
  });

  it("keeps class names that are not Tailwind utilities", () => {
    expect(cn("button-primary", "profile-section-cta")).toBe(
      "button-primary profile-section-cta",
    );
  });
});
