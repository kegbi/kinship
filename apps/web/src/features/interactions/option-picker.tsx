/**
 * One of Quick capture's bounded selectors: participants, the activity type,
 * or emotions (GAP-031).
 *
 * A selector shows one page of options at a time — at most 70, never the
 * whole workspace — with a search field and a "Load more" control that
 * continues the page on screen. A search runs when it is committed (the
 * field's native `change`, on blur or Enter), as it did before; a
 * continuation belongs to the search that produced its cursor, so it waits
 * until the field shows that search again. Each selector reads through its
 * own latest-request slot, so only its newest search or continuation lands,
 * and an answer for a search the field no longer shows is dropped. A chosen
 * option stays offered whatever page is on screen.
 *
 * The dialog owns what is chosen; a selector owns only its page, and the
 * dialog remounts it (with a new `key`) whenever the draft starts over.
 */

import {
  type Ref,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Avatar } from "@/components/ui/avatar.tsx";
import { buttonVariants } from "@/components/ui/variants.ts";
import { nameInitials } from "../../lib/person-name.ts";
import { type ApiCall, useLatestRequest } from "../../islands/core/index.ts";
import {
  type Choice,
  type OptionPage,
  selectorOptions,
} from "./capture-state.ts";

export interface OptionPickerProps {
  /** The page the selector starts from. */
  readonly initial: OptionPage;
  readonly chosen: readonly Choice[];
  readonly onChoose: (chosen: readonly Choice[]) => void;
  /** The request for one page of `search`, continued from `cursor`. */
  readonly load: (search: string, cursor?: string) => ApiCall<OptionPage>;
  readonly disabled: boolean;
  readonly multiple: boolean;
  /** A first option meaning "none", for a single-choice selector. */
  readonly blank?: string | undefined;
  readonly select: {
    readonly id: string;
    readonly name: string;
    readonly label: string;
    readonly size?: number | undefined;
    readonly required?: boolean | undefined;
    readonly describedBy?: string | undefined;
  };
  /** The list box, for the dialog to focus. */
  readonly selectRef?: Ref<HTMLSelectElement> | undefined;
  readonly search: {
    readonly id: string;
    readonly name: string;
    readonly label: string;
    readonly maxLength: number;
    readonly placeholder: string;
  };
  readonly more: {
    readonly label: string;
    /** The `data-*` attribute the "Load more" control carries. */
    readonly data: string;
  };
  /**
   * The label of a list that draws each chosen option with its avatar
   * (GAP-045). A native option cannot hold an image, so the people picker
   * shows who was chosen, avatar and name, beneath the list box.
   */
  readonly showChosen?: string | undefined;
}

interface Page extends OptionPage {
  /** The search the page and its cursor answer. */
  readonly search: string;
}

export function OptionPicker(
  { selectRef, ...props }: OptionPickerProps,
) {
  const [page, setPage] = useState<Page>({ ...props.initial, search: "" });
  const request = useLatestRequest();
  const field = useRef<HTMLInputElement>(null);
  const shown = () => field.current?.value.trim() ?? "";

  const fetchPage = (search: string, cursor?: string) =>
    void request(props.load(search, cursor)).then((answer) => {
      if (answer?.status !== "ready" || !answer.data) return;
      if (search !== shown()) return;
      setPage({ ...answer.data, search });
    });

  // A search runs when it is committed, as the field's native `change` says.
  const commit = useEffectEvent(() => {
    const search = shown();
    setPage((current) => ({ ...current, cursor: undefined, search }));
    fetchPage(search);
  });
  useLayoutEffect(() => {
    const element = field.current!;
    const listener = () => commit();
    element.addEventListener("change", listener);
    return () => element.removeEventListener("change", listener);
  }, []);

  const more = () => {
    if (page.cursor && page.search === shown()) {
      fetchPage(page.search, page.cursor);
    }
  };

  const options = selectorOptions(page.records, props.chosen);
  const single = !props.multiple;
  const chosenIds = props.chosen.map((entry) => entry.id);
  const choose = (select: HTMLSelectElement) => {
    const ids = new Set(
      [...select.selectedOptions].map((entry) => entry.value).filter(Boolean),
    );
    props.onChoose(options.filter((entry) => ids.has(entry.id)));
  };

  return (
    <>
      <label htmlFor={props.search.id}>{props.search.label}</label>
      <input
        autoComplete="off"
        disabled={props.disabled}
        id={props.search.id}
        maxLength={props.search.maxLength}
        name={props.search.name}
        placeholder={props.search.placeholder}
        ref={field}
        type="search"
      />
      <label htmlFor={props.select.id}>{props.select.label}</label>
      <select
        aria-describedby={props.select.describedBy}
        disabled={props.disabled}
        id={props.select.id}
        multiple={props.multiple}
        name={props.select.name}
        onChange={(event) => choose(event.currentTarget)}
        ref={selectRef}
        required={props.select.required}
        size={props.select.size}
        value={single ? chosenIds[0] ?? "" : chosenIds}
      >
        {props.blank !== undefined
          ? <option value="">{props.blank}</option>
          : single
          // A list box of one choice may choose nothing; this option stands
          // for that, so no person is chosen for the member.
          ? <option hidden value="" />
          : null}
        {options.map((entry) => (
          <option key={entry.id} value={entry.id}>{entry.name}</option>
        ))}
      </select>
      <button
        {...{ [`data-${props.more.data}`]: "" }}
        className={buttonVariants({ variant: "outline" })}
        disabled={props.disabled}
        hidden={!page.cursor}
        onClick={more}
        type="button"
      >
        {props.more.label}
      </button>
      {props.showChosen === undefined ? null : (
        <ul
          aria-label={props.showChosen}
          className="capture-chosen"
          data-participants-chosen=""
          hidden={props.chosen.length === 0}
        >
          {props.chosen.map((entry) => (
            <li key={entry.id}>
              <Avatar
                avatar={entry.avatar}
                initials={nameInitials(entry.name)}
                size="sm"
              />
              <span>{entry.name}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
