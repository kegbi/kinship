import { assertEquals } from "../../../testing/assert.ts";
import {
  AVATAR_MAX_BYTES,
  checksum,
  isAllowedMedia,
  maximumUploadBytes,
  PERSON_FILE_MAX_BYTES,
  type PersonFileKind,
  publicFile,
  recordsReads,
  scannedStatus,
  type StoredPersonFile,
  validateUpload,
} from "./file_rules.ts";

const personId = "10000000-0000-4000-8000-000000000001";
const fileId = "20000000-0000-4000-8000-000000000001";

function stored(overrides: Partial<StoredPersonFile> = {}): StoredPersonFile {
  return {
    byteSize: 3,
    checksumSha256:
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    createdAt: "2026-03-04T10:00:00.000000Z",
    fileId,
    filename: "letter.pdf",
    kind: "document",
    mimeType: "application/pdf",
    personId,
    status: "available",
    storageKey: "workspace/letter.pdf",
    title: "A letter",
    ...overrides,
  };
}

function upload(overrides: Partial<{
  bytes: Uint8Array;
  filename: string;
  kind: PersonFileKind;
  mimeType: string;
  title: string;
}> = {}) {
  return {
    bytes: new Uint8Array([1, 2, 3]),
    filename: "letter.pdf",
    kind: "document" as PersonFileKind,
    mimeType: "application/pdf",
    title: "A letter",
    ...overrides,
  };
}

