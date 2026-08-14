// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { mountRegistrationForm } from "./registration-form.ts";

function renderForm(): HTMLFormElement {
  document.body.innerHTML = `
    <form id="registration-form">
      <input name="email" value="owner@example.test">
      <input name="firstName" value="Ada">
      <input name="lastName" value="Lovelace">
      <input name="password" value="a sufficiently long password">
      <input name="workspaceName" value="Ada's circle">
      <p data-field-error="email">stale</p>
      <button type="submit">Create workspace</button>
    </form>
    <div id="registration-status" tabindex="-1"></div>`;
  return document.querySelector<HTMLFormElement>("form")!;
}

async function submit(form: HTMLFormElement): Promise<void> {
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() => {
    const state = document.querySelector<HTMLElement>("#registration-status")
      ?.dataset.state;
    expect(state).not.toBe("loading");
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("registration form", () => {
  it("preserves created state and retries delayed verification delivery", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            type: "about:blank",
            title: "Verification email delayed",
            status: 503,
            detail: "Created, delivery delayed.",
            code: "verification_delivery_failed",
          }),
          {
            status: 503,
            headers: { "content-type": "application/problem+json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "accepted" }), {
          status: 202,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const form = renderForm();
    mountRegistrationForm(form);
    await submit(form);

    const retry = document.querySelector<HTMLButtonElement>(
      "#retry-verification-delivery",
    );
    expect(form.hidden).toBe(true);
    expect(retry).not.toBeNull();
    expect(document.querySelector("#registration-status")?.textContent)
      .toMatch(/workspace.*created/i);
    retry?.click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(
      JSON.stringify({ email: "owner@example.test" }),
    );
    await vi.waitFor(() =>
      expect(document.querySelector("#registration-status")?.textContent)
        .toMatch(/request.*accepted/i)
    );
  });

  it("shows the private verification handoff after accepted registration", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ status: "verification-required" }),
          { status: 202, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const form = renderForm();

    mountRegistrationForm(form);
    await submit(form);

    const status = document.querySelector<HTMLElement>("#registration-status")!;
    expect(form.hidden).toBe(true);
    expect(status.dataset.state).toBe("success");
    expect(status.textContent).toMatch(/check your email/i);
    expect(document.activeElement).toBe(status);
  });

  it("renders safe field and duplicate-email errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            type: "about:blank",
            title: "Registration unavailable",
            status: 409,
            detail: "An account already uses that email address.",
            code: "duplicate_email",
            errors: { email: "Use another email address." },
          }),
          {
            status: 409,
            headers: { "content-type": "application/problem+json" },
          },
        ),
      ),
    );
    const form = renderForm();

    mountRegistrationForm(form);
    await submit(form);

    expect(document.querySelector('[data-field-error="email"]')?.textContent)
      .toBe("Use another email address.");
    expect(document.querySelector("#registration-status")?.textContent).toMatch(
      /already uses/i,
    );
    expect(form.querySelector<HTMLButtonElement>("button")?.disabled).toBe(
      false,
    );
  });

  it("fails safely when the API is unavailable and ignores incomplete markup", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("private details")),
    );
    const form = renderForm();
    mountRegistrationForm(form);
    await submit(form);
    expect(document.querySelector("#registration-status")?.textContent).toMatch(
      /temporarily unavailable/i,
    );

    document.body.innerHTML = '<form id="incomplete"></form>';
    expect(() => mountRegistrationForm(document.querySelector("form")!)).not
      .toThrow();
  });

  it("handles absent optional controls and unknown server fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            type: "about:blank",
            title: "Invalid request",
            status: 422,
            detail: "Review the highlighted fields.",
            code: "validation_failed",
            errors: { absentControl: "Not rendered." },
          }),
          {
            status: 422,
            headers: { "content-type": "application/problem+json" },
          },
        ),
      ),
    );
    document.body.innerHTML = `
      <form><button type="submit">Create workspace</button></form>
      <div id="registration-status" tabindex="-1"></div>`;
    const form = document.querySelector<HTMLFormElement>("form")!;

    mountRegistrationForm(form);
    await submit(form);

    expect(document.querySelector("#registration-status")?.textContent).toMatch(
      /temporarily unavailable/i,
    );
  });
});
