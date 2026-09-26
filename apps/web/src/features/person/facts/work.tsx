/**
 * Work: each role's title, organization, dates, and description (GAP-029).
 * An organization is either chosen from the workspace's or named new, never
 * both. The rail keeps the current role in view behind a history expander,
 * and the first role is the hero's work vital.
 */

import {
  occupationFactCreateInput,
  occupationFactUpdateInput,
} from "../../../../../../packages/contracts/schemas/people.ts";
import { FactEditor, type FactFormSpec } from "./fact-editor.tsx";
import {
  CheckboxField,
  ChoiceField,
  LookupSlot,
  NotesField,
  TextField,
  useFactForm,
} from "./fact-form.tsx";
import { profileOptionLookup } from "./lookup.ts";
import { filled, workSummaryRecord } from "./records.ts";
import { type FactIslandProps, factSectionMount } from "./mount.tsx";
import { railPublisher, workVital } from "./publish.ts";

interface WorkValues {
  description: string;
  endOn: string;
  isCurrent: boolean;
  organizationId: string;
  organizationName: string;
  startOn: string;
  title: string;
}

/** The organization: an existing one, or a new name, never both. */
function OrganizationFields() {
  const { form } = useFactForm();
  return (
    <>
      <ChoiceField
        label="Existing organization"
        name="organizationId"
        onChoose={(value) => {
          if (value) form.setValue("organizationName", "");
        }}
      />
      <TextField
        label="New organization"
        maxLength={200}
        name="organizationName"
        onText={(value) => {
          if (value.trim()) form.setValue("organizationId", "");
        }}
      />
    </>
  );
}

const form: FactFormSpec<WorkValues> = {
  create: occupationFactCreateInput,
  empty: {
    description: "",
    endOn: "",
    isCurrent: false,
    organizationId: "",
    organizationName: "",
    startOn: "",
    title: "",
  },
  fields: (
    <>
      <TextField label="Role or title" maxLength={200} name="title" required />
      <OrganizationFields />
      <LookupSlot />
      <TextField label="Start date" name="startOn" type="date" />
      <TextField label="End date" name="endOn" type="date" />
      <CheckboxField label="Current role" name="isCurrent" />
      <NotesField label="Role description" name="description" />
    </>
  ),
  input: (values) => {
    const organizationId = filled(values.organizationId);
    return {
      description: filled(values.description),
      endOn: filled(values.endOn),
      isCurrent: values.isCurrent,
      organizationId,
      organizationName: organizationId
        ? undefined
        : filled(values.organizationName),
      startOn: filled(values.startOn),
      title: filled(values.title),
    };
  },
  update: occupationFactUpdateInput,
  values: (record) =>
    record.section === "work"
      ? {
        description: record.value.description ?? "",
        endOn: record.value.endOn ?? "",
        isCurrent: record.value.isCurrent,
        organizationId: record.value.organizationId ?? "",
        // A chosen organization's name is the organization's, not a new one.
        organizationName: record.value.organizationId
          ? ""
          : record.value.organizationName ?? "",
        startOn: record.value.startOn ?? "",
        title: record.value.title,
      }
      : form.empty,
  wording: { required: { title: "Enter a role or title." } },
};

const lookup = profileOptionLookup({
  label: "Search organizations",
  more: "Load more organizations",
}, { organizationId: "organization" });

const publish = railPublisher("work", workVital);

export function Work(props: FactIslandProps) {
  return (
    <FactEditor
      {...props}
      form={form}
      lookup={lookup}
      noun="work"
      publish={publish}
      remove={{ verb: "Delete" }}
      rows={{
        collapse: (records) => {
          const current = workSummaryRecord(records);
          if (!current || records.length < 2) return undefined;
          return {
            hidden: new Set(
              records.filter((record) => record.id !== current.id).map((
                record,
              ) => record.id),
            ),
            label: "Show history",
            suffix: "work roles",
          };
        },
      }}
      section="work"
    />
  );
}

export const mountWork = factSectionMount("person-fact-work", "work", Work);
