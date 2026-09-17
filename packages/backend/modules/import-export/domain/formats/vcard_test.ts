import { assertEquals } from "../../../../testing/assert.ts";
import {
  VCARD_MIME_TYPE,
  vcardFilename,
  type VCardPerson,
  vcardText,
} from "./vcard.ts";

const ADA: VCardPerson = {
  contactMethods: [
    { kind: "email", label: "Work mail!", value: "ada@example.com" },
    { kind: "phone", label: "", value: "+44 20 7946 0000" },
    { kind: "other", label: "signal", value: "@ada" },
  ],
  familyName: "Lovelace",
  givenName: "Ada",
  middleName: "Byron",
};

Deno.test("[GAP-018] a card is pinned line for line", () => {
  assertEquals(
    vcardText(ADA, "Ada Lovelace"),
    [
      "BEGIN:VCARD",
      "VERSION:4.0",
      "FN:Ada Lovelace",
      "N:Lovelace;Ada;Byron;;",
      "EMAIL;TYPE=Work-mail-:ada@example.com",
      "TEL;TYPE=other:+44 20 7946 0000",
      "END:VCARD",
      "",
    ].join("\r\n"),
  );
  assertEquals(VCARD_MIME_TYPE, "text/vcard; charset=utf-8");
});

Deno.test("[GAP-018] anything that would end a property is escaped", () => {
  const card = vcardText({
    contactMethods: [{
      kind: "email",
      label: "home,office",
      value: "a;b,c\\d",
    }],
    familyName: "Love,lace",
    givenName: "Ada\nGrace",
    middleName: "A\\B",
  }, "Ada, the\r\nfirst");
  assertEquals(
    card.split("\r\n")[2],
    "FN:Ada\\, the\\nfirst",
    "a newline inside a value becomes the escape, not a new line",
  );
  assertEquals(card.split("\r\n")[3], "N:Love\\,lace;Ada\\nGrace;A\\\\B;;");
  assertEquals(
    card.split("\r\n")[4],
    "EMAIL;TYPE=home-office:a\\;b\\,c\\\\d",
  );
});

Deno.test("[GAP-018] a card carries only the methods it has properties for", () => {
  assertEquals(
    vcardText({
      contactMethods: [{ kind: "other", label: "fax", value: "x" }],
      givenName: "Solo",
    }, "Solo").split("\r\n"),
    ["BEGIN:VCARD", "VERSION:4.0", "FN:Solo", "N:;Solo;;;", "END:VCARD", ""],
  );
});

Deno.test("[GAP-018] a label becomes a token, or the word other", () => {
  const card = vcardText({
    contactMethods: [
      { kind: "phone", label: "   ", value: "1" },
      { kind: "phone", label: "!!!", value: "2" },
      { kind: "phone", label: "x".repeat(60), value: "3" },
    ],
    givenName: "Solo",
  }, "Solo");
  const lines = card.split("\r\n");
  assertEquals(lines[4], "TEL;TYPE=other:1");
  assertEquals(lines[5], "TEL;TYPE=---:2");
  assertEquals(lines[6], `TEL;TYPE=${"x".repeat(40)}:3`);
});

Deno.test("[GAP-018] the filename keeps only what a file system will keep", () => {
  assertEquals(vcardFilename(ADA), "Ada-Lovelace.vcf");
  assertEquals(
    vcardFilename({ contactMethods: [], givenName: "Ada" }),
    "Ada.vcf",
  );
  assertEquals(
    vcardFilename({
      contactMethods: [],
      familyName: "Lovelace",
      givenName: "Ada B./..",
    }),
    "Ada-B.-..-Lovelace.vcf",
  );
  assertEquals(
    vcardFilename({ contactMethods: [], givenName: "" }),
    "person.vcf",
    "a person with nothing usable left is still downloadable",
  );
  assertEquals(
    vcardFilename({ contactMethods: [], givenName: "???" }),
    "-.vcf",
  );
});
