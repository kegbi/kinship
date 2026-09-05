import {
  formatInstant,
  loadTimePreferences,
  type TimePreferences,
} from "./time-presentation.ts";
import {
  type ApiTokenRecord,
  type ApiTokenScope,
  createApiToken,
  getApiTokens,
  revokeApiToken,
} from "../../../../packages/contracts/generated/auth-client.ts";
import { resolveWorkspaceSession } from "./workspace-context.ts";

function element<T extends Element>(selector: string): T | undefined {
  return document.querySelector<T>(selector) ?? undefined;
}

function renderRecord(
  record: ApiTokenRecord,
  timePreferences: TimePreferences | undefined,
  revoke: (id: string, button: HTMLButtonElement) => void,
): HTMLLIElement {
  const item = document.createElement("li");
  const content = document.createElement("div");
  const name = document.createElement("strong");
  name.textContent = record.name;
  const metadata = document.createElement("span");
  const expiry = record.expiresAt
    ? formatInstant(record.expiresAt, timePreferences)
    : "No expiry";
  metadata.textContent = record.expiresAt
    ? `${record.scopes.join(", ")} · Expires ${expiry}`
    : `${record.scopes.join(", ")} · No expiry`;
  const activity = document.createElement("small");
  activity.textContent = record.revokedAt
    ? `Revoked ${formatInstant(record.revokedAt, timePreferences)}`
    : record.lastUsedAt
    ? `Last used ${formatInstant(record.lastUsedAt, timePreferences)}`
    : "Never used";
  content.append(name, metadata, activity);
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = record.revokedAt ? "Revoked" : "Revoke";
  button.disabled = Boolean(record.revokedAt);
  button.addEventListener("click", () => revoke(record.id, button));
  item.append(content, button);
  return item;
}

export async function mountApiAccess(): Promise<void> {
  const root = element<HTMLElement>("[data-api-access]");
  const state = element<HTMLElement>("[data-api-state]");
  const form = element<HTMLFormElement>("[data-api-create]");
  const list = element<HTMLUListElement>("[data-api-list]");
  const empty = element<HTMLElement>("[data-api-empty]");
  const secretPanel = element<HTMLElement>("[data-api-secret-panel]");
  const secretInput = element<HTMLInputElement>("[data-api-secret]");
  const copy = element<HTMLButtonElement>("[data-api-copy]");
  const dismiss = element<HTMLButtonElement>("[data-api-dismiss]");
  if (
    !root || !state || !form || !list || !empty || !secretPanel ||
    !secretInput || !copy || !dismiss
  ) return;

  const session = await resolveWorkspaceSession();
  if (session.status !== "ready") {
    state.textContent = "Your session could not be confirmed.";
    return;
  }
  if (session.session.member.role === "member") {
    form.remove();
    state.textContent =
      "API token management requires workspace owner or administrator access.";
    return;
  }
  const workspaceId = session.session.workspace.id;
  const timePreferences = await loadTimePreferences(workspaceId);
  let mutationInFlight = false;

  const mutate = (
    button: HTMLButtonElement,
    action: () => Promise<void>,
  ) => {
    if (mutationInFlight) return;
    mutationInFlight = true;
    button.disabled = true;
    void action().finally(() => {
      mutationInFlight = false;
      if (button.isConnected) button.disabled = false;
    });
  };

  const load = async () => {
    state.textContent = "Loading API tokens…";
    const result = await getApiTokens(workspaceId).catch(() => undefined);
    if (!result?.ok) {
      state.textContent = result?.problem.detail ??
        "API tokens could not be loaded.";
      return;
    }
    const revoke = (id: string, button: HTMLButtonElement) => {
      mutate(button, async () => {
        state.textContent = "Revoking API token…";
        const revoked = await revokeApiToken(id, workspaceId).catch(() =>
          undefined
        );
        state.textContent = revoked?.ok
          ? "API token revoked."
          : revoked?.problem.detail ?? "API token could not be revoked.";
        if (revoked?.ok) await load();
      });
    };
    list.replaceChildren(
      ...result.value.records.map((record) =>
        renderRecord(record, timePreferences, revoke)
      ),
    );
    empty.hidden = result.value.records.length !== 0;
    state.textContent = "API tokens are current.";
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const name = data.get("name")?.toString().trim();
    const expiresValue = data.get("expiresAt")?.toString();
    const scopes: ApiTokenScope[] = data.getAll("scopes").flatMap((scope) =>
      scope === "people:read" ? [scope] : []
    );
    if (!name || scopes.length === 0) {
      state.textContent = "Enter a name and at least one scope.";
      return;
    }
    const submit = form.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    );
    if (!submit) return;
    mutate(submit, async () => {
      state.textContent = "Creating API token…";
      const created = await createApiToken(
        {
          ...(expiresValue
            ? { expiresAt: new Date(expiresValue).toISOString() }
            : {}),
          name,
          scopes,
        },
        workspaceId,
      ).catch(() => undefined);
      if (!created?.ok) {
        state.textContent = created?.problem.detail ??
          "API token could not be created.";
        return;
      }
      secretInput.value = created.value.secret;
      secretPanel.hidden = false;
      form.reset();
      state.textContent = "API token created. Copy the secret now.";
      await load();
    });
  });
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(secretInput.value);
      state.textContent = "API token copied.";
    } catch {
      state.textContent =
        "Copy failed. Select the one-time secret and copy it manually.";
    }
  });
  dismiss.addEventListener("click", () => {
    secretInput.value = "";
    secretPanel.hidden = true;
    state.textContent = "The one-time secret has been dismissed.";
  });
  await load();
}
