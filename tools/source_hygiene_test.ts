/**
 * Source files are plain text.
 *
 * A control character written as a raw byte rather than as an escape survives
 * every gate the repository has: the compiler accepts it, the formatter keeps
 * it, and the runtime string is identical — but the file stops being text.
 * `grep` reports it as binary and skips it, a diff renders it as `Binary files
 * differ`, and an editor may silently drop it on save, which would change a
 * stored digest without changing anything a reader can see.
 *
 * GAP-006 hit this in the shared kernel's identifier derivation and GAP-016
 * hit it again in planning's cadence fingerprint; both were written `\u0000`
 * afterwards. This walk is the guard that keeps the third occurrence from
 * reaching a review, so every hashing template in the repository stays
 * readable and greppable.
 */

import { assert } from "../packages/backend/testing/assert.ts";

const ROOT = new URL("../", import.meta.url);

/** The trees whose sources this repository owns. */
const SOURCE_ROOTS = ["apps", "packages", "tests", "tools"] as const;

/** Installed, generated, or build output nobody edits by hand. */
const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  ".artifacts",
  ".astro",
  ".coverage",
  "dist",
]);

/** The text extensions a control byte has no business appearing in. */
const TEXT_EXTENSIONS = [".ts", ".md", ".json", ".yaml"] as const;

const NUL = 0;

function isText(name: string): boolean {
  return TEXT_EXTENSIONS.some((extension) => name.endsWith(extension));
}

async function textFiles(relative: string): Promise<string[]> {
  const found: string[] = [];
  for await (const entry of Deno.readDir(new URL(relative, ROOT))) {
    if (IGNORED_DIRECTORIES.has(entry.name)) continue;
    const path = `${relative}/${entry.name}`;
    if (entry.isDirectory) {
      found.push(...await textFiles(path));
      continue;
    }
    if (entry.isFile && isText(entry.name)) found.push(path);
  }
  return found;
}

Deno.test("[GAP-016] no source file carries a raw NUL byte", async () => {
  const paths: string[] = [];
  for (const root of SOURCE_ROOTS) paths.push(...await textFiles(root));
  assert(
    paths.length > 0,
    "the source hygiene walk found no files to inspect",
  );
  const offenders: string[] = [];
  for (const path of paths) {
    const bytes = await Deno.readFile(new URL(path, ROOT));
    const count = bytes.reduce(
      (total, byte) => byte === NUL ? total + 1 : total,
      0,
    );
    if (count > 0) offenders.push(`${path} (${count})`);
  }
  assert(
    offenders.length === 0,
    `these sources carry raw NUL bytes; write them as \\u0000 instead: ${
      offenders.join(", ")
    }`,
  );
});
