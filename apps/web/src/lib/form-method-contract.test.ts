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
    // No helper left in `lib/` builds a form since GAP-033 moved settings,
    // personalization, and the legal review to islands; one that does must
    // still make it a POST form.
    const libraries = readdirSync(join(sourceRoot, "lib"))
      .filter((path) => path.endsWith(".ts") && !path.endsWith(".test.ts"));
    for (const path of libraries) {
      const source = readFileSync(join(sourceRoot, "lib", path), "utf8");
      expect(
        source.split('createElement("form")').length - 1,
        path,
      ).toBe(source.split('.method = "post"').length - 1);
    }
  });
});

// Island forms (GAP-033). An island renders over a static form the page
// drew, and some islands render forms no page draws, so their JSX obeys the
// same rule: POST, a dialog, or an allowlisted GET filter.

// Island GET filters, exactly: the audit filters the two audit pages draw.
const intentionalIslandQueryForms: Readonly<Record<string, number>> = {
  "features/audit/audit-history.tsx": 1,
};

interface IslandForm {
  readonly file: string;
  readonly method: string | undefined;
  readonly body: string;
}

function islandFiles(): string[] {
  return readdirSync(sourceRoot, { recursive: true, encoding: "utf8" })
    .map((path) => path.replaceAll("\\", "/"))
    .filter((path) =>
      path.endsWith(".tsx") && !path.endsWith(".test.tsx") &&
      !path.startsWith("testing/")
    )
    .sort();
}

/**
 * Each `<form` element in a JSX source: its opening tag runs to the first
 * `>` outside braces, so `onSubmit={(event) => …}` does not end it.
 */
function islandForms(file: string): IslandForm[] {
  const source = readFileSync(join(sourceRoot, file), "utf8");
  const forms: IslandForm[] = [];
  for (const match of source.matchAll(/<form\b/g)) {
    let depth = 0;
    let end = match.index + 5;
    for (; end < source.length; end += 1) {
      const character = source[end];
      if (character === "{") depth += 1;
      else if (character === "}") depth -= 1;
      else if (character === ">" && depth === 0) break;
    }
    const tag = source.slice(match.index, end + 1);
    const close = source.indexOf("</form>", end);
    forms.push({
      body: source.slice(match.index, close < 0 ? source.length : close),
      file,
      method: /\smethod="([^"]*)"/.exec(tag)?.[1],
    });
  }
  return forms;
}

describe("REL-041 island form submission contract", () => {
  const forms = islandFiles().flatMap(islandForms);
  const count = (
    predicate: (form: IslandForm) => boolean,
  ): Record<string, number> => {
    const counts: Record<string, number> = {};
    for (const form of forms.filter(predicate)) {
      counts[form.file] = (counts[form.file] ?? 0) + 1;
    }
    return counts;
  };

  it("finds the islands' forms", () => {
    expect(forms.length).toBeGreaterThan(10);
  });

  it("gives every island form a POST or dialog method, except the allowlisted GET filters", () => {
    expect(
      count(({ method }) =>
        method !== undefined && method !== "post" && method !== "dialog" &&
        method !== "get"
      ),
    ).toEqual({});
    expect(count(({ method }) => method === "get")).toEqual(
      intentionalIslandQueryForms,
    );
  });

  it("gives every island form a method", () => {
    expect(count(({ method }) => method === undefined)).toEqual({});
  });

  it("keeps Quick capture's form the only dialog form", () => {
    expect(count(({ method }) => method === "dialog")).toEqual({
      "features/interactions/quick-capture.tsx": 1,
    });
  });

  it("keeps each island GET filter free of personal fields", () => {
    for (const form of forms.filter(({ method }) => method === "get")) {
      const names = [...form.body.matchAll(/\sname="([^"]+)"/g)].map((
        match,
      ) => match[1]!);
      expect(names.length, form.file).toBeGreaterThan(0);
      expect(names.filter((name) => personalFieldNames.test(name)), form.file)
        .toEqual([]);
    }
  });
});
