/**
 * The ids of the `<template>`s the person shell draws once and the
 * workspace clones (GAP-033). They live apart from the code that clones
 * them, so the shell's frontmatter imports two strings rather than the
 * modules that run the page.
 */

/** A rail editor's phone sheet, `dialog > h2`, cloned per opening. */
export const RAIL_DIALOG_TEMPLATE_ID = "profile-rail-dialog-template";

/**
 * The hidden-section notice's link to personalization, which an owner or
 * admin is offered.
 */
export const SECTION_NOTICE_LINK_TEMPLATE_ID =
  "person-section-notice-personalization";
