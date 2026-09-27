import { DeclaredMediaScanner } from "./declared_media_scanner.ts";
import { assert } from "../../../../testing/assert.ts";

Deno.test("[FILES-001] declared media scanner quarantines mismatched content", async () => {
  const scanner = new DeclaredMediaScanner();
  assert(
    await scanner.inspect({
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      filename: "ok.pdf",
      mimeType: "application/pdf",
    }) === "clean",
    "PDF signature accepted",
  );
  assert(
    await scanner.inspect({
      bytes: new Uint8Array([0x3c, 0x73, 0x76, 0x67]),
      filename: "fake.pdf",
      mimeType: "application/pdf",
    }) === "quarantined",
    "mismatched content quarantined",
  );
  assert(
    await scanner.inspect({
      bytes: new Uint8Array([0xff, 0xd8, 0xff]),
      filename: "photo.jpg",
      mimeType: "image/jpeg",
    }) === "clean",
    "JPEG accepted",
  );
  assert(
    await scanner.inspect({
      bytes: new TextEncoder().encode("notes"),
      filename: "notes.txt",
      mimeType: "text/plain",
    }) === "clean",
    "plain text accepted",
  );
  assert(
    await scanner.inspect({
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      filename: "upper.pdf",
      mimeType: "APPLICATION/PDF",
    }) === "clean",
    "MIME matching is case insensitive",
  );
  assert(
    await scanner.inspect({
      bytes: new TextEncoder().encode("PK arbitrary zip payload"),
      filename: "fake.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }) === "quarantined",
    "an arbitrary ZIP is not accepted as DOCX",
  );
  assert(
    await scanner.inspect({
      bytes: new TextEncoder().encode("PK[Content_Types].xmlword/document.xml"),
      filename: "markers.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }) === "quarantined",
    "marker text without a ZIP central directory is rejected",
  );
  const docx = Uint8Array.from(
    atob(
      "UEsDBBQAAAAIAFk9F10rhCYSBgAAAAQAAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbLOp0LcDAFBLAwQUAAAACABZPRddK4QmEgYAAAAEAAAAEQAAAHdvcmQvZG9jdW1lbnQueG1ss6nQtwMAUEsBAhQAFAAAAAgAWT0XXSuEJhIGAAAABAAAABMAAAAAAAAAAAAAAAAAAAAAAFtDb250ZW50X1R5cGVzXS54bWxQSwECFAAUAAAACABZPRddK4QmEgYAAAAEAAAAEQAAAAAAAAAAAAAAAAA3AAAAd29yZC9kb2N1bWVudC54bWxQSwUGAAAAAAIAAgCAAAAAbAAAAAAA",
    ),
    (value) => value.charCodeAt(0),
  );
  assert(
    await scanner.inspect({
      bytes: docx,
      filename: "minimal.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }) === "clean",
    "a real minimal DOCX central directory is accepted",
  );
});
