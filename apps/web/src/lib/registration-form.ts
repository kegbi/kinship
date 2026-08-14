import {
  register,
  registerInvitedIdentity,
  retryInvitedVerificationDelivery,
  retryVerificationDelivery,
} from "../../../../packages/contracts/generated/auth-client.ts";
import { registrationMessage } from "./registration-state.ts";

export function mountRegistrationForm(form: HTMLFormElement): void {
  const status = document.querySelector<HTMLElement>("#registration-status");
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!status || !submit) return;
  const inviteToken = new URLSearchParams(globalThis.location.hash.slice(1))
    .get("invite") ?? undefined;
  if (inviteToken) {
    history.replaceState({}, "", "/auth/sign-up");
    form.querySelector("#workspace-field")?.remove();
    submit.textContent = "Create account and join";
    document.title = "Create your invited account — Kinship";
    const eyebrow = document.querySelector<HTMLElement>("#signup-eyebrow");
    const heading = document.querySelector<HTMLElement>("#signup-heading");
    const detail = document.querySelector<HTMLElement>("#signup-detail");
    const next = document.querySelector<HTMLElement>("#signup-next");
    if (eyebrow) eyebrow.textContent = "Your workspace invitation";
    if (heading) heading.textContent = "Create your invited account.";
    if (detail) {
      detail.textContent =
        "Verify your email, then return to accept the invitation. No workspace is created at this step.";
    }
    if (next) {
      next.innerHTML =
        "<li>Your password is protected with Argon2id.</li><li>Your verification link works once.</li><li>Your membership begins only after you accept the invitation.</li>";
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    form.querySelectorAll<HTMLElement>("[data-field-error]").forEach((node) =>
      node.textContent = ""
    );
    status.textContent = inviteToken
      ? "Creating your account for this invitation…"
      : "Creating your private workspace…";
    status.dataset.state = "loading";
    submit.disabled = true;
    const data = new FormData(form);
    const email = String(data.get("email") ?? "").trim().toLowerCase();
    let registrationCommitted = false;
    try {
      const identity = {
        email,
        firstName: String(data.get("firstName") ?? ""),
        lastName: String(data.get("lastName") ?? ""),
        password: String(data.get("password") ?? ""),
      };
      const result = inviteToken
        ? await registerInvitedIdentity({ ...identity, token: inviteToken })
        : await register({
          ...identity,
          workspaceName: String(data.get("workspaceName") ?? ""),
        });
      if (result.ok) {
        form.hidden = true;
        status.dataset.state = "success";
        status.innerHTML =
          "<strong>Check your email.</strong><span>We sent a private, single-use verification link. It expires in 24 hours.</span>";
        status.focus();
        return;
      }
      if (
        result.problem.code === "verification_delivery_failed" ||
        result.problem.code === "invitation_verification_delivery_failed"
      ) {
        registrationCommitted = true;
        form.hidden = true;
        status.dataset.state = "warning";
        const message = document.createElement("strong");
        message.textContent = inviteToken
          ? "Your account was created for this invitation; email is delayed."
          : "Your workspace was created; email is delayed.";
        const detail = document.createElement("span");
        detail.textContent =
          "You can safely request another verification delivery.";
        const retry = document.createElement("button");
        retry.id = "retry-verification-delivery";
        retry.type = "button";
        retry.textContent = "Retry verification email";
        retry.addEventListener("click", async () => {
          retry.disabled = true;
          status.dataset.state = "loading";
          detail.textContent = "Requesting another verification email…";
          try {
            const delivery = inviteToken
              ? await retryInvitedVerificationDelivery()
              : await retryVerificationDelivery(email);
            status.dataset.state = delivery.ok ? "success" : "error";
            detail.textContent = delivery.ok
              ? inviteToken
                ? "Your verification email was sent. Check your email."
                : "Your delivery request was accepted. Check your email shortly."
              : "The retry is temporarily unavailable. Please try again.";
          } catch {
            status.dataset.state = "error";
            detail.textContent =
              "The retry is temporarily unavailable. Please try again.";
          } finally {
            retry.disabled = false;
          }
        });
        status.replaceChildren(message, detail, retry);
        status.focus();
        return;
      }
      for (
        const [field, message] of Object.entries(result.problem.errors ?? {})
      ) {
        const fieldError = form.querySelector<HTMLElement>(
          `[data-field-error="${field}"]`,
        );
        if (fieldError) fieldError.textContent = message;
      }
      status.dataset.state = "error";
      status.textContent = registrationMessage(result.problem.code);
      status.focus();
    } catch {
      status.dataset.state = "error";
      status.textContent = registrationMessage("unknown");
      status.focus();
    } finally {
      submit.disabled = registrationCommitted;
    }
  });
}
