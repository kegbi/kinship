import {
  formatInstant,
  loadTimePreferences,
  type TimePreferences,
} from "./time-presentation.ts";
import { resolveWorkspaceSession } from "./workspace-context.ts";
import { bindSubmitEarly } from "./early-submit.ts";
import {
  createDavSubscription,
  type DavSubscription as Subscription,
  disableDavSubscription,
  getDavSubscriptions,
  synchronizeDavSubscription,
} from "../../../../packages/contracts/generated/auth-client.ts";

function status(
  subscription: Subscription,
  timePreferences: TimePreferences | undefined,
): string {
  if (!subscription.isActive) return "Disabled";
  if (subscription.lastOutcome === "never") return "Not synchronized yet";
  if (subscription.lastOutcome === "success") {
    return subscription.lastSyncedAt
      ? `Synchronized ${
        formatInstant(subscription.lastSyncedAt, timePreferences)
      }`
      : "Synchronized";
  }
  const label = subscription.lastOutcome === "auth-failure"
    ? "Authentication failed"
    : subscription.lastOutcome === "conflict"
    ? "Conflict needs retry"
    : "Partially synchronized";
  const detail = subscription.lastError === "dav_authentication_failed"
    ? "Check the saved DAV credentials."
    : subscription.lastError === "dav_remote_conflict"
    ? "Retry to refresh the remote collection."
    : subscription.lastError === "dav_claim_lost"
    ? "Another synchronization took ownership. Retry."
    : subscription.lastError === "dav_sync_failed"
    ? "Retry the synchronization."
    : undefined;
  return detail ? `${label}: ${detail}` : label;
}

function render(
  subscription: Subscription,
  timePreferences: TimePreferences | undefined,
  mutate: (button: HTMLButtonElement, action: "disable" | "sync") => void,
) {
  const item = document.createElement("li");
  const content = document.createElement("div");
  const name = document.createElement("strong");
  name.textContent = subscription.name;
  const location = document.createElement("span");
  location.textContent = subscription.remoteUrl;
  const outcome = document.createElement("small");
  outcome.textContent = status(subscription, timePreferences);
  content.append(name, location, outcome);
  const actions = document.createElement("div");
  const sync = document.createElement("button");
  sync.type = "button";
  sync.textContent = subscription.lastOutcome === "partial" ||
      subscription.lastOutcome === "conflict" ||
      subscription.lastOutcome === "auth-failure"
    ? "Retry"
    : "Sync now";
  sync.disabled = !subscription.isActive;
  sync.addEventListener("click", () => mutate(sync, "sync"));
  const disable = document.createElement("button");
  disable.type = "button";
  disable.className = "button-secondary";
  disable.textContent = subscription.isActive ? "Disable" : "Disabled";
  disable.disabled = !subscription.isActive;
  disable.addEventListener("click", () => mutate(disable, "disable"));
  actions.append(sync, disable);
  item.append(content, actions);
  return item;
}

export async function mountIntegrations(): Promise<void> {
  const root = document.querySelector<HTMLElement>("[data-integrations]");
  const state = document.querySelector<HTMLElement>("[data-integration-state]");
  const form = document.querySelector<HTMLFormElement>(
    "[data-integration-create]",
  );
  const list = document.querySelector<HTMLUListElement>(
    "[data-integration-list]",
  );
  const empty = document.querySelector<HTMLElement>("[data-integration-empty]");
  if (!root || !state || !form || !list || !empty) return;
  const submission = bindSubmitEarly(form);
  const session = await resolveWorkspaceSession();
  if (session.status !== "ready") {
    state.textContent = "Your session could not be confirmed.";
    return;
  }
  if (session.session.member.role === "member") {
    form.remove();
    state.textContent =
      "Integration management requires workspace owner or administrator access.";
    return;
  }
  const workspaceId = session.session.workspace.id;
  const timePreferences = await loadTimePreferences(workspaceId);
  let inFlight = false;
  const load = async () => {
    const result = await getDavSubscriptions(workspaceId).catch(() =>
      undefined
    );
    if (!result?.ok) {
      state.textContent = result?.problem.detail ??
        "Integrations could not be loaded.";
      return;
    }
    const mutate = (
      subscription: Subscription,
      button: HTMLButtonElement,
      action: "disable" | "sync",
    ) => {
      if (inFlight) return;
      inFlight = true;
      button.disabled = true;
      state.textContent = action === "sync"
        ? "Synchronizing DAV…"
        : "Disabling DAV…";
      const operation = action === "sync"
        ? synchronizeDavSubscription(subscription.id, workspaceId)
        : disableDavSubscription(subscription.id, workspaceId);
      void operation.then(async (result) => {
        state.textContent = result.ok
          ? action === "sync"
            ? "DAV synchronization finished."
            : "DAV connection disabled."
          : result.problem.detail;
        if (result.ok) await load();
      }).catch(() => {
        state.textContent = "The DAV operation could not finish.";
      }).finally(() => {
        inFlight = false;
        if (button.isConnected) button.disabled = false;
      });
    };
    list.replaceChildren(
      ...result.value.subscriptions.map((subscription) =>
        render(
          subscription,
          timePreferences,
          (button, action) => mutate(subscription, button, action),
        )
      ),
    );
    empty.hidden = result.value.subscriptions.length !== 0;
    state.textContent = "DAV connection status is current.";
  };
  submission.handle(() => {
    if (inFlight) return;
    const data = new FormData(form);
    const button = form.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    );
    const name = data.get("name")?.toString().trim();
    const remoteUrl = data.get("remoteUrl")?.toString().trim();
    const username = data.get("username")?.toString().trim();
    const password = data.get("password")?.toString();
    if (!button || !name || !remoteUrl || !password) {
      state.textContent = "Enter a name, public HTTPS DAV URL, and secret.";
      return;
    }
    inFlight = true;
    button.disabled = true;
    state.textContent = "Adding DAV connection…";
    void createDavSubscription(
      { name, password, remoteUrl, ...(username ? { username } : {}) },
      workspaceId,
    ).then(async (result) => {
      state.textContent = result.ok
        ? "DAV connection added."
        : result.problem.detail;
      if (result.ok) {
        form.reset();
        await load();
      }
    }).catch(() => state.textContent = "The DAV connection could not be added.")
      .finally(() => {
        inFlight = false;
        button.disabled = false;
      });
  });
  await load();
}
