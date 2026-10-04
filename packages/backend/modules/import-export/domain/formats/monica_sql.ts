/** A deliberately small data reader, never a SQL executor. */
const MAX_SQL_BYTES = 1_500_000;

const KEPT_TABLES = new Set([
  "contacts",
  "contact_fields",
  "contact_field_types",
  "addresses",
  "places",
  "special_dates",
  "notes",
  "photos",
]);
// Monica's exporter writes is_numeric() strings without quotes. Preserve the
// token's spelling for consumed text fields; identifiers, flags, and sizes
// still use numeric semantics. This is not a general SQL type inference layer.
const TEXT_COLUMNS = new Set([
  ...[
    "first_name",
    "middle_name",
    "last_name",
    "nickname",
    "description",
    "food_preferences",
    "job",
    "company",
    "uuid",
    "deleted_at",
    "avatar_source",
    "avatar_file_name",
    "avatar_gravatar_url",
    "avatar_adorable_url",
    "avatar_default_url",
    "avatar_external_url",
    "gravatar_url",
    "default_avatar_color",
  ].map((column) => `contacts.${column}`),
  ...["street", "city", "province", "postal_code", "country"].map((column) =>
    `places.${column}`
  ),
  "contact_fields.data",
  "notes.body",
  "photos.original_filename",
]);
const INVALID =
  "The SQL export must contain literal INSERT statements with explicit columns and optional FOREIGN_KEY_CHECKS toggles; SQL commands and expressions are not supported.";

/** Unknown tables retain only row counts, never their potentially secret values. */
export interface SqlTables {
  readonly tables: Record<string, Record<string, unknown>[]>;
}

class Reader {
  private offset = 0;
  constructor(private readonly text: string) {}

  private space(): void {
    while (this.offset < this.text.length) {
      const rest = this.text.slice(this.offset);
      const whitespace = /^\s+/.exec(rest)?.[0];
      if (whitespace) this.offset += whitespace.length;
      else if (rest.startsWith("#") || /^--(?:\s|$)/.test(rest)) {
        const end = this.text.indexOf("\n", this.offset);
        this.offset = end < 0 ? this.text.length : end + 1;
      } else if (rest.startsWith("/*")) {
        if (rest.startsWith("/*!")) throw new Error(INVALID);
        const end = this.text.indexOf("*/", this.offset + 2);
        if (end < 0) throw new Error(INVALID);
        this.offset = end + 2;
      } else break;
    }
  }

  done(): boolean {
    this.space();
    return this.offset === this.text.length;
  }

  take(value: string): boolean {
    this.space();
    if (!this.text.startsWith(value, this.offset)) return false;
    this.offset += value.length;
    return true;
  }

  need(value: string): void {
    if (!this.take(value)) throw new Error(INVALID);
  }

  word(): string {
    this.space();
    const quoted = this.take("`");
    const word = /^[a-zA-Z_][a-zA-Z0-9_]{0,99}/.exec(
      this.text.slice(this.offset),
    )?.[0];
    if (!word) throw new Error(INVALID);
    this.offset += word.length;
    if (quoted) this.need("`");
    return word.toLowerCase();
  }

  literal(preserveNumericText = false): unknown {
    this.space();
    const quote = this.text[this.offset];
    if (quote === "'" || quote === '"') {
      this.offset++;
      let value = "";
      while (this.offset < this.text.length) {
        const character = this.text[this.offset++]!;
        if (character === quote) {
          if (this.text[this.offset] !== quote) return value;
          this.offset++;
          value += quote;
        } else if (character === "\\") {
          const escaped = this.text[this.offset++];
          if (escaped === undefined) throw new Error(INVALID);
          const escapes: Record<string, string> = {
            "0": "\0",
            b: "\b",
            n: "\n",
            r: "\r",
            t: "\t",
            Z: "\x1a",
          };
          value += escapes[escaped] ??
            (escaped === "%" || escaped === "_" ? `\\${escaped}` : escaped);
        } else value += character;
      }
      throw new Error(INVALID);
    }
    const token =
      /^(?:NULL|TRUE|FALSE|[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=\s|[,);]|$)/i
        .exec(this.text.slice(this.offset))?.[0];
    if (!token) throw new Error(INVALID);
    this.offset += token.length;
    if (token.toUpperCase() === "NULL") return null;
    if (token.toUpperCase() === "TRUE") return true;
    if (token.toUpperCase() === "FALSE") return false;
    if (preserveNumericText) return token;
    const value = Number(token);
    return Number.isFinite(value) &&
        (!Number.isInteger(value) || Number.isSafeInteger(value))
      ? value
      : token;
  }
}

export function parseMonicaSql(text: unknown): SqlTables | string {
  if (
    typeof text !== "string" || text.includes("\u0000") ||
    text.includes("\uFFFD") ||
    new TextEncoder().encode(text).length > MAX_SQL_BYTES
  ) {
    return "The SQL export must be UTF-8 text within the 1.5 MB staging limit.";
  }
  const reader = new Reader(text.replace(/^\uFEFF/, ""));
  const tables: Record<string, Record<string, unknown>[]> = Object.create(null);
  let rows = 0;
  try {
    while (!reader.done()) {
      const statement = reader.word();
      if (statement === "set") {
        if (reader.word() !== "foreign_key_checks") throw new Error(INVALID);
        reader.need("=");
        if (![0, 1].includes(reader.literal() as number)) {
          throw new Error(INVALID);
        }
        reader.need(";");
        continue;
      }
      if (statement !== "insert") throw new Error(INVALID);
      let into = reader.word();
      if (into === "ignore") into = reader.word();
      if (into !== "into") throw new Error(INVALID);
      const table = reader.word();
      if (Object.keys(tables).length >= 100 && !tables[table]) {
        throw new Error(INVALID);
      }
      reader.need("(");
      const columns: string[] = [];
      do {
        const column = reader.word();
        if (columns.includes(column) || columns.length >= 100) {
          throw new Error(INVALID);
        }
        columns.push(column);
      } while (reader.take(","));
      reader.need(")");
      if (reader.word() !== "values") throw new Error(INVALID);
      do {
        reader.need("(");
        const values: unknown[] = [];
        do {
          if (values.length >= columns.length) throw new Error(INVALID);
          const value = reader.literal(
            TEXT_COLUMNS.has(`${table}.${columns[values.length]}`),
          );
          if (typeof value === "string" && value.includes("\0")) {
            throw new Error(INVALID);
          }
          values.push(value);
        } while (reader.take(","));
        reader.need(")");
        if (values.length !== columns.length || ++rows > 10_000) {
          throw new Error(INVALID);
        }
        (tables[table] ??= []).push(
          KEPT_TABLES.has(table)
            ? Object.fromEntries(
              columns.map((column, index) => [column, values[index]]),
            )
            : {},
        );
      } while (reader.take(","));
      reader.need(";");
    }
    if (!tables.contacts) {
      return "The SQL export must contain a contacts table.";
    }
    return { tables };
  } catch {
    // Never include a token, row value, SQL fragment, or driver error.
    return INVALID;
  }
}
