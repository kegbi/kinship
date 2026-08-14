import {
  register,
  retryVerificationDelivery,
} from "../../../../packages/contracts/generated/auth-client.ts";
import { registrationMessage } from "./registration-state.ts";

export function mountRegistrationForm(form: HTMLFormElement): void {
  const status = document.querySelector<HTMLElement>("#registration-status");
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!status || !submit) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    form.querySelectorAll<HTMLElement>("[data-field-error]").forEach((node) =>
      node.textContent = ""
    );
    status.textContent = "Creating your private workspace…";
    status.dataset.state = "loading";
    submit.disabled = true;
    const data = new FormData(form);
    const email = String(data.get("email") ?? "").trim().toLowerCase();
    let registrationCommitted = false;
    try {
      const result = await register({
        email,
        firstName: String(data.get("firstName") ?? ""),
        lastName: String(data.get("lastName") ?? ""),
        password: String(data.get("password") ?? ""),
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
      if (result.problem.code === "verification_delivery_failed") {
        registrationCommitted = true;
        form.hidden = true;
        status.dataset.state = "warning";
        const message = document.createElement("strong");
        message.textContent = "Your workspace was created; email is delayed.";
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
            const delivery = await retryVerificationDelivery(email);
            status.dataset.state = delivery.ok ? "success" : "error";
            detail.textContent = delivery.ok
              ? "Your delivery request was accepted. Check your email shortly."
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
