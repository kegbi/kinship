/**
 * The sign-up form (AUTH-001, AUTH-002; GAP-033).
 *
 * `pages/auth/sign-up.astro` is a public page and stays React-free: it
 * draws the form, both versions of the "what happens next" list, and the
 * status's two rich answers as `<template>`s. This module only toggles and
 * removes what the page drew, sets text, and clones those templates — it
 * never builds an element. An invitation handoff (`#invite=`) turns the page
 * into the invited-account version before the reader can submit.
 */

import {
  register,
  registerInvitedIdentity,
  retryInvitedVerificationDelivery,
  retryVerificationDelivery,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import { registrationMessage } from "../../../lib/registration-state.ts";
import { cloneTemplate } from "../../shell/templates.ts";

/** The status's answer once a verification email is on its way. */
export const REGISTRATION_SENT_TEMPLATE_ID = "registration-sent-template";

/** The status's answer once the account exists but its email is delayed. */
export const REGISTRATION_DELAYED_TEMPLATE_ID = "registration-delayed-template";

/** Turns the page into the invited-account version of itself. */
function presentInvitation(form: HTMLFormElement, submit: HTMLElement): void {
  history.replaceState({}, "", "/auth/sign-up");
  form.querySelector("#workspace-field")?.remove();
  submit.textContent = "Create account and join";
  document.title = "Create your invited account — Kinship";
  const text: ReadonlyArray<readonly [string, string]> = [
    ["#signup-eyebrow", "Your workspace invitation"],
    ["#signup-heading", "Create your invited account."],
    [
      "#signup-detail",
      "Verify your email, then return to accept the invitation. No workspace is created at this step.",
    ],
  ];
  for (const [selector, value] of text) {
    const target = document.querySelector(selector);
    if (target) target.textContent = value;
  }
  document.querySelector("[data-signup-owner]")?.remove();
  document.querySelectorAll<HTMLElement>("[data-signup-invited]").forEach(
    (item) => item.hidden = false,
  );
}

/**
 * The delayed-email answer, its retry wired, or `undefined` on a page
 * without the template.
 */
function delayedDelivery(
  status: HTMLElement,
  email: string,
  inviteToken: string | undefined,
): DocumentFragment | undefined {
  const content = cloneTemplate(REGISTRATION_DELAYED_TEMPLATE_ID);
  const message = content?.querySelector("strong");
  const detail = content?.querySelector("span");
  const retry = content?.querySelector("button");
  if (!content || !message || !detail || !retry) return undefined;
  message.textContent = inviteToken
    ? "Your account was created for this invitation; email is delayed."
    : "Your workspace was created; email is delayed.";
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
  return content;
}

export function mountRegistrationForm(form: HTMLFormElement): void {
  const status = document.querySelector<HTMLElement>("#registration-status");
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!status || !submit) return;
  const inviteToken = new URLSearchParams(globalThis.location.hash.slice(1))
    .get("invite") ?? undefined;
  if (inviteToken) presentInvitation(form, submit);

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
        status.replaceChildren(
          cloneTemplate(REGISTRATION_SENT_TEMPLATE_ID) ?? "Check your email.",
        );
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
        status.replaceChildren(
          delayedDelivery(status, email, inviteToken) ??
            "Your account was created; email is delayed.",
        );
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
