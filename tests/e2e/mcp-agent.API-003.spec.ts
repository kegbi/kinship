import { expect, test } from "./support/test.ts";
import type { APIRequestContext, APIResponse } from "@playwright/test";
import { registerVerified } from "./support/api.ts";
import { origin } from "./support/env.ts";
import { bareToken } from "./support/mail.ts";
import { signInAcceptingCompliance } from "./support/sign-in.ts";

/*
 * API-003: an owner mints an agent token in API access settings and an MCP
 * client uses it against `POST /api/v1/mcp` through the public gateway, the
 * way a real client does: a 2025-era `initialize` handshake, then
 * `notifications/initialized`, `tools/list`, and `tools/call`, each a single
 * JSON-RPC message with the bearer token and no cookie or Origin.
 */

const MCP_PATH = "/api/v1/mcp";
const PROTOCOL_VERSION = "2025-06-18";

// deno-lint-ignore no-explicit-any
type Json = any;

/** One JSON-RPC message posted as a Streamable HTTP client posts it. */
function rpc(
  client: APIRequestContext,
  message: {
    readonly id?: number;
    readonly method: string;
    readonly params?: Record<string, unknown>;
  },
): Promise<APIResponse> {
  return client.post(MCP_PATH, {
    data: { jsonrpc: "2.0", ...message },
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      ...(message.method === "initialize"
        ? {}
        : { "MCP-Protocol-Version": PROTOCOL_VERSION }),
    },
  });
}

