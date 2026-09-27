// @vitest-environment happy-dom

import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deferred,
  jsonResponse,
  problemResponse,
  stubApi,
  unreachable,
} from "../../../testing/api.ts";
import { element } from "../../../testing/render.tsx";
import { drawPage, pageMain } from "../auth-pages.test-helper.ts";
import {
  INVITATION_OPEN_TEMPLATE_ID,
  mountInvitationAcceptance,
} from "./invitation.ts";

const INSPECT = "POST /api/v1/workspace-invitations/inspect";
const ACCEPT = "POST /api/v1/workspace-invitations/accept";
const SESSION = "GET /api/v1/session";
const TOKEN = "private-token-abcdefghijklmnopqrstuvwxyz";

const pending = (role = "member") =>
  jsonResponse({
    status: "pending",
    email: "invitee@example.test",
    role,
    workspaceName: "Circle",
  });
const signedOut = () => problemResponse(401, { code: "session_invalid" });
const signedIn = () =>
  jsonResponse({
    status: "authenticated",
    workspace: { id: "own", name: "Own" },
  });
const accepted = () =>
  jsonResponse({
    status: "accepted",
    next: "/app",
    workspace: { id: "circle", name: "Circle" },
  });

function openPage(path = `/invite/${TOKEN}`): void {
  history.replaceState({}, "", path);
  drawPage("invite/[token]");
}

const heading = () => screen.getByRole("heading", { level: 1 }).textContent;
const detail = () => screen.getByRole("status").textContent;
// The actions start hidden, so they are found by their frozen ids.
const accept = () => element<HTMLButtonElement>("#accept-invitation");
const signInLink = () => element<HTMLAnchorElement>("#invitation-sign-in");
const registerLink = () => element<HTMLAnchorElement>("#invitation-register");

/**
 * Clicks `link` and answers whether the page let the browser follow it; the
 * test's own document listener then stops the navigation either way.
 */
function clickLink(link: HTMLAnchorElement): boolean {
  let followed = false;
  document.addEventListener("click", (event) => {
    followed = !event.defaultPrevented;
    event.preventDefault();
  }, { once: true });
  link.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true }),
  );
  return followed;
}

afterEach(() => {
  vi.unstubAllGlobals();
  history.replaceState({}, "", "/");
  sessionStorage.clear();
});

