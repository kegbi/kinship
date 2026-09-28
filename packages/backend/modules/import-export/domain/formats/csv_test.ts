import { assert, assertEquals } from "../../../../testing/assert.ts";
import { csvText, parseCsv, type ParsedCsv, safeCell } from "./csv.ts";

const fixture = (name: string) =>
  Deno.readTextFile(new URL(`./fixtures/${name}`, import.meta.url));

function parsed(text: string): ParsedCsv {
  const result = parseCsv(text);
  assert(typeof result !== "string", `expected a parse, got ${result}`);
  return result;
}

Deno.test("[GAP-050] a semicolon export with quoted newlines and CRLF parses by RFC 4180", async () => {
  const csv = parsed(await fixture("contacts.csv"));
  assertEquals(csv.delimiter, ";");
  assertEquals(csv.headers, [
    "First name",
    "Last name",
    "E-mail",
    "Phone",
    "Birthday",
    "Notes",
    "Company",
    "Job",
  ]);
  assertEquals(csv.rows.length, 4);
  assertEquals(csv.rows[0], [
    "Ada",
    "Lovelace",
    "ada@example.com",
    "+44 20 7946 0000",
    "1815-12-10",
    'Wrote the first program;\r\nloved "poetry"',
    "Analytical Engine Society",
    "Mathematician",
  ]);
  assertEquals(csv.rows[1], ["", "", "", "", "", "just a note", "", ""]);
});

Deno.test("[GAP-050] a comma file with LF endings, a BOM, and short rows is read", () => {
  const csv = parsed("\uFEFFname,email\nAda,ada@example.com\nBob\n\n");
  assertEquals(csv.delimiter, ",");
  assertEquals(csv.headers, ["name", "email"]);
  assertEquals(csv.rows, [["Ada", "ada@example.com"], ["Bob", ""]]);
  // A trailing empty field past the header is an exporter's habit, not data.
  assertEquals(parsed("a;b;\r\n1;2;\r\n").rows, [["1", "2"]]);
  assertEquals(parsed("a,b\r\n1,2").rows, [["1", "2"]]);
  // A delimiter inside a quoted header does not count toward detection.
  const quoted = parsed('"a;b;c",d\r1,2\r');
  assertEquals(quoted.delimiter, ",");
  assertEquals(quoted.headers, ["a;b;c", "d"]);
  assertEquals(quoted.rows, [["1", "2"]]);
});

Deno.test("[GAP-050] a CSV that cannot be read is refused with one sentence", () => {
  const refusals: readonly [string, string][] = [
    ["", "The CSV file needs a header row."],
    ["\r\n\r\n", "The CSV file needs a header row."],
    [",,\r\n , \r\n", "The CSV file needs a header row."],
    ['a,b\r\n"open,2\r\n', "A quoted CSV field is never closed."],
    [
      'a,b\r\n"x"y,2\r\n',
      "A quoted CSV field has text after its closing quote.",
    ],
    ["a,b\r\n1,2,3\r\n", "Row 1 has more fields than the header."],
    [
      `${Array.from({ length: 101 }, (_, index) => `c${index}`).join(",")}\r\n`,
      "A CSV file may declare at most 100 columns.",
    ],
    [`a\r\n${"1\r\n".repeat(501)}`, "A CSV file may contain at most 500 rows."],
    [
      `a\r\n"${"x".repeat(10_001)}"\r\n`,
      "A CSV field may be at most 10,000 characters.",
    ],
  ];
  for (const [text, problem] of refusals) {
    assertEquals(parseCsv(text), problem, JSON.stringify(text.slice(0, 40)));
  }
});

Deno.test("[GAP-050] cells a spreadsheet would run as a formula are neutralized", () => {
  for (const cell of ["=1+1", "+1", "-1", "@SUM(A1)", "\tx", "\rx"]) {
    assertEquals(safeCell(cell), `'${cell}`);
  }
  assertEquals(safeCell("Ada"), "Ada");
  assertEquals(safeCell(""), "");
});

Deno.test("[GAP-050] rows are written as RFC 4180 CSV that reads back", () => {
  const rows = [
    ["id", "note"],
    ["1", 'He said "hi", then\nleft'],
    ["2", '=HYPERLINK("x")'],
  ];
  const text = csvText(rows);
  assertEquals(
    text,
    'id,note\r\n1,"He said ""hi"", then\nleft"\r\n2,"\'=HYPERLINK(""x"")"\r\n',
  );
  assertEquals(parsed(text).rows, [
    ["1", 'He said "hi", then\nleft'],
    ["2", '\'=HYPERLINK("x")'],
  ]);
});
