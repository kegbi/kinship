/**
 * The first meeting: where or how the reader met the person, who introduced
 * them, and the story of it (GAP-029). One record at most, which the add
 * control edits once it exists; its story is clamped in the rail, and its
 * place is the hero's first-met vital until a first-met date says when.
 */

import {
  firstMeetingFactCreateInput,
  firstMeetingFactUpdateInput,
} from "../../../../../../packages/contracts/schemas/people.ts";
import { ClampedSummary } from "./clamped-summary.tsx";
import { FactEditor, type FactFormSpec } from "./fact-editor.tsx";
import {
  ChoiceField,
  LookupSlot,
  NotesField,
  TextField,
} from "./fact-form.tsx";
import { introducerLookup } from "./lookup.ts";
import { factSummary, filled } from "./records.ts";
import { type FactIslandProps, factSectionMount } from "./mount.tsx";
import { firstMeetingVital, railPublisher } from "./publish.ts";

interface FirstMeetingValues {
  introducedByPersonId: string;
  notes: string;
  placeText: string;
}

const form: FactFormSpec<FirstMeetingValues> = {
  create: firstMeetingFactCreateInput,
  empty: { introducedByPersonId: "", notes: "", placeText: "" },
  fields: (
    <>
      <TextField
        label="Where or how you first met"
        maxLength={500}
        name="placeText"
      />
      <LookupSlot />
      <ChoiceField label="Introduced by" name="introducedByPersonId" />
      <NotesField label="First meeting story" name="notes" />
    </>
  ),
  input: (values) => ({
    introducedByPersonId: filled(values.introducedByPersonId),
    notes: filled(values.notes),
    placeText: filled(values.placeText),
  }),
  update: firstMeetingFactUpdateInput,
  values: (record) =>
    record.section === "first-meeting"
      ? {
        introducedByPersonId: record.value.introducedByPersonId ?? "",
        notes: record.value.notes ?? "",
        placeText: record.value.placeText ?? "",
      }
      : form.empty,
  wording: {
    empty: { field: "placeText", message: "Enter first-meeting details." },
  },
};

const publish = railPublisher("first-meeting", firstMeetingVital);

export function FirstMeeting(props: FactIslandProps) {
  return (
    <FactEditor
      {...props}
      form={form}
      lookup={introducerLookup}
      noun="first meeting"
      publish={publish}
      remove={{ verb: "Delete" }}
      rows={{
        summary: (record, options) => (
          <ClampedSummary
            suffix="first meeting"
            text={factSummary(record, options)}
          />
        ),
      }}
      section="first-meeting"
      singleton
    />
  );
}

export const mountFirstMeeting = factSectionMount(
  "person-fact-first-meeting",
  "first-meeting",
  FirstMeeting,
);