Deno.test("[GAP-017] the digest recorded against a stored object is fixed for all time", async () => {
  assertEquals(
    await checksum(new Uint8Array()),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "a stored checksum that stops matching invalidates every row already written",
  );
  assertEquals(
    await checksum(new TextEncoder().encode("abc")),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  assertEquals(
    await checksum(new Uint8Array([1, 2, 3, 4, 5])),
    "74f81fe167d99b4cb41d6d0ccda82278caee9f3e2f25d5e5a3936ff3dcec60d0",
  );
  const backing = new Uint8Array([9, 1, 2, 3, 4, 5, 9]);
  assertEquals(
    await checksum(backing.subarray(1, 6)),
    "74f81fe167d99b4cb41d6d0ccda82278caee9f3e2f25d5e5a3936ff3dcec60d0",
    "a view over a larger buffer hashes what it views, not what it sits in",
  );
});

Deno.test("[GAP-017] a reader never sees the storage key or the checksum", () => {
  assertEquals(publicFile(stored()), {
    byteSize: 3,
    createdAt: "2026-03-04T10:00:00.000000Z",
    fileId,
    filename: "letter.pdf",
    kind: "document",
    mimeType: "application/pdf",
    personId,
    status: "available",
    title: "A letter",
  });
  assertEquals(
    publicFile(stored({ status: "quarantined" })).status,
    "quarantined",
    "what the record says about itself is the reader's business",
  );
});

Deno.test("[GAP-017] each kind of file is stored as its own media and nothing else", () => {
  for (
    const mimeType of [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain",
    ]
  ) {
    assertEquals(isAllowedMedia("document", mimeType), true, mimeType);
    assertEquals(isAllowedMedia("photo", mimeType), false, mimeType);
  }
  for (const mimeType of ["image/jpeg", "image/png", "image/webp"]) {
    assertEquals(isAllowedMedia("photo", mimeType), true, mimeType);
    assertEquals(isAllowedMedia("document", mimeType), false, mimeType);
  }
  assertEquals(isAllowedMedia("photo", "image/gif"), false);
  assertEquals(
    isAllowedMedia("document", "APPLICATION/PDF"),
    false,
    "the vocabulary is lower case, so a caller lower-cases before asking",
  );
});

Deno.test("[GAP-017] an upload is judged on size first, then its names, then its media", () => {
  assertEquals(validateUpload(upload()), {
    status: "ready",
    values: {
      filename: "letter.pdf",
      mimeType: "application/pdf",
      title: "A letter",
    },
  });
  assertEquals(
    validateUpload(upload({
      bytes: new Uint8Array(PERSON_FILE_MAX_BYTES + 1),
      mimeType: "application/zip",
    })),
    { status: "storage-limit" },
    "a file that is both too large and the wrong type is told about the size",
  );
  assertEquals(
    validateUpload(upload({ bytes: new Uint8Array(PERSON_FILE_MAX_BYTES) }))
      .status,
    "ready",
    "the limit itself is still within the limit",
  );
  assertEquals(
    validateUpload(upload({ bytes: new Uint8Array() })),
    { status: "validation-error" },
    "there is nothing to store",
  );
  assertEquals(
    validateUpload(upload({ filename: "   " })),
    { status: "validation-error" },
  );
  assertEquals(
    validateUpload(upload({ filename: "x".repeat(501) })),
    { status: "validation-error" },
  );
  assertEquals(
    validateUpload(upload({ title: "   " })),
    { status: "validation-error" },
  );
  assertEquals(
    validateUpload(upload({ title: "x".repeat(501) })),
    { status: "validation-error" },
  );
  assertEquals(
    validateUpload(upload({ mimeType: "application/zip" })),
    { status: "rejected-media" },
  );
  assertEquals(
    validateUpload(upload({ kind: "photo" })),
    { status: "rejected-media" },
    "a document's media is not a photo's",
  );
});

Deno.test("[GAP-017] an upload keeps the trimmed names and the lower-cased media", () => {
  assertEquals(
    validateUpload(upload({
      filename: "  letter.pdf  ",
      mimeType: "Application/PDF",
      title: "  A letter  ",
    })),
    {
      status: "ready",
      values: {
        filename: "letter.pdf",
        mimeType: "application/pdf",
        title: "A letter",
      },
    },
  );
});

Deno.test("[GAP-017] a file is available only when the scanner found it clean", () => {
  assertEquals(scannedStatus("clean"), "available");
  assertEquals(scannedStatus("quarantined"), "quarantined");
});

Deno.test("[GAP-045] an avatar is an image no larger than its own limit", () => {
  const avatar = (bytes: Uint8Array, mimeType = "image/png") =>
    validateUpload(upload({
      bytes,
      filename: "ada.png",
      kind: "avatar",
      mimeType,
      title: "Avatar",
    }));
  assertEquals(AVATAR_MAX_BYTES, 1024 * 1024);
  assertEquals(maximumUploadBytes("avatar"), AVATAR_MAX_BYTES);
  assertEquals(maximumUploadBytes("photo"), PERSON_FILE_MAX_BYTES);
  assertEquals(
    avatar(new Uint8Array(AVATAR_MAX_BYTES)).status,
    "ready",
    "the limit itself is admitted",
  );
  assertEquals(
    avatar(new Uint8Array(AVATAR_MAX_BYTES + 1)).status,
    "storage-limit",
    "an avatar past its own limit is refused although a photo would fit",
  );
  for (const mimeType of ["image/jpeg", "image/png", "image/webp"]) {
    assertEquals(isAllowedMedia("avatar", mimeType), true, mimeType);
  }
  for (
    const mimeType of ["application/pdf", "text/plain", "image/svg+xml"]
  ) {
    assertEquals(isAllowedMedia("avatar", mimeType), false, mimeType);
  }
  assertEquals(
    avatar(new Uint8Array([1]), "image/svg+xml").status,
    "rejected-media",
    "an avatar reuses the photo allowlist, so a scriptable image is refused",
  );
});

Deno.test("[GAP-045] reading an avatar is not a recorded read", () => {
  assertEquals(recordsReads("document"), true);
  assertEquals(recordsReads("photo"), true);
  assertEquals(
    recordsReads("avatar"),
    false,
    "an avatar is drawn on every list it appears in, so its reads are not audited",
  );
});
