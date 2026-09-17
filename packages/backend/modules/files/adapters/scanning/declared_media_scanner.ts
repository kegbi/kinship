import type { FileScanner } from "../../ports/object_storage.ts";

const startsWith = (bytes: Uint8Array, signature: readonly number[]) =>
  signature.every((value, index) => bytes[index] === value);

const read16 = (bytes: Uint8Array, offset: number) =>
  bytes[offset]! | (bytes[offset + 1]! << 8);
const read32 = (bytes: Uint8Array, offset: number) =>
  (read16(bytes, offset) | (read16(bytes, offset + 2) << 16)) >>> 0;

function isDocx(bytes: Uint8Array): boolean {
  if (bytes.length < 22) return false;
  const floor = Math.max(0, bytes.length - 65_557);
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= floor; offset--) {
    if (read32(bytes, offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) return false;
  const entries = read16(bytes, eocd + 10);
  const size = read32(bytes, eocd + 12);
  const start = read32(bytes, eocd + 16);
  if (entries > 4096 || start + size > eocd) return false;
  const names = new Set<string>();
  let offset = start;
  for (let index = 0; index < entries; index++) {
    if (offset + 46 > eocd || read32(bytes, offset) !== 0x02014b50) {
      return false;
    }
    const nameLength = read16(bytes, offset + 28);
    const end = offset + 46 + nameLength + read16(bytes, offset + 30) +
      read16(bytes, offset + 32);
    if (end > eocd) return false;
    names.add(
      new TextDecoder().decode(
        bytes.slice(offset + 46, offset + 46 + nameLength),
      ),
    );
    offset = end;
  }
  return offset === start + size && names.has("[Content_Types].xml") &&
    names.has("word/document.xml");
}

export class DeclaredMediaScanner implements FileScanner {
  inspect(
    command: Parameters<FileScanner["inspect"]>[0],
  ): Promise<"clean" | "quarantined"> {
    const mimeType = command.mimeType.toLowerCase();
    const clean = mimeType === "application/pdf"
      ? startsWith(command.bytes, [0x25, 0x50, 0x44, 0x46])
      : mimeType === "image/jpeg"
      ? startsWith(command.bytes, [0xff, 0xd8, 0xff])
      : mimeType === "image/png"
      ? startsWith(command.bytes, [0x89, 0x50, 0x4e, 0x47])
      : mimeType === "image/webp"
      ? startsWith(command.bytes, [0x52, 0x49, 0x46, 0x46]) &&
        String.fromCharCode(...command.bytes.slice(8, 12)) === "WEBP"
      : mimeType ===
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      ? isDocx(command.bytes)
      : mimeType === "text/plain" &&
        !command.bytes.some((value) => value === 0);
    return Promise.resolve(clean ? "clean" : "quarantined");
  }
}
