/**
 * Tags: which of the workspace's tags the person carries (GAP-029).
 *
 * The hero previews the tags; this is the editor beside that preview. The
 * assignment is one record stored on the person, which "Edit tags" edits and
 * nothing removes. A choice made on one page of tags stays chosen while the
 * reader searches others, and an assignment naming a tag no answer can find
 * again is never edited blind.
 */

import {
  tagsFactCreateInput,
  tagsFactUpdateInput,
} from "../../../../../../packages/contracts/schemas/people.ts";
import { FactEditor, type FactFormSpec } from "./fact-editor.tsx";
import { ChoiceField, LookupSlot } from "./fact-form.tsx";
import { tagLookup } from "./lookup.ts";
import { type FactPage, tagSummary } from "./records.ts";
import { type FactIslandProps, factSectionMount } from "./mount.tsx";
import { tagPublisher } from "./publish.ts";

interface TagValues {
  tagIds: string[];
}

const form: FactFormSpec<TagValues> = {
  create: tagsFactCreateInput,
  empty: { tagIds: [] },
  fields: (
    <>
      <LookupSlot />
      <ChoiceField label="Assigned tags" multiple name="tagIds" />
    </>
  ),
  input: (values) => ({ tagIds: values.tagIds }),
  update: tagsFactUpdateInput,
  values: (record) => ({
    tagIds: record.section === "tags" ? [...record.value.tagIds] : [],
  }),
  wording: { lists: { tagIds: "tags" } },
};

/** How many tags the assignment holds. */
function summaryText(page: FactPage): string {
  const record = page.records.find((entry) => entry.section === "tags");
  return tagSummary(
    record?.section === "tags" ? record.value.tagIds.length : 0,
  );
}

export function Tags(props: FactIslandProps) {
  return (
    <FactEditor
      {...props}
      addControl="button"
      addLabel={() => "Edit tags"}
      followsPerson
      form={form}
      lookup={tagLookup}
      noun="tags"
      publish={tagPublisher}
      savedAfterSummary
      section="tags"
      singleton
      summaryText={summaryText}
    />
  );
}

export const mountTags = factSectionMount("person-fact-tags", "tags", Tags);
