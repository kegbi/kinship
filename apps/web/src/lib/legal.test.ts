import { describe, expect, it, vi } from "vitest";
import { readPublicLegalPage } from "./legal.ts";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const legal = {
  content: "Exact immutable terms content.\n\n<script>alert(1)</script>",
  documentType: "terms",
  id: "00000000-0000-4000-8000-000000000101",
  publishedAt: "2026-08-23T09:00:00.000Z",
  version: "2026-08",
};

const API_ORIGIN = "http://api.internal:8000";

describe("GOVERNANCE-001 public legal documents (ADR 0007)", () => {
  it("reads the exact active version from the API's public read", async () => {
    const fetch = vi.fn().mockResolvedValue(
      response({ document: legal, status: "ready" }),
    );

    const page = await readPublicLegalPage("terms", {
      apiOrigin: API_ORIGIN,
      fetch,
      requestId: "0123456789abcdef0123456789abcdef",
    });

    expect(page).toEqual({
      status: 200,
      title: "Terms of service",
      version: "Version 2026-08 · Published Aug 23, 2026, 9:00 AM",
      content: legal.content,
    });
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe(`${API_ORIGIN}/api/v1/legal-documents/terms`);
    expect(new Headers(init.headers).get("x-request-id")).toBe(
      "0123456789abcdef0123456789abcdef",
    );
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("names only the version when the publication time is absent", async () => {
    const page = await readPublicLegalPage("privacy", {
      apiOrigin: API_ORIGIN,
      fetch: vi.fn().mockResolvedValue(response({
        document: { ...legal, documentType: "privacy", publishedAt: undefined },
        status: "ready",
      })),
    });

    expect(page).toMatchObject({
      status: 200,
      title: "Privacy policy",
      version: "Version 2026-08",
    });
  });

  it("forwards only a well-formed request identifier", async () => {
    const fetch = vi.fn().mockResolvedValue(
      response({ document: legal, status: "ready" }),
    );

    await readPublicLegalPage("terms", {
      apiOrigin: API_ORIGIN,
      fetch,
      requestId: "not a request id\r\nX-Injected: 1",
    });

    expect(new Headers(fetch.mock.calls[0]![1].headers).has("x-request-id"))
      .toBe(false);
  });

  it("answers not found while no version is active", async () => {
    const page = await readPublicLegalPage("privacy", {
      apiOrigin: API_ORIGIN,
      fetch: vi.fn().mockResolvedValue(
        response({ code: "legal_document_not_found", status: 404 }, 404),
      ),
    });

    expect(page).toEqual({
      status: 404,
      title: "Privacy policy",
      message: "This privacy policy has not been published yet.",
    });
  });

  it.each([
    ["an unreachable API", () => Promise.reject(new Error("offline"))],
    [
      "an unavailable API",
      () => Promise.resolve(response({ code: "unavailable" }, 503)),
    ],
    [
      "an answer the contract does not describe",
      () =>
        Promise.resolve(
          response({ document: { version: 1 }, status: "ready" }),
        ),
    ],
    [
      "a body that is not JSON",
      () => Promise.resolve(new Response("<html>", { status: 200 })),
    ],
  ])("answers unavailable for %s", async (_name, answer) => {
    const page = await readPublicLegalPage("terms", {
      apiOrigin: API_ORIGIN,
      fetch: vi.fn().mockImplementation(answer),
    });

    expect(page).toEqual({
      status: 503,
      title: "Terms of service",
      message: "This legal document is temporarily unavailable.",
    });
  });
});
