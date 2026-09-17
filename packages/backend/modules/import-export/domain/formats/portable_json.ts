/**
 * The one export format this module writes today: the portable Monica JSON
 * profile.
 *
 * It is deliberately narrow. The artifact carries the person identity fields
 * Monica's own importer accepts and nothing else, so an export can be read
 * back by the tool people are migrating away from; the three limitations are
 * shipped inside the manifest rather than left in a help page, because the
 * file outlives the page. GAP-050 adds CSV and an all-people vCard beside this
 * file, and neither needs anything here to move: a format module answers with
 * bytes, a manifest, and a digest, and the use case does not care which one it
 * asked.
 *
 * `readPortableArtifact` is the other direction, and it is not a parser for
 * anybody else's file: it re-reads an artifact this module wrote, so a run
 * that was interrupted after the bytes were stored can finish without writing
 * them twice. It re-derives every digest the manifest claims, so an artifact
 * that was truncated, edited, or written by an older profile is discarded and
 * rebuilt rather than trusted.
 *
 * The person shape is declared here rather than imported from people. A format
 * needs the fields it renders, and declaring them is what keeps this file a
 * domain file; the people module's `ExportPerson` satisfies it structurally.
 */

import type { ExportManifest } from "../export_rules.ts";
import { canonicalJson, jsonObject, sha256Hex } from "./canonical.ts";

const ENCODER = new TextEncoder();

/** The most people one portable artifact may carry. */
export const MAX_PORTABLE_PEOPLE = 500;

/** What this profile leaves out, said in the artifact itself. */
export const PORTABLE_LIMITATIONS: readonly string[] = [
  "Only person identity fields accepted by Monica JSON import are included.",
  "Contact methods are available in person vCard exports but are not in this portable JSON profile.",
  "Attachments are not included in this bounded export profile.",
];

/** The media type the artifact is stored and served under. */
export const PORTABLE_MIME_TYPE = "application/json";

/** The person fields this profile renders. */
export interface PortablePerson {
  readonly archived?: boolean;
  readonly deletedAt?: string;
  readonly description?: string;
  readonly familyName?: string;
  readonly foodPreferences?: string;
  readonly givenName: string;
  readonly id: string;
  readonly isDeceased: boolean;
  readonly isPartial: boolean;
  readonly isStarred: boolean;
  readonly middleName?: string;
  readonly nickname?: string;
}

/** The artifact, its manifest, and the digest recorded against the bytes. */
export interface PortableArtifact {
  readonly bytes: Uint8Array;
  readonly checksumSha256: string;
  readonly manifest: ExportManifest;
  readonly people: number;
}

/** The sentence a member is shown when their workspace is too large. */
export const PORTABLE_TOO_LARGE =
  `Portable export is limited to ${MAX_PORTABLE_PEOPLE} people.`;

/** The name the artifact is stored and downloaded under. */
export function portableFilename(exportId: string): string {
  return `kinship-${exportId}.json`;
}

/** One person as the profile's `contacts` table row. */
export function portableContact(
  person: PortablePerson,
): Record<string, unknown> {
  return {
    id: person.id,
    uuid: person.id,
    first_name: person.givenName,
    ...(person.middleName ? { middle_name: person.middleName } : {}),
    ...(person.familyName ? { last_name: person.familyName } : {}),
    ...(person.nickname ? { nickname: person.nickname } : {}),
    ...(person.description ? { description: person.description } : {}),
    ...(person.foodPreferences
      ? { food_preferences: person.foodPreferences }
      : {}),
    is_active: !person.archived,
    is_dead: person.isDeceased,
    is_partial: person.isPartial,
    is_starred: person.isStarred,
    ...(person.deletedAt ? { deleted_at: person.deletedAt } : {}),
  };
}

/** The manifest that signs a set of rendered rows. */
export async function portableManifest(
  contacts: readonly Record<string, unknown>[],
): Promise<ExportManifest> {
  return {
    attachments: { count: 0, items: [], sha256: await sha256Hex("[]") },
    limitations: PORTABLE_LIMITATIONS,
    profile: "monica-json",
    rows: {
      people: {
        count: contacts.length,
        sha256: await sha256Hex(canonicalJson(contacts)),
      },
    },
    version: 1,
  };
}

/** The whole artifact for a workspace's people, ready to be stored. */
export async function portableArtifact(
  people: readonly PortablePerson[],
): Promise<PortableArtifact> {
  const contacts = people.map(portableContact);
  const manifest = await portableManifest(contacts);
  const bytes = ENCODER.encode(JSON.stringify({
    attachments: [],
    format: "monica-json",
    manifest,
    tables: { contacts },
    version: 1,
  }));
  return {
    bytes,
    checksumSha256: await sha256Hex(bytes),
    manifest,
    people: contacts.length,
  };
}

/**
 * An artifact this module wrote earlier, re-read and re-verified, or nothing.
 *
 * Every claim the manifest makes is checked against the rows beside it, so a
 * resumed run either continues from bytes that still say what they said when
 * they were stored or starts again from the database.
 */
export async function readPortableArtifact(
  bytes: Uint8Array,
): Promise<PortableArtifact | undefined> {
  try {
    const source = JSON.parse(new TextDecoder().decode(bytes)) as Record<
      string,
      unknown
    >;
    const manifest = source.manifest as ExportManifest | undefined;
    const tables = jsonObject(source.tables);
    const contacts = tables?.contacts;
    if (
      source.format !== "monica-json" || source.version !== 1 ||
      !manifest || manifest.version !== 1 ||
      manifest.profile !== "monica-json" || !Array.isArray(contacts) ||
      manifest.rows?.people?.count !== contacts.length ||
      !/^[0-9a-f]{64}$/.test(manifest.rows.people.sha256) ||
      manifest.rows.people.sha256 !==
        await sha256Hex(canonicalJson(contacts)) ||
      manifest.attachments?.count !== 0 ||
      !Array.isArray(manifest.attachments.items) ||
      manifest.attachments.items.length !== 0 ||
      manifest.attachments.sha256 !== await sha256Hex("[]") ||
      !Array.isArray(manifest.limitations) ||
      !manifest.limitations.every((item) => typeof item === "string")
    ) return undefined;
    return {
      bytes,
      checksumSha256: await sha256Hex(bytes),
      manifest,
      people: contacts.length,
    };
  } catch {
    return undefined;
  }
}
