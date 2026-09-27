import { describe, expect, it } from "vitest";
import {
  dirtyLine,
  initialSettingsForm,
  REVIEW_FIELDS,
  type SettingsFormAction,
  settingsFormReducer,
  type SettingsFormState,
} from "./settings-form.ts";

type Values = { readonly name: string };
const reduce = (
  state: SettingsFormState<Values>,
  ...actions: SettingsFormAction<Values>[]
) => actions.reduce(settingsFormReducer<Values>, state);
const loading = initialSettingsForm<Values>("Loading…");
const ready = reduce(loading, { type: "loaded", values: { name: "Circle" } });

describe("AUTH-004 settings form state", () => {
  it("loads disabled, then restarts the fields from the loaded values", () => {
    expect(loading).toMatchObject({
      generation: 0,
      phase: "loading",
      status: "Loading…",
    });
    expect(dirtyLine(loading)).toEqual({ text: "" });
    expect(ready).toMatchObject({
      dirty: false,
      generation: 1,
      phase: "ready",
      status: "",
      values: { name: "Circle" },
    });
    expect(dirtyLine(ready)).toEqual({
      state: "saved",
      text: "All changes saved.",
    });
    const unavailable = reduce(loading, {
      message: "Down.",
      type: "unavailable",
    });
    expect(unavailable).toMatchObject({
      phase: "unavailable",
      status: "Down.",
    });
    expect(dirtyLine(unavailable)).toEqual({ text: "" });
  });

  it("tracks edits and a discarded draft", () => {
    const edited = reduce(ready, { dirty: true, type: "edited" });
    expect(dirtyLine(edited)).toEqual({
      state: "dirty",
      text: "Unsaved changes.",
    });
    const discarded = reduce(edited, { type: "discarded" });
    expect(dirtyLine(discarded)).toEqual({
      state: "saved",
      text: "Unsaved changes discarded.",
    });
    expect(dirtyLine(reduce(discarded, { dirty: false, type: "edited" })))
      .toEqual({ state: "saved", text: "All changes saved." });
  });

  it("marks refused fields once and clears each as it is edited", () => {
    const invalid = reduce(
      ready,
      { name: "name", type: "invalid" },
      { name: "name", type: "invalid" },
    );
    expect(invalid).toMatchObject({
      invalid: ["name"],
      summary: true,
      validation: 2,
    });
    expect(REVIEW_FIELDS).toBe("Review the highlighted fields and try again.");
    const stillInvalid = reduce(invalid, {
      name: "name",
      type: "input",
      valid: false,
    });
    expect(stillInvalid.invalid).toEqual(["name"]);
    expect(
      reduce(invalid, { name: "name", type: "input", valid: true }).invalid,
    )
      .toEqual([]);
  });

  it("saves, and shows a refusal beside the fields it names", () => {
    const saving = reduce(ready, { message: "Saving…", type: "saving" });
    expect(saving).toMatchObject({ saving: true, status: "Saving…" });
    const plain = reduce(saving, { message: "Down.", type: "refused" });
    expect(plain).toMatchObject({
      saving: false,
      status: "Down.",
      summary: false,
      validation: 0,
    });
    const fielded = reduce(saving, {
      errors: { timezone: "Enter a valid IANA time zone." },
      message: "Review the values.",
      type: "refused",
    });
    expect(fielded).toMatchObject({
      errors: { timezone: "Enter a valid IANA time zone." },
      invalid: ["timezone"],
      saving: false,
      summary: true,
      validation: 1,
    });
    const cleared = reduce(fielded, {
      name: "timezone",
      type: "input",
      valid: true,
    });
    expect(cleared.errors).toEqual({});
    const saved = reduce(
      reduce(fielded, { dirty: true, type: "edited" }),
      { message: "Saved.", type: "saved" },
    );
    expect(saved).toMatchObject({
      dirty: false,
      saving: false,
      status: "Saved.",
      summary: false,
    });
  });
});
