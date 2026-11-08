/**
 * The workspace's general settings form (GAP-033): its identity and the
 * defaults every member starts from, for the active workspace only. The
 * default currency is a choice among the supported codes; new debts and gifts
 * start in it unless the member chose their own (GIFTS-001).
 */

import {
  getWorkspaceSettings,
  updateWorkspaceSettings,
  type WorkspaceSettings,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import {
  FieldError,
  mountSettingsSurface,
  SettingsForm,
} from "../form/settings-form.tsx";
import { CurrencyOptions } from "../form/currency-select.tsx";
import { TimezoneSelect } from "@/components/ui/timezone-select.tsx";
import { clearSessionCache } from "../../../lib/workspace-context.ts";

export const WORKSPACE_SETTINGS_ISLAND = "settings-workspace";

/** The settings as loaded, with the currencies the picker offers. */
type Workspace = WorkspaceSettings & {
  readonly currencyChoices: readonly string[];
};

/** What the form asks the server to save, as the fields hold it. */
export function workspaceInput(
  form: HTMLFormElement,
): Parameters<typeof updateWorkspaceSettings>[0] {
  const data = new FormData(form);
  const text = (name: string) => (data.get(name) as string).trim();
  const slug = text("slug");
  const defaultTimezone = text("defaultTimezone");
  const defaultCurrencyCode = text("defaultCurrencyCode").toUpperCase();
  return {
    name: text("name"),
    ...(slug ? { slug } : {}),
    defaultLocale: text("defaultLocale"),
    ...(defaultTimezone ? { defaultTimezone } : {}),
    ...(defaultCurrencyCode ? { defaultCurrencyCode } : {}),
    defaultReminderTime: data.get("defaultReminderTime") as string,
  };
}

export function WorkspaceSettingsForm(
  props: { readonly onSettled?: () => void },
) {
  return (
    <SettingsForm<Workspace>
      fieldErrors
      fields={({ disabled, errors, values }) => (
        <>
          <label>
            Workspace name<input
              defaultValue={values?.name ?? ""}
              disabled={disabled}
              maxLength={200}
              name="name"
              required
            />
          </label>
          <label>
            Workspace slug<input
              defaultValue={values?.slug ?? ""}
              disabled={disabled}
              maxLength={100}
              name="slug"
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            />
          </label>
          <label>
            Default locale<input
              defaultValue={values?.defaultLocale ?? ""}
              disabled={disabled}
              maxLength={35}
              name="defaultLocale"
              pattern="[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*"
              required
            />
          </label>
          <div className="grid content-start gap-(--space-1)">
            <label htmlFor="workspace-timezone">Default time zone</label>
            <TimezoneSelect
              id="workspace-timezone"
              aria-describedby="default-timezone-error"
              defaultValue={values?.defaultTimezone ?? ""}
              disabled={disabled}
              name="defaultTimezone"
            />
            <FieldError
              errors={errors}
              id="default-timezone-error"
              name="defaultTimezone"
            />
          </div>
          <label>
            Default currency<select
              aria-describedby="default-currency-error"
              defaultValue={values?.defaultCurrencyCode ?? ""}
              disabled={disabled}
              name="defaultCurrencyCode"
            >
              <CurrencyOptions
                choices={values?.currencyChoices ?? []}
                empty="None (US dollars)"
                value={values?.defaultCurrencyCode}
              />
            </select>
            <FieldError
              errors={errors}
              id="default-currency-error"
              name="defaultCurrencyCode"
            />
          </label>
          <label>
            Default reminder time<input
              defaultValue={values?.defaultReminderTime ?? ""}
              disabled={disabled}
              name="defaultReminderTime"
              required
              type="time"
            />
          </label>
        </>
      )}
      id="workspace-form"
      load={async (workspaceId) => {
        const loaded = await getWorkspaceSettings(workspaceId);
        return loaded.ok
          ? {
            ok: true,
            value: {
              ...loaded.value.workspace,
              currencyChoices: loaded.value.supportedCurrencyCodes,
            },
          }
          : loaded;
      }}
      loadFailed={(problem) =>
        problem?.detail ?? "Workspace settings could not be loaded."}
      loading="Loading workspace settings…"
      // The session carries the workspace's name and, for a member without
      // a time zone of their own, its default time zone (AUD-F3); the next
      // page reads it again rather than patching who keeps which zone.
      onSaved={() => clearSessionCache()}
      onSettled={props.onSettled}
      save={(form, workspaceId) =>
        updateWorkspaceSettings(workspaceInput(form), workspaceId)}
      saveFailed="Workspace settings could not be saved."
      saved="Workspace settings saved."
      saving="Saving workspace settings…"
    />
  );
}

/** Mounts the general settings form over the one `workspace.astro` drew. */
export function mountWorkspaceSettings(
  root: ParentNode = document,
): Promise<() => void> {
  return mountSettingsSurface(
    root,
    "[data-settings-workspace]",
    WORKSPACE_SETTINGS_ISLAND,
    (onSettled) => <WorkspaceSettingsForm onSettled={onSettled} />,
  );
}
