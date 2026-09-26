// @vitest-environment happy-dom

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const authCss = readFileSync("apps/web/src/styles/auth.css", "utf8");

/** Every page the auth layout (and so only `auth.css`) styles. */
function authPages(): readonly string[] {
  return ["apps/web/src/pages/auth", "apps/web/src/pages/invite"].flatMap((
    directory,
  ) =>
    readdirSync(directory).filter((name) => name.endsWith(".astro")).map((
      name,
    ) => join(directory, name))
  ).filter((path) => readFileSync(path, "utf8").includes("AuthLayout"));
}

/** The page's own markup, without its frontmatter, layout, or script. */
function pageMarkup(path: string): string {
  const main = /<main[\s\S]*<\/main>/.exec(readFileSync(path, "utf8"))?.[0];
  if (!main) throw new Error(`${path} has no main element.`);
  return main;
}

function mount(path: string): void {
  const style = document.createElement("style");
  style.textContent = authCss;
  document.head.replaceChildren(style);
  document.body.innerHTML = pageMarkup(path);
}

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

describe("REL-045 auth stylesheet", () => {
  it("keeps the invitation actions out of reach while the markup hides them", () => {
    mount("apps/web/src/pages/invite/[token].astro");
    const actions = document.querySelector<HTMLElement>("#invitation-actions")!;
    expect(actions.hidden).toBe(true);
    expect(getComputedStyle(actions).display).toBe("none");
  });

  it("never displays an element an auth page marks hidden", () => {
    const pages = authPages();
    expect(pages.length).toBeGreaterThan(1);
    for (const path of pages) {
      mount(path);
      for (
        const element of document.querySelectorAll<HTMLElement>("[hidden]")
      ) {
        expect(getComputedStyle(element).display, `${path} ${element.id}`)
          .toBe("none");
      }
    }
  });
});
