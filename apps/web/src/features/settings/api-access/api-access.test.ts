import { describe, expect, it } from "vitest";
import type { ApiTokenListEntry } from "../../../../../../packages/contracts/generated/auth-client.ts";
import { apiTokenScope } from "../../../../../../packages/contracts/schemas/api_tokens.ts";
import {
  agentConfigurations,
  API_TOKEN_SCOPE_CHOICES,
  API_TOKEN_SCOPE_GROUPS,
  apiAccessReducer,
  cautionText,
  initialApiAccess,
  mcpEndpoint,
  recordActivity,
  recordIssuer,
  recordScope,
  SCOPE_PRESETS,
  scopeGroups,
  scopeLabel,
} from "./api-access.ts";

const utc = { effectiveTimezone: "UTC", locale: "en" };
const record = {
  createdAt: "2026-08-24T10:00:00.000Z",
  id: "t",
  issuer: { email: "ada@example.test", name: "Ada Lovelace" },
  name: "Desktop",
  scopes: ["people:read"],
} as ApiTokenListEntry;

describe("API-001 API access state", () => {
  it("moves through its phases and keeps the secret until dismissed", () => {
    const ready = apiAccessReducer(initialApiAccess, {
      timePreferences: utc,
      type: "context",
    });
    expect(ready.phase).toBe("ready");
    const created = apiAccessReducer(ready, { secret: "s", type: "created" });
    expect(created).toMatchObject({
      secret: "s",
      status: "API token created. Copy the secret now.",
    });
    expect(apiAccessReducer(created, { type: "dismissed" })).toMatchObject({
      secret: undefined,
      status: "The one-time secret has been dismissed.",
    });
    expect(
      apiAccessReducer(ready, {
        records: [],
        scopes: ["people:read"],
        type: "loaded",
      }).status,
    )
      .toBe("API tokens are current.");
    const busy = apiAccessReducer(ready, {
      busy: true,
      message: "Working…",
      type: "busy",
    });
    expect(apiAccessReducer(busy, { busy: false, type: "busy" }))
      .toMatchObject({ busy: false, status: "Working…" });
    expect(apiAccessReducer(ready, { message: "x", type: "status" }).status)
      .toBe("x");
    expect(apiAccessReducer(ready, { type: "member" }).phase).toBe("member");
    expect(apiAccessReducer(ready, { type: "no-session" }).phase).toBe(
      "no-session",
    );
  });

  it("words each token's scope, expiry, and activity", () => {
    expect(recordScope(record, utc)).toBe("people:read · No expiry");
    expect(
      recordScope({ ...record, expiresAt: "2026-09-24T10:00:00.000Z" }, utc),
    ).toBe("people:read · Expires Sep 24, 2026, 10:00 AM");
    expect(recordActivity(record, utc)).toBe("Never used");
    expect(
      recordActivity(
        { ...record, lastUsedAt: "2026-08-24T12:00:00.000Z" },
        utc,
      ),
    ).toBe("Last used Aug 24, 2026, 12:00 PM");
    expect(
      recordActivity({ ...record, revokedAt: "2026-08-24T13:00:00.000Z" }, utc),
    ).toBe("Revoked Aug 24, 2026, 1:00 PM");
  });

  it("[AUD-M4] names who created each token, by address when the name is blank", () => {
    expect(recordIssuer(record)).toBe(
      "Created by Ada Lovelace · ada@example.test",
    );
    expect(
      recordIssuer({
        ...record,
        issuer: { email: "ada@example.test", name: "" },
      }),
    ).toBe("Created by ada@example.test");
  });
});

