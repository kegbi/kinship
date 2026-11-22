// @vitest-environment happy-dom
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiTokenScope } from "../../../../../../packages/contracts/schemas/api_tokens.ts";
import { expectNoAxeViolations } from "../../../testing/a11y.ts";
import {
  deferred,
  jsonResponse,
  problemResponse,
  stubApi,
  unreachable,
} from "../../../testing/api.ts";
import { ids, workspaceSession } from "../../../testing/fixtures.ts";
import {
  drawShell,
  element,
  mountPending,
  mountSettled,
} from "../../../testing/render.tsx";
import { API_ACCESS_ISLAND, mountApiAccess } from "./api-access.tsx";

const SESSION = "GET /api/v1/session";
const LIST = "GET /api/v1/settings/api-tokens";
const CREATE = "POST /api/v1/settings/api-tokens";
const REVOKE = "DELETE /api/v1/settings/api-tokens/:id";
const tokenId = "00000000-0000-4000-8000-000000000004";
const secret = `kin_pat_${tokenId}.secret-with-enough-entropy-for-a-token`;
const record = {
  createdAt: "2026-08-24T10:00:00.000Z",
  expiresAt: "2026-09-24T10:00:00.000Z",
  id: tokenId,
  issuer: { email: "admin@example.test", name: "Grace Admin" },
  name: "Desktop read",
  scopes: ["people:read"],
};
const listed = (...records: object[]) =>
  jsonResponse({
    records,
    scopes: ["people:read", "people:profile:read", "relationships:read"],
    status: "ready",
  });
const base = {
  [SESSION]: jsonResponse(workspaceSession()),
};

function shell(): void {
  drawShell("<main data-api-access><div data-api-surface></div></main>");
}

const mount = () => mountSettled(() => mountApiAccess());
const state = () => element("[data-api-state]");
const list = () => element("[data-api-list]");
const form = () => element<HTMLFormElement>("[data-api-create]");
const createButton = () =>
  screen.getByRole<HTMLButtonElement>("button", { name: "Create token" });

function fill(name: string, options: { expires?: string } = {}): void {
  act(() => {
    fireEvent.input(screen.getByLabelText("Token name"), {
      target: { value: name },
    });
    if (options.expires) {
      fireEvent.input(screen.getByLabelText("Expiry Optional"), {
        target: { value: options.expires },
      });
    }
    fireEvent.click(screen.getByLabelText("Read people"));
  });
}

function submit(): void {
  act(() => {
    fireEvent.submit(form());
  });
}

