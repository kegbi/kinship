/**
 * Stands in for `@radix-ui/react-dialog` in the web build (GAP-027).
 *
 * cmdk, which shadcn/ui's `command` wraps, attaches its own `Command.Dialog`
 * built on Radix Dialog, so bundling cmdk would ship Radix's dialog, focus
 * scope, dismissable layer, and scroll lock beside the Base UI primitives.
 * The palette renders `Command` inside Base UI's Dialog and never renders
 * `Command.Dialog`; `astro.config.mjs` aliases the Radix package here so
 * none of it ships. Rendering any part fails loudly instead.
 */

function unused() {
  throw new Error(
    "cmdk's Radix Command.Dialog is not used; compose Command inside the Base UI Dialog.",
  );
}

export const Root = unused;
export const Portal = unused;
export const Overlay = unused;
export const Content = unused;
