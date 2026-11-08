/**
 * The sign-in, second-factor, recovery, and reset forms (AUTH-003; GAP-033).
 *
 * Their pages are public and stay React-free: each draws its form and one
 * `#auth-status` region, and this module only reads the form, sets the
 * status's text and state, and toggles the submit control — it never builds
 * an element.
 */

import {
  authenticateWorkspaceInvitation,
  completeMfa,
  completeWorkspaceInvitationMfa,
  requestPasswordReset,
  resetPassword,
  signIn,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import { clearSessionCache } from "../../../lib/workspace-context.ts";

interface FormUi {
  readonly output: HTMLElement;
  readonly submit: HTMLButtonElement;
}

function formUi(form: HTMLFormElement): FormUi | undefined {
  const output = document.querySelector<HTMLElement>("#auth-status");
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  return output && submit ? { output, submit } : undefined;
}

function begin(ui: FormUi, message: string): void {
  ui.output.dataset.state = "loading";
  ui.output.textContent = message;
  ui.submit.disabled = true;
}

/**
 * Lets the reader submit. Each page draws its submit disabled, because a
 * submission made before this module's listener exists would fall through to
 * a native POST that the gateway answers 405 (FER-13); a mount enables it once
 * the listener is attached, and each attempt again when it settles.
 */
function enableSubmit(ui: FormUi): void {
  ui.submit.disabled = false;
}

type Navigate = (path: string) => void;

const browserNavigate: Navigate = (path) => globalThis.location.assign(path);

function captureInvitationHandoff(): {
  readonly active: boolean;
  readonly token?: string;
} {
  const token = new URLSearchParams(globalThis.location.hash.slice(1)).get(
    "invite",
  );
  const marker = globalThis.location.hash === "#invitation";
  if (token || marker) {
    history.replaceState({}, "", globalThis.location.pathname);
  }
  return { active: Boolean(token) || marker, ...(token ? { token } : {}) };
}

export function mountSignIn(
  form: HTMLFormElement,
  navigate: Navigate = browserNavigate,
): void {
  const ui = formUi(form);
  if (!ui) return;
  let invitation = captureInvitationHandoff();
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    begin(ui, "Checking your credentials securely…");
    const data = new FormData(form);
    try {
      const credentials = {
        email: String(data.get("email") ?? "").trim().toLowerCase(),
        password: String(data.get("password") ?? ""),
      };
      const result = invitation.active
        ? await authenticateWorkspaceInvitation({
          ...credentials,
          ...(invitation.token ? { token: invitation.token } : {}),
        })
        : await signIn(credentials);
      if (result.ok) {
        const next = invitation.active
          ? result.value.status === "mfa-required"
            ? "/auth/mfa#invitation"
            : "/invite/continue"
          : result.value.next;
        invitation = { active: false };
        clearSessionCache();
        navigate(next);
        return;
      }
      ui.output.dataset.state = "error";
      ui.output.textContent = result.problem.code === "membership_inactive"
        ? "Your credentials are valid, but this workspace membership is not active."
        : result.problem.code === "authentication_rate_limited"
        ? "Too many attempts. Wait a few minutes before trying again."
        : "The email address or password is incorrect.";
      ui.output.focus();
    } catch {
      ui.output.dataset.state = "error";
      ui.output.textContent =
        "Sign-in is temporarily unavailable. Please try again.";
      ui.output.focus();
    } finally {
      enableSubmit(ui);
    }
  });
  enableSubmit(ui);
}

export function mountMfa(
  form: HTMLFormElement,
  navigate: Navigate = browserNavigate,
): void {
  const ui = formUi(form);
  if (!ui) return;
  let invitation = captureInvitationHandoff();
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    begin(ui, "Checking your second factor…");
    const factor = String(new FormData(form).get("factor") ?? "").trim();
    try {
      const result = invitation.active
        ? await completeWorkspaceInvitationMfa(factor)
        : await completeMfa(factor);
      if (result.ok) {
        const next = invitation.active ? "/invite/continue" : result.value.next;
        invitation = { active: false };
        clearSessionCache();
        navigate(next);
        return;
      }
      ui.output.dataset.state = "error";
      ui.output.textContent = result.problem.code === "mfa_challenge_expired"
        ? "This challenge expired. Return to sign-in and start again."
        : result.problem.code === "authentication_rate_limited"
        ? "Too many attempts. Return to sign-in when the challenge expires."
        : "That authenticator or recovery code is not valid.";
      ui.output.focus();
    } catch {
      ui.output.dataset.state = "error";
      ui.output.textContent = "The challenge is temporarily unavailable.";
      ui.output.focus();
    } finally {
      enableSubmit(ui);
    }
  });
  enableSubmit(ui);
}

export function mountRecovery(form: HTMLFormElement): void {
  const ui = formUi(form);
  if (!ui) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    begin(ui, "Preparing recovery instructions…");
    const email = String(new FormData(form).get("email") ?? "")
      .trim().toLowerCase();
    try {
      const result = await requestPasswordReset(email);
      if (!result.ok) {
        ui.output.dataset.state = "error";
        ui.output.textContent =
          "We could not submit the recovery request. Check your connection and try again.";
      } else {
        ui.output.dataset.state = "success";
        ui.output.textContent =
          "Request received. To protect account privacy, we cannot confirm delivery. If no message arrives, check the address and try again.";
      }
      ui.output.focus();
    } catch {
      ui.output.dataset.state = "error";
      ui.output.textContent =
        "We could not submit the recovery request. Check your connection and try again.";
      ui.output.focus();
    } finally {
      enableSubmit(ui);
    }
  });
  enableSubmit(ui);
}

export function mountReset(
  form: HTMLFormElement,
  navigate: Navigate = browserNavigate,
): void {
  const ui = formUi(form);
  if (!ui) return;
  const token = new URL(globalThis.location.href).searchParams.get("token");
  history.replaceState({}, "", "/auth/reset-password");
  if (!token) {
    form.hidden = true;
    ui.output.dataset.state = "error";
    ui.output.textContent =
      "This reset link is invalid or expired. Request a new one.";
    return;
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    begin(ui, "Replacing your password and revoking old sessions…");
    const password = String(new FormData(form).get("password") ?? "");
    try {
      const result = await resetPassword(token, password);
      if (result.ok) {
        navigate(result.value.next);
        return;
      }
      ui.output.dataset.state = "error";
      ui.output.textContent = result.problem.code === "password_reset_expired"
        ? "This reset link is invalid or expired. Request a new one."
        : "Password reset is temporarily unavailable. Please try again.";
      ui.output.focus();
    } catch {
      ui.output.dataset.state = "error";
      ui.output.textContent =
        "Password reset is temporarily unavailable. Please try again.";
      ui.output.focus();
    } finally {
      enableSubmit(ui);
    }
  });
  enableSubmit(ui);
}
