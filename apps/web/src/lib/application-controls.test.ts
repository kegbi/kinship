// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readApplicationStylesheet } from "./application-stylesheet.test-helper.ts";

const applicationCss = readApplicationStylesheet();
const todayPage = readFileSync("apps/web/src/pages/app.astro", "utf8");

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
    ).toBe("white");
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
      expect(computed.backgroundColor).toBe("white");
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
      expect(computed.boxShadow).toContain("inset 0 0 0 2px white");
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
    expect(computed.boxShadow).toContain("inset 0 0 0 2px white");
    expect(computed.boxShadow).toContain("inset 0 0 0 5px #a44730");
    expect(computed.boxShadow.match(/inset/g)).toHaveLength(2);
    expect(applicationCss).toMatch(
      /@media \(forced-colors: active\)[\s\S]*\.profile-section-card:focus[\s\S]*outline-offset:\s*-3px/,
    );
  });
});
