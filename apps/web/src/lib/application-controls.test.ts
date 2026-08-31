// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readApplicationStylesheet } from "./application-stylesheet.test-helper.ts";

const applicationCss = readApplicationStylesheet();
const tokensCss = readFileSync("apps/web/src/styles/tokens.css", "utf8");
const todayPage = readFileSync("apps/web/src/pages/app.astro", "utf8");
const layoutPaths = [
  "apps/web/src/layouts/ApplicationLayout.astro",
  "apps/web/src/layouts/AuthLayout.astro",
  "apps/web/src/layouts/PublicLayout.astro",
] as const;
const nonTokenStylesheetPaths = [
  "apps/web/src/styles/base.css",
  "apps/web/src/styles/shell.css",
  "apps/web/src/styles/settings.css",
  "apps/web/src/styles/components.css",
  "apps/web/src/styles/person.css",
] as const;
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

function mountStyles(): void {
  const style = document.createElement("style");
  style.textContent = applicationCss;
  document.head.append(style);
}

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

describe("application control presentation", () => {
  it("overrides every theme-dependent custom property in dark mode", () => {
    const lightRoot = tokensCss.match(/^:root\s*\{([^}]*)\}/)?.[1] ?? "";
    const darkRoot = tokensCss.match(
      /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{\s*:root\s*\{([^}]*)\}/,
    )?.[1] ?? "";
    const customProperties = (block: string): string[] =>
      Array.from(
        block.matchAll(/(--[a-z0-9-]+)\s*:/gi),
        (match) => match[1]!,
      );
    const deliberatelyInherited = (name: string): boolean =>
      name === "--line-hairline" ||
      name.startsWith("--radius-") ||
      name.startsWith("--space-");
    const lightProperties = customProperties(lightRoot).filter(
      (name) => !deliberatelyInherited(name),
    );

    expect(lightProperties.length).toBeGreaterThan(0);
    expect(customProperties(darkRoot).sort()).toEqual(lightProperties.sort());
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

  it("loads Inter Variable before the application root stack uses it", () => {
    expect(applicationCss).toMatch(
      /@font-face\s*\{[^}]*font-family:\s*"Inter Variable";[^}]*\}[\s\S]*:root\s*\{[^}]*font-family:\s*"Inter Variable",\s*Inter,\s*ui-sans-serif,\s*system-ui,\s*sans-serif;/,
    );
  });

  it("presents primary, secondary, and danger anchors and buttons consistently", () => {
    mountStyles();
    const openAllClasses = todayPage.match(
      /<a class="([^"]+)" href="\/app\/tasks">Open all tasks<\/a>/,
    )?.[1];
    expect(openAllClasses).toBeTruthy();

    const controls = [
      ["button", "button-primary"],
      ["a", "button-primary"],
      ["button", "button-secondary"],
      ["a", openAllClasses!],
      ["button", "button-danger"],
      ["a", "button-danger"],
    ] as const;
    for (const [tagName, className] of controls) {
      const control = document.createElement(tagName);
      control.className = className;
      control.textContent = className.includes("today-touch-target")
        ? "Open all tasks"
        : "Action";
      document.body.append(control);
      const computed = getComputedStyle(control);
      expect(computed.display).toBe("inline-flex");
      expect(computed.alignItems).toBe("center");
      expect(computed.justifyContent).toBe("center");
      expect(computed.minHeight).toBe("44px");
      expect(computed.paddingTop).toBe("10.4px");
      expect(computed.paddingRight).toBe("14.4px");
      expect(computed.borderRadius).toBe("10.4px");
      expect(computed.fontWeight).toBe("750");
      expect(computed.lineHeight).toBe("1.2");
      if (tagName === "a") expect(computed.textDecoration).toBe("none");
    }

    const openAll = document.body.querySelector<HTMLElement>(
      "a.today-touch-target",
    )!;
    expect(getComputedStyle(openAll).paddingRight).toBe("14.4px");
    expect(
      getComputedStyle(document.body.querySelector(".button-primary")!)
        .backgroundColor,
    ).toBe("#20352d");
    expect(
      getComputedStyle(document.body.querySelector(".button-danger")!)
        .backgroundColor,
    ).toBe("#a44730");

    const disabledButton = document.body.querySelector<HTMLButtonElement>(
      "button.button-primary",
    )!;
    disabledButton.disabled = true;
    expect(Number(getComputedStyle(disabledButton).opacity)).toBe(.55);
    expect(getComputedStyle(disabledButton).cursor).toBe("not-allowed");
    const disabledLink = document.body.querySelector<HTMLAnchorElement>(
      "a.button-danger",
    )!;
    disabledLink.setAttribute("aria-disabled", "true");
    expect(Number(getComputedStyle(disabledLink).opacity)).toBe(.55);
    expect(getComputedStyle(disabledLink).pointerEvents).toBe("none");
  });

  it("keeps semantic buttons and links aligned inside mixed form action rows", () => {
    mountStyles();
    const row = document.createElement("div");
    row.className = "form-actions";
    for (const variant of ["primary", "secondary", "danger"] as const) {
      for (const tagName of ["button", "a"] as const) {
        const control = document.createElement(tagName);
        control.className = `button-${variant}`;
        control.textContent = `${variant} ${tagName}`;
        row.append(control);
      }
    }
    document.body.append(row);

    for (const variant of ["primary", "secondary", "danger"] as const) {
      const [button, link] = [
        row.querySelector<HTMLElement>(`button.button-${variant}`)!,
        row.querySelector<HTMLElement>(`a.button-${variant}`)!,
      ];
      const buttonStyle = getComputedStyle(button);
      const linkStyle = getComputedStyle(link);
      for (
        const property of [
          "minHeight",
          "paddingTop",
          "paddingRight",
          "borderRadius",
          "lineHeight",
        ] as const
      ) {
        expect(buttonStyle[property]).toBe(linkStyle[property]);
      }
      expect(buttonStyle.color).toBe(linkStyle.color);
      expect(buttonStyle.backgroundColor).toBe(linkStyle.backgroundColor);
    }
    expect(
      getComputedStyle(row.querySelector(".button-primary")!)
        .backgroundColor,
    ).toBe("#20352d");
    expect(
      getComputedStyle(row.querySelector(".button-secondary")!)
        .backgroundColor,
    ).toBe("#fffdf8");
    expect(
      getComputedStyle(row.querySelector(".button-danger")!)
        .backgroundColor,
    ).toBe("#a44730");
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
      expect(computed.font).toBe("inherit");
      expect(computed.color).toBe("inherit");
      expect(computed.backgroundColor).toBe("#fffdf8");
      expect(computed.borderTopWidth).toBe("1px");
      expect(computed.borderRadius).toBe("9.6px");
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

  it("keeps the keyboard focus indicator inside interactive controls only", () => {
    mountStyles();
    const buttons = ["primary", "secondary", "danger"].map((variant) => {
      const button = document.createElement("button");
      button.className = `button-${variant}`;
      return button;
    });
    const input = document.createElement("input");
    const select = document.createElement("select");
    const textarea = document.createElement("textarea");
    const link = document.createElement("a");
    link.href = "#target";
    const summary = document.createElement("summary");
    const status = document.createElement("main");
    status.tabIndex = -1;
    document.body.append(
      ...buttons,
      input,
      select,
      textarea,
      link,
      summary,
      status,
    );

    for (
      const control of [...buttons, input, select, textarea, link, summary]
    ) {
      control.focus();
      const computed = getComputedStyle(control);
      expect(computed.outlineStyle).toBe("none");
      expect(computed.outlineOffset).not.toBe("3px");
      expect(computed.boxShadow).toContain("inset 0 0 0 2px #fffdf8");
      expect(computed.boxShadow).toContain("inset 0 0 0 5px #a44730");
      expect(computed.boxShadow.match(/inset/g)).toHaveLength(2);
    }
    status.focus();
    expect(getComputedStyle(status).boxShadow).not.toContain("inset");
  });

  it("keeps programmatic profile-section focus inside the card", () => {
    mountStyles();
    const card = document.createElement("section");
    card.className = "profile-section-card";
    card.tabIndex = -1;
    document.body.append(card);
    card.focus();

    const computed = getComputedStyle(card);
    expect(computed.outlineStyle).toBe("none");
    expect(Number.parseFloat(computed.outlineOffset)).toBe(0);
    expect(computed.boxShadow).toContain("inset 0 0 0 2px #fffdf8");
    expect(computed.boxShadow).toContain("inset 0 0 0 5px #a44730");
    expect(computed.boxShadow.match(/inset/g)).toHaveLength(2);
    expect(applicationCss).toMatch(
      /@media \(forced-colors: active\)[\s\S]*\.profile-section-card:focus[\s\S]*outline-offset:\s*-3px/,
    );
  });
});
