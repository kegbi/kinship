import {
  completeMfa,
  consumeApplicationEntry,
  getSession,
  requestPasswordReset,
  resetPassword,
  signIn,
  signOut,
} from "../../../../packages/contracts/generated/auth-client.ts";

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

function finish(ui: FormUi): void {
  ui.submit.disabled = false;
}

type Navigate = (path: string) => void;

const browserNavigate: Navigate = (path) => globalThis.location.assign(path);

export function mountSignIn(
  form: HTMLFormElement,
  navigate: Navigate = browserNavigate,
): void {
  const ui = formUi(form);
  if (!ui) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    begin(ui, "Checking your credentials securely…");
    const data = new FormData(form);
    try {
      const result = await signIn({
        email: String(data.get("email") ?? "").trim().toLowerCase(),
        password: String(data.get("password") ?? ""),
      });
      if (result.ok) {
        navigate(result.value.next);
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
      finish(ui);
    }
  });
}

export function mountMfa(
  form: HTMLFormElement,
  navigate: Navigate = browserNavigate,
): void {
  const ui = formUi(form);
  if (!ui) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    begin(ui, "Checking your second factor…");
    const factor = String(new FormData(form).get("factor") ?? "").trim();
    try {
      const result = await completeMfa(factor);
      if (result.ok) {
        navigate(result.value.next);
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
      finish(ui);
    }
  });
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
      finish(ui);
    }
  });
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
      finish(ui);
    }
  });
}

function renderWorkspace(
  heading: HTMLElement,
  output: HTMLElement,
  workspaceName: string,
  navigate: Navigate,
  firstName?: string,
): void {
  heading.textContent = firstName ? `Welcome, ${firstName}.` : "Welcome back.";
  output.replaceChildren();
  const ready = document.createElement("p");
  const name = document.createElement("strong");
  name.textContent = workspaceName;
  ready.append(name, " is ready.");
  const protectedCopy = document.createElement("p");
  protectedCopy.textContent = firstName
    ? "You are its verified owner. Your protected session is active."
    : "Your protected session and active workspace membership were resolved by the server.";
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Sign out";
  button.addEventListener("click", async () => {
    output.querySelector("[data-sign-out-error]")?.remove();
    button.disabled = true;
    const result = await signOut().catch(() => undefined);
    if (result?.ok) {
      navigate(result.value.next);
      return;
    }
    button.disabled = false;
    const failure = document.createElement("p");
    failure.dataset.signOutError = "true";
    failure.textContent =
      "Your session could not be revoked. Check your connection and try again.";
    output.append(failure);
    output.focus();
  });
  output.append(ready, protectedCopy, button);
  output.focus();
}

export async function mountProtectedEntry(
  navigate: Navigate = browserNavigate,
): Promise<void> {
  const heading = document.querySelector<HTMLElement>("#entry-heading");
  const output = document.querySelector<HTMLElement>("#entry-status");
  if (!heading || !output) return;
  const existing = await getSession().catch(() => undefined);
  if (existing?.ok) {
    renderWorkspace(heading, output, existing.value.workspace.name, navigate);
    return;
  }
  const entry = await consumeApplicationEntry().catch(() => undefined);
  if (entry?.ok) {
    renderWorkspace(
      heading,
      output,
      entry.value.workspace.name,
      navigate,
      entry.value.member.firstName,
    );
    return;
  }
  heading.textContent = "Sign in to Kinship";
  output.replaceChildren();
  const copy = document.createElement("p");
  copy.textContent =
    "Your session is missing, expired, revoked, or no longer has active workspace access.";
  const link = document.createElement("a");
  link.className = "button-link";
  link.href = "/auth/sign-in";
  link.textContent = "Go to sign-in";
  output.append(copy, link);
  output.focus();
}
