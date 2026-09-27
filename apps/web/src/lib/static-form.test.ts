// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { drawShell, element } from "../testing/render.tsx";
import { readStaticForm } from "./static-form.ts";

describe("GAP-033 static form handoff", () => {
  it("reads what was typed and checked before the island took over", () => {
    drawShell(`<form method="post">
      <input name="givenName" value="Ada">
      <input name="nickname">
      <input name="isPartial" type="checkbox" checked>
      <input name="unchecked" type="checkbox">
      <input type="text" value="unnamed">
    </form>`);
    expect(readStaticForm(element("form")).values).toEqual({
      givenName: "Ada",
      isPartial: "on",
      nickname: "",
    });
  });

  it("puts focus back on the replacement field of the same name", () => {
    drawShell(`<form method="post"><input name="search"></form>
      <div id="island"><input name="other"><input name="search"></div>`);
    element<HTMLInputElement>("form [name=search]").focus();
    const input = readStaticForm(element("form"));
    element("form").remove();
    input.restoreFocus(document);
    expect(document.activeElement).toBe(element("#island [name=search]"));
  });

  it("leaves focus alone when no field of the form held it", () => {
    drawShell(`<button id="elsewhere">Elsewhere</button>
      <form method="post"><input name="search"></form>`);
    element("#elsewhere").focus();
    const input = readStaticForm(element("form"));
    input.restoreFocus(document);
    expect(document.activeElement).toBe(element("#elsewhere"));
  });

  it("reads nothing from a page without the form", () => {
    drawShell("<main></main>");
    const input = readStaticForm(document.querySelector("form"));
    expect(input.values).toEqual({});
    expect(() => input.restoreFocus(document)).not.toThrow();
  });

  it("skips a chosen file and a focused control without a name", () => {
    drawShell(`<form method="post">
      <input name="file" type="file">
      <input name="title" value="Care plan">
      <button type="submit">Upload</button>
    </form>`);
    element("button").focus();
    const input = readStaticForm(element("form"));
    expect(input.values).toEqual({ title: "Care plan" });
    input.restoreFocus(document);
    expect(document.activeElement).toBe(element("button"));
  });
});
