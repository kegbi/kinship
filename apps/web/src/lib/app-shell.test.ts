// @vitest-environment happy-dom

import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { drawShell } from "../testing/render.tsx";
import { mountSettingsSearch } from "./app-shell.ts";

function search(query: string): void {
  const input = screen.getByRole<HTMLInputElement>("searchbox", {
    name: "Search settings",
  });
  input.value = query;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("settings overview search", () => {
  it("does not mount without the search, its empty state, or any item", () => {
    drawShell("<main></main>");
    mountSettingsSearch();
    expect(document.body.innerHTML).toBe("<main></main>");
  });
});

describe("settings search across individual settings", () => {
  function drawOverview(): void {
    drawShell(`
      <label for="settings-search">Search settings</label>
      <input id="settings-search" type="search">
      <nav aria-label="Settings categories">
        <a href="#personal" data-settings-nav="personal">Personal<span data-settings-nav-count hidden></span></a>
        <a href="#workspace" data-settings-nav="workspace">Workspace<span data-settings-nav-count hidden></span></a>
      </nav>
      <section id="personal" data-settings-group="personal">
        <h2>Personal</h2>
        <div data-settings-cards><article>Preferences card</article></div>
        <ul data-settings-matches hidden>
          <li data-settings-match data-search="theme appearance dark light mode"><a href="/app/settings/preferences#appearance-heading">Theme</a></li>
          <li data-settings-match data-search="time zone"><a href="/app/settings/preferences">Time zone</a></li>
        </ul>
      </section>
      <section id="workspace" data-settings-group="workspace">
        <h2>Workspace</h2>
        <div data-settings-cards><article>General card</article></div>
        <ul data-settings-matches hidden>
          <li data-settings-match data-search="default time zone"><a href="/app/settings/workspace">Default time zone</a></li>
          <li data-settings-match data-search="tags labels"><a href="/app/settings/personalization?section=tags">Tags</a></li>
        </ul>
      </section>
      <p id="settings-no-results" hidden>No settings match.</p>`);
    mountSettingsSearch();
  }

  const group = (id: string) =>
    document.querySelector<HTMLElement>(`[data-settings-group="${id}"]`)!;
  const nav = (id: string) =>
    document.querySelector<HTMLElement>(`[data-settings-nav="${id}"]`)!;

  it("finds a single setting such as the theme and links straight to it", () => {
    drawOverview();
    search("theme");

    const theme = screen.getByRole("link", { name: "Theme" });
    expect(theme.closest("li")!.hidden).toBe(false);
    expect(theme.closest("ul")!.hidden).toBe(false);
    expect(
      screen.getByRole("link", { hidden: true, name: "Time zone" }).closest(
        "li",
      )!.hidden,
    )
      .toBe(true);
    // The overview cards give way to the matching settings.
    expect(
      group("personal").querySelector<HTMLElement>("[data-settings-cards]")!
        .hidden,
    ).toBe(true);
    // A category without a match leaves the page and the navigation.
    expect(group("workspace").hidden).toBe(true);
    expect(nav("workspace").hidden).toBe(true);
    expect(nav("personal").hidden).toBe(false);
    expect(
      nav("personal").querySelector("[data-settings-nav-count]")!.textContent,
    )
      .toBe("1");
  });

  it("matches every word of the query in any order across categories", () => {
    drawOverview();
    search("zone time");

    expect(group("personal").hidden).toBe(false);
    expect(group("workspace").hidden).toBe(false);
    expect(
      nav("workspace").querySelector("[data-settings-nav-count]")!.textContent,
    )
      .toBe("1");
    expect(
      screen.getByRole("link", { hidden: true, name: "Tags" }).closest("li")!
        .hidden,
    )
      .toBe(true);
  });

  it("finds a setting typed on the other keyboard layout", () => {
    drawOverview();
    // "theme" typed with the Russian layout active.
    search("еруьу");
    expect(screen.getByRole("link", { name: "Theme" }).closest("li")!.hidden)
      .toBe(false);
    expect(group("workspace").hidden).toBe(true);
  });

  it("restores the overview when the query is cleared", () => {
    drawOverview();
    search("nothing like this");
    expect(screen.getByText("No settings match.").hidden).toBe(false);
    expect(group("personal").hidden).toBe(true);

    search("");
    expect(group("personal").hidden).toBe(false);
    expect(group("workspace").hidden).toBe(false);
    expect(nav("workspace").hidden).toBe(false);
    expect(
      nav("personal").querySelector<HTMLElement>("[data-settings-nav-count]")!
        .hidden,
    ).toBe(true);
    expect(
      group("personal").querySelector<HTMLElement>("[data-settings-matches]")!
        .hidden,
    ).toBe(true);
    expect(
      group("personal").querySelector<HTMLElement>("[data-settings-cards]")!
        .hidden,
    ).toBe(false);
    expect(screen.getByText("No settings match.").hidden).toBe(true);
  });

  it("counts only the settings the member's role still shows", () => {
    drawOverview();
    // The shell removes what the member's role may not open.
    screen.getByRole("link", { hidden: true, name: "Tags" }).closest("li")!
      .remove();
    search("tags");
    expect(group("workspace").hidden).toBe(true);
    expect(screen.getByText("No settings match.").hidden).toBe(false);
  });
});
