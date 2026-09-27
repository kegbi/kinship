/**
 * Verifying an email address from its single-use link (AUTH-001; GAP-033).
 *
 * `pages/auth/verify-email.astro` is public and stays React-free: its status
 * draws one message and one hidden link back to registration. This module
 * takes the token out of the address bar at once, then only sets the
 * message's text and reveals and names the link — it never builds an
 * element.
 */

import { verifyEmail } from "../../../../../../packages/contracts/generated/auth-client.ts";

type Navigate = (path: string) => void;

const browserNavigate: Navigate = (path) => globalThis.location.assign(path);

const FAILURES: Readonly<Record<string, string>> = {
  invalid_verification: "This verification link is invalid.",
  verification_expired: "This verification link has expired.",
  verification_replayed: "This verification link was already used.",
};

export async function mountEmailVerification(
  navigate: Navigate = browserNavigate,
): Promise<void> {
  const token = new URL(globalThis.location.href).searchParams.get("token");
  history.replaceState({}, "", "/auth/verify-email");
  const status = document.querySelector<HTMLElement>("#verification-status");
  const message = status?.querySelector("p");
  const link = status?.querySelector("a");
  if (!status || !message || !link) return;
  const answer = (text: string, linkLabel?: string): void => {
    message.textContent = text;
    link.textContent = linkLabel ?? "";
    link.hidden = linkLabel === undefined;
    status.focus();
  };
  if (!token) {
    answer("This verification link is invalid.", "Create an account");
    return;
  }
  const result = await verifyEmail(token).catch(() => undefined);
  if (!result) {
    answer(
      "Email verification is temporarily unavailable. Please try again.",
    );
    return;
  }
  if (result.ok) {
    message.textContent = "Email verified. Taking you to your workspace…";
    navigate(result.value.next);
    return;
  }
  answer(
    FAILURES[result.problem.code] ??
      "Email verification is temporarily unavailable.",
    "Return to registration",
  );
}
