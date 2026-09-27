/**
 * The profile form (GAP-033): the member's email, which stays the verified
 * sign-in address, and the identity-wide name they can change.
 */

import {
  getSettingsProfile,
  type ProfileSettings,
  updateSettingsProfile,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import { mountSettingsSurface, SettingsForm } from "../form/settings-form.tsx";

export const PROFILE_SETTINGS_ISLAND = "settings-profile";

type Profile = ProfileSettings;

function text(form: HTMLFormElement, name: string): string {
  return (new FormData(form).get(name) as string).trim();
}

export function ProfileSettingsForm(
  props: { readonly onSettled?: () => void },
) {
  return (
    <SettingsForm<Profile>
      fields={({ disabled, values }) => (
        <>
          <label>
            Email address<input
              defaultValue={values?.email ?? ""}
              disabled={disabled}
              name="email"
              readOnly
              type="email"
            />
          </label>
          <label>
            First name<input
              defaultValue={values?.firstName ?? ""}
              disabled={disabled}
              maxLength={100}
              name="firstName"
              required
            />
          </label>
          <label>
            Last name<input
              defaultValue={values?.lastName ?? ""}
              disabled={disabled}
              maxLength={100}
              name="lastName"
            />
          </label>
        </>
      )}
      id="profile-form"
      load={async (workspaceId) => {
        const loaded = await getSettingsProfile(workspaceId);
        return loaded.ok ? { ok: true, value: loaded.value.profile } : loaded;
      }}
      loadFailed={() => "Your profile could not be loaded."}
      loading="Loading your profile…"
      onSettled={props.onSettled}
      save={(form, workspaceId) =>
        updateSettingsProfile({
          firstName: text(form, "firstName"),
          lastName: text(form, "lastName"),
        }, workspaceId)}
      saveFailed="Profile could not be saved."
      saved="Profile saved."
      saving="Saving profile…"
    />
  );
}

/** Mounts the profile form over the one `profile.astro` drew. */
export function mountProfileSettings(
  root: ParentNode = document,
): Promise<() => void> {
  return mountSettingsSurface(
    root,
    "[data-settings-profile]",
    PROFILE_SETTINGS_ISLAND,
    (onSettled) => <ProfileSettingsForm onSettled={onSettled} />,
  );
}
