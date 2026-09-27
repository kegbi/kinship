import { describe, expect, it } from "vitest";
import type { WorkspaceLifecyclePreview } from "../../../../../../packages/contracts/generated/auth-client.ts";
import {
  countLabel,
  dangerReducer,
  initialDanger,
} from "./workspace-danger.ts";

const preview = { impactToken: "t" } as unknown as WorkspaceLifecyclePreview;

describe("WORKSPACE-002 danger zone state", () => {
  it("loads the impact, holds the action in flight, and withdraws", () => {
    expect(initialDanger.status).toBe("Loading current impact…");
    const loaded = dangerReducer(initialDanger, {
      preview,
      type: "loaded",
      workspaceId: "w",
    });
    expect(loaded).toMatchObject({ phase: "ready", workspaceId: "w" });
    const busy = dangerReducer(loaded, { action: "reset", type: "submitting" });
    expect(busy).toMatchObject({
      busy: "reset",
      status: "Reauthenticating and revalidating current impact…",
    });
    expect(dangerReducer(busy, { message: "No.", type: "refused" }))
      .toMatchObject({ busy: undefined, status: "No." });
    expect(
      dangerReducer(initialDanger, { message: "Gone.", type: "withdrawn" }),
    )
      .toMatchObject({ phase: "withdrawn", status: "Gone." });
  });

  it("words each count", () => {
    expect(countLabel("journalPosts")).toBe("journal posts");
    expect(countLabel("people")).toBe("people");
  });
});