afterEach(() => {
  sessionStorage.clear();
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("API-001 personal API tokens", () => {
  it("offers capture alone and explains its four kinds and historic-content limit", async () => {
    shell();
    const api = stubApi({
      ...base,
      [LIST]: jsonResponse({
        records: [],
        scopes: ["interactions:create"],
        status: "ready",
      }),
      [CREATE]: jsonResponse({ secret, status: "created" }, 201),
    });
    await mount();
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(screen.getByText(/notes, activities, calls, and conversations/))
      .toBeTruthy();
    expect(
      screen.getByText(/no reading, editing, or deleting historic content/),
    ).toBeTruthy();
    act(() => {
      fireEvent.input(screen.getByLabelText("Token name"), {
        target: { value: "Capture" },
      });
      fireEvent.click(screen.getByLabelText("Record interactions"));
    });
    submit();
    await waitFor(() =>
      expect(api.bodies()).toEqual([{
        name: "Capture",
        scopes: ["interactions:create"],
      }])
    );
  });
  it("explains and selects independent task read, create, and edit grants for automation", async () => {
    shell();
    const api = stubApi({
      ...base,
      [LIST]: jsonResponse({
        records: [],
        scopes: ["tasks:read", "tasks:create", "tasks:write"],
        status: "ready",
      }),
      [CREATE]: jsonResponse({ secret, status: "created" }, 201),
    });
    await mount();
    act(() => {
      fireEvent.input(screen.getByLabelText("Token name"), {
        target: { value: "Task automation" },
      });
      fireEvent.click(screen.getByLabelText("Read tasks"));
      fireEvent.click(screen.getByLabelText("Create tasks"));
      fireEvent.click(screen.getByLabelText("Edit and complete tasks"));
    });
    expect(screen.getByText(/Task lists and individual task details/))
      .toBeTruthy();
    expect(screen.getByText(/New tasks only/)).toBeTruthy();
    expect(screen.getByText(/Edit, complete, and reopen existing tasks/))
      .toBeTruthy();
    submit();
    await waitFor(() =>
      expect(api.bodies()).toEqual([{
        name: "Task automation",
        scopes: ["tasks:read", "tasks:create", "tasks:write"],
      }])
    );
  });
  it("offers the returned grants with plain labels and sends only deliberately selected scopes", async () => {
    shell();
    const api = stubApi({
      ...base,
      [LIST]: listed(),
      [CREATE]: jsonResponse({ secret, status: "created" }, 201),
    });
    await mount();
    for (const checkbox of screen.getAllByRole<HTMLInputElement>("checkbox")) {
      expect(checkbox.checked).toBe(false);
    }
    act(() => {
      fireEvent.input(screen.getByLabelText("Token name"), {
        target: { value: "Detailed connector" },
      });
      fireEvent.click(screen.getByLabelText("Read person profiles"));
      fireEvent.click(screen.getByLabelText("Read relationships"));
    });
    submit();
    await waitFor(() =>
      expect(api.bodies()).toEqual([{
        name: "Detailed connector",
        scopes: ["people:profile:read", "relationships:read"],
      }])
    );
  });

  it("shows only grants the server currently allows", async () => {
    shell();
    stubApi({
      ...base,
      [LIST]: jsonResponse({
        records: [],
        scopes: ["relationships:read"],
        status: "ready",
      }),
    });
    await mount();
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(screen.getByLabelText("Read relationships")).toBeTruthy();
  });

  it("holds creation while allowed scopes cannot be confirmed", async () => {
    shell();
    const api = stubApi({
      ...base,
      [LIST]: problemResponse(503, { detail: "Tokens offline" }),
    });
    await mount();
    expect(state().textContent).toBe("Tokens offline");
    expect(createButton().disabled).toBe(true);
    fill("Unconfirmed");
    submit();
    expect(api.calls()).not.toContain(CREATE);
  });
  it("does nothing when the API access surface is absent", async () => {
    drawShell("<p>Other page</p>");
    const api = stubApi();
    await mount();
    expect(api.calls()).toEqual([]);
    expect(API_ACCESS_ISLAND).toBe("settings-api-access");
  });

  it("shows a created secret once, copies it, lists metadata, and revokes", async () => {
    shell();
    const api = stubApi({
      ...base,
      [CREATE]: jsonResponse({ secret, status: "created" }, 201),
      [LIST]: [
        listed(),
        listed(record),
        listed({ ...record, revokedAt: "2026-08-24T11:00:00.000Z" }),
      ],
      [REVOKE]: jsonResponse({ status: "revoked" }),
    });
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    await mount();
    expect(state().textContent).toBe("API tokens are current.");
    expect(element("[data-api-empty]").hidden).toBe(false);
    const panel = element("[data-api-secret-panel]");
    expect(panel.hidden).toBe(true);
    await expectNoAxeViolations(document.body);
    fill("Desktop read", { expires: "2026-09-24T10:00" });
    submit();
    await waitFor(() =>
      expect(
        screen.getByLabelText<HTMLInputElement>("New API token secret").value,
      ).toBe(secret)
    );
    expect(panel.hidden).toBe(false);
    expect(api.bodies()[0]).toEqual({
      expiresAt: new Date("2026-09-24T10:00").toISOString(),
      name: "Desktop read",
      scopes: ["people:read"],
    });
    await waitFor(() => expect(list().textContent).toContain("Desktop read"));
    expect(list().textContent).toContain(
      "people:read · Expires Sep 24, 2026, 10:00 AM",
    );
    expect(list().textContent).toContain("Never used");
    expect(list().textContent).toContain(
      "Created by Grace Admin · admin@example.test",
    );
    expect(
      screen.getByRole("heading", { name: "Workspace API tokens" }),
    ).toBeTruthy();
    expect(list().textContent).not.toContain(secret);
    expect(screen.getByLabelText<HTMLInputElement>("Token name").value).toBe(
      "",
    );
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    });
    await waitFor(() => expect(state().textContent).toBe("API token copied."));
    expect(writeText).toHaveBeenCalledWith(secret);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "I have saved it" }));
    });
    expect(state().textContent).toBe("The one-time secret has been dismissed.");
    expect(panel.hidden).toBe(true);
    expect(document.body.textContent).not.toContain(secret);
    expect(
      element<HTMLInputElement>("[data-api-secret]").value,
    ).toBe("");
    act(() => {
      fireEvent.click(within(list()).getByRole("button", { name: "Revoke" }));
    });
    await waitFor(() =>
      expect(list().textContent).toContain("Revoked Aug 24, 2026, 11:00 AM")
    );
    expect(
      within(list()).getByRole<HTMLButtonElement>("button", {
        name: "Revoked",
      }).disabled,
    ).toBe(true);
    expect(
      api.requests().find((request) => request.method === "DELETE")
        ?.params,
    ).toEqual({ id: tokenId });
  });

  it("serializes a non-expiring create and omits the optional expiry", async () => {
    shell();
    const created = deferred<Response>();
    const api = stubApi({
      ...base,
      [CREATE]: created.promise,
      [LIST]: listed(),
    });
    await mount();
    fill("No expiry");
    submit();
    submit();
    expect(createButton().disabled).toBe(true);
    expect(api.calls().filter((call) => call === CREATE)).toHaveLength(1);
    expect(api.bodies()).toEqual([{
      name: "No expiry",
      scopes: ["people:read"],
    }]);
    await act(async () => {
      created.resolve(jsonResponse({ secret, status: "created" }, 201));
      await created.promise;
    });
    await waitFor(() => expect(createButton().disabled).toBe(false));
  });

  it("keeps a token created before the page loaded off the URL and creates it once loaded", async () => {
    shell();
    const session = deferred<Response>();
    const api = stubApi({
      ...base,
      [CREATE]: jsonResponse({ secret, status: "created" }, 201),
      [LIST]: listed(),
      [SESSION]: session.promise,
    });
    const settled = mountPending(() => mountApiAccess());
    fill("Early");
    const early = new Event("submit", { bubbles: true, cancelable: true });
    act(() => {
      form().dispatchEvent(early);
    });
    expect(early.defaultPrevented).toBe(true);
    await act(async () => {
      session.resolve(jsonResponse(workspaceSession()));
      await settled;
    });
    await waitFor(() =>
      expect(element<HTMLInputElement>("[data-api-secret]").value).toBe(secret)
    );
    expect(api.bodies()).toEqual([{ name: "Early", scopes: ["people:read"] }]);
  });

  it("does not expose token management to a regular member", async () => {
    shell();
    const api = stubApi({
      [SESSION]: jsonResponse(
        workspaceSession({ member: { id: ids.member, role: "member" } }),
      ),
    });
    await mount();
    expect(document.querySelector("[data-api-create]")).toBeNull();
    expect(state().textContent).toBe(
      "API token management requires workspace owner or administrator access.",
    );
    expect(api.calls()).toEqual([SESSION]);
    expect(screen.getByRole("region", { name: "Connect an AI agent" }))
      .toBeTruthy();
  });

  it("keeps validation and unavailable management failures actionable", async () => {
    shell();
    stubApi({
      ...base,
      [CREATE]: [
        problemResponse(400, { detail: "Expiry rejected" }),
        unreachable,
      ],
      [LIST]: listed(),
    });
    await mount();
    expect(state().textContent).toBe("API tokens are current.");
    submit();
    expect(state().textContent).toBe("Enter a name and at least one scope.");
    fill("Expired", { expires: "2026-09-24T10:00" });
    submit();
    await waitFor(() => expect(state().textContent).toBe("Expiry rejected"));
    submit();
    await waitFor(() =>
      expect(state().textContent).toBe("API token could not be created.")
    );
  });

  it("reports clipboard, revoke, and session failures without losing the visible token metadata", async () => {
    shell();
    const revoked = deferred<Response>();
    const api = stubApi({
      ...base,
      [CREATE]: jsonResponse({ secret, status: "created" }, 201),
      [LIST]: [listed(record), listed(record), listed(record)],
      [REVOKE]: [revoked.promise, unreachable],
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("denied")) },
    });
    await mount();
    fill("Second");
    submit();
    await waitFor(() =>
      expect(element("[data-api-secret-panel]").hidden).toBe(false)
    );
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    });
    await waitFor(() =>
      expect(state().textContent).toBe(
        "Copy failed. Select the one-time secret and copy it manually.",
      )
    );
    await waitFor(() => expect(createButton().disabled).toBe(false));
    const revoke = within(list()).getByRole<HTMLButtonElement>("button", {
      name: "Revoke",
    });
    act(() => {
      fireEvent.click(revoke);
    });
    act(() => {
      fireEvent.click(revoke);
    });
    expect(revoke.disabled).toBe(true);
    expect(api.calls().filter((call) => call.startsWith("DELETE")))
      .toHaveLength(1);
    await act(async () => {
      revoked.resolve(problemResponse(503, { detail: "Revocation offline" }));
      await revoked.promise;
    });
    await waitFor(() => expect(state().textContent).toBe("Revocation offline"));
    expect(list().textContent).toContain("Desktop read");
    act(() => {
      fireEvent.click(revoke);
    });
    await waitFor(() =>
      expect(state().textContent).toBe("API token could not be revoked.")
    );
  });

  it("says when the session could not be confirmed", async () => {
    shell();
    stubApi({ [SESSION]: unreachable });
    await mount();
    expect(state().textContent).toBe("Your session could not be confirmed.");
  });
});

