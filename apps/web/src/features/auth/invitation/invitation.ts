/**
 * Accepting a workspace invitation (AUTH-002; GAP-033).
 *
 * `pages/invite/[token].astro` is public and stays React-free. It draws the
 * heading, the status detail, every action hidden until this module wires
 * it (REL-041, REL-045), and the accepted answer's link as a `<template>`;
 * this module sets text, toggles `hidden`, and clones that template. The
 * bearer token leaves the address bar at once and reaches only the API and
 * the sign-in or sign-up handoff fragment.
 */

import {
  acceptWorkspaceInvitation,
  getSession,
  inspectWorkspaceInvitation,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import { setActiveWorkspace } from "../../../lib/workspace-context.ts";
import { cloneTemplate } from "../../shell/templates.ts";

/** The accepted invitation's way into its workspace. */
export const INVITATION_OPEN_TEMPLATE_ID = "invitation-open-template";

const SCRUBBED_INVITATION_PATH = "/invite/continue";
type Navigate = (path: string) => void;
const browserNavigate: Navigate = (path) => globalThis.location.assign(path);

function captureInvitationToken(): string | undefined {
  const fragmentToken = new URLSearchParams(
    globalThis.location.hash.slice(1),
  ).get("token");
  const pathToken = globalThis.location.pathname.match(/^\/invite\/([^/]+)$/)
    ?.[1];
  const raw = fragmentToken ??
    (pathToken === "continue" ? undefined : pathToken);
  if (fragmentToken || pathToken) {
    history.replaceState({}, "", SCRUBBED_INVITATION_PATH);
  }
  if (!raw) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return undefined;
  }
}

export async function mountInvitationAcceptance(
  navigate: Navigate = browserNavigate,
): Promise<void> {
  const heading = document.querySelector<HTMLElement>("#invitation-heading");
  const detail = document.querySelector<HTMLElement>("#invitation-detail");
  const actions = document.querySelector<HTMLElement>("#invitation-actions");
  const accept = document.querySelector<HTMLButtonElement>(
    "#accept-invitation",
  );
  const signIn = document.querySelector<HTMLAnchorElement>(
    "#invitation-sign-in",
  );
  const register = document.querySelector<HTMLAnchorElement>(
    "#invitation-register",
  );
  if (!heading || !detail || !actions || !accept || !signIn || !register) {
    return;
  }
  const continuing = globalThis.location.pathname === SCRUBBED_INVITATION_PATH;
  let token = captureInvitationToken();
  if (!token && !continuing) {
    heading.textContent = "Invitation unavailable";
    detail.textContent = "This invitation link is invalid.";
    return;
  }
  const inspected = await inspectWorkspaceInvitation(token).catch(() =>
    undefined
  );
  if (!inspected?.ok) {
    if (!inspected || inspected.problem.status < 500) token = undefined;
    heading.textContent = "Invitation unavailable";
    detail.textContent = inspected?.problem.detail ??
      "The invitation could not be checked. Try again.";
    return;
  }
  heading.textContent = `Join ${inspected.value.workspaceName}`;
  detail.textContent =
    `${inspected.value.email} was invited as ${inspected.value.role}. Sign in or create that account before accepting.`;
  const session = await getSession().catch(() => undefined);
  accept.hidden = !session?.ok && !continuing;
  signIn.hidden = session?.ok === true || continuing;
  register.hidden = session?.ok === true || continuing;
  signIn.href = "/auth/sign-in";
  signIn.addEventListener("click", (event) => {
    if (!token) return;
    event.preventDefault();
    const handoff = token;
    token = undefined;
    navigate(
      `/auth/sign-in#invite=${encodeURIComponent(handoff)}`,
    );
  });
  register.addEventListener("click", (event) => {
    if (!token) return;
    event.preventDefault();
    const handoff = token;
    token = undefined;
    navigate(`/auth/sign-up#invite=${encodeURIComponent(handoff)}`);
  });
  accept.addEventListener("click", async () => {
    if (!token && !continuing) return;
    accept.disabled = true;
    detail.textContent = "Accepting your invitation atomically…";
    const result = await acceptWorkspaceInvitation(token).catch(() =>
      undefined
    );
    if (result?.ok) {
      token = undefined;
      setActiveWorkspace(result.value.workspace.id);
      heading.textContent = `Welcome to ${result.value.workspace.name}`;
      detail.textContent =
        "Your active membership was created. This invitation cannot be used again.";
      const open = cloneTemplate(INVITATION_OPEN_TEMPLATE_ID);
      open?.querySelector("a")?.setAttribute("href", result.value.next);
      actions.replaceChildren(...open ? [open] : []);
      actions.hidden = false;
      return;
    }
    if (!result || result.problem.status < 500) token = undefined;
    accept.disabled = false;
    heading.textContent = "Invitation unavailable";
    detail.textContent = result?.problem.detail ??
      "The invitation could not be accepted. Try again.";
  });
  // Revealed only once the handoff above is wired: an earlier click on a
  // plain link would leave without the invitation.
  actions.hidden = false;
}
