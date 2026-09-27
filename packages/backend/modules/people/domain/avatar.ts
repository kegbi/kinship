/**
 * How a person is drawn when a list or their page shows them (GAP-045).
 *
 * A person's avatar is one of two things: an uploaded image the `files`
 * module keeps, or their initials on a colour. The colour is the person's own
 * when one was stored — a Monica import carries `default_avatar_color` into
 * `person_avatars.background_color` — and otherwise one of a fixed palette,
 * picked from the person's identifier so it never changes between reads.
 *
 * The initials themselves are not decided here. They follow the name the
 * member reads, in the member's own name order, so the web app derives them
 * from the name it already shows rather than from a copy the server froze.
 *
 * Every palette colour keeps white initials above the 4.5:1 contrast floor,
 * and the web primitive chooses dark or light initials for a stored colour
 * the same way, so no colour here can make initials unreadable.
 */

/** Where a person's avatar comes from, as `person_avatars.source` says. */
export type AvatarSource =
  | "default"
  | "external"
  | "file"
  | "generated"
  | "gravatar";

/** The colours a person without a stored colour is drawn on. */
export const AVATAR_PALETTE = [
  "#1f6f5c",
  "#6b4c9a",
  "#a0442c",
  "#2d5e9e",
  "#7a5c12",
  "#9b3563",
  "#3b6a2b",
  "#555b8f",
] as const;

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Whether a stored value is a colour this module draws with. */
export function isAvatarColor(value: string): boolean {
  return HEX_COLOR.test(value);
}

/** A stable, well-spread index for an identifier (32-bit FNV-1a). */
function paletteIndex(personId: string): number {
  let hash = 0x811c9dc5;
  for (const character of personId.toLowerCase()) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % AVATAR_PALETTE.length;
}

/**
 * The colour a person's initials are drawn on: their stored colour when it is
 * one, as six lower-case digits, else their palette colour.
 */
export function avatarColor(personId: string, stored?: string): string {
  const candidate = stored?.trim() ?? "";
  if (isAvatarColor(candidate)) {
    const digits = candidate.slice(1).toLowerCase();
    return digits.length === 3
      ? `#${[...digits].map((digit) => digit + digit).join("")}`
      : `#${digits}`;
  }
  return AVATAR_PALETTE[paletteIndex(personId)]!;
}

/**
 * What a read model knows about a person's avatar: the stored colour, and the
 * file behind the image only when that file is available to be drawn.
 */
export interface PersonAvatarRecord {
  readonly backgroundColor?: string;
  readonly fileId?: string;
}

/** The avatar a reader is given: a colour, and an image when there is one. */
export interface PersonAvatarView {
  readonly color: string;
  readonly fileId?: string;
}

export function avatarView(
  personId: string,
  record: PersonAvatarRecord,
): PersonAvatarView {
  return {
    color: avatarColor(personId, record.backgroundColor),
    ...(record.fileId ? { fileId: record.fileId } : {}),
  };
}
