// @vitest-environment happy-dom

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const styles = resolve("apps/web/src/styles");
const read = (path: string) => readFileSync(resolve(path), "utf8");
const tokens = read("apps/web/src/styles/tokens.css");
const bootstrap = read("apps/web/src/components/ThemeBootstrap.astro");

/** The custom properties declared by the first rule whose selector is `selector`. */
function block(selector: string): Map<string, string> {
  const start = tokens.indexOf(`${selector} {`);
  expect(start, `${selector} is declared`).toBeGreaterThan(-1);
  const body = tokens.slice(
    tokens.indexOf("{", start) + 1,
    tokens.indexOf("}", start),
  );
  return new Map(
    [...body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((
      [, name, value],
    ) => [name!, value!.trim()]),
  );
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16))
    .map((value) => value / 255)
    .map((value) =>
      value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    );
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! +
    0.0722 * channels[2]!;
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high! + 0.05) / (low! + 0.05);
}

/** The inline script's source, without its element. */
function bootstrapScript(): string {
  const script = /<script is:inline>([\s\S]*?)<\/script>/.exec(bootstrap)?.[1];
  expect(script, "ThemeBootstrap carries one inline script").toBeDefined();
  return script!;
}

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
  localStorage.clear();
});

describe("member theme on every surface", () => {
  it.each([
    "AuthLayout.astro",
    "PublicLayout.astro",
    "ApplicationLayout.astro",
  ])("%s applies the saved theme before first paint", (layout) => {
    const source = read(`apps/web/src/layouts/${layout}`);
    const head = /<head>([\s\S]*?)<\/head>/.exec(source)?.[1] ?? "";
    expect(head).toContain("<ThemeBootstrap />");
    expect(source).not.toContain('localStorage.getItem("kinship.theme")');
  });

  it.each(["dark", "light"])(
    "the bootstrap forces a saved %s theme",
    (theme) => {
      localStorage.setItem("kinship.theme", theme);
      new Function(bootstrapScript())();
      expect(document.documentElement.dataset.theme).toBe(theme);
    },
  );

  it("the bootstrap leaves the system theme to the OS", () => {
    localStorage.setItem("kinship.theme", "sepia");
    new Function(bootstrapScript())();
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it.each(["auth.css", "public.css"])(
    "%s reads the theme tokens instead of pinning the light scheme",
    (sheet) => {
      const source = readFileSync(resolve(styles, sheet), "utf8");
      expect(source).toMatch(/@import "\.\/tokens\.css";/);
      expect(source).not.toMatch(/color-scheme:\s*light;/);
      // A literal white surface would stay white in the dark theme.
      expect(source).not.toMatch(/rgb\(255 255 255/);
    },
  );
});

describe("filled accent controls", () => {
  const light = block(":root");
  const mediaDark = block('  :root:not([data-theme="light"])');
  const dark = block(':root[data-theme="dark"]');

  it.each(
    [
      ["light", light],
      ["OS dark", mediaDark],
      ["forced dark", dark],
    ] as const,
  )(
    "keep readable text on the %s accent fill",
    (_theme, values) => {
      const fill = values.get("--accent-solid") ?? light.get("--accent-solid");
      const text = values.get("--on-accent") ?? light.get("--on-accent");
      expect(fill).toMatch(/^#[0-9a-f]{6}$/);
      expect(text).toMatch(/^#[0-9a-f]{6}$/);
      expect(contrast(fill!, text!)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("names the fill and its text for shadcn's primary", () => {
    expect(tokens).toMatch(/--primary:\s*var\(--accent-solid\);/);
    expect(tokens).toMatch(/--primary-foreground:\s*var\(--on-accent\);/);
  });

  it("never sets inverse ink on an accent fill", () => {
    for (
      const sheet of readdirSync(styles).filter((name) => name.endsWith(".css"))
    ) {
      const source = readFileSync(resolve(styles, sheet), "utf8");
      for (const [rule] of source.matchAll(/[^{}]*\{[^{}]*\}/g)) {
        if (/background(?:-color)?:\s*var\(--accent\)/.test(rule)) {
          expect(rule, `${sheet}: ${rule.trim().split("\n")[0]}`).not.toMatch(
            /color:\s*var\(--ink-inverse/,
          );
        }
      }
    }
  });
});
