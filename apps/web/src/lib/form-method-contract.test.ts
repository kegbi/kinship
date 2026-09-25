import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// REL-041: a form submitted before its handler is wired falls back to a
// native submission. Without a method that is a GET, which puts every field
// value in the URL: browser history, access logs, and the Referer header.
// Every form therefore declares a method, and `post` is the default: the
// gateway answers a POST to a static path with 405 and never logs the body.

const sourceRoot = "apps/web/src";

// Query forms whose fields are meant to be in the URL. None may carry a
// personal field.
const intentionalQueryForms: Readonly<Record<string, string>> = {
  "pages/app/settings/audit.astro":
    "Deep-linkable workspace audit filters: opaque person and member IDs, an action name, and a date range.",
  "pages/internal/activity-report-shell.astro":
    "Deep-linkable activity report year filter.",
  "pages/internal/person-audit-shell.astro":
    "Deep-linkable person audit filters: an opaque member ID, an action name, and a date range.",
};

// Field names a query form must never put in the URL.
const personalFieldNames =
  /^(?:name|givenName|middleName|familyName|nickname|email|password|confirmation|username|search|query|body|title|comment|description|remoteUrl|factor|secret)$/i;

interface FormTag {
  readonly file: string;
  readonly method: string | undefined;
  readonly source: string;
}

function astroFiles(): string[] {
  return readdirSync(sourceRoot, { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".astro"))
    .map((path) => path.replaceAll("\\", "/"))
    .sort();
}

function formTags(file: string): FormTag[] {
  const source = readFileSync(join(sourceRoot, file), "utf8");
  return [...source.matchAll(/<form\b[^>]*>/g)].map((match) => ({
    file,
    method: /\smethod="([^"]*)"/.exec(match[0])?.[1],
    source: match[0],
  }));
}

function formBody(file: string): string {
  const source = readFileSync(join(sourceRoot, file), "utf8");
  return /<form\b[\s\S]*?<\/form>/.exec(source)?.[0] ?? "";
}

describe("REL-041 native form submission contract", () => {
  const forms = astroFiles().flatMap(formTags);

  it("finds the application's forms", () => {
    expect(forms.length).toBeGreaterThan(30);
  });

  it("gives every form a method so a native submission never becomes an accidental GET", () => {
    const offenders = forms.filter(({ file, method }) =>
      method !== "post" && method !== "dialog" &&
      !(method === "get" && file in intentionalQueryForms)
    ).map(({ file, source }) => `${file}: ${source}`);
    expect(offenders).toEqual([]);
  });

  it("keeps each allowlisted query form a GET form without personal fields", () => {
    for (const file of Object.keys(intentionalQueryForms)) {
      const tags = formTags(file);
      expect(tags.map(({ method }) => method), file).toEqual(["get"]);
      const names = [...formBody(file).matchAll(/\sname="([^"]+)"/g)].map((
        match,
      ) => match[1]!);
      expect(names.length, file).toBeGreaterThan(0);
      expect(names.filter((name) => personalFieldNames.test(name)), file)
        .toEqual([]);
    }
  });

  it("gives every script-created form a POST method", () => {
    const libraries = readdirSync(join(sourceRoot, "lib"))
      .filter((path) => path.endsWith(".ts") && !path.endsWith(".test.ts"));
    const creators = libraries.filter((path) =>
      readFileSync(join(sourceRoot, "lib", path), "utf8").includes(
        'createElement("form")',
      )
    );
    expect(creators.length).toBeGreaterThan(0);
    for (const path of creators) {
      const source = readFileSync(join(sourceRoot, "lib", path), "utf8");
      expect(
        source.split('createElement("form")').length - 1,
        path,
      ).toBe(source.split('.method = "post"').length - 1);
    }
  });
});