describe("MCP-W1 scope picker metadata", () => {
  it("classifies every scope the contract defines, and no other", () => {
    expect(API_TOKEN_SCOPE_CHOICES.map(({ scope }) => scope).toSorted())
      .toEqual([...apiTokenScope.options].toSorted());
    const groups = new Set<string>(API_TOKEN_SCOPE_GROUPS.map(({ id }) => id));
    for (const choice of API_TOKEN_SCOPE_CHOICES) {
      expect(groups.has(choice.group), choice.scope).toBe(true);
      expect(["read", "write"]).toContain(choice.access);
      expect(choice.label.trim(), choice.scope).not.toBe("");
      expect(choice.detail, choice.scope).toMatch(/^[A-Z].*\.$/);
    }
  });

  it("keeps the labels the API flows select by", () => {
    const label = (scope: string) =>
      API_TOKEN_SCOPE_CHOICES.find((choice) => choice.scope === scope)?.label;
    expect([
      "people:read",
      "people:profile:read",
      "relationships:read",
      "tasks:read",
      "tasks:create",
      "tasks:write",
      "interactions:create",
    ].map(label)).toEqual([
      "Read people",
      "Read person profiles",
      "Read relationships",
      "Read tasks",
      "Create tasks",
      "Edit and complete tasks",
      "Record interactions",
    ]);
  });

  it("marks destructive, broad, financial, and administrative grants in words", () => {
    const caution = (scope: string) =>
      API_TOKEN_SCOPE_CHOICES.find((choice) => choice.scope === scope)
        ?.caution;
    expect(caution("people:delete")).toBe("destructive");
    expect(caution("people:merge")).toBe("destructive");
    expect(caution("search:read")).toBe("broad");
    expect(caution("today:read")).toBe("broad");
    expect(caution("gifts:read")).toBe("financial");
    expect(caution("gifts:write")).toBe("financial");
    expect(caution("vocabularies:write")).toBe("administrative");
    expect(caution("people:read")).toBeUndefined();
    expect(cautionText("destructive")).toMatch(/^Destructive/);
    expect(cautionText("broad")).toMatch(/^Broad/);
    expect(cautionText("financial")).toMatch(/^Financial/);
    expect(cautionText("administrative")).toMatch(/administrators/);
  });

  it("groups the offered scopes and shows an unknown one under a fallback label", () => {
    const all = scopeGroups(undefined);
    expect(all.flatMap(({ choices }) => choices.map(({ scope }) => scope)))
      .toHaveLength(apiTokenScope.options.length);
    expect(all.map(({ title }) => title)).toEqual([
      "People",
      "Relationships",
      "Interactions",
      "Tasks and reminders",
      "Journal",
      "Gifts and debts",
      "Files",
      "Search and Today",
      "Vocabularies",
    ]);
    for (const group of all) {
      const reads = group.choices.filter(({ access }) => access === "read");
      expect(group.choices.slice(0, reads.length)).toEqual(reads);
    }
    const offered = scopeGroups(["tasks:write", "notes:archive", "tasks:read"]);
    expect(offered.map(({ title }) => title)).toEqual([
      "Tasks and reminders",
      "Other grants",
    ]);
    expect(offered[0]!.choices.map(({ scope }) => scope)).toEqual([
      "tasks:read",
      "tasks:write",
    ]);
    expect(offered[1]!.choices).toEqual([{
      access: "unknown",
      detail:
        "This server offers a grant this page does not describe yet. Check the API reference before granting it.",
      group: "other",
      label: "notes:archive",
      scope: "notes:archive",
    }]);
    expect(scopeLabel("notes:archive")).toBe("notes:archive");
    expect(scopeLabel("people:read")).toBe("Read people");
  });

  it("derives the two presets from the scope metadata", () => {
    const readOnly = SCOPE_PRESETS.find(({ id }) => id === "read-only")!;
    const full = SCOPE_PRESETS.find(({ id }) => id === "full")!;
    expect(readOnly.label).toBe("Read-only agent");
    expect(full.label).toBe("Full CRM agent");
    expect(readOnly.scopes.toSorted()).toEqual([
      "files:read",
      "gifts:read",
      "interactions:read",
      "journal:read",
      "people:profile:read",
      "people:read",
      "relationships:read",
      "reminders:read",
      "search:read",
      "tasks:read",
      "today:read",
      "vocabularies:read",
    ]);
    expect(full.scopes.toSorted()).toEqual(
      apiTokenScope.options.filter((scope) =>
        !["people:delete", "people:merge", "vocabularies:write"].includes(
          scope,
        )
      ).toSorted(),
    );
  });

  it("builds agent configurations from the page origin and a token or a placeholder", () => {
    const endpoint = mcpEndpoint("https://kinship.example");
    expect(endpoint).toBe("https://kinship.example/api/v1/mcp");
    const placeholder = agentConfigurations(endpoint);
    expect(placeholder.claudeCode).toBe(
      'claude mcp add --transport http kinship https://kinship.example/api/v1/mcp --header "Authorization: Bearer <your-api-token>"',
    );
    expect(JSON.parse(placeholder.json)).toEqual({
      mcpServers: {
        kinship: {
          headers: { Authorization: "Bearer <your-api-token>" },
          type: "http",
          url: "https://kinship.example/api/v1/mcp",
        },
      },
    });
    const filled = agentConfigurations(endpoint, "kin_pat_x.y");
    expect(filled.claudeCode).toContain('"Authorization: Bearer kin_pat_x.y"');
    expect(JSON.parse(filled.json).mcpServers.kinship.headers).toEqual({
      Authorization: "Bearer kin_pat_x.y",
    });
  });
});
