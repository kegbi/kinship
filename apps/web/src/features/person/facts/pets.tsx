/**
 * Pets: each pet's name, its category from the workspace vocabulary, and
 * notes about it (GAP-029). A pet needs a name or a category.
 */

import {
  petFactCreateInput,
  petFactUpdateInput,
} from "../../../../../../packages/contracts/schemas/people.ts";
import { FactEditor, type FactFormSpec } from "./fact-editor.tsx";
import {
  ChoiceField,
  LookupSlot,
  NotesField,
  TextField,
} from "./fact-form.tsx";
import { profileOptionLookup } from "./lookup.ts";
import { filled } from "./records.ts";
import { type FactIslandProps, factSectionMount } from "./mount.tsx";
import { railPublisher } from "./publish.ts";

interface PetValues {
  categoryId: string;
  name: string;
  notes: string;
}

const form: FactFormSpec<PetValues> = {
  create: petFactCreateInput,
  empty: { categoryId: "", name: "", notes: "" },
  fields: (
    <>
      <TextField label="Pet name" maxLength={200} name="name" />
      <ChoiceField label="Pet category" name="categoryId" />
      <NotesField label="Pet notes" name="notes" />
      <LookupSlot />
    </>
  ),
  input: (values) => ({
    categoryId: filled(values.categoryId),
    name: filled(values.name),
    notes: filled(values.notes),
  }),
  update: petFactUpdateInput,
  values: (record) =>
    record.section === "pets"
      ? {
        categoryId: record.value.categoryId ?? "",
        name: record.value.name ?? "",
        notes: record.value.notes ?? "",
      }
      : form.empty,
  wording: {
    empty: { field: "name", message: "Enter a pet name or category." },
  },
};

const lookup = profileOptionLookup({
  label: "Search pet categories",
  more: "Load more pet categories",
}, { categoryId: "pet-category" });

const publish = railPublisher("pets");

export function Pets(props: FactIslandProps) {
  return (
    <FactEditor
      {...props}
      form={form}
      lookup={lookup}
      noun="pets"
      publish={publish}
      remove={{ verb: "Delete" }}
      section="pets"
    />
  );
}

export const mountPets = factSectionMount("person-fact-pets", "pets", Pets);
