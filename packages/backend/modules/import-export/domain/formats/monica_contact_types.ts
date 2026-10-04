/** Source-only catalog metadata, validated before it reaches staging. */
import type { ImportedContactMethodType } from "../contact_import.ts";
import {
  booleanValue,
  sourceId,
  textValue,
  validOptionalBoolean,
} from "./monica_source.ts";

type Row = Readonly<Record<string, unknown>>;
export function monicaTimestamps(
  row: Row,
): { readonly createdAt?: string; readonly updatedAt?: string } | string {
  const result: { createdAt?: string; updatedAt?: string } = {};
  for (
    const [source, target] of [["created_at", "createdAt"], [
      "updated_at",
      "updatedAt",
    ]] as const
  ) {
    const value = row[source];
    if (value === undefined || value === null || value === "") continue;
    // Monica exports timezone-free MySQL timestamps in UTC.
    if (
      typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z?$/.test(value)
    ) return "A Monica contact method timestamp is invalid.";
    const date = new Date(value.replace(" ", "T").replace(/Z?$/, "Z"));
    if (
      !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value.slice(0, 10)
    ) return "A Monica contact method timestamp is invalid.";
    result[target] = date.toISOString();
  }
  return result;
}
export function monicaContactType(
  row: Row,
): ImportedContactMethodType | string | undefined {
  const id = sourceId(row.id);
  if (!id) return undefined;
  for (
    const [field, max] of [["name", 120], ["protocol", 100], [
      "fontawesome_icon",
      100,
    ]] as const
  ) {
    if (
      row[field] !== undefined && row[field] !== null && row[field] !== "" &&
      !textValue(row[field], max)
    ) return "A Monica contact method type exceeds the supported text limit.";
  }
  if (row.delible !== null && !validOptionalBoolean(row.delible)) {
    return "A Monica contact method type flag is invalid.";
  }
  const timestamps = monicaTimestamps(row);
  if (typeof timestamps === "string") return timestamps;
  const kind =
    ["email", "phone", "url", "social", "im", "username", "custom"].includes(
        row.type as string,
      )
      ? row.type as ImportedContactMethodType["kind"]
      : "custom";
  const name = textValue(row.name, 120) ??
    (row.type === "email"
      ? "Email"
      : row.type === "phone"
      ? "Phone"
      : row.type === "url"
      ? "Website"
      : textValue(row.type, 120) ?? "Custom");
  const protocol = textValue(row.protocol, 100);
  const icon = textValue(row.fontawesome_icon, 100);
  return {
    key: `${encodeURIComponent(sourceId(row.account_id) ?? "")}:${
      encodeURIComponent(id)
    }`,
    name,
    kind,
    ...(typeof row.type === "string" && row.type !== kind
      ? { sourceKind: row.type }
      : {}),
    ...(protocol ? { protocol } : {}),
    ...(icon ? { icon } : {}),
    ...(row.delible !== undefined && row.delible !== null
      ? { canDelete: booleanValue(row.delible) }
      : {}),
    ...timestamps,
  };
}
