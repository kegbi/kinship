/**
 * CSV in both directions (GAP-050): reading a member's contact spreadsheet
 * and writing the three tables of a CSV export.
 *
 * Reading follows RFC 4180 — quoted fields, a doubled quote inside one, and
 * line breaks inside a quoted field — and accepts CRLF, LF, or CR endings,
 * because every spreadsheet writes one of them. The delimiter is the one the
 * header row uses more of, comma or semicolon: a European spreadsheet writes
 * semicolons because its decimal separator is a comma. The first non-blank
 * row is the header and is required, since a column the member cannot name
 * is a column they cannot map.
 *
 * Writing is the same grammar backwards, with one addition: a cell that
 * begins with `=`, `+`, `-`, `@`, a tab, or a carriage return is prefixed
 * with `'`. A spreadsheet opening the export would otherwise run a person's
 * name as a formula, which is how a contact called `=HYPERLINK(...)` leaks a
 * workbook (OWASP "CSV injection").
 */

import { CONTACT_SOURCE_LIMITS } from "./contact_source.ts";

/** A parsed CSV: its header, its data rows, and the delimiter it used. */
export interface ParsedCsv {
  readonly delimiter: "," | ";";
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

/** The media type a CSV is written under. */
export const CSV_MIME_TYPE = "text/csv; charset=utf-8";

/** The delimiter the first line uses more of, outside quotes. */
function detectDelimiter(text: string): "," | ";" {
  let commas = 0;
  let semicolons = 0;
  let quoted = false;
  for (const character of text) {
    if (character === '"') quoted = !quoted;
    else if (!quoted && (character === "\n" || character === "\r")) break;
    else if (!quoted && character === ",") commas++;
    else if (!quoted && character === ";") semicolons++;
  }
  return semicolons > commas ? ";" : ",";
}

/** Every record in `text`, or the sentence that says why it is unreadable. */
function records(text: string, delimiter: string): string[][] | string {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let index = 0;
  let quotedField = false;
  const endField = () => {
    row.push(field);
    field = "";
    quotedField = false;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };
  while (index < text.length) {
    const character = text[index]!;
    if (character === '"' && field === "" && !quotedField) {
      const close = (() => {
        let cursor = index + 1;
        let value = "";
        while (cursor < text.length) {
          if (text[cursor] === '"') {
            if (text[cursor + 1] === '"') {
              value += '"';
              cursor += 2;
              continue;
            }
            return { cursor: cursor + 1, value };
          }
          value += text[cursor];
          cursor++;
        }
        return undefined;
      })();
      if (!close) return "A quoted CSV field is never closed.";
      const next = text[close.cursor];
      if (
        next !== undefined && next !== delimiter && next !== "\r" &&
        next !== "\n"
      ) return "A quoted CSV field has text after its closing quote.";
      field = close.value;
      quotedField = true;
      index = close.cursor;
      continue;
    }
    if (character === delimiter) {
      endField();
    } else if (character === "\r" || character === "\n") {
      endRow();
      if (character === "\r" && text[index + 1] === "\n") index++;
    } else {
      field += character;
    }
    index++;
  }
  if (field !== "" || quotedField || row.length > 0) endRow();
  for (const record of rows) {
    if (record.some((cell) => cell.length > CONTACT_SOURCE_LIMITS.value)) {
      return "A CSV field may be at most 10,000 characters.";
    }
  }
  return rows;
}

/** A record without the empty fields a trailing delimiter leaves. */
function trimmed(record: readonly string[]): string[] {
  const cells = [...record];
  while (cells.length > 0 && cells.at(-1) === "") cells.pop();
  return cells;
}

/**
 * The header and data rows of `text`, or the sentence the member is shown.
 *
 * Blank lines are skipped. A row shorter than the header is padded with empty
 * cells; a row with a non-empty field past the header is refused rather than
 * guessed at, because nothing says which column it belongs to.
 */
export function parseCsv(text: string): ParsedCsv | string {
  const source = text.replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(source.trimStart());
  const parsed = records(source, delimiter);
  if (typeof parsed === "string") return parsed;
  const nonBlank = parsed.filter((record) =>
    record.some((cell) => cell.trim() !== "")
  );
  const [header, ...data] = nonBlank;
  const headers = header ? trimmed(header).map((cell) => cell.trim()) : [];
  if (headers.length === 0 || headers.every((cell) => cell === "")) {
    return "The CSV file needs a header row.";
  }
  if (headers.length > CONTACT_SOURCE_LIMITS.columns) {
    return `A CSV file may declare at most ${CONTACT_SOURCE_LIMITS.columns} columns.`;
  }
  if (data.length > CONTACT_SOURCE_LIMITS.contacts) {
    return `A CSV file may contain at most ${CONTACT_SOURCE_LIMITS.contacts} rows.`;
  }
  const rows: string[][] = [];
  for (const [number, record] of data.entries()) {
    const cells = trimmed(record);
    if (cells.length > headers.length) {
      return `Row ${number + 1} has more fields than the header.`;
    }
    rows.push(headers.map((_, column) => cells[column] ?? ""));
  }
  return { delimiter, headers, rows };
}

/** A cell a spreadsheet will show as text rather than evaluate. */
export function safeCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** One cell as RFC 4180 writes it. */
function quoted(value: string): string {
  const cell = safeCell(value);
  return /[",\r\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
}

/** Rows as a comma-separated CSV with CRLF endings. */
export function csvText(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => `${row.map(quoted).join(",")}\r\n`).join("");
}
