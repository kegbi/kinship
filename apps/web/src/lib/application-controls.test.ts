// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  PROTECTED_CASCADE,
  readApplicationStylesheet,
} from "./application-stylesheet.test-helper.ts";
import {
  buttonVariants,
  formActionsVariants,
} from "../components/ui/variants.ts";

const applicationCss = readApplicationStylesheet();
const tokensCss = readFileSync("apps/web/src/styles/tokens.css", "utf8");
const applicationLayout = readFileSync(
  "apps/web/src/layouts/ApplicationLayout.astro",
  "utf8",
);
const themeSource = readFileSync("apps/web/src/lib/theme.ts", "utf8");
const themeBootstrap = readFileSync(
  "apps/web/src/components/ThemeBootstrap.astro",
  "utf8",
);
const todayPage = readFileSync("apps/web/src/pages/app.astro", "utf8");
const layoutPaths = [
  "apps/web/src/layouts/ApplicationLayout.astro",
  "apps/web/src/layouts/AuthLayout.astro",
  "apps/web/src/layouts/PublicLayout.astro",
] as const;
/** Every protected stylesheet except the fonts and tokens (FER-09). */
const nonTokenStylesheetPaths = PROTECTED_CASCADE
  .filter((name) => name !== "fonts" && name !== "tokens")
  .map((name) => `apps/web/src/styles/${name}.css`);
const cssNamedColors = [
  "aliceblue",
  "antiquewhite",
  "aqua",
  "aquamarine",
  "azure",
  "beige",
  "bisque",
  "black",
  "blanchedalmond",
  "blue",
  "blueviolet",
  "brown",
  "burlywood",
  "cadetblue",
  "chartreuse",
  "chocolate",
  "coral",
  "cornflowerblue",
  "cornsilk",
  "crimson",
  "cyan",
  "darkblue",
  "darkcyan",
  "darkgoldenrod",
  "darkgray",
  "darkgreen",
  "darkgrey",
  "darkkhaki",
  "darkmagenta",
  "darkolivegreen",
  "darkorange",
  "darkorchid",
  "darkred",
  "darksalmon",
  "darkseagreen",
  "darkslateblue",
  "darkslategray",
  "darkslategrey",
  "darkturquoise",
  "darkviolet",
  "deeppink",
  "deepskyblue",
  "dimgray",
  "dimgrey",
  "dodgerblue",
  "firebrick",
  "floralwhite",
  "forestgreen",
  "fuchsia",
  "gainsboro",
  "ghostwhite",
  "gold",
  "goldenrod",
  "gray",
  "green",
  "greenyellow",
  "grey",
  "honeydew",
  "hotpink",
  "indianred",
  "indigo",
  "ivory",
  "khaki",
  "lavender",
  "lavenderblush",
  "lawngreen",
  "lemonchiffon",
  "lightblue",
  "lightcoral",
  "lightcyan",
  "lightgoldenrodyellow",
  "lightgray",
  "lightgreen",
  "lightgrey",
  "lightpink",
  "lightsalmon",
  "lightseagreen",
  "lightskyblue",
  "lightslategray",
  "lightslategrey",
  "lightsteelblue",
  "lightyellow",
  "lime",
  "limegreen",
  "linen",
  "magenta",
  "maroon",
  "mediumaquamarine",
  "mediumblue",
  "mediumorchid",
  "mediumpurple",
  "mediumseagreen",
  "mediumslateblue",
  "mediumspringgreen",
  "mediumturquoise",
  "mediumvioletred",
  "midnightblue",
  "mintcream",
  "mistyrose",
  "moccasin",
  "navajowhite",
  "navy",
  "oldlace",
  "olive",
  "olivedrab",
  "orange",
  "orangered",
  "orchid",
  "palegoldenrod",
  "palegreen",
  "paleturquoise",
  "palevioletred",
  "papayawhip",
  "peachpuff",
  "peru",
  "pink",
  "plum",
  "powderblue",
  "purple",
  "rebeccapurple",
  "red",
  "rosybrown",
  "royalblue",
  "saddlebrown",
  "salmon",
  "sandybrown",
  "seagreen",
  "seashell",
  "sienna",
  "silver",
  "skyblue",
  "slateblue",
  "slategray",
  "slategrey",
  "snow",
  "springgreen",
  "steelblue",
  "tan",
  "teal",
  "thistle",
  "tomato",
  "turquoise",
  "violet",
  "wheat",
  "white",
  "whitesmoke",
  "yellow",
  "yellowgreen",
].join("|");
const colorLiteralPattern = new RegExp(
  `#[0-9a-f]{3,8}(?![0-9a-f])|(?<![-\\w])(?:rgb|rgba|hsl|hsla)\\s*\\(|(?<![-\\w])(?:${cssNamedColors})(?![-\\w])`,
  "gi",
);
const spacingPropertyPattern =
  /^(?:padding(?:-[a-z-]+)?|margin(?:-[a-z-]+)?|gap|row-gap|column-gap)$/;
