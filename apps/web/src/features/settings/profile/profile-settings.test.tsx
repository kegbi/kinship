// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "../../../testing/a11y.ts";
import {
  deferred,
  jsonResponse,
  problemResponse,
  stubApi,
  unreachable,
} from "../../../testing/api.ts";
import { workspaceSession } from "../../../testing/fixtures.ts";
import {
  drawShell,
  element,
  mountPending,
  mountSettled,
} from "../../../testing/render.tsx";
import { WORKSPACE_CHANGE_REQUEST_EVENT } from "../../../lib/workspace-context.ts";
import {
  mountProfileSettings,
  PROFILE_SETTINGS_ISLAND,
} from "./profile-settings.tsx";

const SESSION = "GET /api/v1/session";
const PROFILE = "GET /api/v1/settings/profile";
const SAVE = "PUT /api/v1/settings/profile";
const profilePage = readFileSync(
  "apps/web/src/pages/app/settings/profile.astro",
  "utf8",
);
const profile = (firstName = "Owner", lastName = "Person") =>
  jsonResponse({
    profile: { email: "owner@example.test", firstName, lastName },
    status: "ready",
  });

function shell(): void {
  drawShell("<main><div data-settings-profile></div></main>");
}

const mount = () => mountSettled(() => mountProfileSettings());
const form = () => element<HTMLFormElement>("#profile-form");
const status = () => element("#settings-status");
const dirty = () => element("#settings-dirty");
const firstName = () => screen.getByLabelText<HTMLInputElement>("First name");
const save = () =>
  screen.getByRole<HTMLButtonElement>("button", { name: "Save changes" });

function type(input: HTMLInputElement, value: string): void {
  act(() => {
    fireEvent.input(input, { target: { value } });
  });
}

