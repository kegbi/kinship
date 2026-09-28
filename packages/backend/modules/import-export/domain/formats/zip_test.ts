import { assertEquals } from "../../../../testing/assert.ts";
import { crc32, zipArchive } from "./zip.ts";

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

/** The stored entries an archive's central directory lists, read back. */
function entries(archive: Uint8Array): Map<string, string> {
  const view = new DataView(archive.buffer, archive.byteOffset);
  const end = archive.byteLength - 22;
  assertEquals(view.getUint32(end, true), 0x06054b50);
  const count = view.getUint16(end + 10, true);
  let cursor = view.getUint32(end + 16, true);
  const found = new Map<string, string>();
  for (let index = 0; index < count; index++) {
    assertEquals(view.getUint32(cursor, true), 0x02014b50);
    assertEquals(view.getUint16(cursor + 10, true), 0, "stored, not deflated");
    const crc = view.getUint32(cursor + 16, true);
    const size = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const local = view.getUint32(cursor + 42, true);
    const name = DECODER.decode(
      archive.subarray(cursor + 46, cursor + 46 + nameLength),
    );
    assertEquals(view.getUint32(local, true), 0x04034b50);
    const start = local + 30 + view.getUint16(local + 26, true);
    const bytes = archive.subarray(start, start + size);
    assertEquals(crc32(bytes), crc, `${name} checksum`);
    found.set(name, DECODER.decode(bytes));
    cursor += 46 + nameLength;
  }
  return found;
}

Deno.test("[GAP-050] CRC-32 matches the standard check value", () => {
  assertEquals(crc32(ENCODER.encode("123456789")), 0xcbf43926);
  assertEquals(crc32(new Uint8Array()), 0);
});

Deno.test("[GAP-050] an archive lists every entry, in order, byte for byte", () => {
  const archive = zipArchive([
    { bytes: ENCODER.encode("id,name\r\n1,Ada\r\n"), name: "people.csv" },
    { bytes: ENCODER.encode(""), name: "dates.csv" },
    { bytes: ENCODER.encode('{"é":1}'), name: "manifest-é.json" },
  ]);
  assertEquals([...entries(archive)], [
    ["people.csv", "id,name\r\n1,Ada\r\n"],
    ["dates.csv", ""],
    ["manifest-é.json", '{"é":1}'],
  ]);
});

Deno.test("[GAP-050] the same entries always make the same archive", () => {
  const make = () =>
    zipArchive([{ bytes: ENCODER.encode("x"), name: "a.csv" }]);
  assertEquals([...make()], [...make()]);
});
