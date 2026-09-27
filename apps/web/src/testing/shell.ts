/**
 * Test support: the `<template>`s and toast region the application layout
 * draws (GAP-033).
 *
 * `ApplicationLayout.astro` draws the permanent `#app-toasts` list and the
 * templates `features/shell/` clones; a suite that expects a toast, an access
 * answer, or a workspace option draws the same markup.
 * `features/shell/layout-markup.test.ts` proves the layout carries exactly
 * this markup, so the two cannot drift apart.
 */

import { buttonVariants } from "../components/ui/variants.ts";

const accessAction = buttonVariants({
  className: "mt-(--space-4)",
  shape: "pill",
});

/** The toast template, exactly as the layout draws it. */
export const TOAST_TEMPLATE =
  '<template id="app-toast-template"><li class="app-toast"><p class="app-toast-message"></p><button class="app-toast-action" type="button"></button><button class="app-toast-dismiss" type="button" aria-label="Dismiss notification"><span aria-hidden="true">×</span></button></li></template>';

/** The toast region, exactly as the layout draws it, with its template. */
export const TOAST_REGION =
  `<ul id="app-toasts" class="app-toasts" aria-live="polite" aria-label="Notifications"></ul>${TOAST_TEMPLATE}`;

/** The access state's three answers, exactly as the layout draws them. */
export const ACCESS_TEMPLATES = [
  `<template id="access-sign-in-template"><h1>Sign in to Kinship</h1><p>Your session is missing, expired, revoked, or no longer active in this workspace.</p><a class="${accessAction}" href="/auth/sign-in">Go to sign-in</a></template>`,
  `<template id="access-unavailable-template"><h1>Kinship is temporarily unavailable</h1><p>We could not confirm your active workspace. Any saved workspace choice is unchanged.</p><button class="${accessAction}" type="button">Try again</button></template>`,
  `<template id="access-forbidden-template"><main id="forbidden-main-content" tabindex="-1"><h1>You don’t have access to Members</h1><p>Only workspace owners and admins can view members and invitations.</p><a class="${accessAction}" href="/app/settings">Return to settings</a></main></template>`,
].join("");

/** The workspace switcher's option template, exactly as the layout draws it. */
export const WORKSPACE_OPTION_TEMPLATE =
  '<template id="workspace-option-template"><option></option></template>';
