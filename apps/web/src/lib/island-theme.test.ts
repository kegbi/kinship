import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = resolve("apps/web/src/styles");
const tokens = readFileSync(resolve(styles, "tokens.css"), "utf8");
const islands = readFileSync(resolve(styles, "islands.css"), "utf8");

/**
 * The custom properties of the `nth` top-level rule whose selector is exactly
 * `selector`.
 */
function block(
  source: string,
  selector: string,
  nth = 0,
): Map<string, string> {
  const starts = [...source.matchAll(/^(.+?) \{$/gm)]
    .filter(([, found]) => found === selector)
    .map((match) => match.index);
  const start = starts[nth];
  expect(start, `${selector} #${nth} is declared`).toBeDefined();
  const body = source.slice(
    source.indexOf("{", start) + 1,
    source.indexOf("}", start),
  );
  return new Map(
    [...body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((
      [, name, value],
    ) => [name!, value!.trim()]),
  );
}

/** The shadcn/ui theme variables its components are written against. */
const SHADCN_VARIABLES = [
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--muted-foreground",
  "--accent-foreground",
  "--destructive",
  "--border",
  "--input",
  "--ring",
  "--radius",
];

describe("GAP-026 island theme", () => {
  const light = block(tokens, ":root");
  const shadcn = block(tokens, ":root", 1);
  const mediaDark = block(tokens, '  :root:not([data-theme="light"])');
  const dark = block(tokens, ':root[data-theme="dark"]');

  it("declares every shadcn theme variable as one UXD-001 token", () => {
    expect([...shadcn.keys()]).toEqual(SHADCN_VARIABLES);
    for (const name of SHADCN_VARIABLES) {
      const value = shadcn.get(name);
      expect(value, `${name} names one token`).toMatch(
        /^var\(--[a-z0-9-]+\)$/,
      );
      const token = value!.slice(4, -1);
      expect(light.has(token), `${token} is a UXD-001 token`).toBe(true);
    }
  });

  it("follows the dark theme through the tokens it names", () => {
    for (const name of SHADCN_VARIABLES) {
      if (name === "--radius") continue;
      const token = shadcn.get(name)!.slice(4, -1);
      expect(mediaDark.has(token), `${token} follows the OS theme`).toBe(true);
      expect(dark.has(token), `${token} follows data-theme`).toBe(true);
      // One declaration serves both themes; a second copy could drift.
      expect(dark.has(name), `${name} is declared once`).toBe(false);
      expect(light.has(name), `${name} is declared once`).toBe(false);
    }
  });

  it("declares no variable the hand-written stylesheets already read", () => {
    // A name the existing CSS reads (even with a fallback, as `--muted` is)
    // would silently change what it draws on every page.
    const handWritten = readdirSync(styles)
      .filter((file) =>
        file.endsWith(".css") && !["tokens.css", "islands.css"].includes(file)
      )
      .map((file) => readFileSync(resolve(styles, file), "utf8"))
      .join("\n");
    for (const name of shadcn.keys()) {
      expect(handWritten, `${name} is not read by hand-written CSS`).not
        .toMatch(new RegExp(`var\\(\\s*${name}\\s*[,)]`));
    }
    expect(islands).toMatch(/--color-muted:\s*var\(--surface-sunken\);/);
  });

  it("keeps the design system's own accent token", () => {
    expect(light.get("--accent")).toBe("#a44730");
    expect(shadcn.has("--accent")).toBe(false);
    expect(shadcn.has("--muted")).toBe(false);
    expect(islands).toMatch(/--color-accent:\s*var\(--accent-soft\);/);
  });

  it("adds Tailwind in layers, without preflight, scanning only islands", () => {
    expect(islands).not.toMatch(/preflight/);
    expect(islands).not.toMatch(/@import\s+["']tailwindcss["']/);
    const imports = [...islands.matchAll(/^@import\s+([^;]+);/gm)].map((
      [, rule],
    ) => rule!);
    expect(imports).toEqual([
      '"tailwindcss/theme.css" layer(theme)',
      '"tailwindcss/utilities.css" layer(utilities) source(none)',
    ]);
    expect(
      [...islands.matchAll(/^@source\s+([^;]+);/gm)].map(([, rule]) => rule),
    )
      .toEqual([
        '"../islands"',
        '"../components/ui"',
        'not "../islands/**/*.test.tsx"',
      ]);
    for (const name of SHADCN_VARIABLES) {
      if (name === "--radius") continue;
      expect(islands).toContain(`--color-${name.slice(2)}: var(${name});`);
    }
  });
});