const spacingTokenPattern = /^var\(--(?:space-[1-8]|pad-card|pad-block)\)$/;
const percentagePattern = /^(?:\d+(?:\.\d+)?|\.\d+)%$/;
const approvedPageLevelSpacing = [
  {
    path: "apps/web/src/styles/base.css",
    selector: ".access-card",
    property: "padding",
    value: "clamp(var(--space-5), 5vw, var(--space-7))",
    // Page-level access-state padding already follows the accepted responsive scale.
  },
  {
    path: "apps/web/src/styles/shell.css",
    selector: ".page-frame",
    property: "padding",
    value: "clamp(var(--space-6), 6vw, var(--space-8)) 0 var(--space-8)",
    // The application page frame keeps responsive padding with grid-aligned endpoints.
  },
  {
    path: "apps/web/src/styles/person-hero.css",
    selector: ".person-profile-hero",
    property: "padding",
    value: "clamp(var(--pad-card), 4vw, var(--space-6))",
    // Review §7.1 keeps the showcase hero responsive at page-level scale.
  },
] as const;
const spacingExceptions = [
  {
    path: "apps/web/src/styles/base.css",
    selector: "select",
    property: "padding",
    value: "var(--space-2) 2.35rem var(--space-2) var(--space-3)",
    // The second component clears the custom select caret rather than setting rhythm.
  },
  {
    path: "apps/web/src/styles/base.css",
    selector: ".sr-only",
    property: "margin",
    value: "-1px",
    // The accessibility clipping offset is geometry, not visual rhythm.
  },
  {
    path: "apps/web/src/styles/person-chrome.css",
    selector: ".person-workspace-layout",
    property: "gap",
    value: "1.25rem",
    // Review §7.5 fixes the 900–1199px person workspace gap at this value.
  },
  {
    path: "apps/web/src/styles/person-chrome.css",
    selector: ".profile-section-directory nav ul",
    property: "gap",
    value: ".1rem",
    // Compact rail navigation relies on link padding for its visible separation.
  },
  {
    path: "apps/web/src/styles/people.css",
    selector: ".directory-tag-picker legend",
    property: "margin",
    value: "-1px",
    // The visually hidden legend uses the standard clipping offset.
  },
  {
    path: "apps/web/src/styles/person-rail.css",
    selector: ".profile-rail-add > span",
    property: "padding-bottom",
    value: ".15em",
    // Optically centers the plus glyph in its circle; it scales with the glyph.
  },
  {
    path: "apps/web/src/styles/shell.css",
    selector: ".primary-nav",
    property: "margin",
    value: "calc(-1 * var(--space-1))",
    // Compensates the matching focus-outline clearance padding inside its scrollport.
  },
  {
    path: "apps/web/src/styles/settings.css",
    selector: ".import-review > legend + p, .import-review-group > legend + p",
    property: "margin-top",
    value: "calc(var(--space-2) - var(--space-4))",
    // Reduces the grid's space-4 gap to the space-2 heading-description rhythm.
  },
] as const;

function withoutForcedColorsBlocks(stylesheet: string): string {
  const source = stylesheet.replace(/\/\*[\s\S]*?\*\//g, "");
  const forcedColorsStart =
    /@media\s*\(\s*forced-colors\s*:\s*active\s*\)\s*\{/gi;
  let result = "";
  let sourceIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = forcedColorsStart.exec(source)) !== null) {
    result += source.slice(sourceIndex, match.index);
    let depth = 1;
    let blockIndex = forcedColorsStart.lastIndex;
    while (depth > 0 && blockIndex < source.length) {
      if (source[blockIndex] === "{") depth += 1;
      if (source[blockIndex] === "}") depth -= 1;
      blockIndex += 1;
    }
    if (depth !== 0) throw new Error("Unclosed forced-colors media block");
    sourceIndex = blockIndex;
    forcedColorsStart.lastIndex = blockIndex;
  }

  return result + source.slice(sourceIndex);
}

