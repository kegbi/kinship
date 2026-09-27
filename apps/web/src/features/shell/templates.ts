/**
 * The ids of the `<template>`s the application layout draws once and the
 * shell's scripts clone (GAP-033). They live apart from the code that clones
 * them, so the layout's frontmatter imports strings rather than the modules
 * that run the page.
 */

/** One toast: `li.app-toast` with its message, action, and dismiss button. */
export const TOAST_TEMPLATE_ID = "app-toast-template";

/** One `<option>` of the member menu's workspace switcher. */
export const WORKSPACE_OPTION_TEMPLATE_ID = "workspace-option-template";

/** The access state's sign-in prompt, for a missing or lost session. */
export const ACCESS_SIGN_IN_TEMPLATE_ID = "access-sign-in-template";

/** The access state's retry prompt, for an unconfirmed session. */
export const ACCESS_UNAVAILABLE_TEMPLATE_ID = "access-unavailable-template";

/**
 * The access state's whole-route forbidden `<main>`, drawn with the default
 * (members) copy and given each page's own copy when cloned.
 */
export const ACCESS_FORBIDDEN_TEMPLATE_ID = "access-forbidden-template";

/**
 * A copy of template `id`'s content, or `undefined` on a page that does not
 * draw it.
 */
export function cloneTemplate(id: string): DocumentFragment | undefined {
  const template = document.getElementById(id);
  return template instanceof HTMLTemplateElement
    ? document.importNode(template.content, true)
    : undefined;
}
