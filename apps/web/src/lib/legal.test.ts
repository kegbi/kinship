// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { mountCompliance, mountPublicLegal } from "./legal.ts";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const legal = {
  content: "Exact immutable terms content.",
  documentType: "terms",
  id: "00000000-0000-4000-8000-000000000101",
  publishedAt: "2026-08-23T09:00:00.000Z",
  version: "2026-08",
};

function complianceMarkup(): string {
  return `
    <p data-compliance-state></p><section data-compliance-review hidden>
      <p data-compliance-kind></p><h1 data-compliance-title></h1>
      <p data-compliance-version></p><article data-compliance-content></article>
      <label><input data-compliance-confirm type="checkbox"> Confirm</label>
      <button data-compliance-accept disabled>Accept</button>
      <button data-compliance-decline>Not now</button>
    </section>`;
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  history.replaceState({}, "", "/");
});

describe("GOVERNANCE-001 legal review", () => {
  it("renders the exact public version as text", async () => {
    document.body.innerHTML =
      "<p data-legal-state></p><h1 data-legal-title></h1><p data-legal-version></p><article data-legal-content></article>";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({
        document: legal,
        status: "ready",
      })),
    );

    await mountPublicLegal("terms");

    expect(document.querySelector("[data-legal-version]")?.textContent)
      .toContain("2026-08");
    expect(document.querySelector("[data-legal-content]")?.textContent).toBe(
      legal.content,
    );
    expect(document.querySelector("[data-legal-content]")?.innerHTML).not
      .toContain("<script");
  });

  it("requires explicit review, accepts once, refreshes, and continues safely", async () => {
    history.replaceState({}, "", "/app/compliance?next=%2Fapp%2Fjournal");
    document.body.innerHTML = complianceMarkup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ documents: [legal], status: "ready" }))
      .mockResolvedValueOnce(response({
        acceptedAt: "2026-08-23T10:00:00.000Z",
        documentId: legal.id,
        status: "accepted",
      }, 201))
      .mockResolvedValueOnce(response({ documents: [], status: "ready" }));
    vi.stubGlobal("fetch", fetchMock);
    const navigate = vi.fn();

    await mountCompliance(navigate);
    const confirm = document.querySelector<HTMLInputElement>(
      "[data-compliance-confirm]",
    )!;
    const accept = document.querySelector<HTMLButtonElement>(
      "[data-compliance-accept]",
    )!;
    expect(accept.disabled).toBe(true);
    confirm.click();
    expect(accept.disabled).toBe(false);
    accept.click();

    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("/app/journal")
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/v1/legal-acceptances");
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("POST");
  });

  it("keeps access interrupted when requirements or acceptance cannot be confirmed", async () => {
    history.replaceState({}, "", "/app/compliance?next=%2F%2Fevil.example");
    document.body.innerHTML = complianceMarkup();
    const privacy = {
      ...legal,
      documentType: "privacy",
      id: "00000000-0000-4000-8000-000000000102",
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        response({ documents: [privacy], status: "ready" }),
      )
      .mockResolvedValueOnce(response({
        detail: "The selected legal version is no longer current.",
        status: 409,
        title: "Legal document superseded",
        type: "about:blank",
      }, 409))
      .mockRejectedValueOnce(new Error("requirements unavailable"));
    vi.stubGlobal("fetch", fetchMock);
    const navigate = vi.fn();

    await mountCompliance(navigate);
    const confirm = document.querySelector<HTMLInputElement>(
      "[data-compliance-confirm]",
    )!;
    confirm.click();
    document.querySelector<HTMLButtonElement>("[data-compliance-accept]")!
      .click();

    await vi.waitFor(() => {
      expect(document.querySelector("[data-compliance-state]")?.textContent)
        .toContain("cannot be confirmed");
    });
    expect(document.querySelector("[data-compliance-title]")?.textContent).toBe(
      "Privacy policy",
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it("signs out on decline and uses only the returned destination", async () => {
    document.body.innerHTML = complianceMarkup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ documents: [legal], status: "ready" }))
      .mockResolvedValueOnce(
        response({ next: "/sign-in", status: "signed-out" }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const navigate = vi.fn();

    await mountCompliance(navigate);
    document.querySelector<HTMLButtonElement>("[data-compliance-decline]")!
      .click();

    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith("/sign-in"));
  });

  it("renders unavailable public state without interpreting response content", async () => {
    document.body.innerHTML =
      "<p data-legal-state></p><h1 data-legal-title></h1><p data-legal-version></p><article data-legal-content></article>";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    await mountPublicLegal("privacy");

    expect(document.querySelector("[data-legal-state]")?.textContent).toContain(
      "temporarily unavailable",
    );
  });

  it("renders privacy metadata when publication time is intentionally absent", async () => {
    document.body.innerHTML =
      "<p data-legal-state></p><h1 data-legal-title></h1><p data-legal-version></p><article data-legal-content></article>";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({
        document: { ...legal, documentType: "privacy", publishedAt: null },
        status: "ready",
      })),
    );

    await mountPublicLegal("privacy");

    expect(document.querySelector("[data-legal-title]")?.textContent).toBe(
      "Privacy policy",
    );
    expect(document.querySelector("[data-legal-version]")?.textContent).toBe(
      "Version 2026-08",
    );
  });

  it("falls back to Today when an unsafe return path has no pending requirement", async () => {
    history.replaceState({}, "", "/app/compliance?next=%2Fapplication");
    document.body.innerHTML = complianceMarkup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({ documents: [], status: "ready" }),
      ),
    );
    const navigate = vi.fn();

    await mountCompliance(navigate);

    expect(navigate).toHaveBeenCalledWith("/app");
  });

  it("keeps the interruption visible when sign-out fails", async () => {
    document.body.innerHTML = complianceMarkup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ documents: [legal], status: "ready" }))
      .mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);

    await mountCompliance(vi.fn());
    document.querySelector<HTMLButtonElement>("[data-compliance-decline]")!
      .click();

    await vi.waitFor(() => {
      expect(document.querySelector("[data-compliance-state]")?.textContent)
        .toContain("Sign-out could not be completed");
    });
  });
});