interface SpacingDeclaration {
  path: string;
  selector: string;
  property: string;
  value: string;
}

function collectSpacingDeclarations(path: string): SpacingDeclaration[] {
  const stylesheet = withoutForcedColorsBlocks(readFileSync(path, "utf8"));
  return Array.from(stylesheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)).flatMap(
    (rule) => {
      const selector = rule[1]!.trim().replace(/\s+/g, " ");
      return Array.from(
        rule[2]!.matchAll(/(?:^|;)\s*([a-z-]+)\s*:\s*([^;]+)/g),
        (declaration): SpacingDeclaration => ({
          path,
          selector,
          property: declaration[1]!,
          value: declaration[2]!.trim().replace(/\s+/g, " "),
        }),
      ).filter(({ property }) => spacingPropertyPattern.test(property));
    },
  );
}

function isApprovedSpacing(declaration: SpacingDeclaration): boolean {
  const matches = (approved: SpacingDeclaration): boolean =>
    approved.path === declaration.path &&
    approved.selector === declaration.selector &&
    approved.property === declaration.property &&
    approved.value === declaration.value;

  if (approvedPageLevelSpacing.some(matches)) return true;
  if (spacingExceptions.some(matches)) return true;

  return declaration.value.split(/\s+/).every((component) =>
    component === "0" ||
    component === "auto" ||
    spacingTokenPattern.test(component) ||
    percentagePattern.test(component)
  );
}

function mountStyles(): void {
  const style = document.createElement("style");
  style.textContent = applicationCss;
  document.head.append(style);
}

/**
 * The values the mounted top-level rules matching `element` declare for
 * `property`. A computed `inherit` is already resolved to the parent's value,
 * and the test DOM has no built-in control styles for it to differ from, so a
 * reset to `inherit` is read from the rules themselves.
 */
function declaredValues(element: Element, property: string): string[] {
  return [...document.styleSheets]
    .flatMap((sheet) => [...sheet.cssRules])
    .filter((rule): rule is CSSStyleRule =>
      rule instanceof CSSStyleRule && element.matches(rule.selectorText)
    )
    .map((rule) => rule.style.getPropertyValue(property));
}

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

describe("the stylesheets the invariants read", () => {
  it("are every protected stylesheet except the fonts and tokens", () => {
    expect(nonTokenStylesheetPaths).toHaveLength(PROTECTED_CASCADE.length - 2);
    expect(nonTokenStylesheetPaths).toContain(
      "apps/web/src/styles/person-chrome.css",
    );
    expect(nonTokenStylesheetPaths).toContain(
      "apps/web/src/styles/settings.css",
    );
  });
});

