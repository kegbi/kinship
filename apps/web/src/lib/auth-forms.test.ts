// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mountMfa,
  mountProtectedEntry,
  mountRecovery,
  mountReset,
  mountSignIn,
} from "./auth-forms.ts";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function form(markup: string): HTMLFormElement {
  document.body.innerHTML =
    `${markup}<div id="auth-status" tabindex="-1"></div>`;
  return document.querySelector<HTMLFormElement>("form")!;
}

async function submit(target: HTMLFormElement): Promise<void> {
  target.dispatchEvent(
    new Event("submit", { bubbles: true, cancelable: true }),
  );
  await vi.waitFor(() =>
    expect(target.querySelector<HTMLButtonElement>("button")?.disabled).toBe(
      false,
    )
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  history.replaceState({}, "", "/");
  sessionStorage.clear();
});

describe("AUTH-003 forms", () => {
  it("captures and scrubs an invitation handoff before sign-in", async () => {
    history.replaceState(
      {},
      "",
      "/auth/sign-in#invite=private-token-abcdefghijklmnopqrstuvwxyz",
    );
    const target = form(`
      <form><input name="email" value="invitee@example.test">
      <input name="password" value="secret"><button type="submit">Sign in</button></form>`);
    const navigate = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({
        status: "authenticated",
        next: "/app",
        workspace: { id: "own", name: "Own" },
        member: { id: "member", role: "owner" },
      })),
    );
    mountSignIn(target, navigate);
    expect(location.pathname).toBe("/auth/sign-in");
    expect(location.hash).toBe("");
    expect(document.documentElement.innerHTML).not.toContain("private-token");
    await submit(target);
    expect(navigate).toHaveBeenCalledWith("/invite/continue");
  });

  it("preserves a scrubbed invitation handoff through MFA", async () => {
    history.replaceState(
      {},
      "",
      "/auth/mfa#invite=private-token-abcdefghijklmnopqrstuvwxyz",
    );
    const target = form(`
      <form><input name="factor" value="123456"><button type="submit">Continue</button></form>`);
    const navigate = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({
        status: "authenticated",
        next: "/app",
        workspace: { id: "own", name: "Own" },
        member: { id: "member", role: "owner" },
      })),
    );
    mountMfa(target, navigate);
    expect(location.pathname).toBe("/auth/mfa");
    expect(location.hash).toBe("");
    await submit(target);
    expect(navigate).toHaveBeenCalledWith("/invite/continue");
  });

  it("uses the generated sign-in call and follows an MFA transition", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response({ status: "mfa-required", next: "/auth/mfa" }, 202),
    );
    vi.stubGlobal("fetch", fetchMock);
    const navigate = vi.fn();
    const target = form(`
      <form><input name="email" value="OWNER@EXAMPLE.TEST">
      <input name="password" value="secret"><button type="submit">Sign in</button></form>`);
    sessionStorage.setItem("kinship.session", "stale identity");
    mountSignIn(target, navigate);
    await submit(target);
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({
      email: "owner@example.test",
      password: "secret",
    }));
    expect(sessionStorage.getItem("kinship.session")).toBeNull();
    expect(navigate).toHaveBeenCalledWith("/auth/mfa");
  });

  it("shows safe credential, membership, and network failures", async () => {
    const target = form(`
      <form><input name="email" value="owner@example.test">
      <input name="password" value="wrong"><button type="submit">Sign in</button></form>`);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({
        type: "about:blank",
        title: "failed",
        status: 401,
        detail: "safe",
        code: "invalid_credentials",
      }, 401)),
    );
    mountSignIn(target, vi.fn());
    await submit(target);
    expect(document.querySelector("#auth-status")?.textContent).toMatch(
      /incorrect/i,
    );

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("private")));
    await submit(target);
    expect(document.querySelector("#auth-status")?.textContent).toMatch(
      /temporarily unavailable/i,
    );
  });

  it("distinguishes inactive membership and bounded sign-in attempts", async () => {
    const target = form(`
      <form><button type="submit">Sign in</button></form>`);
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response({
          type: "about:blank",
          title: "inactive",
          status: 403,
          detail: "safe",
          code: "membership_inactive",
        }, 403))
        .mockResolvedValueOnce(response({
          type: "about:blank",
          title: "limited",
          status: 429,
          detail: "safe",
          code: "authentication_rate_limited",
        }, 429)),
    );
    mountSignIn(target, vi.fn());
    await submit(target);
    expect(document.querySelector("#auth-status")?.textContent).toMatch(
      /membership is not active/i,
    );
    await submit(target);
    expect(document.querySelector("#auth-status")?.textContent).toMatch(
      /too many attempts/i,
    );
  });

  it("accepts an MFA factor and renders invalid or expired challenges safely", async () => {
    const target = form(`
      <form><input name="factor" value="123456"><button type="submit">Continue</button></form>`);
    const navigate = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        type: "about:blank",
        title: "failed",
        status: 401,
        detail: "safe",
        code: "invalid_mfa",
      }, 401))
      .mockResolvedValueOnce(response({
        status: "authenticated",
        next: "/app",
        workspace: { id: "workspace", name: "Circle" },
        member: { id: "member", role: "owner" },
      }));
    vi.stubGlobal("fetch", fetchMock);
    mountMfa(target, navigate);
    await submit(target);
    expect(document.querySelector("#auth-status")?.textContent).toMatch(
      /not valid/i,
    );
    sessionStorage.setItem("kinship.session", "stale identity");
    await submit(target);
    expect(sessionStorage.getItem("kinship.session")).toBeNull();
    expect(navigate).toHaveBeenCalledWith("/app");
  });

  it("renders expired, limited, and unavailable MFA challenges", async () => {
    const target = form(`
      <form><button type="submit">Continue</button></form>`);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        type: "about:blank",
        title: "expired",
        status: 401,
        detail: "safe",
        code: "mfa_challenge_expired",
      }, 401))
      .mockResolvedValueOnce(response({
        type: "about:blank",
        title: "limited",
        status: 429,
        detail: "safe",
        code: "authentication_rate_limited",
      }, 429))
      .mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    mountMfa(target, vi.fn());
    await submit(target);
    expect(document.querySelector("#auth-status")?.textContent).toMatch(
      /challenge expired/i,
    );
    await submit(target);
    expect(document.querySelector("#auth-status")?.textContent).toMatch(
      /too many attempts/i,
    );
    await submit(target);
    expect(document.querySelector("#auth-status")?.textContent).toMatch(
      /challenge is temporarily unavailable/i,
    );
    expect(document.querySelector("#auth-status")?.getAttribute("data-state"))
      .toBe("error");
    expect(document.activeElement).toBe(
      document.querySelector("#auth-status"),
    );
    expect(target.querySelector<HTMLButtonElement>("button")?.disabled).toBe(
      false,
    );
  });

  it("keeps password-recovery requests non-enumerating and retryable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const target = form(`
      <form><input name="email" value="absent@example.test"><button type="submit">Send</button></form>`);
    mountRecovery(target);
    await submit(target);
    expect(target.hidden).toBe(false);
    expect(document.querySelector("#auth-status")?.textContent).toMatch(
      /could not submit|try again/i,
    );
    expect(target.querySelector("button")?.disabled).toBe(false);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({
        type: "about:blank",
        title: "unavailable",
        status: 503,
        detail: "safe",
        code: "password_recovery_unavailable",
      }, 503)),
    );
    await submit(target);
    expect(target.hidden).toBe(false);
    expect(document.querySelector("#auth-status")?.textContent).toMatch(
      /could not submit|try again/i,
    );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({ status: "accepted" }, 202)),
    );
    await submit(target);
    expect(target.hidden).toBe(false);
    expect(document.querySelector("#auth-status")?.textContent).toMatch(
      /cannot confirm delivery|no message arrives/i,
    );
    expect(target.querySelector("button")?.disabled).toBe(false);
  });

  it("handles absent, expired, and successful reset transitions", async () => {
    const absent = form(`
      <form><input name="password" value="long enough password"><button type="submit">Reset</button></form>`);
    mountReset(absent, vi.fn());
    expect(absent.hidden).toBe(true);
    expect(document.querySelector("#auth-status")?.textContent).toMatch(
      /invalid or expired/i,
    );

    history.replaceState(
      {},
      "",
      "/auth/reset-password?token=abcdefghijklmnopqrstuvwxyz1234567890",
    );
    const target = form(`
      <form><input name="password" value="long enough password"><button type="submit">Reset</button></form>`);
    const navigate = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({
        status: "reset",
        next: "/auth/sign-in",
      })),
    );
    mountReset(target, navigate);
    await submit(target);
    expect(navigate).toHaveBeenCalledWith("/auth/sign-in");
    expect(location.search).toBe("");
  });

  it("renders expired and unavailable reset failures", async () => {
    history.replaceState({}, "", "/auth/reset-password?token=single-use-token");
    const target = form(`
      <form><button type="submit">Reset</button></form>`);
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response({
          type: "about:blank",
          title: "expired",
          status: 410,
          detail: "safe",
          code: "password_reset_expired",
        }, 410))
        .mockResolvedValueOnce(response({
          type: "about:blank",
          title: "failed",
          status: 503,
          detail: "safe",
          code: "password_reset_failed",
        }, 503))
        .mockRejectedValueOnce(new Error("network unavailable")),
    );
    mountReset(target, vi.fn());
    await submit(target);
    expect(document.querySelector("#auth-status")?.textContent).toMatch(
      /invalid or expired/i,
    );
    await submit(target);
    expect(document.querySelector("#auth-status")?.textContent).toMatch(
      /temporarily unavailable/i,
    );
    await submit(target);
    expect(document.querySelector("#auth-status")?.textContent).toMatch(
      /temporarily unavailable/i,
    );
    expect(target.querySelector<HTMLButtonElement>("button")?.disabled).toBe(
      false,
    );
  });

  it("resolves protected sessions, signs out, and rejects missing access", async () => {
    document.body.innerHTML = `
      <h1 id="entry-heading">Preparing</h1>
      <div id="entry-status" tabindex="-1"></div>`;
    const navigate = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        status: "authenticated",
        principal: { userId: "user" },
        workspace: { id: "workspace", name: "Private circle" },
        member: { id: "member", role: "owner" },
      }))
      .mockResolvedValueOnce(response({
        status: "signed-out",
        next: "/auth/sign-in",
      }));
    vi.stubGlobal("fetch", fetchMock);
    sessionStorage.setItem("kinship.session", "cached session");
    await mountProtectedEntry(navigate);
    expect(document.querySelector("#entry-status")?.textContent).toMatch(
      /protected session/i,
    );
    document.querySelector<HTMLButtonElement>("button")?.click();
    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("/auth/sign-in")
    );
    expect(sessionStorage.getItem("kinship.session")).toBeNull();

    document.body.innerHTML = `
      <h1 id="entry-heading">Preparing</h1>
      <div id="entry-status" tabindex="-1"></div>`;
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response({ code: "session_invalid" }, 401))
        .mockResolvedValueOnce(response({ code: "entry_invalid" }, 409)),
    );
    await mountProtectedEntry(navigate);
    expect(document.querySelector("#entry-status")?.textContent).toMatch(
      /missing, expired, revoked/i,
    );
    expect(document.querySelector<HTMLAnchorElement>("a")?.href).toContain(
      "/auth/sign-in",
    );
  });

  it("consumes a verified entry and fails sign-out closed", async () => {
    document.body.innerHTML = `
      <h1 id="entry-heading">Preparing</h1>
      <div id="entry-status" tabindex="-1"></div>`;
    const navigate = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response({ code: "session_invalid" }, 401))
        .mockResolvedValueOnce(response({
          status: "entered",
          workspace: { id: "workspace", name: "Private circle" },
          member: { id: "member", role: "owner", firstName: "Avery" },
        }))
        .mockRejectedValueOnce(new Error("offline")),
    );
    sessionStorage.setItem("kinship.session", "live session");
    await mountProtectedEntry(navigate);
    expect(document.querySelector("#entry-heading")?.textContent).toBe(
      "Welcome, Avery.",
    );
    expect(document.querySelector("#entry-status")?.textContent).toMatch(
      /verified owner/i,
    );
    document.querySelector<HTMLButtonElement>("button")?.click();
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLButtonElement>("button")?.disabled)
        .toBe(false)
    );
    expect(navigate).not.toHaveBeenCalled();
    expect(document.querySelector("#entry-status")?.textContent).toMatch(
      /could not be revoked/i,
    );
    expect(sessionStorage.getItem("kinship.session")).toBe("live session");
  });

  it("does not mount when required page elements are absent", async () => {
    document.body.innerHTML = "<form></form>";
    const target = document.querySelector<HTMLFormElement>("form")!;
    mountSignIn(target, vi.fn());
    mountMfa(target, vi.fn());
    mountRecovery(target);
    mountReset(target, vi.fn());
    await mountProtectedEntry(vi.fn());
    expect(target.children).toHaveLength(0);
  });
});
