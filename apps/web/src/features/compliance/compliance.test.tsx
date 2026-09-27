// @vitest-environment happy-dom
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "../../testing/a11y.ts";
import {
  deferred,
  jsonResponse,
  problemResponse,
  stubApi,
  unreachable,
} from "../../testing/api.ts";
import { drawShell, element, mountSettled } from "../../testing/render.tsx";
import { COMPLIANCE_ISLAND, mountCompliance } from "./compliance.tsx";

const REQUIREMENTS = "GET /api/v1/legal-requirements";
const ACCEPT = "POST /api/v1/legal-acceptances";
const SIGN_OUT = "POST /api/v1/sign-out";
const legal = {
  content: "Exact immutable terms content.",
  documentType: "terms",
  id: "00000000-0000-4000-8000-000000000101",
  publishedAt: "2026-08-23T09:00:00.000Z",
  version: "2026-08",
};
const required = (...documents: object[]) =>
  jsonResponse({ documents, status: "ready" });

function shell(): void {
  drawShell(
    '<main id="main-content" data-compliance-page><p data-compliance-state>Checking required legal documents…</p></main>',
  );
}

const mount = (navigate = vi.fn()) =>
  mountSettled(() => mountCompliance(document, navigate));
const hook = (name: string) => element(`[data-compliance-${name}]`);
const accept = () =>
  screen.getByRole<HTMLButtonElement>("button", {
    hidden: true,
    name: "Accept and continue",
  });

function click(target: HTMLElement): void {
  act(() => {
    fireEvent.click(target);
  });
}

function confirm(): void {
  click(
    screen.getByLabelText("I have reviewed and accept this exact version."),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  history.replaceState({}, "", "/");
  sessionStorage.clear();
});

