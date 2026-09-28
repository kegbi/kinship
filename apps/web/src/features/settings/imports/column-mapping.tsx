/**
 * The CSV column-mapping step (GAP-050): the file's header and first rows,
 * and one choice per column of the field it fills.
 *
 * The form is a contract form over the schema the mapping route parses with
 * (`csvColumnMapping`), so the browser refuses exactly what the API would.
 * The choices start from the mapping the header suggested. The step takes
 * focus when it appears, because it replaces the control the reader just
 * used, and a refused mapping keeps the reader's choices; the refusal itself
 * is the page's status line.
 */

import { useLayoutEffect, useRef } from "react";
import type { CsvColumnTarget } from "../../../../../../packages/contracts/generated/auth-client.ts";
import {
  CSV_COLUMN_TARGETS,
  csvColumnMapping,
} from "../../../../../../packages/contracts/schemas/imports.ts";
import { useContractForm } from "../../../islands/core/index.ts";
import { CSV_TARGET_LABELS, type PendingMapping } from "./imports.ts";

export function ColumnMapping(props: {
  readonly applying: boolean;
  readonly mapping: PendingMapping;
  readonly onApply: (columns: readonly CsvColumnTarget[]) => void;
}) {
  const { headers, rowCount, rows, suggested } = props.mapping.preview;
  const form = useContractForm(csvColumnMapping, {
    defaultValues: { columns: [...suggested] },
  });
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    heading.current?.focus();
  }, [props.mapping.importId]);

  return (
    <section
      aria-labelledby="import-mapping-heading"
      className="import-mapping"
      data-import-mapping=""
    >
      <h2 id="import-mapping-heading" ref={heading} tabIndex={-1}>
        Map columns
      </h2>
      <p>
        {rowCount} row{rowCount === 1 ? "" : "s"}. The first{" "}
        {rows.length === 1 ? "row is" : `${rows.length} rows are`}{" "}
        shown. Columns left on Ignore are not imported.
      </p>
      <form
        className="import-form"
        data-import-mapping-form=""
        method="post"
        onSubmit={form.handleSubmit((values) => props.onApply(values.columns))}
      >
        <div className="import-preview" role="region" aria-label="CSV preview">
          <table>
            <thead>
              <tr>
                {headers.map((header, column) => (
                  <th key={column} scope="col">
                    <label htmlFor={`import-column-${column}`}>
                      {header || `Column ${column + 1}`}
                    </label>
                    <select
                      disabled={props.applying}
                      id={`import-column-${column}`}
                      {...form.register(`columns.${column}`)}
                    >
                      {CSV_COLUMN_TARGETS.map((target) => (
                        <option key={target} value={target}>
                          {CSV_TARGET_LABELS[target]}
                        </option>
                      ))}
                    </select>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>
                  {headers.map((_, column) => (
                    <td key={column}>{row[column] ?? ""}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button disabled={props.applying} type="submit">
          Apply mapping
        </button>
      </form>
    </section>
  );
}
