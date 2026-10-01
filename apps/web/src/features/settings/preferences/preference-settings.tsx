/**
 * The member's preferences form (GAP-033): locale, regional formats, contact
 * naming, the fluid layout, and where reminders are delivered (PLANNING-003),
 * for this membership only. The currency is a choice among the supported
 * codes; it is the one new debts and gifts start in (GIFTS-001). A saved layout tells the application shell
 * through `MEMBER_LAYOUT_SAVED_EVENT`, so the page frame follows at once.
 */

import {
  getMemberPreferences,
  type ResolvedMemberPreferences,
  updateMemberPreferences,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import {
  MEMBER_LAYOUT_SAVED_EVENT,
  type MemberLayoutSavedDetail,
} from "../../../lib/app-shell.ts";
import {
  FieldError,
  mountSettingsSurface,
  SettingsForm,
} from "../form/settings-form.tsx";
import { CurrencyOptions } from "../form/currency-select.tsx";

export const PREFERENCE_SETTINGS_ISLAND = "settings-preferences";

type Preferences = ResolvedMemberPreferences;
type PreferencesInput = Parameters<typeof updateMemberPreferences>[0];
/** The preferences as loaded, with the currencies the picker offers. */
type PreferenceValues = Preferences & {
  readonly currencyChoices: readonly string[];
};

/** What the form asks the server to save, as the fields hold it. */
export function preferencesInput(form: HTMLFormElement): PreferencesInput {
  const data = new FormData(form);
  const text = (name: string) => (data.get(name) as string).trim();
  const timezone = text("timezone");
  const currencyCode = text("currencyCode").toUpperCase();
  const digestTime = text("digestTime");
  return {
    contactNameOrder: text("contactNameOrder") as Preferences[
      "contactNameOrder"
    ],
    contactSortOrder: text("contactSortOrder") as Preferences[
      "contactSortOrder"
    ],
    ...(currencyCode ? { currencyCode } : {}),
    // An empty digest time stops the digest rather than keeping the old one.
    digestTime: digestTime ? digestTime.slice(0, 5) : null,
    fluidLayout: data.get("fluidLayout") !== null,
    locale: text("locale"),
    measurementSystem: text("measurementSystem") as Preferences[
      "measurementSystem"
    ],
    reminderDelivery: text("reminderDelivery") as Preferences[
      "reminderDelivery"
    ],
    temperatureScale: text("temperatureScale") as Preferences[
      "temperatureScale"
    ],
    ...(timezone ? { timezone } : {}),
  };
}

export function PreferenceSettingsForm(
  props: { readonly onSettled?: () => void },
) {
  return (
    <SettingsForm<PreferenceValues>
      fieldErrors
      fields={({ disabled, errors, values }) => (
        <>
          <label>
            Locale<input
              defaultValue={values?.locale ?? ""}
              disabled={disabled}
              maxLength={35}
              name="locale"
              pattern="[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*"
              required
            />
          </label>
          <label>
            Time zone<input
              aria-describedby="timezone-error"
              defaultValue={values?.timezone ?? ""}
              disabled={disabled}
              maxLength={100}
              name="timezone"
              placeholder="Europe/Belgrade"
            />
            <FieldError errors={errors} id="timezone-error" name="timezone" />
          </label>
          <label>
            Temperature<select
              defaultValue={values?.temperatureScale ?? "celsius"}
              disabled={disabled}
              name="temperatureScale"
              required
            >
              <option value="celsius">Celsius</option>
              <option value="fahrenheit">Fahrenheit</option>
            </select>
          </label>
          <label>
            Measurements<select
              defaultValue={values?.measurementSystem ?? "metric"}
              disabled={disabled}
              name="measurementSystem"
              required
            >
              <option value="metric">Metric</option>
              <option value="imperial">Imperial</option>
            </select>
          </label>
          <label>
            Currency<select
              aria-describedby="currency-error"
              defaultValue={values?.currencyCode ?? ""}
              disabled={disabled}
              name="currencyCode"
            >
              <CurrencyOptions
                choices={values?.currencyChoices ?? []}
                empty="Workspace default"
                value={values?.currencyCode}
              />
            </select>
            <FieldError
              errors={errors}
              id="currency-error"
              name="currencyCode"
            />
          </label>
          <label>
            Contact sorting<select
              defaultValue={values?.contactSortOrder ?? "given_name_asc"}
              disabled={disabled}
              name="contactSortOrder"
              required
            >
              <option value="given_name_asc">Given name</option>
              <option value="family_name_asc">Family name</option>
            </select>
          </label>
          <label>
            Name display<select
              defaultValue={values?.contactNameOrder ?? "given_family_nickname"}
              disabled={disabled}
              name="contactNameOrder"
              required
            >
              <option value="given_family_nickname">Given then family</option>
              <option value="family_given_nickname">Family then given</option>
            </select>
          </label>
          <label className="check-label">
            <input
              defaultChecked={values?.fluidLayout ?? false}
              disabled={disabled}
              name="fluidLayout"
              type="checkbox"
            />{" "}
            Use fluid layout
          </label>
          <label>
            Reminder delivery<select
              aria-describedby="reminder-delivery-hint"
              defaultValue={values?.reminderDelivery ?? "in_app"}
              disabled={disabled}
              name="reminderDelivery"
              required
            >
              <option value="in_app">In the app</option>
              <option value="email">Email</option>
              <option value="both">In the app and by email</option>
            </select>
          </label>
          <label>
            Daily email digest<input
              aria-describedby="reminder-delivery-hint digest-time-error"
              defaultValue={values?.digestTime ?? ""}
              disabled={disabled}
              name="digestTime"
              type="time"
            />
            <FieldError
              errors={errors}
              id="digest-time-error"
              name="digestTime"
            />
          </label>
          <p id="reminder-delivery-hint">
            Email reminders go to your verified email address; without one,
            reminders stay in the app. A delivery change applies to reminders
            scheduled from now on. A digest time applies to every email reminder
            still waiting: they arrive together at that time in your time zone.
            Leave it empty to get each one when it is due.
          </p>
        </>
      )}
      id="preferences-form"
      load={async (workspaceId) => {
        const loaded = await getMemberPreferences(workspaceId);
        return loaded.ok
          ? {
            ok: true,
            value: {
              ...loaded.value.preferences,
              currencyChoices: loaded.value.supportedCurrencyCodes,
            },
          }
          : loaded;
      }}
      loadFailed={() => "Your preferences could not be loaded."}
      loading="Loading your preferences…"
      onSaved={(form, value, workspaceId) => {
        const saved = value as { readonly preferences: Preferences };
        form.dispatchEvent(
          new CustomEvent<MemberLayoutSavedDetail>(MEMBER_LAYOUT_SAVED_EVENT, {
            bubbles: true,
            detail: { fluidLayout: saved.preferences.fluidLayout, workspaceId },
          }),
        );
      }}
      onSettled={props.onSettled}
      save={(form, workspaceId) =>
        updateMemberPreferences(preferencesInput(form), workspaceId)}
      saveFailed="Preferences could not be saved."
      saved="Preferences saved."
      saving="Saving preferences…"
    />
  );
}

/** Mounts the preferences form over the one `preferences.astro` drew. */
export function mountPreferenceSettings(
  root: ParentNode = document,
): Promise<() => void> {
  return mountSettingsSurface(
    root,
    "[data-settings-preferences]",
    PREFERENCE_SETTINGS_ISLAND,
    (onSettled) => <PreferenceSettingsForm onSettled={onSettled} />,
  );
}
