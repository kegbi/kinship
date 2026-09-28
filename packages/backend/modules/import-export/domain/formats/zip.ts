/**
 * A ZIP archive of a few small text files, uncompressed (GAP-050).
 *
 * The CSV export is three tables, and three downloads for one export would
 * be three short-lived credentials for one request. They travel in one
 * archive instead, written here with the "stored" method (APPNOTE 4.4.5,
 * method 0): no compression, so there is nothing to inflate, nothing to add
 * as a dependency, and nothing a crafted archive could expand into. Every
 * archive tool opens it.
 *
 * The output is deterministic — entries in the order given, a fixed
 * modification time — so an interrupted export that rebuilds its archive
 * produces the same bytes and the same checksum as the run it resumes.
 */

const ENCODER = new TextEncoder();

/** The media type an archive is stored and served under. */
export const ZIP_MIME_TYPE = "application/zip";

/** One file in the archive. */
export interface ZipEntry {
  readonly bytes: Uint8Array;
  readonly name: string;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

/** The CRC-32 (ISO 3309) the archive records for each entry. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** 1980-01-01 00:00, the earliest time a ZIP header can say. */
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
/** Version 2.0, and bit 11: names are UTF-8. */
const VERSION = 20;
const UTF8_NAMES = 0x0800;

class Writer {
  readonly #chunks: Uint8Array[] = [];
  length = 0;
  bytes(bytes: Uint8Array) {
    this.#chunks.push(bytes);
    this.length += bytes.byteLength;
  }
  u16(value: number) {
    this.bytes(new Uint8Array([value & 0xff, (value >>> 8) & 0xff]));
  }
  u32(value: number) {
    this.bytes(
      new Uint8Array([
        value & 0xff,
        (value >>> 8) & 0xff,
        (value >>> 16) & 0xff,
        (value >>> 24) & 0xff,
      ]),
    );
  }
  result(): Uint8Array {
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.#chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  }
}

/** The archive holding `entries`, in order. */
export function zipArchive(entries: readonly ZipEntry[]): Uint8Array {
  const writer = new Writer();
  const central: {
    readonly crc: number;
    readonly name: Uint8Array;
    readonly offset: number;
    readonly size: number;
  }[] = [];
  for (const entry of entries) {
    const name = ENCODER.encode(entry.name);
    const crc = crc32(entry.bytes);
    central.push({
      crc,
      name,
      offset: writer.length,
      size: entry.bytes.byteLength,
    });
    writer.u32(0x04034b50);
    writer.u16(VERSION);
    writer.u16(UTF8_NAMES);
    writer.u16(0);
    writer.u16(DOS_TIME);
    writer.u16(DOS_DATE);
    writer.u32(crc);
    writer.u32(entry.bytes.byteLength);
    writer.u32(entry.bytes.byteLength);
    writer.u16(name.byteLength);
    writer.u16(0);
    writer.bytes(name);
    writer.bytes(entry.bytes);
  }
  const directoryStart = writer.length;
  for (const entry of central) {
    writer.u32(0x02014b50);
    writer.u16(VERSION);
    writer.u16(VERSION);
    writer.u16(UTF8_NAMES);
    writer.u16(0);
    writer.u16(DOS_TIME);
    writer.u16(DOS_DATE);
    writer.u32(entry.crc);
    writer.u32(entry.size);
    writer.u32(entry.size);
    writer.u16(entry.name.byteLength);
    writer.u16(0);
    writer.u16(0);
    writer.u16(0);
    writer.u16(0);
    writer.u32(0);
    writer.u32(entry.offset);
    writer.bytes(entry.name);
  }
  const directorySize = writer.length - directoryStart;
  writer.u32(0x06054b50);
  writer.u16(0);
  writer.u16(0);
  writer.u16(central.length);
  writer.u16(central.length);
  writer.u32(directorySize);
  writer.u32(directoryStart);
  writer.u16(0);
  return writer.result();
}