describe("AUTH-002 invitation acceptance", () => {
  it("draws the accepted answer's link as the template the module names", () => {
    expect(pageMain("invite/[token]")).toContain(
      `<template id="${INVITATION_OPEN_TEMPLATE_ID}"><a class="button-link" href="/app">Open workspace</a></template>`,
    );
  });

  it("offers sign-in without storing the bearer token", async () => {
    openPage();
    stubApi({ [INSPECT]: pending(), [SESSION]: signedOut() });
    const navigate = vi.fn();

    await mountInvitationAcceptance(navigate);

    expect(heading()).toBe("Join Circle");
    expect(detail()).toBe(
      "invitee@example.test was invited as member. Sign in or create that account before accepting.",
    );
    expect(accept().hidden).toBe(true);
    expect(location.pathname).toBe("/invite/continue");
    expect(location.hash).toBe("");
    expect(document.documentElement.innerHTML).not.toContain("private-token");
    expect(signInLink().getAttribute("href")).toBe("/auth/sign-in");
    expect(localStorage.length).toBe(0);
    expect(clickLink(signInLink())).toBe(false);
    expect(navigate).toHaveBeenCalledWith(`/auth/sign-in#invite=${TOKEN}`);
    // The handoff is spent: a second click follows the plain link.
    expect(clickLink(signInLink())).toBe(true);
    expect(navigate).toHaveBeenCalledOnce();
  });

  it("reveals the invitation actions only once their token handoff is wired", async () => {
    openPage();
    const session = deferred<Response>();
    stubApi({ [INSPECT]: pending(), [SESSION]: session.promise });
    const navigate = vi.fn();

    const mounted = mountInvitationAcceptance(navigate);
    await vi.waitFor(() => expect(heading()).toBe("Join Circle"));
    expect(screen.queryByRole("link", { name: /Sign in as/ })).toBeNull();
    const actions = document.querySelector<HTMLElement>("#invitation-actions")!;
    expect(actions.hidden).toBe(true);
    session.resolve(signedOut());
    await mounted;

    expect(actions.hidden).toBe(false);
    clickLink(screen.getByRole("link", { name: /Sign in as/ }));
    expect(navigate).toHaveBeenCalledWith(`/auth/sign-in#invite=${TOKEN}`);
  });

  it("offers genuine sign-up through a scrubbed fragment handoff", async () => {
    openPage(`/invite/fragment#token=${TOKEN}`);
    stubApi({ [INSPECT]: pending(), [SESSION]: signedOut() });
    const navigate = vi.fn();

    await mountInvitationAcceptance(navigate);
    expect(clickLink(registerLink())).toBe(false);
    expect(clickLink(registerLink())).toBe(true);

    expect(navigate.mock.calls).toEqual([[`/auth/sign-up#invite=${TOKEN}`]]);
    expect(location.pathname).toBe("/invite/continue");
    expect(document.documentElement.innerHTML).not.toContain("private-token");
  });

  it("continues after verification using only HttpOnly invitation state", async () => {
    openPage("/invite/continue");
    const api = stubApi({
      [INSPECT]: pending(),
      [SESSION]: signedOut(),
      [ACCEPT]: accepted(),
    });

    await mountInvitationAcceptance();
    expect(accept().hidden).toBe(false);
    expect(signInLink().hidden).toBe(true);
    expect(registerLink().hidden).toBe(true);
    accept().click();

    await vi.waitFor(() => expect(heading()).toBe("Welcome to Circle"));
    expect(api.fetch.mock.calls[0]?.[1]?.body).not.toContain("token");
  });

  it("accepts for an authenticated user and renders a stable destination", async () => {
    openPage();
    const accepting = deferred<Response>();
    const api = stubApi({
      [INSPECT]: pending("admin"),
      [SESSION]: signedIn(),
      [ACCEPT]: accepting.promise,
    });

    await mountInvitationAcceptance();
    expect(signInLink().hidden).toBe(true);
    accept().click();
    expect(accept().disabled).toBe(true);
    expect(detail()).toBe("Accepting your invitation atomically…");
    accepting.resolve(accepted());

    await vi.waitFor(() => expect(heading()).toBe("Welcome to Circle"));
    expect(detail()).toMatch(/cannot be used again/);
    const open = screen.getByRole<HTMLAnchorElement>("link", {
      name: "Open workspace",
    });
    expect(open.getAttribute("href")).toBe("/app");
    expect(open.parentElement?.id).toBe("invitation-actions");
    expect(screen.queryByRole("button", { name: "Accept invitation" }))
      .toBeNull();
    expect(sessionStorage.getItem("kinship.active-workspace")).toBe("circle");
    expect(document.documentElement.innerHTML).not.toContain("private-token");
    expect(location.pathname).toBe("/invite/continue");
    expect(api.fetch.mock.calls[2]?.[1]?.body).toContain("private-token");
  });

  it("keeps the token for a retry after a server failure, and drops it after a refusal", async () => {
    openPage();
    const api = stubApi({
      [INSPECT]: pending(),
      [SESSION]: signedIn(),
      [ACCEPT]: [
        problemResponse(503, { detail: "Try again shortly." }),
        problemResponse(409, { detail: "Already a member." }),
      ],
    });

    await mountInvitationAcceptance();
    accept().click();
    await vi.waitFor(() => expect(detail()).toBe("Try again shortly."));
    expect(heading()).toBe("Invitation unavailable");
    expect(accept().disabled).toBe(false);
    accept().click();
    await vi.waitFor(() => expect(detail()).toBe("Already a member."));
    accept().click();
    expect(api.calls()).toEqual([INSPECT, SESSION, ACCEPT, ACCEPT]);
  });

  it("spends the token when acceptance goes unanswered", async () => {
    openPage();
    const api = stubApi({
      [INSPECT]: pending(),
      [SESSION]: unreachable,
      [ACCEPT]: unreachable,
    });

    await mountInvitationAcceptance();
    // An unconfirmed session still offers sign-in, not acceptance.
    expect(accept().hidden).toBe(true);
    accept().click();
    await vi.waitFor(() =>
      expect(detail()).toBe("The invitation could not be accepted. Try again.")
    );
    accept().click();
    expect(api.calls()).toEqual([INSPECT, SESSION, ACCEPT]);
  });

  it("renders invalid, terminal, and unavailable states without focus shortcuts", async () => {
    openPage("/invite");
    await mountInvitationAcceptance();
    expect(heading()).toBe("Invitation unavailable");
    expect(detail()).toBe("This invitation link is invalid.");

    openPage(`/invite/${"%E0%A4%A"}`);
    await mountInvitationAcceptance();
    expect(detail()).toBe("This invitation link is invalid.");
    expect(location.pathname).toBe("/invite/continue");

    openPage();
    stubApi({
      [INSPECT]: [
        problemResponse(410, { detail: "This invitation has expired." }),
        unreachable,
      ],
    });
    await mountInvitationAcceptance();
    expect(detail()).toBe("This invitation has expired.");
    expect(location.pathname).toBe("/invite/continue");
    expect(document.documentElement.innerHTML).not.toContain("private-token");
    expect(document.activeElement).toBe(document.body);

    openPage();
    await mountInvitationAcceptance();
    expect(detail()).toBe("The invitation could not be checked. Try again.");
    expect(document.querySelector<HTMLElement>("#invitation-actions")?.hidden)
      .toBe(true);
  });

  it("does not mount without its page", async () => {
    history.replaceState({}, "", `/invite/${TOKEN}`);
    drawPage("auth/sign-in");
    await mountInvitationAcceptance();
    expect(location.pathname).toBe(`/invite/${TOKEN}`);
  });

  it("follows the sign-in handoff through the browser by default", async () => {
    openPage();
    stubApi({ [INSPECT]: pending(), [SESSION]: signedOut() });
    const assign = vi.fn();
    vi.stubGlobal("location", {
      ...globalThis.location,
      assign,
      hash: "",
      href: `http://localhost/invite/${TOKEN}`,
      pathname: `/invite/${TOKEN}`,
    });

    await mountInvitationAcceptance();
    clickLink(signInLink());

    expect(assign).toHaveBeenCalledWith(`/auth/sign-in#invite=${TOKEN}`);
  });
});
