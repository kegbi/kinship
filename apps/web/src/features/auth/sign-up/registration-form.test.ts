// @vitest-environment happy-dom

import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  jsonResponse,
  problemResponse,
  stubApi,
  unreachable,
} from "../../../testing/api.ts";
import { drawShell } from "../../../testing/render.tsx";
import { drawPage, fill, pageMain } from "../auth-pages.test-helper.ts";
import {
  mountRegistrationForm,
  REGISTRATION_DELAYED_TEMPLATE_ID,
  REGISTRATION_SENT_TEMPLATE_ID,
} from "./registration-form.ts";

const REGISTER = "POST /api/v1/registrations";
const REGISTER_INVITED = "POST /api/v1/workspace-invitations/register";
const RETRY = "POST /api/v1/email-verification-deliveries";
const RETRY_INVITED =
  "POST /api/v1/workspace-invitations/verification-delivery";

/** The sign-up page, filled in, with its form mounted. */
function mountPage(): HTMLFormElement {
  drawPage("auth/sign-up");
  fill(screen.getByLabelText("First name"), "Ada");
  fill(screen.getByLabelText(/Last name/), "Lovelace");
  fill(screen.getByLabelText("Email address"), " Owner@Example.test ");
  if (!location.hash) fill(screen.getByLabelText("Workspace name"), "Ada's");
  fill(screen.getByLabelText("Password"), "a sufficiently long password");
  const form = document.querySelector<HTMLFormElement>("#registration-form")!;
  mountRegistrationForm(form);
  return form;
}

function status(): HTMLElement {
  return screen.getByRole("status");
}

async function submit(form: HTMLFormElement): Promise<void> {
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(status().dataset.state).not.toBe("loading"));
}

function delayed(code: string): Response {
  return problemResponse(503, { code, title: "Verification email delayed" });
}

afterEach(() => {
  history.replaceState({}, "", "/auth/sign-up");
  document.title = "";
});