describe("application control presentation", () => {
  it("overrides every theme-dependent custom property in dark mode", () => {
    const lightRoot = tokensCss.match(/^:root\s*\{([^}]*)\}/)?.[1] ?? "";
    const mediaDarkRoot = tokensCss.match(
      /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{([^}]*)\}/,
    )?.[1] ?? "";
    const explicitDarkRoot = tokensCss.match(
      /:root\[data-theme="dark"\]\s*\{([^}]*)\}/,
    )?.[1] ?? "";
    const customProperties = (block: string): Record<string, string> =>
      Object.fromEntries(Array.from(
        block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi),
        (match) => [match[1]!, match[2]!.trim()],
      ));
    const deliberatelyInherited = (name: string): boolean =>
      name === "--line-hairline" ||
      name.startsWith("--radius-") ||
      name.startsWith("--space-") ||
      name.startsWith("--pad-");
    const lightProperties = Object.fromEntries(
      Object.entries(customProperties(lightRoot)).filter(
        ([name]) => !deliberatelyInherited(name),
      ),
    );

    expect(Object.keys(lightProperties).length).toBeGreaterThan(0);
    const mediaDarkProperties = customProperties(mediaDarkRoot);
    const explicitDarkProperties = customProperties(explicitDarkRoot);
    expect(explicitDarkProperties).toEqual(mediaDarkProperties);
    expect(Object.keys(mediaDarkProperties).sort()).toEqual(
      Object.keys(lightProperties).sort(),
    );

    const themeSelectorSpecificity = (selector: string) => [
      0,
      (selector.match(/:root/g) ?? []).length +
      (selector.match(/\[data-theme(?:="[^"]+")?\]/g) ?? []).length,
      0,
    ];
    expect(themeSelectorSpecificity(':root:not([data-theme="light"])'))
      .toEqual([0, 2, 0]);
    expect(themeSelectorSpecificity(':root[data-theme="dark"]')).toEqual([
      0,
      2,
      0,
    ]);
  });

  it("runs the local theme cache inline in the application head", () => {
    const headStart = applicationLayout.indexOf("<head>");
    const headEnd = applicationLayout.indexOf("</head>");
    const bootstrapIndex = applicationLayout.indexOf("<ThemeBootstrap />");
    const inlineScript = themeBootstrap.match(
      /<script\s+is:inline>([\s\S]*?)<\/script>/,
    );
    const layoutStorageKey = inlineScript?.[1]?.match(
      /localStorage\.getItem\("([^"]+)"\)/,
    )?.[1];
    const runtimeStorageKey = themeSource.match(
      /const THEME_STORAGE_KEY = "([^"]+)"/,
    )?.[1];

    expect(bootstrapIndex).toBeGreaterThan(headStart);
    expect(bootstrapIndex).toBeLessThan(headEnd);
    expect(layoutStorageKey).toBe("kinship.theme");
    expect(runtimeStorageKey).toBe(layoutStorageKey);
    expect(inlineScript?.[1]).not.toMatch(/matchMedia|theme-color/);
  });

  it("advertises native light and dark color schemes", () => {
    const lightRoot = tokensCss.match(/^:root\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(lightRoot).toMatch(/color-scheme:\s*light dark;/);
  });

  it("declares light and dark theme colors in every layout", () => {
    for (const path of layoutPaths) {
      const layout = readFileSync(path, "utf8");
      const themeColorTags = Array.from(
        layout.matchAll(/<meta\b[^>]*\bname="theme-color"[^>]*\/>/g),
        ([tag]) => tag,
      );
      const mediaValues = themeColorTags.map((tag) =>
        tag.match(/\bmedia="([^"]+)"/)?.[1]
      ).sort();

      expect(themeColorTags, path).toHaveLength(2);
      expect(mediaValues, path).toEqual([
        "(prefers-color-scheme: dark)",
        "(prefers-color-scheme: light)",
      ]);
    }
  });

  it("references only declared custom properties when no fallback is provided", () => {
    const declaredProperties = new Set(
      Array.from(
        applicationCss.matchAll(/(--[a-z0-9-]+)\s*:/gi),
        ([, name]) => name,
      ),
    );
    const undeclaredProperties = Array.from(
      new Set(
        Array.from(
          applicationCss.matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/gi),
          ([, name]) => name,
        ).filter((name) => !declaredProperties.has(name)),
      ),
    ).sort();

    expect(undeclaredProperties).toEqual([]);
  });

  it("keeps literal colors confined to the token stylesheet", () => {
    const violations = nonTokenStylesheetPaths.flatMap((path) => {
      const stylesheet = withoutForcedColorsBlocks(readFileSync(path, "utf8"));
      return Array.from(
        stylesheet.matchAll(colorLiteralPattern),
        (match) => `${path}:${match[0]}`,
      );
    });

    expect(
      violations,
      `Found ${violations.length} hard-coded color literals outside tokens.css`,
    ).toEqual([]);
  });

  it("keeps application font weights within the approved numeric set", () => {
    const violations = nonTokenStylesheetPaths.flatMap((path) =>
      Array.from(
        readFileSync(path, "utf8").matchAll(/font-weight:\s*([^;]+);/g),
        (match) => `${path}:${match[1]?.trim()}`,
      ).filter((entry) => !/:(?:400|500|600|700)$/.test(entry))
    );

    expect(
      violations,
      `Found ${violations.length} font weights outside 400, 500, 600, and 700`,
    ).toEqual([]);
  });

  it("keeps application spacing on the approved rhythm", () => {
    const violations = nonTokenStylesheetPaths.flatMap((path) =>
      collectSpacingDeclarations(path).filter((declaration) =>
        !isApprovedSpacing(declaration)
      ).map(({ path, selector, property, value }) =>
        `${path}:${selector}:${property}: ${value}`
      )
    );

    expect(
      violations,
      `Found ${violations.length} spacing declarations outside the approved rhythm`,
    ).toEqual([]);
  });

  it("loads Inter Variable and its metric-matched fallback before the application root stack uses them", () => {
    // FER-12: text paints in the fallback face until Inter swaps in.
    expect(applicationCss).toMatch(
      /@font-face\s*\{[^}]*font-family:\s*"Inter Variable";[^}]*\}[\s\S]*@font-face\s*\{[^}]*font-family:\s*"Inter Fallback";[^}]*size-adjust:[^}]*\}[\s\S]*:root\s*\{[^}]*font-family:\s*"Inter Variable",\s*"Inter Fallback",\s*Inter,\s*ui-sans-serif,\s*system-ui,\s*sans-serif;/,
    );
  });

  it("presents primary, secondary, and danger anchors and buttons from one variant definition", () => {
    // GAP-027: the look lives in components/ui/variants.ts, which static,
    // vanilla, and island markup all call; no stylesheet redraws it.
    expect(applicationCss).not.toMatch(
      /\.(?:button-(?:primary|secondary|danger|link)|state-badge|form-actions)\b/,
    );
    const openAllClasses = todayPage.match(
      /<a class=\{([^}]+\})\)\} href="\/app\/tasks">Open all tasks<\/a>/,
    )?.[1];
    expect(openAllClasses).toBe(
      'buttonVariants({ variant: "outline", wrap: true }',
    );
    for (const variant of ["default", "outline", "destructive"] as const) {
      const classes = buttonVariants({ variant }).split(" ");
      // A button and a link that names the same variant draw the same box:
      // a 44px target, 8px by 16px padding, the small radius, semibold text
      // on a 1.2 line, never underlined.
      for (
        const token of [
          "inline-flex",
          "items-center",
          "justify-center",
          "min-h-11",
          "py-(--space-2)",
          "px-(--space-4)",
          "rounded-(--radius-sm)",
          "font-semibold",
          "leading-[1.2]",
          "no-underline",
          "disabled:opacity-55",
          "disabled:cursor-not-allowed",
          "aria-disabled:opacity-55",
          "aria-disabled:pointer-events-none",
        ]
      ) expect(classes).toContain(token);
    }
    // Primary is the indigo accent (#4f46e5) and danger its own red (#b91c1c).
    expect(tokensCss).toMatch(/--primary:\s*var\(--accent-solid\);/);
    expect(tokensCss).toMatch(/--accent:\s*#4f46e5;/);
    expect(buttonVariants().split(" ")).toContain("bg-primary");
    expect(tokensCss).toMatch(/--danger:\s*#b91c1c;/);
    expect(buttonVariants({ variant: "destructive" }).split(" ")).toContain(
      "bg-(--danger)",
    );
  });

  it("keeps semantic buttons and links aligned inside mixed form action rows", () => {
    expect(formActionsVariants()).toBe("flex flex-wrap gap-(--space-3)");
    const row = document.createElement("div");
    row.className = formActionsVariants();
    for (const variant of ["default", "outline", "destructive"] as const) {
      for (const tagName of ["button", "a"] as const) {
        const control = document.createElement(tagName);
        control.className = buttonVariants({ variant });
        control.dataset.variant = variant;
        row.append(control);
      }
    }
    document.body.append(row);
    for (const variant of ["default", "outline", "destructive"] as const) {
      const [button, link] = [
        row.querySelector<HTMLElement>(`button[data-variant="${variant}"]`)!,
        row.querySelector<HTMLElement>(`a[data-variant="${variant}"]`)!,
      ];
      expect(button.className).toBe(link.className);
    }
  });

  it("styles ordinary single and multiple selects without forcing a caret on multiple selects", () => {
    mountStyles();
    const single = document.createElement("select");
    const multiple = document.createElement("select");
    multiple.multiple = true;
    document.body.append(single, multiple);

    for (const select of [single, multiple]) {
      const computed = getComputedStyle(select);
      expect(computed.minHeight).toBe("44px");
      expect(declaredValues(select, "font")).toContain("inherit");
      expect(declaredValues(select, "color")).toContain("inherit");
      expect(computed.backgroundColor).toBe("#ffffff");
      expect(computed.borderTopWidth).toBe("1px");
      expect(computed.borderRadius).toBe("8px");
      expect(computed.maxWidth).toBe("100%");
      expect(computed.cursor).toBe("pointer");
    }
    expect(getComputedStyle(single).backgroundImage).not.toBe("none");
    expect(getComputedStyle(multiple).backgroundImage).toBe("none");
    expect(applicationCss).toMatch(
      /@media \(forced-colors: active\)[\s\S]*select:not\(\[multiple\]\)\s*\{[^}]*appearance:\s*auto;[^}]*padding-right:\s*\.75rem;[^}]*background-image:\s*none;/,
    );

    single.disabled = true;
    expect(getComputedStyle(single).cursor).toBe("not-allowed");
    expect(Number(getComputedStyle(single).opacity)).toBe(.65);
  });

  it("keeps keyboard focus outside interactive content, including programmatic menu controls", () => {
    mountStyles();
    const buttons = (["default", "outline", "destructive"] as const).map((
      variant,
    ) => {
      const button = document.createElement("button");
      button.className = buttonVariants({ variant });
      // The focus ring is the application's; no variant draws its own.
      expect(button.className).not.toMatch(
        /(?:^|\s)(?:\S*:)?(?:outline|ring)-/,
      );
      return button;
    });
    const input = document.createElement("input");
    const select = document.createElement("select");
    const textarea = document.createElement("textarea");
    const link = document.createElement("a");
    link.href = "#target";
    const summary = document.createElement("summary");
    const menuButton = document.createElement("button");
    menuButton.tabIndex = -1;
    menuButton.setAttribute("role", "menuitem");
    const status = document.createElement("main");
    status.tabIndex = -1;
    document.body.append(
      ...buttons,
      input,
      select,
      textarea,
      link,
      summary,
      menuButton,
      status,
    );

    for (
      const control of [
        ...buttons,
        link,
        summary,
        menuButton,
      ]
    ) {
      control.focus();
      const computed = getComputedStyle(control);
      expect(computed.outlineStyle).toBe("solid");
      expect(computed.outlineWidth).toBe("2px");
      expect(computed.outlineOffset).toBe("2px");
      expect(computed.outlineColor).toBe("#6366f1");
      expect(computed.boxShadow).not.toContain("inset");
    }
    // A text field takes focus as an accent border and a soft halo; its
    // transparent outline is what forced-colors mode paints.
    for (const control of [input, select, textarea]) {
      control.focus();
      const computed = getComputedStyle(control);
      expect(computed.outlineStyle).toBe("solid");
      expect(computed.outlineWidth).toBe("2px");
      expect(computed.outlineColor).toBe("transparent");
      expect(computed.boxShadow).toMatch(/^0 0 0 3px /);
      expect(computed.boxShadow).not.toContain("inset");
    }
    status.focus();
    expect(getComputedStyle(status).outlineStyle).toBe("none");
    expect(getComputedStyle(status).boxShadow).not.toContain("inset");
    expect(applicationCss).toMatch(
      /@media \(forced-colors: active\)[\s\S]*:where\(a\[href\], button, input, select, textarea, summary\):focus-visible\s*\{[^}]*outline-color:\s*Highlight;/,
    );
  });

  it.each(["person-form", "settings-form"])(
    "keeps full-strength keyboard focus on invalid controls in %s",
    (formClass) => {
      mountStyles();
      // Happy DOM does not compute color-mix outlines, so also verify that the
      // actual error-outline selector cannot override a keyboard-focused control.
      const invalidOutlineSelector = Array.from(
        applicationCss.matchAll(/([^{}]+)\{([^{}]*)\}/g),
      ).find((rule) =>
        rule[1]!.includes(`.${formClass} [aria-invalid="true"]`) &&
        /\boutline\s*:/.test(rule[2]!)
      )?.[1]?.trim();
      expect(invalidOutlineSelector).toBeTruthy();
      const form = document.createElement("form");
      form.className = formClass;
      document.body.append(form);
      // Native select focus selectors are covered by the browser regression.
      for (const tagName of ["input", "textarea"] as const) {
        const control = document.createElement(tagName);
        control.setAttribute("aria-invalid", "true");
        form.append(control);
        control.focus();
        expect(
          control.matches(invalidOutlineSelector!),
          `${tagName}: ${invalidOutlineSelector}`,
        )
          .toBe(false);
        const computed = getComputedStyle(control);
        expect(computed.outlineColor).toBe("transparent");
        expect(computed.outlineStyle).toBe("solid");
        expect(computed.outlineWidth).toBe("2px");
        expect(computed.boxShadow).toMatch(/^0 0 0 3px /);
        expect(computed.borderColor).toBe("#b91c1c");
      }
      const unfocused = document.createElement("input");
      unfocused.setAttribute("aria-invalid", "true");
      form.append(unfocused);
      expect(unfocused.matches(invalidOutlineSelector!)).toBe(true);
      expect(getComputedStyle(unfocused).borderColor).toBe("#b91c1c");
    },
  );

  it("cues page, heading, status, and profile-section focus with localized text decoration", () => {
    mountStyles();
    for (
      const [markup, cueSelector] of [
        ['<main tabindex="-1"><h1>Ada Focus</h1></main>', "h1"],
        ['<main><h1 tabindex="-1">Ada Focus</h1></main>', "h1"],
        [
          '<section class="profile-section-card" tabindex="-1"><header class="profile-section-heading"><h3>Contact methods</h3><button>Add</button></header></section>',
          "h3",
        ],
        [
          '<p class="profile-section-notice" role="status" tabindex="-1">Section turned off</p>',
          "p",
        ],
      ]
    ) {
      document.body.innerHTML = markup!;
      const destination = document.querySelector<HTMLElement>(
        '[tabindex="-1"]',
      )!;
      const cue = document.querySelector(cueSelector!)!;
      destination.focus();
      expect(getComputedStyle(destination).outlineStyle, destination.outerHTML)
        .toBe("none");
      expect(getComputedStyle(destination).boxShadow).not.toContain("inset");
      const cueStyle = getComputedStyle(cue);
      expect(cueStyle.textDecoration).toBe("underline");
      expect(cueStyle.textDecorationColor).toBe("#6366f1");
      expect(cueStyle.getPropertyValue("text-decoration-thickness")).toBe(
        "2px",
      );
      expect(cueStyle.getPropertyValue("text-underline-offset")).toBe(".2em");
      const button = destination.querySelector("button");
      if (button) {
        expect(getComputedStyle(button).textDecoration).not.toBe("underline");
      }
    }
    expect(applicationCss).toMatch(
      /@media \(forced-colors: active\)[\s\S]*\.profile-section-card:focus-visible[^}]*text-decoration-color:\s*Highlight;/,
    );
  });

  it("REL-046 never animates document scrolling, so a control stops moving before the next click lands", () => {
    // `scroll-behavior: smooth` turns every focus reveal and every
    // scroll-into-view (the browser's, a keyboard user's, or an automation
    // retry's) into a multi-frame glide, so a click aimed at a control lands
    // on whatever slides under the pointer. A section the reader picks glides
    // from script instead (`features/person/workspace.ts`).
    mountStyles();
    expect(getComputedStyle(document.documentElement).scrollBehavior)
      .not.toBe("smooth");
    expect(applicationCss).not.toMatch(/scroll-behavior:\s*smooth/);
  });

  it("sizes the notification badge in whole pixels so its count is centered", () => {
    // A fractional font size or line height leaves the digit's baseline
    // between two pixels. The browser then draws it on the upper one, and the
    // count sits a pixel above the middle of its circle.
    mountStyles();
    const badge = document.createElement("span");
    badge.className = "notification-bell-badge";
    document.body.append(badge);
    const pixels = (property: string): number => {
      const value = declaredValues(badge, property).find((found) =>
        found !== ""
      );
      expect(value, property).toMatch(/^\d*\.?\d+rem$/);
      return Number.parseFloat(value!) * 16;
    };
    const fontSize = pixels("font-size");
    const lineHeight = pixels("line-height");
    expect(Number.isInteger(fontSize), "font-size").toBe(true);
    expect(Number.isInteger(lineHeight), "line-height").toBe(true);
    // One digit sits in a circle: the badge is as wide as its line is tall.
    expect(pixels("min-width")).toBe(lineHeight);
    // Inter's ascent and descent are 1984 and 494 of 2048 units, and the
    // browser rounds each to a pixel. What is left of the line is split above
    // and below them, so it has to be an even number of pixels.
    const contentArea = Math.round(fontSize * 1984 / 2048) +
      Math.round(fontSize * 494 / 2048);
    expect((lineHeight - contentArea) % 2).toBe(0);
  });
});
