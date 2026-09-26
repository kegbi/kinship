/**
 * The choices a fact editor offers, and the lookup that loads them
 * (GAP-029).
 *
 * One hook owns the options a section's choice fields list: the page the
 * lookup loaded last, every option the section has seen by id (so a choice
 * keeps its name whatever page is on screen), and what each field held when
 * its options were last listed, which stays listed first. It also owns the
 * lookup's two failure modes: an editor that may not open, and saving blocked
 * while a search cannot answer.
 */

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type {
  ProfileFactOption,
  ProfileFactRecord,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import type { FactLookup, LookupContext } from "./lookup.ts";
import { mergeOptions } from "./records.ts";

interface Choices {
  readonly page: readonly ProfileFactOption[];
  readonly next?: string | undefined;
  readonly known: ReadonlyMap<string, ProfileFactOption>;
  /**
   * What each choice field held when its options were last listed. Those
   * stay listed first whatever page is loaded, so a choice never disappears
   * with the page it came from; they change only when a page lands, never as
   * the reader picks.
   */
  readonly pinned: Readonly<Record<string, readonly string[]>>;
}

const NONE: Choices = { known: new Map(), page: [], pinned: {} };

/** The chosen ids a choice field's value holds. */
function chosenIds(value: unknown): readonly string[] {
  if (Array.isArray(value)) return value.map(String);
  return typeof value === "string" && value ? [value] : [];
}

function learn(
  known: ReadonlyMap<string, ProfileFactOption>,
  options: readonly ProfileFactOption[],
): ReadonlyMap<string, ProfileFactOption> {
  const next = new Map(known);
  for (const option of options) next.set(option.id, option);
  return next;
}

export interface FactChoices {
  /** The options choice field `name` lists: what it held, then the page. */
  readonly options: (name: string) => readonly ProfileFactOption[];
  /** Whether the last answer offered another page. */
  readonly more: boolean;
  /** Whether saving is blocked because the choices could not be verified. */
  readonly blocked: boolean;
  /** Whether a search is in flight. */
  readonly searching: boolean;
  /** Starts again from a fresh read's options. */
  readonly reset: (options: readonly ProfileFactOption[]) => void;
  /** Learns options a later page of records named. */
  readonly learn: (options: readonly ProfileFactOption[]) => void;
  /** Lists `values`' choices first; called when an editor opens on them. */
  readonly pin: (values: Record<string, unknown>) => void;
  /**
   * Gets the choices ready for an editor about to open on `record`; answers
   * why it may not open, or `undefined` when it may.
   */
  readonly prepare: (
    record: ProfileFactRecord | undefined,
  ) => Promise<string | undefined>;
  /**
   * Loads the first page matching `search`, or the page after the last one;
   * answers what went wrong, or `undefined` when it landed.
   */
  readonly search: (search: string, next: boolean) => Promise<
    string | undefined
  >;
  /** Lets the editor save again; called when it opens on verified choices. */
  readonly unblock: () => void;
}

/**
 * The choices of a section with `lookup`, asking `context`; `values` reads
 * what the editor's fields hold now.
 */
export function useFactChoices(
  lookup: FactLookup | undefined,
  context: LookupContext,
  values: () => Record<string, unknown>,
): FactChoices {
  const [choices, setChoices] = useState<Choices>(NONE);
  const [blocked, setBlocked] = useState(false);
  const [searching, setSearching] = useState(false);
  // Whether a page has loaded since the section was last read.
  const prepared = useRef(false);
  // A search or an opening editor reads the choices as they are by then.
  const latest = useRef(choices);
  useLayoutEffect(() => {
    latest.current = choices;
  }, [choices]);

  const pinned = useCallback(
    (held: Record<string, unknown>) =>
      Object.fromEntries(
        Object.keys(lookup?.fields ?? {}).map((name) => [
          name,
          chosenIds(held[name]),
        ]),
      ),
    [lookup],
  );

  /** Loads a page; answers whether it came back. */
  const page = async (
    search: string | undefined,
    cursor: string | undefined,
    selected?: string | undefined,
  ): Promise<boolean> => {
    if (!lookup) return true;
    const answer = await lookup.page(context, { cursor, search, selected });
    if (!answer) {
      setBlocked(true);
      setChoices((current) => ({ ...current, next: undefined }));
      return false;
    }
    const held = pinned(values());
    setChoices((current) => ({
      known: learn(current.known, answer.options),
      next: answer.next,
      page: cursor
        ? mergeOptions(current.page, answer.options)
        : answer.options,
      pinned: held,
    }));
    setBlocked(false);
    prepared.current = true;
    return true;
  };

  const reset = useCallback((options: readonly ProfileFactOption[]) => {
    prepared.current = false;
    setChoices({ known: learn(new Map(), options), page: options, pinned: {} });
    setBlocked(false);
  }, []);

  const learnOptions = useCallback(
    (options: readonly ProfileFactOption[]) =>
      setChoices((current) => ({
        ...current,
        known: learn(current.known, options),
      })),
    [],
  );

  return {
    blocked,
    learn: learnOptions,
    more: choices.next !== undefined,
    options: (name) => {
      const kind = lookup?.fields[name];
      const first = choices.pinned[name] ?? [];
      const listed = new Set(first);
      return [
        ...first.map((id) => choices.known.get(id) ?? { id, name: id }),
        ...choices.page.filter((option) =>
          !listed.has(option.id) && (kind === undefined || option.kind === kind)
        ),
      ];
    },
    pin: (held) =>
      setChoices((current) => ({ ...current, pinned: pinned(held) })),
    prepare: async (record) => {
      if (!lookup) return undefined;
      const refusal = lookup.refuse?.(record, latest.current.known);
      if (refusal) {
        setBlocked(true);
        return refusal;
      }
      if (
        !prepared.current &&
        !await page(undefined, undefined, lookup.selected?.(record))
      ) return lookup.unverified;
      learnOptions(record?.selectedOptions ?? []);
      return undefined;
    },
    reset,
    search: async (search, next) => {
      if (!lookup) return undefined;
      setSearching(true);
      const landed = await page(
        search || undefined,
        next ? latest.current.next : undefined,
      );
      setSearching(false);
      return landed ? undefined : lookup.unavailable;
    },
    searching,
    unblock: () => setBlocked(false),
  };
}
