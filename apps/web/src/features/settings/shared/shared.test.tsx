// @vitest-environment happy-dom
import { act, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deferred,
  jsonResponse,
  stubApi,
  unreachable,
} from "../../../testing/api.ts";
import {
  ids,
  preferences,
  workspaceSession,
} from "../../../testing/fixtures.ts";
import { renderIsland } from "../../../testing/render.tsx";
import type { ReactNode } from "react";
import { ComplianceReview } from "../../compliance/compliance.tsx";
import { ApiAccess } from "../api-access/api-access.tsx";
import { WorkspaceDanger } from "../danger-zone/workspace-danger.tsx";
import { ExportsPage } from "../exports/exports.tsx";
import { ImportHistory } from "../imports/import-history.tsx";
import { ImportReportPage } from "../imports/import-report.tsx";
import { Integrations } from "../integrations/integrations.tsx";
import { MembersPage } from "../members/members.tsx";
import { Personalization } from "../personalization/personalization.tsx";
import { PreferenceSettingsForm } from "../preferences/preference-settings.tsx";
import { PersonalLifecycle } from "../profile/personal-lifecycle.tsx";
import { ProfileSettingsForm } from "../profile/profile-settings.tsx";
import { SecuritySessions } from "../security/security-sessions.tsx";
import { StorageSettingsPage } from "../storage/storage-settings.tsx";
import { WorkspaceSettingsForm } from "../workspace/workspace-settings.tsx";
import {
  browserNavigate,
  managesWorkspace,
  resolveSettingsContext,
} from "./context.ts";

const SESSION = "GET /api/v1/session";
const PREFERENCES = "GET /api/v1/settings/preferences";
const importId = "00000000-0000-4000-8000-000000000010";

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe("GAP-033 settings island context", () => {
  it("resolves the workspace, the role, and the time preferences on request", async () => {
    stubApi({
      [PREFERENCES]: jsonResponse({
        preferences: preferences(),
        status: "ready",
      }),
      [SESSION]: jsonResponse(workspaceSession()),
    });
    await expect(resolveSettingsContext()).resolves.toEqual({
      role: "owner",
      workspaceId: ids.workspace,
    });
    sessionStorage.clear();
    await expect(resolveSettingsContext({ timePreferences: true })).resolves
      .toMatchObject({ timePreferences: { effectiveTimezone: "UTC" } });
    expect(managesWorkspace("admin")).toBe(true);
    expect(managesWorkspace("member")).toBe(false);
  });

  it("answers no context when the session cannot be confirmed", async () => {
    stubApi({ [SESSION]: unreachable });
    await expect(resolveSettingsContext()).resolves.toBeUndefined();
  });

  it("navigates the browser outside tests", () => {
    const assign = vi.spyOn(globalThis.location, "assign")
      .mockImplementation(() => undefined);
    browserNavigate("/auth/sign-in");
    expect(assign).toHaveBeenCalledWith("/auth/sign-in");
  });
});

const navigate = vi.fn();
const islands: readonly {
  readonly name: string;
  readonly read: string;
  readonly ui: ReactNode;
}[] = [
  {
    name: "profile",
    read: "GET /api/v1/settings/profile",
    ui: <ProfileSettingsForm />,
  },
  {
    name: "personal lifecycle",
    read: "GET /api/v1/settings/personal-lifecycle",
    ui: <PersonalLifecycle navigate={navigate} />,
  },
  { name: "preferences", read: PREFERENCES, ui: <PreferenceSettingsForm /> },
  {
    name: "workspace",
    read: "GET /api/v1/settings/workspace",
    ui: <WorkspaceSettingsForm />,
  },
  {
    name: "security",
    read: "GET /api/v1/settings/sessions",
    ui: <SecuritySessions navigate={navigate} />,
  },
  {
    name: "danger zone",
    read: "GET /api/v1/settings/workspace-lifecycle",
    ui: <WorkspaceDanger navigate={navigate} />,
  },
  {
    name: "members",
    read: "GET /api/v1/workspace-members",
    ui: <MembersPage />,
  },
  {
    name: "personalization",
    read: "GET /api/v1/settings/personalization/profile-modules",
    ui: <Personalization />,
  },
  {
    name: "integrations",
    read: "GET /api/v1/settings/integrations/dav",
    ui: <Integrations />,
  },
  {
    name: "API access",
    read: "GET /api/v1/settings/api-tokens",
    ui: <ApiAccess />,
  },
  {
    name: "storage",
    read: "GET /api/v1/settings/storage",
    ui: <StorageSettingsPage />,
  },
  {
    name: "import history",
    read: "GET /api/v1/imports",
    ui: <ImportHistory />,
  },
  {
    name: "import report",
    read: `GET /api/v1/imports/${importId}`,
    ui: <ImportReportPage pathname={`/app/settings/import/${importId}`} />,
  },
  { name: "exports", read: "GET /api/v1/exports", ui: <ExportsPage /> },
  {
    name: "legal review",
    read: "GET /api/v1/legal-requirements",
    ui: <ComplianceReview navigate={navigate} />,
  },
];

describe("GAP-033 settings islands", () => {
  it.each(islands)(
    "drops the $name read that answers after the island is gone",
    async ({ read, ui }) => {
      const answer = deferred<Response>();
      const api = stubApi({
        [read]: answer.promise,
        [PREFERENCES]: jsonResponse({
          preferences: preferences(),
          status: "ready",
        }),
        [SESSION]: jsonResponse(workspaceSession()),
      });
      const { island, unmount } = await renderIsland(ui);
      await waitFor(() => expect(api.calls()).toContain(read));
      const drawn = island.innerHTML;
      unmount();
      await act(async () => {
        answer.resolve(jsonResponse({ status: "ready" }));
        await answer.promise;
      });
      expect(drawn.length).toBeGreaterThan(0);
      expect(document.body.textContent).toBe("");
      expect(navigate).not.toHaveBeenCalled();
    },
  );
});
