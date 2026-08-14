import { describe, expect, it, vi } from "vitest";
import { checkApiReadiness } from "./health-status.ts";

describe("public.home API readiness", () => {
  it("maps the shared successful contract to the ready state", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ status: "healthy", readiness: "ready" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(checkApiReadiness(fetcher)).resolves.toEqual({
      kind: "ready",
      message: "API ready",
    });
    expect(fetcher).toHaveBeenCalledWith("/api/v1/health", {
      headers: { accept: "application/json" },
    });
  });

  it.each([
    [
      "network failure",
      vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")),
    ],
    [
      "non-success response",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response("unavailable", { status: 503 }),
      ),
    ],
    [
      "contract drift",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({ status: "healthy", readiness: "starting" }),
      ),
    ],
  ])("maps %s to the honest unavailable state", async (_name, fetcher) => {
    await expect(checkApiReadiness(fetcher)).resolves.toEqual({
      kind: "unavailable",
      message: "API temporarily unavailable",
    });
  });
});
