/**
 * Turning a result row into a record.
 *
 * The canonical schema stores an absent optional value as NULL, and the
 * application records model the same absence by leaving the property off
 * entirely — `exactOptionalPropertyTypes` makes `{ nickname: undefined }` a
 * different thing from `{}`. Every repository bridged that gap with the same
 * line, `...(row.nickname ? { nickname: row.nickname } : {})`, once per
 * optional column and more than a hundred times across the backend.
 *
 * `pickDefined` is that line, written once.
 */

/**
 * The entries whose values are present, as a partial record.
 *
 * "Present" means truthy, which is exactly what the copied idiom tested: the
 * optional columns this maps are text, identifiers, and rendered timestamps,
 * where NULL and the empty string both mean absent.
 */
export function pickDefined<Fields extends Record<string, unknown>>(
  fields: Fields,
): { [Key in keyof Fields]?: NonNullable<Fields[Key]> } {
  const picked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value) picked[key] = value;
  }
  return picked as { [Key in keyof Fields]?: NonNullable<Fields[Key]> };
}