const everyScope = () =>
  jsonResponse({ records: [], scopes: apiTokenScope.options, status: "ready" });
/** The words a control's `aria-describedby` points at. */
const described = (control: HTMLElement) =>
  (control.getAttribute("aria-describedby") ?? "").split(" ").map((id) =>
    document.getElementById(id)?.textContent ?? ""
  ).join(" ");
const checkbox = (name: string) =>
  screen.getByRole<HTMLInputElement>("checkbox", { name });
const checkedScopes = () =>
  screen.getAllByRole<HTMLInputElement>("checkbox").filter(({ checked }) =>
    checked
  ).map(({ value }) => value);

describe("MCP-W1 grouped grants, presets, and connecting an agent", () => {
  it("groups the grants by area and marks reads, writes, and risky grants in words", async () => {
    shell();
    stubApi({ ...base, [LIST]: everyScope() });
    await mount();
    expect(screen.getAllByRole("checkbox")).toHaveLength(
      apiTokenScope.options.length,
    );
    const people = screen.getByRole("group", { name: "People" });
    expect(within(people).getAllByRole("checkbox")).toHaveLength(5);
    for (
      const name of [
        "Relationships",
        "Interactions",
        "Tasks and reminders",
        "Journal",
        "Gifts and debts",
        "Files",
        "Search and Today",
        "Vocabularies",
      ]
    ) {
      expect(screen.getByRole("group", { name })).toBeTruthy();
    }
    expect(described(checkbox("Read people"))).toMatch(/^Read\b/);
    expect(described(checkbox("Edit people"))).toMatch(/^Write\b/);
    expect(described(checkbox("Delete people"))).toMatch(/Destructive/);
    expect(described(checkbox("Merge people"))).toMatch(/Destructive/);
    expect(described(checkbox("Search the workspace"))).toMatch(/Broad/);
    expect(described(checkbox("Read Today"))).toMatch(/Broad/);
    expect(described(checkbox("Read gifts and debts"))).toMatch(/Financial/);
    expect(described(checkbox("Edit vocabularies"))).toMatch(
      /administrators/,
    );
    await expectNoAxeViolations(document.body);
  });

  it("shows an offered grant this page does not describe under its own name and sends it", async () => {
    shell();
    const api = stubApi({
      ...base,
      [LIST]: jsonResponse({
        records: [],
        scopes: ["people:read", "notes:archive"],
        status: "ready",
      }),
      [CREATE]: jsonResponse({ secret, status: "created" }, 201),
    });
    await mount();
    const other = screen.getByRole("group", { name: "Other grants" });
    act(() => {
      fireEvent.input(screen.getByLabelText("Token name"), {
        target: { value: "Future" },
      });
      fireEvent.click(
        within(other).getByRole("checkbox", { name: "notes:archive" }),
      );
    });
    submit();
    await waitFor(() =>
      expect(api.bodies()).toEqual([{
        name: "Future",
        scopes: ["notes:archive"],
      }])
    );
  });

  it("ticks a preset's grants, which stay adjustable, and never ticks an opt-in grant", async () => {
    shell();
    const api = stubApi({
      ...base,
      [LIST]: everyScope(),
      [CREATE]: jsonResponse({ secret, status: "created" }, 201),
    });
    await mount();
    const readOnly = screen.getByRole("button", { name: "Read-only agent" });
    expect(described(readOnly)).toMatch(/no write/i);
    act(() => {
      fireEvent.click(readOnly);
    });
    expect(checkedScopes().toSorted()).toEqual(
      apiTokenScope.options.filter((scope) => scope.endsWith(":read"))
        .toSorted(),
    );
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Full CRM agent" }));
    });
    expect(checkbox("Edit people").checked).toBe(true);
    expect(checkbox("Read people").checked).toBe(true);
    for (const name of ["Delete people", "Merge people", "Edit vocabularies"]) {
      expect(checkbox(name).checked).toBe(false);
    }
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Read-only agent" }));
    });
    act(() => {
      fireEvent.click(checkbox("Read files"));
      fireEvent.input(screen.getByLabelText("Token name"), {
        target: { value: "Reader" },
      });
    });
    submit();
    await waitFor(() =>
      expect(api.bodies()).toEqual([{
        name: "Reader",
        scopes: apiTokenScope.options.filter((scope) =>
          scope.endsWith(":read") && scope !== "files:read"
        ),
      }])
    );
  });

  it("explains connecting an agent and fills the one-time secret in only while it is shown", async () => {
    shell();
    stubApi({
      ...base,
      [LIST]: [listed(), listed(record)],
      [CREATE]: jsonResponse({ secret, status: "created" }, 201),
    });
    const writeText = vi.fn((_text: string) => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    await mount();
    const endpoint = `${location.origin}/api/v1/mcp`;
    const connect = screen.getByRole("region", {
      name: "Connect an AI agent",
    });
    expect(
      within(connect).getByLabelText<HTMLInputElement>("MCP endpoint URL")
        .value,
    ).toBe(endpoint);
    expect(connect.textContent).toMatch(
      /whatever the token's scopes allow in this workspace/,
    );
    expect(connect.textContent).toMatch(
      /Revoking the token cuts the agent off/,
    );
    expect(
      within(connect).getByRole("link", { name: /API reference/ })
        .getAttribute("href"),
    ).toBe("/docs/api");
    expect(document.querySelector('a[href^="/docs/mcp"]')).toBeNull();
    const claude = within(connect).getByRole("region", {
      name: "Claude Code command",
    });
    expect(claude.textContent).toBe(
      `claude mcp add --transport http kinship ${endpoint} --header "Authorization: Bearer <your-api-token>"`,
    );
    expect(
      within(connect).getByRole("region", { name: "JSON configuration" })
        .textContent,
    ).toContain('"Authorization": "Bearer <your-api-token>"');
    act(() => {
      fireEvent.click(
        within(connect).getByRole("button", { name: "Copy endpoint URL" }),
      );
    });
    await waitFor(() =>
      expect(state().textContent).toBe("MCP endpoint URL copied.")
    );
    expect(writeText).toHaveBeenLastCalledWith(endpoint);
    act(() => {
      fireEvent.click(
        within(connect).getByRole("button", {
          name: "Copy Claude Code command",
        }),
      );
    });
    await waitFor(() =>
      expect(state().textContent).toBe("Claude Code command copied.")
    );
    expect(writeText).toHaveBeenLastCalledWith(claude.textContent);
    await expectNoAxeViolations(document.body);

    fill("Agent");
    submit();
    const panel = element("[data-api-secret-panel]");
    await waitFor(() => expect(panel.hidden).toBe(false));
    expect(connect.textContent).not.toContain(secret);
    const filled = within(panel).getByRole("region", {
      name: "JSON configuration with your new token",
    });
    expect(JSON.parse(filled.textContent!)).toEqual({
      mcpServers: {
        kinship: {
          headers: { Authorization: `Bearer ${secret}` },
          type: "http",
          url: endpoint,
        },
      },
    });
    act(() => {
      fireEvent.click(
        within(panel).getByRole("button", {
          name: "Copy Claude Code command with your new token",
        }),
      );
    });
    await waitFor(() =>
      expect(writeText).toHaveBeenLastCalledWith(
        `claude mcp add --transport http kinship ${endpoint} --header "Authorization: Bearer ${secret}"`,
      )
    );
    act(() => {
      fireEvent.click(
        within(panel).getByRole("button", {
          name: "Copy JSON configuration with your new token",
        }),
      );
    });
    await waitFor(() =>
      expect(writeText).toHaveBeenLastCalledWith(filled.textContent)
    );
    for (const storage of [localStorage, sessionStorage]) {
      const values = Array.from(
        { length: storage.length },
        (_, index) => storage.getItem(storage.key(index)!),
      );
      expect(values.join(" ")).not.toContain("kin_pat_");
    }
    expect(location.href).not.toContain(secret);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "I have saved it" }));
    });
    expect(document.body.textContent).not.toContain(secret);
    expect(
      within(panel).queryByRole("region", {
        name: "JSON configuration with your new token",
        hidden: true,
      }),
    ).toBeNull();
  });

  it("reports a failed configuration copy", async () => {
    shell();
    stubApi({ ...base, [LIST]: listed() });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("denied")) },
    });
    await mount();
    act(() => {
      fireEvent.click(
        screen.getByRole("button", { name: "Copy JSON configuration" }),
      );
    });
    await waitFor(() =>
      expect(state().textContent).toBe(
        "Copy failed. Select the text and copy it manually.",
      )
    );
  });
});