describe("AUTH-001 registration form", () => {
  it("draws both rich answers as templates the module names", () => {
    const main = pageMain("auth/sign-up");
    expect(main).toContain(`<template id="${REGISTRATION_SENT_TEMPLATE_ID}">`);
    expect(main).toContain(
      `<template id="${REGISTRATION_DELAYED_TEMPLATE_ID}">`,
    );
  });

  it("shows the private verification handoff after accepted registration", async () => {
    const api = stubApi({
      [REGISTER]: jsonResponse({ status: "verification-required" }, 202),
    });
    const form = mountPage();

    await submit(form);

    expect(JSON.parse(String(api.fetch.mock.calls[0]?.[1]?.body))).toEqual({
      email: "owner@example.test",
      firstName: "Ada",
      lastName: "Lovelace",
      password: "a sufficiently long password",
      workspaceName: "Ada's",
    });
    expect(form.hidden).toBe(true);
    expect(status().dataset.state).toBe("success");
    expect(within(status()).getByText("Check your email.").tagName).toBe(
      "STRONG",
    );
    expect(status().textContent).toContain("expires in 24 hours");
    expect(document.activeElement).toBe(status());
  });

  it("FER-13 draws the submit disabled until its handler is wired", () => {
    drawPage("auth/sign-up");
    const submit = screen.getByRole<HTMLButtonElement>("button", {
      name: "Create workspace",
    });
    expect(submit.disabled).toBe(true);

    mountRegistrationForm(submit.form!);

    expect(submit.disabled).toBe(false);
  });

  it("keeps the owner's next steps and hides the invitation's", () => {
    stubApi();
    mountPage();
    const next = screen.getByRole("list", { name: "What happens next" });
    expect(
      within(next).getAllByRole("listitem").map((item) => item.textContent),
    )
      .toEqual([
        "Your password is protected with Argon2id.",
        "Your verification link works once.",
        "Your workspace starts with you as its owner.",
      ]);
  });

  it("registers an invited identity without requesting a new workspace", async () => {
    history.replaceState({}, "", "/auth/sign-up#invite=private-invite-token");
    const api = stubApi({
      [REGISTER_INVITED]: jsonResponse(
        { status: "verification-required" },
        202,
      ),
    });
    const form = mountPage();

    expect(location.hash).toBe("");
    expect(screen.queryByLabelText("Workspace name")).toBeNull();
    expect(screen.getByRole("button", { name: "Create account and join" }))
      .toBeTruthy();
    expect(document.title).toBe("Create your invited account — Kinship");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(
      /invited account/i,
    );
    expect(document.querySelector("#signup-eyebrow")?.textContent).toBe(
      "Your workspace invitation",
    );
    expect(document.querySelector("#signup-detail")?.textContent).toMatch(
      /no workspace is created/i,
    );
    const next = screen.getByRole("list", { name: "What happens next" });
    expect(
      within(next).getAllByRole("listitem").map((item) => item.textContent),
    )
      .toEqual([
        "Your password is protected with Argon2id.",
        "Your verification link works once.",
        "Your membership begins only after you accept the invitation.",
      ]);

    await submit(form);

    const body = JSON.parse(String(api.fetch.mock.calls[0]?.[1]?.body));
    expect(api.calls()).toEqual([REGISTER_INVITED]);
    expect(body.token).toBe("private-invite-token");
    expect(body).not.toHaveProperty("workspaceName");
    expect(status().textContent).not.toMatch(/workspace/i);
  });

  it("keeps invited mail failure visible and retryable without workspace claims", async () => {
    history.replaceState({}, "", "/auth/sign-up#invite=private-invite-token");
    const api = stubApi({
      [REGISTER_INVITED]: delayed("invitation_verification_delivery_failed"),
      [RETRY_INVITED]: [
        delayed("invitation_verification_delivery_failed"),
        jsonResponse({ status: "accepted" }, 202),
      ],
    });
    const form = mountPage();

    await submit(form);

    expect(status().dataset.state).toBe("warning");
    expect(status().textContent).toMatch(/account was created for this/i);
    expect(status().textContent).not.toMatch(/workspace/i);
    const retry = within(status()).getByRole<HTMLButtonElement>("button", {
      name: "Retry verification email",
    });
    expect(retry.id).toBe("retry-verification-delivery");
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        hidden: true,
        name: "Create account and join",
      }).disabled,
    ).toBe(true);
    retry.click();
    expect(retry.disabled).toBe(true);
    expect(status().textContent).toContain("Requesting another");
    await vi.waitFor(() => expect(retry.disabled).toBe(false));
    expect(status().dataset.state).toBe("error");
    expect(status().textContent).toMatch(/try again/i);
    retry.click();
    await vi.waitFor(() =>
      expect(status().textContent).toMatch(/was sent\. check your email/i)
    );
    expect(api.calls()).toEqual([
      REGISTER_INVITED,
      RETRY_INVITED,
      RETRY_INVITED,
    ]);
  });

  it("preserves created state and retries delayed verification delivery", async () => {
    const api = stubApi({
      [REGISTER]: delayed("verification_delivery_failed"),
      [RETRY]: [unreachable, jsonResponse({ status: "accepted" }, 202)],
    });
    const form = mountPage();

    await submit(form);

    expect(form.hidden).toBe(true);
    expect(status().textContent).toMatch(/workspace was created/i);
    const retry = within(status()).getByRole<HTMLButtonElement>("button", {
      name: "Retry verification email",
    });
    retry.click();
    await vi.waitFor(() => expect(retry.disabled).toBe(false));
    expect(status().textContent).toMatch(/temporarily unavailable/i);
    retry.click();
    await vi.waitFor(() =>
      expect(status().textContent).toMatch(/request was accepted/i)
    );
    expect(status().dataset.state).toBe("success");
    expect(api.fetch.mock.calls[1]?.[1]?.body).toBe(
      JSON.stringify({ email: "owner@example.test" }),
    );
  });

  it("renders safe field errors", async () => {
    stubApi({
      [REGISTER]: problemResponse(400, {
        code: "validation_failed",
        errors: { email: "Use another email address.", absent: "Not drawn." },
      }),
    });
    const form = mountPage();
    document.querySelector('[data-field-error="firstName"]')!.textContent =
      "stale";

    await submit(form);

    expect(document.querySelector('[data-field-error="email"]')?.textContent)
      .toBe("Use another email address.");
    expect(
      document.querySelector('[data-field-error="firstName"]')?.textContent,
    )
      .toBe("");
    expect(status().textContent).toBe(
      "Registration is temporarily unavailable. Please try again.",
    );
    expect(document.activeElement).toBe(status());
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Create workspace",
      }).disabled,
    ).toBe(false);
  });

  it("fails safely when the API is unavailable", async () => {
    stubApi({ [REGISTER]: unreachable });
    const form = mountPage();

    await submit(form);

    expect(status().dataset.state).toBe("error");
    expect(status().textContent).toBe(
      "Registration is temporarily unavailable. Please try again.",
    );
  });

  it("answers in plain text on a page without the status templates", async () => {
    stubApi({
      [REGISTER]: [
        delayed("verification_delivery_failed"),
        jsonResponse({ status: "verification-required" }, 202),
      ],
    });
    drawShell(
      '<form method="post"><input name="email" value="a@example.test"><button type="submit">Create workspace</button></form><div id="registration-status" role="status" tabindex="-1"></div>',
    );
    const form = document.querySelector("form")!;
    mountRegistrationForm(form);

    await submit(form);
    expect(status().textContent).toBe(
      "Your account was created; email is delayed.",
    );
    await submit(form);
    expect(status().textContent).toBe("Check your email.");
  });

  it("ignores incomplete markup", () => {
    drawShell('<form method="post"></form>');
    expect(() => mountRegistrationForm(document.querySelector("form")!)).not
      .toThrow();
  });
});
