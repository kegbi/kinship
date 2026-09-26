/**
 * Food preferences: what the person eats, avoids, and cannot have (GAP-029).
 * One free-text record at most, stored on the person, which the add control
 * edits once it exists and a "Clear" control removes; the rail clamps it.
 */

import {
  foodPreferencesFactCreateInput,
  foodPreferencesFactUpdateInput,
} from "../../../../../../packages/contracts/schemas/people.ts";
import { ClampedSummary } from "./clamped-summary.tsx";
import { FactEditor, type FactFormSpec } from "./fact-editor.tsx";
import { NotesField } from "./fact-form.tsx";
import { factSummary, filled } from "./records.ts";
import { type FactIslandProps, factSectionMount } from "./mount.tsx";
import { railPublisher } from "./publish.ts";

interface FoodValues {
  foodPreferences: string;
}

const form: FactFormSpec<FoodValues> = {
  create: foodPreferencesFactCreateInput,
  empty: { foodPreferences: "" },
  fields: (
    <NotesField
      label="Food, allergy, and dietary preferences"
      name="foodPreferences"
      required
    />
  ),
  input: (values) => ({ foodPreferences: filled(values.foodPreferences) }),
  update: foodPreferencesFactUpdateInput,
  values: (record) => ({
    foodPreferences: record.section === "food-preferences"
      ? record.value.foodPreferences ?? ""
      : "",
  }),
  wording: { required: { foodPreferences: "Enter food preferences." } },
};

const publish = railPublisher("food-preferences");

export function FoodPreferences(props: FactIslandProps) {
  return (
    <FactEditor
      {...props}
      followsPerson
      form={form}
      noun="food preferences"
      publish={publish}
      remove={{ context: "food preferences", verb: "Clear" }}
      rows={{
        summary: (record, options) => (
          <ClampedSummary
            suffix="food preferences"
            text={factSummary(record, options)}
          />
        ),
      }}
      section="food-preferences"
      singleton
    />
  );
}

export const mountFoodPreferences = factSectionMount(
  "person-fact-food-preferences",
  "food-preferences",
  FoodPreferences,
);
