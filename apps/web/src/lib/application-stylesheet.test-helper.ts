import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const applicationStylesheetPath = resolve(
  "apps/web/src/styles/application.css",
);
const importStatement = /^@import\s+(?:url\()?["]([^"]+)["]\)?;\r?\n?/gm;

export function readApplicationStylesheet(): string {
  const source = readFileSync(applicationStylesheetPath, "utf8");
  let foundImport = false;

  const inlined = source.replace(
    importStatement,
    (_statement: string, importPath: string) => {
      foundImport = true;
      return readFileSync(
        resolve(dirname(applicationStylesheetPath), importPath),
        "utf8",
      );
    },
  );

  if (!foundImport) {
    throw new Error("application.css does not import any stylesheets");
  }

  return inlined;
}