function submit(): void {
  act(() => {
    fireEvent.submit(form());
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe("AUTH-004 profile settings", () => {
  it("does nothing when the form is absent", async () => {
    drawShell("<p>Other page</p>");
    const api = stubApi();
    await mount();
    expect(api.calls()).toEqual([]);
    expect(PROFILE_SETTINGS_ISLAND).toBe("settings-profile");
  });

  it("keeps the form explained and inoperable until it is ready", async () => {
    expect(profilePage).toMatch(
      /<button type="submit"[^>]*\sdisabled>Save changes<\/button>/,
    );
    shell();
    const loaded = deferred<Response>();
    const api = stubApi({
      [PROFILE]: loaded.promise,
      [SAVE]: profile("Changed"),
      [SESSION]: jsonResponse(workspaceSession()),
    });
    const settled = mountPending(() => mountProfileSettings());
    await waitFor(() => expect(api.calls()).toContain(PROFILE));
    expect(status().textContent).toMatch(/loading your profile/i);
    expect(firstName().disabled).toBe(true);
    expect(save().disabled).toBe(true);
    expect(form().hasAttribute("data-dirty")).toBe(false);
    submit();
    await act(async () => {
      loaded.resolve(profile("Loaded"));
      await settled;
    });
    expect(api.calls()).not.toContain(SAVE);
    expect(firstName().value).toBe("Loaded");
    expect(firstName().disabled).toBe(false);
    expect(
      screen.getByLabelText<HTMLInputElement>("Email address").readOnly,
    ).toBe(true);
    expect(save().disabled).toBe(false);
    expect(dirty().textContent).toBe("All changes saved.");
    expect(dirty().dataset.state).toBe("saved");
    expect(form().dataset.dirty).toBe("false");
    await expectNoAxeViolations(document.body);
  });

  it("loads and saves only the current profile, trimmed", async () => {
    shell();
    const saved = deferred<Response>();
    const api = stubApi({
      [PROFILE]: profile("Old", "Name"),
      [SAVE]: saved.promise,
      [SESSION]: jsonResponse(workspaceSession()),
    });
    await mount();
    type(firstName(), " Ada ");
    type(screen.getByLabelText("Last name"), " Lovelace ");
    expect(dirty().textContent).toBe("Unsaved changes.");
    expect(form().dataset.dirty).toBe("true");
    submit();
    expect(status().textContent).toBe("Saving profile…");
    expect(save().disabled).toBe(true);
    submit();
    await act(async () => {
      saved.resolve(profile("Ada", "Lovelace"));
      await saved.promise;
    });
    await waitFor(() => expect(status().textContent).toBe("Profile saved."));
    expect(api.bodies()).toEqual([{ firstName: "Ada", lastName: "Lovelace" }]);
    expect(dirty().textContent).toBe("All changes saved.");
    expect(form().dataset.dirty).toBe("false");
    expect(save().disabled).toBe(false);
  });

  it("focuses native validation and protects unsaved navigation", async () => {
    shell();
    const api = stubApi({
      [PROFILE]: profile(),
      [SESSION]: jsonResponse(workspaceSession()),
    });
    await mount();
    const summary = screen.getByRole("alert", { hidden: true });
    expect(summary.hidden).toBe(true);
    type(firstName(), "");
    const unload = new Event("beforeunload", { cancelable: true });
    globalThis.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    submit();
    expect(api.calls()).not.toContain(SAVE);
    expect(document.activeElement).toBe(firstName());
    expect(firstName().getAttribute("aria-invalid")).toBe("true");
    expect(summary.hidden).toBe(false);
    expect(summary.textContent).toBe(
      "Review the highlighted fields and try again.",
    );
    type(firstName(), "Ada");
    expect(firstName().hasAttribute("aria-invalid")).toBe(false);
    type(firstName(), "Owner");
    const clean = new Event("beforeunload", { cancelable: true });
    globalThis.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
  });

  it("asks before a workspace switch discards a draft", async () => {
    shell();
    stubApi({
      [PROFILE]: profile(),
      [SESSION]: jsonResponse(workspaceSession()),
    });
    await mount();
    const request = (onProceed: (callback: () => void) => void) =>
      new CustomEvent(WORKSPACE_CHANGE_REQUEST_EVENT, {
        cancelable: true,
        detail: { fromWorkspaceId: "a", onProceed, toWorkspaceId: "b" },
      });
    const clean = request(() => undefined);
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    globalThis.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    expect(confirm).not.toHaveBeenCalled();

    type(firstName(), "Draft");
    const stayed = request(() => undefined);
    globalThis.dispatchEvent(stayed);
    expect(stayed.defaultPrevented).toBe(true);
    expect(confirm).toHaveBeenCalledWith(
      "You have unsaved changes in this workspace. Discard them and switch workspaces?",
    );
    expect(firstName().value).toBe("Draft");

    confirm.mockReturnValue(true);
    let proceed: (() => void) | undefined;
    const accepted = request((callback) => proceed = callback);
    globalThis.dispatchEvent(accepted);
    expect(accepted.defaultPrevented).toBe(false);
    expect(dirty().textContent).toBe("Unsaved changes.");
    act(() => proceed!());
    expect(dirty().textContent).toBe("Unsaved changes discarded.");
    expect(form().dataset.dirty).toBe("false");
    type(firstName(), "Draft again");
    expect(dirty().textContent).toBe("Unsaved changes.");
  });

  it("keeps a refused or unreachable save visible and retryable", async () => {
    shell();
    stubApi({
      [PROFILE]: profile(),
      [SAVE]: [
        problemResponse(503, { detail: "Profiles are read-only right now." }),
        unreachable,
      ],
      [SESSION]: jsonResponse(workspaceSession()),
    });
    await mount();
    submit();
    await waitFor(() =>
      expect(status().textContent).toBe("Profiles are read-only right now.")
    );
    expect(save().disabled).toBe(false);
    submit();
    await waitFor(() =>
      expect(status().textContent).toBe("Profile could not be saved.")
    );
    expect(save().disabled).toBe(false);
  });

  it("reports an unavailable profile and keeps the form disabled", async () => {
    for (const answer of [unreachable, problemResponse(503)]) {
      shell();
      stubApi({
        [PROFILE]: answer,
        [SESSION]: jsonResponse(workspaceSession()),
      });
      const unmount = await mount();
      expect(status().textContent).toBe("Your profile could not be loaded.");
      expect(save().disabled).toBe(true);
      expect(firstName().disabled).toBe(true);
      expect(dirty().textContent).toBe("");
      unmount();
    }
  });

  it("recovers a stale saved workspace through one valid default session", async () => {
    shell();
    const stale = "00000000-0000-4000-8000-000000000099";
    sessionStorage.setItem("kinship.active-workspace", stale);
    const api = stubApi({
      [PROFILE]: profile("Recovered", "Owner"),
      [SESSION]: [
        problemResponse(401, { code: "session_invalid" }),
        jsonResponse(workspaceSession()),
      ],
    });
    await mount();
    const [first, second] = api.requests();
    expect(first?.headers.get("x-workspace-id")).toBe(stale);
    expect(second?.headers.get("x-workspace-id")).toBeNull();
    expect(sessionStorage.getItem("kinship.active-workspace")).toBeNull();
    expect(firstName().value).toBe("Recovered");
  });

  it("retains a saved workspace on transport, 503, and 403 session failures", async () => {
    const stale = "00000000-0000-4000-8000-000000000099";
    for (
      const failure of [
        unreachable,
        problemResponse(503, { code: "session_unavailable" }),
        problemResponse(403, { code: "session_forbidden" }),
      ]
    ) {
      shell();
      sessionStorage.setItem("kinship.active-workspace", stale);
      const api = stubApi({ [SESSION]: [failure] });
      const unmount = await mount();
      expect(api.calls()).toEqual([SESSION]);
      expect(sessionStorage.getItem("kinship.active-workspace")).toBe(stale);
      expect(status().textContent).toBe(
        "Your session could not be confirmed.",
      );
      expect(save().disabled).toBe(true);
      unmount();
      sessionStorage.clear();
    }
  });
});
