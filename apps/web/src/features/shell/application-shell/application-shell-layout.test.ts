// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceSessionResolution } from "../../../lib/workspace-context.ts";

const mocks = vi.hoisted(() => ({
  preferences: vi.fn(),
  session: vi.fn(),
  revalidated: vi.fn(),
}));
vi.mock(
  "../../../../../../packages/contracts/generated/auth-client.ts",
  async (original) => ({
    ...await original<
      typeof import("../../../../../../packages/contracts/generated/auth-client.ts")
    >(),
    getMemberPreferences: mocks.preferences,
  }),
);
vi.mock("../../../lib/workspace-context.ts", async (original) => ({
  ...await original<typeof import("../../../lib/workspace-context.ts")>(),
  resolveWorkspaceSession: mocks.session,
  onSessionRevalidated: mocks.revalidated,
}));

import { MEMBER_LAYOUT_SAVED_EVENT } from "../../../lib/app-shell.ts";
import {
  preferences as memberPreferences,
  sessionWithoutPreferences,
  workspaceSession,
} from "../../../testing/fixtures.ts";
import { drawShell, element } from "../../../testing/render.tsx";
import { mountApplicationShell } from "./application-shell.ts";

/** A ready session whose membership carries `fluidLayout`, or no preferences. */
function ready(
  workspaceId = "first",
  memberId = "member",
  fluidLayout: boolean | undefined = false,
): WorkspaceSessionResolution {
  const workspace = { id: workspaceId, name: workspaceId };
  const membership = {
    member: { id: memberId, role: "owner" as const },
    workspace,
    workspaces: [workspace],
  };
  return {
    status: "ready",
    session: fluidLayout === undefined
      ? sessionWithoutPreferences(membership)
      : workspaceSession({
        ...membership,
        preferences: memberPreferences({ fluidLayout }),
      }),
  };
}

function markup(): HTMLElement {
  drawShell(
    `<section id="access-state"></section><div id="protected-shell" hidden><select id="workspace-switcher"></select><button id="member-sign-out"></button><div id="workspace-switcher-container"></div></div>`,
  );
  return element("#protected-shell");
}

function revalidate(resolution: WorkspaceSessionResolution): void {
  mocks.revalidated.mock.calls[0]![0](resolution);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue(ready());
  document.body.dataset.pageId = "settings.preferences";
});

afterEach(() => {
  // The width comes with the session; the shell never reads it apart (AUD-F3).
  expect(mocks.preferences).not.toHaveBeenCalled();
  sessionStorage.clear();
});

describe("APR-010 membership application width", () => {
  it.each([true, false])(
    "takes the selected membership's fluidLayout=%s from its session",
    async (fluid) => {
      const root = markup();
      mocks.session.mockResolvedValue(ready("first", "member", fluid));
      await mountApplicationShell(vi.fn());
      expect(root.dataset.fluidLayout).toBe(String(fluid));
    },
  );

  it("takes each page's width from that page's session instead of the previous page's", async () => {
    const oldRoot = markup();
    mocks.session.mockResolvedValueOnce(ready("first", "member", true));
    await mountApplicationShell(vi.fn());
    expect(oldRoot.dataset.fluidLayout).toBe("true");
    const newRoot = markup();
    await mountApplicationShell(vi.fn());
    expect(newRoot.dataset.fluidLayout).toBe("false");
  });

  it("takes a revalidated session's width, for a changed membership or a changed preference", async () => {
    const root = markup();
    await mountApplicationShell(vi.fn());
    expect(root.dataset.fluidLayout).toBe("false");
    revalidate(ready("second", "other-member", true));
    expect(root.dataset.fluidLayout).toBe("true");
    revalidate(ready("second", "other-member", false));
    expect(root.dataset.fluidLayout).toBe("false");
  });

  it("keeps a membership's width when only workspace presentation is revalidated", async () => {
    const root = markup();
    mocks.session.mockResolvedValue(ready("first", "member", true));
    await mountApplicationShell(vi.fn());
    revalidate(ready("first", "member", true));
    expect(root.dataset.fluidLayout).toBe("true");
  });

  it.each(["access-lost", "forbidden"])(
    "clears width on %s",
    async (state) => {
      const root = markup();
      mocks.session.mockResolvedValue(ready("first", "member", true));
      await mountApplicationShell(vi.fn());
      expect(root.dataset.fluidLayout).toBe("true");
      if (state === "access-lost") revalidate({ status: "access-lost" });
      else {
        document.body.dataset.pageId = "settings.workspace";
        const resolution = ready("first", "member", true);
        if (resolution.status === "ready") {
          revalidate({
            ...resolution,
            session: {
              ...resolution.session,
              member: { id: "member", role: "member" },
            },
          });
        }
      }
      expect(root.dataset.fluidLayout).toBe("false");
      expect(root.hidden).toBe(true);
    },
  );

  it("uses constrained width when a session carries no preferences", async () => {
    const root = markup();
    mocks.session.mockResolvedValue(ready("first", "member", undefined));
    await mountApplicationShell(vi.fn());
    expect(root.dataset.fluidLayout).toBe("false");
    revalidate(ready("second", "member", true));
    expect(root.dataset.fluidLayout).toBe("true");
    revalidate(ready("second", "member", undefined));
    expect(root.dataset.fluidLayout).toBe("false");
    expect(root.hidden).toBe(false);
  });

  it("drops saves for another workspace and after access loss", async () => {
    const root = markup();
    mocks.session.mockResolvedValue(ready("first", "member", true));
    await mountApplicationShell(vi.fn());
    root.dispatchEvent(
      new CustomEvent(MEMBER_LAYOUT_SAVED_EVENT, {
        detail: { workspaceId: "other", fluidLayout: false },
      }),
    );
    expect(root.dataset.fluidLayout).toBe("true");
    revalidate({ status: "access-lost" });
    root.dispatchEvent(
      new CustomEvent(MEMBER_LAYOUT_SAVED_EVENT, {
        detail: { workspaceId: "first", fluidLayout: true },
      }),
    );
    expect(root.dataset.fluidLayout).toBe("false");
  });

  it("applies a saved width at once", async () => {
    const root = markup();
    await mountApplicationShell(vi.fn());
    root.dispatchEvent(
      new CustomEvent(MEMBER_LAYOUT_SAVED_EVENT, {
        detail: { workspaceId: "first", fluidLayout: true },
      }),
    );
    expect(root.dataset.fluidLayout).toBe("true");
  });

  it("names the saved-layout event the settings page dispatches", () => {
    expect(MEMBER_LAYOUT_SAVED_EVENT).toBe("kinship:member-layout-saved");
  });
});
