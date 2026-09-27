// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { mountPublicLegal } from "./legal.ts";

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

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  history.replaceState({}, "", "/");
  sessionStorage.clear();
});

describe("GOVERNANCE-001 public legal documents", () => {
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
});