/** The JSON-RPC result of an answer that must be one JSON body. */
async function resultOf(response: APIResponse): Promise<Json> {
  expect(response.status(), await response.text()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/json");
  const body = await response.json() as Json;
  expect(body.error, JSON.stringify(body)).toBeUndefined();
  return body.result;
}

let nextId = 10;

function callTool(
  client: APIRequestContext,
  name: string,
  args: Record<string, unknown>,
): Promise<APIResponse> {
  return rpc(client, {
    id: nextId++,
    method: "tools/call",
    params: { name, arguments: args },
  });
}

test(
  "[API-003] an owner connects an AI agent that works through the MCP endpoint within its token's grants",
  {
    annotation: { type: "flow", description: "API-003" },
  },
  async ({ page, playwright, request }) => {
    test.setTimeout(180_000);
    const email = `agent-${Date.now()}@example.test`;
    await registerVerified(request, {
      email,
      firstName: "Agent",
      lastName: "Owner",
      workspaceName: "Agent circle",
    }, bareToken);
    await signInAcceptingCompliance(page, email);
    const session = await (await page.request.get(`${origin}/api/v1/session`))
      .json() as { workspace: { id: string } };

    await page.goto("/app/settings/api");
    await expect(page.locator("body")).toHaveAttribute(
      "data-page-id",
      "settings.api-access",
    );
    await expect(page.locator("[data-api-state]")).toContainText(
      "API tokens are current.",
    );
    const connect = page.locator("[data-api-connect]");
    await expect(
      connect.getByRole("heading", { name: "Connect an AI agent" }),
    ).toBeVisible();
    const endpoint = `${origin}${MCP_PATH}`;
    await expect(connect.getByLabel("MCP endpoint URL")).toHaveValue(endpoint);
    await expect(connect.getByRole("link", { name: "MCP guide" }))
      .toHaveAttribute("href", "/docs/mcp");

    await page.getByLabel("Token name").fill("Claude agent");
    await page.getByRole("button", { name: "Read-only agent", exact: true })
      .click();
    await expect(page.locator("[data-api-state]")).toContainText(
      "Read-only agent grants selected.",
    );
    await expect(page.getByLabel("Read people", { exact: true }))
      .toBeChecked();
    const editPeople = page.getByLabel("Edit people", { exact: true });
    await expect(editPeople).not.toBeChecked();
    await expect(page.getByLabel("Edit gifts and debts", { exact: true })).not
      .toBeChecked();
    await editPeople.check();
    const granted = (await page.locator('input[name="scopes"]:checked')
      .evaluateAll((inputs) =>
        inputs.map((input) => (input as HTMLInputElement).value)
      )).sort();
    expect(granted).toContain("people:write");
    expect(granted).not.toContain("people:delete");
    expect(granted).not.toContain("gifts:write");
    await page.getByRole("button", { name: "Create token", exact: true })
      .click();
    const secretInput = page.getByLabel("New API token secret");
    await expect(secretInput).toBeVisible();
    const secret = await secretInput.inputValue();
    expect(secret).toMatch(/^kin_pat_[0-9a-f-]+\.[A-Za-z0-9_-]+$/);
    for (
      const name of [
        "Claude Code command with your new token",
        "JSON configuration with your new token",
      ]
    ) {
      const snippet = page.getByRole("region", { name, exact: true });
      await expect(snippet).toContainText(`Bearer ${secret}`);
      await expect(snippet).toContainText(endpoint);
    }

    // A separate context: an MCP client has neither the session cookie nor an
    // Origin, only its bearer token.
    const agent = await playwright.request.newContext({
      baseURL: origin,
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: { Authorization: `Bearer ${secret}` },
    });
    let personId: string;
    let memberId: string;
    try {
      const initialized = await resultOf(
        await rpc(agent, {
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: "api-003-agent", version: "1" },
          },
        }),
      );
      expect(initialized.protocolVersion).toBe(PROTOCOL_VERSION);
      expect(initialized.serverInfo.name).toBe("kinship");
      expect(initialized.capabilities.tools).toBeDefined();
      expect(
        (await rpc(agent, { method: "notifications/initialized" })).status(),
      ).toBe(202);

      const listed = await resultOf(
        await rpc(agent, { id: 2, method: "tools/list" }),
      );
      const names = (listed.tools as { name: string }[]).map(({ name }) =>
        name
      );
      for (const name of ["get_context", "list_people", "create_person"]) {
        expect(names, `${name} is listed`).toContain(name);
      }
      for (const name of ["create_gift", "delete_person"]) {
        expect(names, `${name} is not listed`).not.toContain(name);
      }

      const context = await resultOf(await callTool(agent, "get_context", {}));
      expect(context.isError, JSON.stringify(context)).not.toBe(true);
      expect(context.structuredContent).toMatchObject({
        role: "owner",
        token: { name: "Claude agent" },
        workspaceId: session.workspace.id,
      });
      expect([...context.structuredContent.token.scopes].sort()).toEqual(
        granted,
      );
      memberId = context.structuredContent.memberId;

      const person = {
        familyName: "Hopper",
        givenName: "Grace",
        isPartial: false,
        requestId: crypto.randomUUID(),
      };
      const created = await resultOf(
        await callTool(agent, "create_person", person),
      );
      expect(created.isError, JSON.stringify(created)).not.toBe(true);
      expect(created.structuredContent).toMatchObject({
        status: "created",
        person: { givenName: "Grace", familyName: "Hopper" },
      });
      personId = created.structuredContent.person.id;
      const replayed = await resultOf(
        await callTool(agent, "create_person", person),
      );
      expect(replayed.isError, JSON.stringify(replayed)).not.toBe(true);
      expect(replayed.structuredContent.person.id).toBe(personId);

      const directory = await resultOf(
        await callTool(agent, "list_people", { search: "Hopper" }),
      );
      expect(
        (directory.structuredContent.people as { id: string }[]).map(
          ({ id }) => id,
        ),
      ).toEqual([personId]);

      // An ungranted tool is not registered, so calling it by name is refused.
      const ungranted = await callTool(agent, "create_gift", {
        personId,
        name: "A book",
        status: "idea",
      });
      expect(ungranted.status()).toBe(200);
      const refusal = await ungranted.json() as Json;
      expect(
        refusal.error !== undefined || refusal.result?.isError === true,
        JSON.stringify(refusal),
      ).toBe(true);

      // The argument schema accepts an empty name; the route refuses it.
      const invalid = await resultOf(
        await callTool(agent, "create_person", {
          givenName: "",
          isPartial: false,
        }),
      );
      expect(invalid.isError).toBe(true);
      expect(invalid.structuredContent.code).toBe("validation_failed");
      expect(JSON.stringify(invalid.content)).toContain("validation_failed");
      expect(invalid.structuredContent.errors?.givenName).toBeTruthy();
    } finally {
      await agent.dispose();
    }

    // The browser sees what the agent made, attributed to the member.
    await page.goto("/app/people");
    await expect(
      page.locator(`#people-directory-list a[href="/app/people/${personId}"]`),
    ).toContainText("Grace Hopper");
    await page.goto("/app/settings/audit");
    await page.getByLabel("Person ID").fill(personId);
    await page.getByLabel("Actor member ID").fill(memberId);
    await page.getByRole("searchbox", { name: "Action", exact: true }).fill(
      "people.person-created",
    );
    await page.getByRole("button", { name: "Apply filters" }).click();
    const events = page.locator("[data-audit-list] li");
    await expect(events).toHaveCount(1);
    await expect(events.first()).toContainText("People person created");
    await expect(events.first()).toContainText(
      `Workspace member ${memberId} · Grace Hopper`,
    );

    // Revoking the token in settings cuts the agent off at its next request.
    await page.goto("/app/settings/api");
    const row = page.locator("[data-api-list] li", { hasText: "Claude agent" });
    await row.getByRole("button", { name: "Revoke", exact: true }).click();
    await expect(row).toContainText("Revoked");
    const revoked = await playwright.request.newContext({
      baseURL: origin,
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: { Authorization: `Bearer ${secret}` },
    });
    try {
      const refused = await rpc(revoked, { id: 3, method: "tools/list" });
      expect(refused.status()).toBe(401);
      expect(refused.headers()["www-authenticate"]).toMatch(/^Bearer\b/);
    } finally {
      await revoked.dispose();
    }
  },
);

test(
  "[API-003] signed-out visitors read the MCP guide without JavaScript",
  {
    annotation: { type: "flow", description: "API-003" },
  },
  async ({ browser }) => {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      baseURL: origin,
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();
    try {
      await page.goto("/docs/mcp");
      await expect(page.locator("body")).toHaveAttribute(
        "data-page-id",
        "public.mcp-guide",
      );
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "MCP guide",
      );
      await expect(page.locator(".reference-meta")).toContainText(
        `POST ${MCP_PATH}`,
      );
      const example = page.getByRole("region", {
        name: "Claude Code command",
        exact: true,
      });
      await expect(example).toBeVisible();
      await expect(example).toContainText(MCP_PATH);
      await expect(example).toContainText("Authorization: Bearer");
      const tool = page.locator('[data-mcp-tool="get_context"]');
      await expect(tool).toBeVisible();
      await expect(tool.getByRole("heading", { name: "get_context" }))
        .toBeVisible();
      expect(await page.locator("[data-mcp-tool]").count()).toBeGreaterThan(1);
      await expect(page.locator("astro-island")).toHaveCount(0);
    } finally {
      await context.close();
    }
  },
);
