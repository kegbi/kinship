import { describe, expect, it } from "vitest";
import {
  type BulkTagPickerAction,
  bulkTagPickerReducer,
  type BulkTagPickerState,
  initialBulkTagPicker,
  tagOptionsInput,
} from "./bulk-tag-picker.ts";

const friends = { id: "f", name: "Friends" };
const family = { id: "m", name: "Family" };
const work = { id: "w", name: "Work" };

const state = (
  overrides: Partial<BulkTagPickerState> = {},
): BulkTagPickerState => ({ ...initialBulkTagPicker, ...overrides });

describe("REL-066 the bulk bar's tag picker", () => {
  const cases: readonly {
    readonly name: string;
    readonly from: BulkTagPickerState;
    readonly action: BulkTagPickerAction;
    readonly to: BulkTagPickerState;
  }[] = [
    {
      action: { append: false, query: "Fri", type: "loading" },
      from: state({ cursor: "next", options: [friends], chosen: "f" }),
      name: "a new search forgets the old continuation and keeps the options",
      to: state({
        chosen: "f",
        loading: true,
        options: [friends],
        query: "Fri",
        status: "Loading tag options…",
      }),
    },
    {
      action: { append: true, query: "ignored", type: "loading" },
      from: state({ cursor: "next", query: "Fa" }),
      name: "a continuation keeps the search it continues",
      to: state({
        cursor: "next",
        loading: true,
        query: "Fa",
        status: "Loading more tag options…",
      }),
    },
    {
      action: {
        append: false,
        page: {
          nextCursor: "next",
          options: [friends, family],
          status: "ready",
        },
        type: "loaded",
      },
      from: state({ chosen: "w", loading: true, options: [work] }),
      name: "a first page replaces the options and chooses the first",
      to: state({
        chosen: "f",
        cursor: "next",
        options: [friends, family],
        status: "2 tag options shown.",
      }),
    },
    {
      action: {
        append: false,
        page: { options: [friends, family], status: "ready" },
        type: "loaded",
      },
      from: state({ chosen: "m", loading: true, options: [family] }),
      name: "a first page keeps a choice it still lists",
      to: state({
        chosen: "m",
        options: [friends, family],
        status: "2 tag options shown.",
      }),
    },
    {
      action: {
        append: true,
        page: { options: [family, work], status: "ready" },
        type: "loaded",
      },
      from: state({
        chosen: "f",
        cursor: "next",
        loading: true,
        options: [friends, family],
      }),
      name: "a continuation appends only what is new and keeps the choice",
      to: state({
        chosen: "f",
        options: [friends, family, work],
        status: "3 tag options shown.",
      }),
    },
    {
      action: {
        append: false,
        page: { options: [], status: "ready" },
        type: "loaded",
      },
      from: state({ chosen: "f", loading: true, options: [friends] }),
      name: "a search with no match leaves nothing to choose",
      to: state({ status: "0 tag options shown." }),
    },
    {
      action: { append: false, type: "failed" },
      from: state({
        chosen: "f",
        cursor: "next",
        loading: true,
        options: [friends],
      }),
      name:
        "a failed first page keeps what was shown and offers no continuation",
      to: state({
        chosen: "f",
        options: [friends],
        status: "Tag options are temporarily unavailable.",
      }),
    },
    {
      action: { append: true, type: "failed" },
      from: state({
        chosen: "f",
        cursor: "next",
        loading: true,
        options: [friends],
        query: "Fr",
      }),
      name: "a failed continuation keeps More tags to try again",
      to: state({
        chosen: "f",
        cursor: "next",
        options: [friends],
        query: "Fr",
        status: "Tag options are temporarily unavailable.",
      }),
    },
    {
      action: { id: "m", type: "choose" },
      from: state({ chosen: "f", options: [friends, family] }),
      name: "a choice is kept",
      to: state({ chosen: "m", options: [friends, family] }),
    },
  ];

  for (const { action, from, name, to } of cases) {
    it(name, () => {
      expect(bulkTagPickerReducer(from, action)).toEqual(to);
    });
  }

  it("asks for a page with only the search and continuation given", () => {
    expect(tagOptionsInput("  ", undefined)).toEqual({});
    expect(tagOptionsInput(" Fri ", "next")).toEqual({
      cursor: "next",
      search: "Fri",
    });
  });
});
