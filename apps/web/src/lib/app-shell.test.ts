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

  it("filters the grouped settings overview without mutating settings", () => {
    drawShell(`
      <label for="settings-search">Search settings</label>
      <input id="settings-search" type="search">
      <article data-settings-item data-search="profile name email">Profile</article>
      <article data-settings-item data-search="security sessions password">Security</article>
      <article data-settings-item>Members</article>
      <p id="settings-no-results" hidden>No settings match.</p>`);

    mountSettingsSearch();
    search("password");

    expect(screen.getByText("Profile").hidden).toBe(true);
    expect(screen.getByText("Security").hidden).toBe(false);
    search("MEMBERS");
    expect(screen.getByText("Members").hidden).toBe(false);
    search("unknown");
    expect(screen.getByText("No settings match.").hidden).toBe(false);
    search("  ");
    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(screen.getByText("No settings match.").hidden).toBe(true);
  });
});
