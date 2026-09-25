// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { mountInvitationAcceptance } from "./invitation.ts";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function markup(): void {
  document.body.innerHTML = `
    <h1 id="invitation-heading">Checking</h1><div id="invitation-detail"></div>
    <div id="invitation-actions" hidden><button id="accept-invitation">Accept</button><a id="invitation-sign-in"></a><a id="invitation-register"></a></div>`;
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  history.replaceState({}, "", "/");
  sessionStorage.clear();
});

describe("AUTH-002 invitation acceptance", () => {
  it("offers sign-in without storing the bearer token", async () => {
    markup();
    history.replaceState(
      {},
      "",
      "/invite/private-token-abcdefghijklmnopqrstuvwxyz",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(
          response({
            status: "pending",
            email: "invitee@example.test",
            role: "member",
            workspaceName: "Circle",
          }),
        )
        .mockResolvedValueOnce(
          response({ code: "session_invalid", status: 401 }, 401),
        ),
    );
    const navigate = vi.fn();
    await mountInvitationAcceptance(navigate);
    expect(document.querySelector("h1")?.textContent).toBe("Join Circle");
    expect(document.querySelector("#invitation-detail")?.textContent).toContain(
      "invitee@example.test",
    );
    expect(
      document.querySelector<HTMLButtonElement>("#accept-invitation")?.hidden,
    ).toBe(true);
    expect(location.pathname).toBe("/invite/continue");
    expect(location.hash).toBe("");
    expect(document.documentElement.innerHTML).not.toContain("private-token");
    expect(
      document.querySelector<HTMLAnchorElement>("#invitation-sign-in")
        ?.getAttribute("href"),
    ).toBe("/auth/sign-in");
    expect(localStorage.length).toBe(0);
    document.querySelector<HTMLAnchorElement>("#invitation-sign-in")?.click();
    expect(navigate).toHaveBeenCalledWith(
      "/auth/sign-in#invite=private-token-abcdefghijklmnopqrstuvwxyz",
    );
    document.querySelector<HTMLAnchorElement>("#invitation-sign-in")?.click();
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("reveals the invitation actions only once their token handoff is wired", async () => {
    markup();
    history.replaceState(
      {},
      "",
      "/invite/private-token-abcdefghijklmnopqrstuvwxyz",
    );
    let resolveSession!: (value: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(
          response({
            status: "pending",
            email: "invitee@example.test",
            role: "member",
            workspaceName: "Circle",
          }),
        )
        .mockReturnValueOnce(
          new Promise<Response>((resolve) => resolveSession = resolve),
        ),
    );
    const navigate = vi.fn();
    const mounted = mountInvitationAcceptance(navigate);
    await vi.waitFor(() =>
      expect(document.querySelector("h1")?.textContent).toBe("Join Circle")
    );
    const actions = document.querySelector<HTMLElement>("#invitation-actions")!;
    expect(actions.hidden).toBe(true);
    resolveSession(response({ code: "session_invalid", status: 401 }, 401));
    await mounted;
    expect(actions.hidden).toBe(false);
    document.querySelector<HTMLAnchorElement>("#invitation-sign-in")?.click();
    expect(navigate).toHaveBeenCalledWith(
      "/auth/sign-in#invite=private-token-abcdefghijklmnopqrstuvwxyz",
    );
  });

  it("offers genuine sign-up through a scrubbed fragment handoff", async () => {
    markup();
    history.replaceState(
      {},
      "",
      "/invite/private-token-abcdefghijklmnopqrstuvwxyz",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response({
          status: "pending",
          email: "invitee@example.test",
          role: "member",
          workspaceName: "Circle",
        }))
        .mockResolvedValueOnce(
          response({ code: "session_invalid", status: 401 }, 401),
        ),
    );
    const navigate = vi.fn();
    await mountInvitationAcceptance(navigate);
    document.querySelector<HTMLAnchorElement>("#invitation-register")?.click();
    expect(navigate).toHaveBeenCalledWith(
      "/auth/sign-up#invite=private-token-abcdefghijklmnopqrstuvwxyz",
    );
    expect(document.documentElement.innerHTML).not.toContain("private-token");
  });

  it("continues after verification using only HttpOnly invitation state", async () => {
    markup();
    history.replaceState({}, "", "/invite/continue");
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response({
          status: "pending",
          email: "invitee@example.test",
          role: "member",
          workspaceName: "Circle",
        }))
        .mockResolvedValueOnce(
          response({ code: "session_invalid", status: 401 }, 401),
        )
        .mockResolvedValueOnce(response({
          status: "accepted",
          next: "/app",
          workspace: { id: "circle", name: "Circle" },
        })),
    );
    await mountInvitationAcceptance();
    document.querySelector<HTMLButtonElement>("#accept-invitation")?.click();
    await vi.waitFor(() =>
      expect(document.querySelector("h1")?.textContent).toBe(
        "Welcome to Circle",
      )
    );
  });

  it("accepts for an authenticated user and renders a stable destination", async () => {
    markup();
    history.replaceState(
      {},
      "",
      "/invite/private-token-abcdefghijklmnopqrstuvwxyz",
    );
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        response({
          status: "pending",
          email: "invitee@example.test",
          role: "admin",
          workspaceName: "Circle",
        }),
      )
      .mockResolvedValueOnce(
        response({
          status: "authenticated",
          workspace: { id: "own", name: "Own" },
        }),
      )
      .mockResolvedValueOnce(
        response({
          status: "accepted",
          next: "/app",
          workspace: { id: "circle", name: "Circle" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await mountInvitationAcceptance();
    document.querySelector<HTMLButtonElement>("#accept-invitation")?.click();
    await vi.waitFor(() =>
      expect(document.querySelector("h1")?.textContent).toBe(
        "Welcome to Circle",
      )
    );
    expect(
      document.querySelector<HTMLAnchorElement>("#invitation-actions a")
        ?.getAttribute("href"),
    ).toBe("/app");
    expect(sessionStorage.getItem("kinship.active-workspace")).toBe("circle");
    expect(document.documentElement.innerHTML).not.toContain("private-token");
    expect(location.pathname).toBe("/invite/continue");
    expect(fetchMock.mock.calls[2]?.[1]?.body).toContain("private-token");
  });

  it("renders invalid, terminal, and acceptance error states without focus shortcuts", async () => {
    markup();
    await mountInvitationAcceptance();
    expect(document.querySelector("#invitation-detail")?.textContent).toMatch(
      /invalid/i,
    );

    markup();
    history.replaceState(
      {},
      "",
      "/invite/private-token-abcdefghijklmnopqrstuvwxyz",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({
          code: "invitation_expired",
          status: 410,
          detail: "This invitation has expired.",
        }, 410),
      ),
    );
    await mountInvitationAcceptance();
    expect(document.querySelector("#invitation-detail")?.textContent).toMatch(
      /expired/i,
    );
    expect(location.pathname).toBe("/invite/continue");
    expect(document.documentElement.innerHTML).not.toContain("private-token");
    expect(document.activeElement).toBe(document.body);
  });
});
