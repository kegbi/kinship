/**
 * Addresses: each address's name, lines, labels, and whether it is the
 * primary one (GAP-029). The rail keeps the first address in view over three
 * lines and collapses the rest behind an expander.
 */

import {
  addressFactCreateInput,
  addressFactUpdateInput,
} from "../../../../../../packages/contracts/schemas/people.ts";
import { FactEditor, type FactFormSpec } from "./fact-editor.tsx";
import {
  CheckboxField,
  ChoiceField,
  LookupSlot,
  TextField,
} from "./fact-form.tsx";
import { profileOptionLookup } from "./lookup.ts";
import { addressLines, filled } from "./records.ts";
import { type FactIslandProps, factSectionMount } from "./mount.tsx";
import { railPublisher } from "./publish.ts";

interface AddressValues {
  city: string;
  country: string;
  displayName: string;
  isPrimary: boolean;
  labelIds: string[];
  postalCode: string;
  region: string;
  street: string;
}

/** The address's text fields, their labels, and their limits. */
const LINES = [
  ["displayName", "Address name", 200],
  ["street", "Street", 500],
  ["city", "City", 200],
  ["region", "Region", 200],
  ["postalCode", "Postal code", 50],
  ["country", "Country", 200],
] as const;

const form: FactFormSpec<AddressValues> = {
  create: addressFactCreateInput,
  empty: {
    city: "",
    country: "",
    displayName: "",
    isPrimary: false,
    labelIds: [],
    postalCode: "",
    region: "",
    street: "",
  },
  fields: (
    <>
      {LINES.map(([name, label, maxLength]) => (
        <TextField key={name} label={label} maxLength={maxLength} name={name} />
      ))}
      <ChoiceField label="Address labels" multiple name="labelIds" />
      <CheckboxField label="Primary address" name="isPrimary" />
      <LookupSlot />
    </>
  ),
  input: (values) => ({
    ...Object.fromEntries(LINES.map(([name]) => [name, filled(values[name])])),
    isPrimary: values.isPrimary,
    labelIds: values.labelIds,
  }),
  update: addressFactUpdateInput,
  values: (record) =>
    record.section === "addresses"
      ? {
        city: record.value.city ?? "",
        country: record.value.country ?? "",
        displayName: record.value.displayName ?? "",
        isPrimary: record.value.isPrimary,
        labelIds: [...record.value.labelIds],
        postalCode: record.value.postalCode ?? "",
        region: record.value.region ?? "",
        street: record.value.street ?? "",
      }
      : form.empty,
  wording: {
    empty: { field: "displayName", message: "Enter address details." },
    lists: { labelIds: "labels" },
  },
};

const lookup = profileOptionLookup({
  label: "Search address labels",
  more: "Load more address labels",
}, { labelIds: "contact-label" });

const publish = railPublisher("addresses");

export function Addresses(props: FactIslandProps) {
  return (
    <FactEditor
      {...props}
      form={form}
      lookup={lookup}
      noun="addresses"
      publish={publish}
      remove={{ verb: "Delete" }}
      rows={{
        collapse: (records) =>
          records.length > 1
            ? {
              hidden: new Set(records.slice(1).map((record) => record.id)),
              label: `+ ${records.length - 1} more`,
              suffix: "addresses",
            }
            : undefined,
        summary: (record, options) =>
          record.section === "addresses"
            ? (
              <p className="profile-address-summary">
                {addressLines(record, options).map((line, index) => (
                  <span key={index}>{line}</span>
                ))}
              </p>
            )
            : null,
      }}
      section="addresses"
    />
  );
}

export const mountAddresses = factSectionMount(
  "person-fact-addresses",
  "addresses",
  Addresses,
);
