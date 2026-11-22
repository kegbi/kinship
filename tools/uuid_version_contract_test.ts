/**
 * No production check narrows the UUID versions it accepts (MCP-R3).
 *
 * `deterministicId` derives version 8 identifiers for people DAV sync and
 * retry-safe creates make, journal posts, tasks, reminders, cadences,
 * interactions, gifts, and debts. Hand-written checks that stopped at version
 * 5 refused those records: a note for such a person answered "Choose one
 * person from this workspace", recording a view of them was forbidden, the
 * directory refused its own next-page cursor, and the gateway sent their
 * pages to the 404 page. The API's `z.uuid()` accepts versions 1 through 8,
 * and so does the one definition each layer now has: `isUuid` in the shared
 * kernel, `apps/web/src/lib/uuid.ts` for the web app, and the gateway's
 * location patterns.
 *
 * This walk finds every UUID pattern in production source by its version
 * slot — the character after the second group — and fails unless that slot
 * is `[1-8]` or unrestricted. The personal-token and calendar-feed patterns
 * are the one deliberate exception: their ids are always minted as version 4,
 * and the secret's shape is part of what the gateway and the token rules
 * check, so they stay `4` and are allowed by name here.
 */

import { assert, assertEquals } from "../packages/backend/testing/assert.ts";

const ROOT = new URL("../", import.meta.url);

/** The trees that hold production source. */
const SOURCE_ROOTS = ["apps", "packages", "gateway"] as const;

/** Installed, generated, or build output nobody edits by hand. */
const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  ".artifacts",
  ".astro",
  ".coverage",
  "dist",
  "testing",
]);

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mjs", ".astro", ".conf"] as const;

/** Tests and their helpers may spell any identifier they like. */
const TEST_SUFFIXES = [
  "_test.ts",
  ".test.ts",
  ".test.tsx",
  ".test-helper.ts",
  ".test-helper.tsx",
] as const;

/**
 * A UUID pattern's version slot: what follows `{4}-` and precedes the third
 * group's remaining three hex digits.
 */
const VERSION_SLOT = /\{4\}-(\[[^\]]*\]|[0-9a-fA-F])\[0-9a-f(?:A-F)?\]\{3\}-/g;

/** Whether a line holds a version slot at all. */
const HAS_VERSION_SLOT = new RegExp(VERSION_SLOT.source);

/** The version slots that admit every RFC 9562 version. */
const ACCEPTED_SLOTS = new Set(["[1-8]", "[0-9a-f]", "[0-9a-fA-F]"]);

/**
 * The patterns that are version 4 on purpose: a personal token's and a
 * calendar feed's id are always minted by `crypto.randomUUID()`.
 */
const VERSION_4_CREDENTIALS = [
  ["packages/backend/modules/api-access/domain/token_rules.ts", "kin_pat_"],
  ["packages/backend/modules/api-access/domain/token_rules.ts", "kin_cal_"],
  ["packages/contracts/schemas/calendar_feeds.ts", "kin_cal_"],
  ["gateway/nginx.conf", "kin_cal_"],
] as const;

function isProductionSource(name: string): boolean {
  return SOURCE_EXTENSIONS.some((extension) => name.endsWith(extension)) &&
    !TEST_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

async function sourceFiles(relative: string): Promise<string[]> {
  const found: string[] = [];
  for await (const entry of Deno.readDir(new URL(relative, ROOT))) {
    if (IGNORED_DIRECTORIES.has(entry.name)) continue;
    const path = `${relative}/${entry.name}`;
    if (entry.isDirectory) {
      found.push(...await sourceFiles(path));
      continue;
    }
    if (entry.isFile && isProductionSource(entry.name)) found.push(path);
  }
  return found;
}

/** Each version slot on `line` that narrows the accepted versions. */
function narrowedVersionSlots(
  path: string,
  line: string,
): readonly string[] {
  if (
    VERSION_4_CREDENTIALS.some(([file, marker]) =>
      file === path && line.includes(marker)
    )
  ) return [];
  return [...line.matchAll(VERSION_SLOT)]
    .map((match) => match[1]!)
    .filter((slot) => !ACCEPTED_SLOTS.has(slot));
}

Deno.test("[MCP-R3] the version-slot detector tells a narrowed pattern from an open one", () => {
  const pattern = (slot: string) =>
    `/^[0-9a-f]{8}-[0-9a-f]{4}-${slot}[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i`;
  for (const slot of ["[1-5]", "[1-58]", "[1-7]", "[45]", "4", "8"]) {
    assertEquals(
      narrowedVersionSlots("apps/x.ts", pattern(slot)),
      [slot],
      `${slot} is a narrowed version slot`,
    );
  }
  assertEquals(
    narrowedVersionSlots(
      "gateway/x.conf",
      '"~^/app/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB]"',
    ),
    ["[1-5]"],
    "an upper-and-lower-case nginx pattern is read too",
  );
  for (const slot of ["[1-8]", "[0-9a-f]"]) {
    assertEquals(narrowedVersionSlots("apps/x.ts", pattern(slot)), []);
  }
  assertEquals(
    narrowedVersionSlots(
      "apps/x.ts",
      "/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i",
    ),
    [],
    "a pattern with no version slot at all is open",
  );
  assertEquals(
    narrowedVersionSlots(
      "packages/backend/modules/api-access/domain/token_rules.ts",
      `/^kin_pat_(${pattern("4").slice(2, -4)})\\./`,
    ),
    [],
    "the personal-token pattern is version 4 on purpose",
  );
  assertEquals(
    narrowedVersionSlots("apps/x.ts", `/^kin_pat_${pattern("4")}/`),
    ["4"],
    "the exception is by file, not by prefix alone",
  );
});

Deno.test("[MCP-R3] no production UUID check refuses a version RFC 9562 defines", async () => {
  const paths: string[] = [];
  for (const root of SOURCE_ROOTS) paths.push(...await sourceFiles(root));
  assert(
    paths.includes("gateway/nginx.conf") &&
      paths.includes("packages/backend/shared-kernel/validation.ts") &&
      paths.includes("apps/web/src/lib/uuid.ts"),
    "the walk reaches the gateway, the kernel, and the web app",
  );
  const offenders: string[] = [];
  let credentials = 0;
  for (const path of paths) {
    const lines = (await Deno.readTextFile(new URL(path, ROOT))).split("\n");
    lines.forEach((line, index) => {
      if (
        VERSION_4_CREDENTIALS.some(([file, marker]) =>
          file === path && line.includes(marker) &&
          HAS_VERSION_SLOT.test(line)
        )
      ) credentials++;
      for (const slot of narrowedVersionSlots(path, line)) {
        offenders.push(`${path}:${index + 1} (${slot})`);
      }
    });
  }
  assert(
    offenders.length === 0,
    `these UUID checks narrow the accepted versions; use the shared kernel's isUuid, apps/web/src/lib/uuid.ts, or [1-8]: ${
      offenders.join(", ")
    }`,
  );
  assertEquals(
    credentials,
    VERSION_4_CREDENTIALS.length,
    "every allowed version 4 credential pattern still exists, so the allowlist cannot go stale",
  );
});