describe("GOVERNANCE-001 legal review", () => {
  it("does nothing without its page", async () => {
    drawShell("<p>Other page</p>");
    const api = stubApi();
    await mount();
    expect(api.calls()).toEqual([]);
    expect(COMPLIANCE_ISLAND).toBe("compliance-review");
  });

  it("requires explicit review, accepts once, refreshes, and continues safely", async () => {
    history.replaceState({}, "", "/app/compliance?next=%2Fapp%2Fjournal");
    shell();
    const accepted = deferred<Response>();
    const api = stubApi({
      [ACCEPT]: accepted.promise,
      [REQUIREMENTS]: [required(legal), required()],
    });
    const navigate = vi.fn();
    await mount(navigate);
    expect(hook("review").hidden).toBe(false);
    expect(hook("kind").textContent).toBe("Required legal review");
    expect(hook("title").textContent).toBe("Terms of service");
    expect(hook("version").textContent).toBe("Version 2026-08");
    expect(hook("content").textContent).toBe(legal.content);
    expect(hook("state").textContent).toBe(
      "Review the exact version before continuing.",
    );
    await expectNoAxeViolations(document.body);
    expect(accept().disabled).toBe(true);
    confirm();
    expect(accept().disabled).toBe(false);
    click(accept());
    expect(hook("state").textContent).toBe("Recording acceptance…");
    expect(accept().disabled).toBe(true);
    click(accept());
    await act(async () => {
      accepted.resolve(jsonResponse({
        acceptedAt: "2026-08-23T10:00:00.000Z",
        documentId: legal.id,
        status: "accepted",
      }, 201));
      await accepted.promise;
    });
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/app/journal"));
    expect(api.calls().filter((call) => call === ACCEPT)).toHaveLength(1);
    expect(api.bodies()).toEqual([{ documentId: legal.id }]);
  });

  it("APR-005 completes the review when workspace storage is disabled", async () => {
    shell();
    vi.stubGlobal("sessionStorage", {
      getItem() {
        throw new DOMException("Disabled", "SecurityError");
      },
    });
    stubApi({
      [ACCEPT]: jsonResponse({ status: "accepted" }, 201),
      [REQUIREMENTS]: [required(legal), required()],
    });
    const navigate = vi.fn();
    await mount(navigate);
    confirm();
    click(accept());
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/app"));
  });

  it("keeps access interrupted when requirements or acceptance cannot be confirmed", async () => {
    history.replaceState({}, "", "/app/compliance?next=%2F%2Fevil.example");
    shell();
    stubApi({
      [ACCEPT]: problemResponse(409, {
        detail: "The selected legal version is no longer current.",
      }),
      [REQUIREMENTS]: [
        required({
          ...legal,
          documentType: "privacy",
          id: "00000000-0000-4000-8000-000000000102",
        }),
        unreachable,
      ],
    });
    const navigate = vi.fn();
    await mount(navigate);
    expect(hook("title").textContent).toBe("Privacy policy");
    confirm();
    click(accept());
    await waitFor(() =>
      expect(hook("state").textContent).toBe(
        "Required legal documents cannot be confirmed. Try again.",
      )
    );
    expect(hook("review").hidden).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("reads the requirements again after a refused acceptance", async () => {
    shell();
    const refreshed = deferred<Response>();
    stubApi({
      [ACCEPT]: [
        problemResponse(409),
        problemResponse(503, { detail: "Legal records are read-only." }),
        unreachable,
      ],
      [REQUIREMENTS]: [
        required(legal),
        refreshed.promise,
        required({ ...legal, documentType: "cookies", version: "2026-09" }),
        required(legal),
      ],
    });
    await mount();
    confirm();
    click(accept());
    await waitFor(() =>
      expect(hook("state").textContent).toBe(
        "Checking required legal documents…",
      )
    );
    await act(async () => {
      refreshed.resolve(required({ ...legal, version: "2026-09" }));
      await refreshed.promise;
    });
    await waitFor(() =>
      expect(hook("version").textContent).toBe("Version 2026-09")
    );
    expect(accept().disabled).toBe(true);
    confirm();
    click(accept());
    await waitFor(() =>
      expect(hook("title").textContent).toBe("Required policy")
    );
    confirm();
    click(accept());
    await waitFor(() =>
      expect(hook("title").textContent).toBe("Terms of service")
    );
  });

  it("falls back to Today when an unsafe return path has no pending requirement", async () => {
    for (
      const search of [
        "?next=%2Fapplication",
        "?next=%2Fapp%2Fcompliance",
        "",
      ]
    ) {
      history.replaceState({}, "", `/app/compliance${search}`);
      shell();
      stubApi({ [REQUIREMENTS]: required() });
      const navigate = vi.fn();
      const unmount = await mount(navigate);
      expect(navigate).toHaveBeenCalledWith("/app");
      unmount();
    }
  });

  it("signs out on decline and uses only the returned destination", async () => {
    shell();
    const signedOut = deferred<Response>();
    stubApi({ [REQUIREMENTS]: required(legal), [SIGN_OUT]: signedOut.promise });
    sessionStorage.setItem("kinship.session", "cached session");
    const navigate = vi.fn();
    await mount(navigate);
    const decline = screen.getByRole<HTMLButtonElement>("button", {
      name: "Not now",
    });
    click(decline);
    expect(hook("state").textContent).toBe("Leaving the protected workspace…");
    expect(decline.disabled).toBe(true);
    await act(async () => {
      signedOut.resolve(
        jsonResponse({ next: "/sign-in", status: "signed-out" }),
      );
      await signedOut.promise;
    });
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/sign-in"));
    expect(sessionStorage.getItem("kinship.session")).toBeNull();
  });

  it("keeps the interruption visible when sign-out fails", async () => {
    shell();
    stubApi({ [REQUIREMENTS]: required(legal), [SIGN_OUT]: unreachable });
    sessionStorage.setItem("kinship.session", "live session");
    await mount();
    const decline = screen.getByRole<HTMLButtonElement>("button", {
      name: "Not now",
    });
    click(decline);
    await waitFor(() =>
      expect(hook("state").textContent).toBe(
        "Sign-out could not be completed. Try again.",
      )
    );
    expect(decline.disabled).toBe(false);
    expect(sessionStorage.getItem("kinship.session")).toBe("live session");
  });
});
