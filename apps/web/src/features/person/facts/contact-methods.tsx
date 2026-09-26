/**
 * Contact methods: each way to reach the person, its type and labels from
 * the workspace vocabulary, whether it is the primary one of its type, and
 * notes (GAP-029).
 *
 * The profile summary names the primary methods (at most one per type, with
 * a link where the type has one). When some of them are on screen, the rail
 * keeps those in view as links with a copy control and collapses the rest
 * behind an expander; without them every method shows as saved. A saved or
 * deleted method can change which are primary, so the summary is read again
 * with the section.
 */

import { useCallback, useState } from "react";
import {
  getPerson,
  type PersonPrimaryContactMethod,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import {
  contactMethodFactCreateInput,
  contactMethodFactUpdateInput,
} from "../../../../../../packages/contracts/schemas/people.ts";
import { Button } from "@/components/ui/button.tsx";
import { settle, toast } from "../../../islands/core/index.ts";
import { FactEditor, type FactFormSpec } from "./fact-editor.tsx";
import {
  CheckboxField,
  ChoiceField,
  LookupSlot,
  NotesField,
  TextField,
} from "./fact-form.tsx";
import { profileOptionLookup } from "./lookup.ts";
import { filled, optionName } from "./records.ts";
import { type FactIslandProps, factSectionMount } from "./mount.tsx";
import { railPublisher } from "./publish.ts";

interface ContactValues {
  isPrimary: boolean;
  labelIds: string[];
  notes: string;
  typeId: string;
  value: string;
}

const form: FactFormSpec<ContactValues> = {
  create: contactMethodFactCreateInput,
  empty: { isPrimary: false, labelIds: [], notes: "", typeId: "", value: "" },
  fields: (
    <>
      <ChoiceField label="Contact type" name="typeId" required />
      <TextField label="Contact value" maxLength={2000} name="value" required />
      <ChoiceField label="Contact labels" multiple name="labelIds" />
      <CheckboxField label="Primary for this contact type" name="isPrimary" />
      <NotesField label="Contact notes" name="notes" />
      <LookupSlot />
    </>
  ),
  input: (values) => ({
    isPrimary: values.isPrimary,
    labelIds: values.labelIds,
    notes: filled(values.notes),
    typeId: filled(values.typeId),
    value: filled(values.value),
  }),
  update: contactMethodFactUpdateInput,
  values: (record) =>
    record.section === "contact-methods"
      ? {
        isPrimary: record.value.isPrimary,
        labelIds: [...record.value.labelIds],
        notes: record.value.notes ?? "",
        typeId: record.value.typeId,
        value: record.value.value,
      }
      : form.empty,
  wording: {
    lists: { labelIds: "labels" },
    required: {
      typeId: "Choose a contact type.",
      value: "Enter a contact value.",
    },
  },
};

const lookup = profileOptionLookup({
  label: "Search contact options",
  more: "Load more contact options",
}, { labelIds: "contact-label", typeId: "contact-type" });

const publish = railPublisher("contact-methods");

async function copy(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    toast(`Copied ${value}`, "success");
  } catch {
    toast("Copy failed. Select the value and copy it manually.", "error");
  }
}

export function ContactMethods(props: FactIslandProps) {
  const { personId, workspaceId } = props;
  const [primary, setPrimary] = useState<
    readonly PersonPrimaryContactMethod[] | undefined
  >(props.initial?.summary?.primaryContactMethods);
  const refreshPrimary = useCallback(async () => {
    const answer = await settle(() =>
      getPerson(personId, workspaceId, "summary")
    );
    const refreshed = answer.data?.summary?.primaryContactMethods;
    if (refreshed !== undefined) setPrimary(refreshed);
  }, [personId, workspaceId]);
  const summarized = primary?.length
    ? new Map(primary.map((method) => [method.id, method]))
    : undefined;
  /** The primary methods, when any of them is on screen. */
  const primaryOf = (records: readonly { readonly id: string }[]) =>
    summarized && records.some((record) => summarized.has(record.id))
      ? summarized
      : undefined;
  return (
    <FactEditor
      {...props}
      afterWrite={refreshPrimary}
      form={form}
      lookup={lookup}
      noun="contact methods"
      publish={publish}
      remove={{ verb: "Delete" }}
      rows={{
        actions: (record, _options, busy) => {
          const method = summarized?.get(record.id);
          if (!method || record.section !== "contact-methods") return null;
          const value = record.value.value;
          return (
            <Button
              aria-label={`Copy ${value}`}
              className="profile-rail-summary-control profile-contact-copy"
              disabled={busy}
              onClick={() => void copy(value)}
              type="button"
              variant="outline"
            >
              Copy
            </Button>
          );
        },
        collapse: (records) => {
          const shown = primaryOf(records);
          if (!shown) return undefined;
          const hidden = records.filter((record) => !shown.has(record.id));
          return {
            hidden: new Set(hidden.map((record) => record.id)),
            label: `+ ${hidden.length} more`,
            suffix: "contact methods",
          };
        },
        summary: (record, options) => {
          if (record.section !== "contact-methods") return null;
          const href = summarized?.get(record.id)?.href;
          return (
            <p className="profile-contact-summary">
              <span className="profile-fact-label">
                {`${optionName(options, record.value.typeId) ?? "Contact"}: `}
              </span>
              <span className="profile-fact-value">
                {href
                  ? <a href={href}>{record.value.value}</a>
                  : record.value.value}
              </span>
            </p>
          );
        },
      }}
      section="contact-methods"
    />
  );
}

export const mountContactMethods = factSectionMount(
  "person-fact-contact-methods",
  "contact-methods",
  ContactMethods,
);
