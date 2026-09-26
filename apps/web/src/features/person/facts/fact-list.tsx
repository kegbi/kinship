/**
 * The records a fact section lists (GAP-029): each row's summary, details,
 * and controls, the previous and next page controls, and below them the
 * expander of a block that keeps one record in view, in the vanilla rail's
 * order. They only render; the editor owns what they show and what their
 * controls do.
 *
 * A control's visible verb stays short in the rail ("Edit", "Delete") and
 * names what it acts on for assistive technology, as the vanilla rail did.
 */

import type { ReactNode } from "react";
import type {
  ProfileFactOption,
  ProfileFactRecord,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import { Button } from "@/components/ui/button.tsx";
import { factDetails, type FactPage, factSummary } from "./records.ts";

/** A visible verb, then what it acts on for assistive technology. */
export function Quiet(
  props: { readonly action: string; readonly context: string },
) {
  return (
    <>
      {props.action}
      <span className="sr-only">{` ${props.context}`}</span>
    </>
  );
}

/** How the rows of a section read. */
export interface FactRows {
  /** The summary element of one record's row. */
  readonly summary?: (
    record: ProfileFactRecord,
    options: readonly ProfileFactOption[],
  ) => ReactNode;
  /** Controls a row offers before its edit control. */
  readonly actions?: (
    record: ProfileFactRecord,
    options: readonly ProfileFactOption[],
    busy: boolean,
  ) => ReactNode;
  /**
   * The records a collapsed block keeps out of view, and what its expander
   * says while collapsed.
   */
  readonly collapse?: (
    records: readonly ProfileFactRecord[],
  ) =>
    | {
      readonly hidden: ReadonlySet<string>;
      readonly label: string;
      readonly suffix: string;
    }
    | undefined;
}

/** How a record is removed; a section without one never removes records. */
export interface FactRemoval {
  readonly verb: "Delete" | "Clear";
  /** The context the control names, instead of the record's summary. */
  readonly context?: string;
}

export function FactList(
  props: {
    readonly noun: string;
    readonly records: readonly ProfileFactRecord[];
    readonly options: readonly ProfileFactOption[];
    readonly rows?: FactRows | undefined;
    readonly remove?: FactRemoval | undefined;
    /** Whether the rows offer edit and remove controls. */
    readonly editable: boolean;
    /** Disables every control while the section reads. */
    readonly busy: boolean;
    /** The record whose remove control asks for confirmation. */
    readonly confirming?: string | undefined;
    readonly expanded: boolean;
    readonly onExpand: () => void;
    /** The page controls, which sit between the list and its expander. */
    readonly pages: ReactNode;
    readonly onEdit: (record: ProfileFactRecord, opener: HTMLElement) => void;
    readonly onRemove: (record: ProfileFactRecord) => void;
  },
) {
  const { busy, editable, options, remove, rows } = props;
  const collapsed = rows?.collapse?.(props.records);
  return (
    <>
      <ul
        aria-label={`Saved ${props.noun}`}
        className="profile-fact-list"
        data-profile-fact-list=""
      >
        {props.records.map((record) => {
          const summary = factSummary(record, options);
          const details = factDetails(record, options);
          const extra = rows?.actions?.(record, options, busy);
          return (
            <li
              hidden={collapsed?.hidden.has(record.id) === true &&
                !props.expanded}
              key={record.id}
            >
              {rows?.summary?.(record, options) ?? <p>{summary}</p>}
              {details.length > 0
                ? (
                  <dl className="profile-fact-details">
                    {details.map((detail) => (
                      <div key={detail.label}>
                        <dt>{detail.label}</dt>
                        <dd>
                          {detail.href
                            ? <a href={detail.href}>{detail.value}</a>
                            : detail.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )
                : null}
              {extra || editable
                ? (
                  <div className="profile-fact-actions">
                    {extra}
                    {editable
                      ? (
                        <Button
                          disabled={busy}
                          onClick={(event) =>
                            props.onEdit(record, event.currentTarget)}
                          type="button"
                          variant="outline"
                        >
                          <Quiet action="Edit" context={summary} />
                        </Button>
                      )
                      : null}
                    {editable && remove
                      ? (
                        <Button
                          className="profile-rail-remove"
                          disabled={busy}
                          onClick={() => props.onRemove(record)}
                          type="button"
                          variant="destructive"
                        >
                          <Quiet
                            action={props.confirming === record.id
                              ? `Confirm ${remove.verb.toLowerCase()}`
                              : remove.verb}
                            context={remove.context ?? summary}
                          />
                        </Button>
                      )
                      : null}
                  </div>
                )
                : null}
            </li>
          );
        })}
      </ul>
      {props.pages}
      {/* Always drawn, so nothing is ever inserted before the editor below. */}
      <Button
        aria-expanded={props.expanded}
        className="profile-rail-summary-control profile-rail-expander"
        data-profile-fact-expander=""
        disabled={busy}
        hidden={!collapsed || collapsed.hidden.size === 0}
        onClick={props.onExpand}
        type="button"
        variant="outline"
      >
        <Quiet
          action={props.expanded ? "Show fewer" : collapsed?.label ?? ""}
          context={collapsed?.suffix ?? ""}
        />
      </Button>
    </>
  );
}

/** The previous and next page controls of a section's list. */
export function FactPages(
  props: {
    readonly label: string;
    readonly noun: string;
    readonly page: FactPage | undefined;
    readonly disabled: boolean;
    readonly onPage: (cursor: string | undefined, index: number) => void;
  },
) {
  const { page } = props;
  return (
    <nav aria-label={props.label} data-profile-fact-pagination="">
      <Button
        data-profile-fact-previous=""
        disabled={props.disabled}
        hidden={!page || page.index === 0}
        onClick={() =>
          page && props.onPage(page.cursors[page.index - 1], page.index - 1)}
        type="button"
        variant="outline"
      >
        {`Previous ${props.noun}`}
      </Button>
      <Button
        data-profile-fact-more=""
        disabled={props.disabled}
        hidden={!page?.nextCursor}
        onClick={() =>
          page?.nextCursor && props.onPage(page.nextCursor, page.index + 1)}
        type="button"
        variant="outline"
      >
        {`Next ${props.noun}`}
      </Button>
    </nav>
  );
}
