/**
 * What a person's file is, what may be uploaded, and what a reader may see.
 *
 * Four rules decide whether bytes become a file: how large they may be, that
 * there are any at all, that the filename and title are usable, and that the
 * media type is one this workspace stores for that kind. They are declared
 * here together because the order they are asked in is itself a rule — a file
 * over the limit is reported as a storage limit rather than as a rejected
 * type, however wrong its type also is.
 *
 * `publicFile` is the other half: the storage key and the checksum are how the
 * module finds and verifies the bytes, and neither is any reader's business,
 * so the record a caller receives is the stored one minus exactly those two.
 *
 * `checksum` lives here rather than beside the object-storage adapter. It is a
 * pure function from bytes to text with no I/O behind it — `crypto.subtle` is
 * a Web API, the same one the shared kernel's `deterministicId` already uses —
 * and what it means is a rule this module owns: this digest, over these bytes,
 * is what `reserveUpload` records so a later read can prove the object it
 * fetched is the one that was stored. The adapter only moves bytes; it does
 * not get to decide what identifies them. The suite beside this file pins the
 * digest with literal vectors, because a stored checksum that stops matching
 * would quietly invalidate every row already written.
 */

import { boundedText } from "../../../shared-kernel/validation.ts";

export const PERSON_FILE_MAX_BYTES = 10 * 1024 * 1024;

export type PersonFileKind = "document" | "photo";
export type PersonFileStatus =
  | "available"
  | "deleted"
  | "missing"
  | "processing"
  | "quarantined";

export interface PersonFileRecord {
  readonly byteSize: number;
  readonly createdAt: string;
  readonly fileId: string;
  readonly filename: string;
  readonly kind: PersonFileKind;
  readonly mimeType: string;
  readonly personId: string;
  readonly status: PersonFileStatus;
  readonly title: string;
}

/** The record with the two fields only this module needs on it. */
export interface StoredPersonFile extends PersonFileRecord {
  readonly checksumSha256?: string;
  readonly storageKey: string;
}

export interface PersonFileUploadInput {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly kind: PersonFileKind;
  readonly mimeType: string;
  readonly title: string;
}

/** The canonical upload a write proceeds with. */
export interface PersonFileUploadValues {
  readonly filename: string;
  readonly mimeType: string;
  readonly title: string;
}

/** Either the canonical upload, or the one reason it was refused. */
export type PersonFileUploadCheck =
  | {
    readonly status: "ready";
    readonly values: PersonFileUploadValues;
  }
  | { readonly status: "rejected-media" }
  | { readonly status: "storage-limit" }
  | { readonly status: "validation-error" };

/** The media each kind of file is stored as, and nothing else. */
const ALLOWED_MEDIA: Readonly<Record<PersonFileKind, ReadonlySet<string>>> = {
  document: new Set([
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
  ]),
  photo: new Set(["image/jpeg", "image/png", "image/webp"]),
};

/** Whether a media type is one this kind of file is stored as. */
export function isAllowedMedia(
  kind: PersonFileKind,
  mimeType: string,
): boolean {
  return ALLOWED_MEDIA[kind].has(mimeType);
}

/** The record a caller receives, without the two fields it never sees. */
export function publicFile(file: StoredPersonFile): PersonFileRecord {
  const { checksumSha256: _checksum, storageKey: _storageKey, ...visible } =
    file;
  return visible;
}

/**
 * The digest recorded against the stored object.
 *
 * `slice()` copies before the digest is taken, so the caller's buffer is never
 * handed to the platform and a detached or reused one cannot change what was
 * hashed.
 */
export async function checksum(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", bytes.slice().buffer),
  );
  return [...digest].map((value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}

/**
 * Whether these bytes may become a file, and the canonical names if they may.
 *
 * The order is the rule: size first, then whether there is anything to store
 * and whether it can be named, then the media type. A member who uploaded a
 * file that is both too large and of the wrong type is told about the size,
 * because that is the one they can do something about.
 */
export function validateUpload(
  input: PersonFileUploadInput,
): PersonFileUploadCheck {
  if (input.bytes.byteLength > PERSON_FILE_MAX_BYTES) {
    return { status: "storage-limit" };
  }
  const filename = boundedText(input.filename, 500);
  const title = boundedText(input.title, 500);
  if (input.bytes.byteLength === 0 || !filename || !title) {
    return { status: "validation-error" };
  }
  const mimeType = input.mimeType.toLowerCase();
  if (!isAllowedMedia(input.kind, mimeType)) {
    return { status: "rejected-media" };
  }
  return { status: "ready", values: { filename, mimeType, title } };
}

/** What a scanned file is stored as, once the scanner has answered. */
export function scannedStatus(
  scan: "clean" | "quarantined",
): "available" | "quarantined" {
  return scan === "clean" ? "available" : "quarantined";
}
