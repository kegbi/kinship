// @vitest-environment happy-dom

import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  jsonResponse,
  problemResponse,
  stubApi,
  unreachable,
} from "../../../testing/api.ts";
import { drawShell } from "../../../testing/render.tsx";
import { drawPage } from "../auth-pages.test-helper.ts";
import { mountEmailVerification } from "./verify-email.ts";

const VERIFY = "POST /api/v1/email-verifications";

function openPage(search = "?token=private-verification-token"): void {
  history.replaceState({}, "", `/auth/verify-email${search}`);
  drawPage("auth/verify-email");
}

const status = () => screen.getByRole("status");

afterEach(() => {
  vi.unstubAllGlobals();
  history.replaceState({}, "", "/");
});

describe("AUTH-001 email verification", () => {
  it("scrubs the token, verifies it, and continues to the workspace", async () => {
    openPage();
    const api = stubApi({
      [VERIFY]: jsonResponse({ status: "verified", next: "/app" }),
    });
    const navigate = vi.fn();

    await mountEmailVerification(navigate);

    expect(location.search).toBe("");
    expect(api.fetch.mock.calls[0]?.[1]?.body).toContain(
      "private-verification-token",
    );
    expect(status().querySelector("p")?.textContent).toBe(
      "Email verified. Taking you to your workspace…",
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(navigate).toHaveBeenCalledWith("/app");
  });

  it("[AUD-A1] sends a verification from another browser to choose a password", async () => {
    openPage();
    stubApi({
      [VERIFY]: jsonResponse({
        status: "password-required",
        next: "/auth/reset-password?token=reset-token",
      }),
    });
    const navigate = vi.fn();

    await mountEmailVerification(navigate);

    expect(status().querySelector("p")?.textContent).toBe(
      "Email verified. Choose a password to finish setting up your account…",
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(navigate).toHaveBeenCalledWith(
      "/auth/reset-password?token=reset-token",
    );
  });

  it("offers a new account for a link without a token", async () => {
    openPage("");
    const api = stubApi();

    await mountEmailVerification(vi.fn());

    expect(status().textContent).toContain(
      "This verification link is invalid.",
    );
    expect(
      screen.getByRole("link", { name: "Create an account" }).getAttribute(
        "href",
      ),
    ).toBe("/auth/sign-up");
    expect(document.activeElement).toBe(status());
    expect(api.calls()).toEqual([]);
  });

  it.each([
    ["verification_expired", "This verification link has expired."],
    ["verification_replayed", "This verification link was already used."],
    ["invalid_verification", "This verification link is invalid."],
    ["unknown", "Email verification is temporarily unavailable."],
  ])("answers %s and links back to registration", async (code, message) => {
    openPage();
    stubApi({ [VERIFY]: problemResponse(410, { code }) });

    await mountEmailVerification(vi.fn());

    expect(status().textContent).toContain(message);
    expect(screen.getByRole("link", { name: "Return to registration" }))
      .toBeTruthy();
    expect(document.activeElement).toBe(status());
  });

  it("answers an unreachable API without a link", async () => {
    openPage();
    stubApi({ [VERIFY]: unreachable });

    await mountEmailVerification(vi.fn());

    expect(status().querySelector("p")?.textContent).toBe(
      "Email verification is temporarily unavailable. Please try again.",
    );
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("does not mount without its status", async () => {
    history.replaceState({}, "", "/auth/verify-email?token=private");
    drawShell("<main></main>");
    const api = stubApi();

    await mountEmailVerification(vi.fn());

    expect(location.search).toBe("");
    expect(api.calls()).toEqual([]);
  });

  it("continues through the browser by default", async () => {
    openPage();
    stubApi({ [VERIFY]: jsonResponse({ status: "verified", next: "/app" }) });
    const assign = vi.fn();
    vi.stubGlobal("location", {
      ...globalThis.location,
      assign,
      href: "http://localhost/auth/verify-email?token=private",
    });

    await mountEmailVerification();

    expect(assign).toHaveBeenCalledWith("/app");
  });
});
