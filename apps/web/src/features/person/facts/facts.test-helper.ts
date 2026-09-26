/**
 * Test support for the fact islands: the shell's markup for a fact section,
 * the fact reads the API answers, and a mount over that shell. The fetch
 * stub, the profile fixtures, and the teardown come from `src/testing`.
 */

import type {
  PersonProfileSectionId,
  PersonProfileSummary,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import { jsonResponse } from "../../../testing/api.ts";
import {
  ids,
  personProfile,
  profileSummary,
  sectionProps,
} from "../../../testing/fixtures.ts";
import {
  drawShell,
  element,
  mountPending,
  mountSettled,
} from "../../../testing/render.tsx";
import type { SectionMount, SectionProps } from "../section-mounts.ts";

export const { person: personId, workspace: workspaceId } = ids;
export const revision = "2026-08-16T12:00:00.000000Z";
export const nextRevision = "2026-08-16T12:00:00.000001Z";

/** The `stubApi` key of every API route, for a suite answering from one handler. */
export const anyRoute = "* /api/v1/*";

/** A fact read answering `records` (with ids and revisions filled in). */
export function factRead(
  records: readonly object[],
  extra: Record<string, unknown> = {},
): Response {
  return jsonResponse({
    options: [],
    personUpdatedAt: revision,
    records,
    status: "ready",
    ...extra,
  });
}

/** A saved fact: `record`, moving the person to `personUpdatedAt`. */
export function factSaved(
  record: unknown,
  personUpdatedAt = nextRevision,
): Response {
  return jsonResponse({ personUpdatedAt, record, status: "saved" });
}

/** A deleted fact, moving the person to the next revision. */
export function factDeleted(): Response {
  return jsonResponse({
    factId: "deleted",
    personUpdatedAt: nextRevision,
    status: "deleted",
  });
}

/** A fact record of `section` holding `value`. */
export function fact(
  section: string,
  value: object,
  id: string = personId,
  extra: Record<string, unknown> = {},
) {
  return { id, section, updatedAt: revision, value, ...extra };
}

const RAIL_TITLES: Readonly<Record<string, string>> = {
  addresses: "Addresses",
  "contact-methods": "Contact methods",
  "first-meeting": "First meeting",
  "food-preferences": "Food preferences",
  pets: "Pets",
  work: "Work",
};

/** A rail fact block as `ProfileFactSection.astro` draws it. */
export function railBlock(section: string): string {
  const title = RAIL_TITLES[section]!;
  return `
    <section id="profile-section-${section}" class="profile-section-card profile-rail-block" data-profile-section="${section}" data-profile-fact-section="${section}" data-section-state="loading" tabindex="-1" aria-labelledby="profile-section-${section}-heading">
      <header class="profile-section-heading">
        <h3 id="profile-section-${section}-heading">${title}</h3>
        <span class="contents" data-rail-count-slot><span class="profile-rail-count" data-profile-rail-count hidden></span></span>
        <button data-profile-fact-add data-profile-fact-add-icon class="profile-rail-add" type="button" aria-label="Add ${title.toLowerCase()}" hidden><span aria-hidden="true">+</span></button>
      </header>
      <p data-profile-fact-state class="section-state" tabindex="-1"><span class="sr-only">Loading ${title.toLowerCase()}…</span></p>
      <ul data-profile-fact-list class="profile-fact-list" aria-label="Saved ${title.toLowerCase()}"></ul>
      <form method="post" data-profile-fact-form class="profile-fact-form" hidden novalidate></form>
    </section>`;
}

/** The tags editor beside the hero's tag preview, as `PersonHero.astro` draws it. */
export function tagsBlock(): string {
  return `
    <div class="person-hero-tags" data-profile-fact-section="tags" data-section-state="loading" aria-busy="true">
      <span class="contents" data-person-tags-slot><ul id="person-profile-tags" class="profile-tag-list" aria-label="Person tags"></ul></span>
      <p data-profile-fact-state class="section-state"><span class="sr-only">Loading tag assignments…</span></p>
      <button data-profile-fact-add type="button" hidden>Edit tags</button>
      <form method="post" data-profile-fact-form class="profile-fact-form" hidden novalidate></form>
    </div>`;
}

/** Draws the given blocks, with the application's toast region. */
export function shell(...blocks: readonly string[]): HTMLElement {
  drawShell(
    `<ul id="app-toasts"></ul><main id="person-profile-ready">${
      blocks.join("")
    }</main>`,
  );
  return element("#person-profile-ready");
}

/** The section element of `section`. */
export function block(section: string): HTMLElement {
  return document.querySelector<HTMLElement>(
    `[data-profile-fact-section="${section}"]`,
  )!;
}

/** The profile the page loaded: its summary, lifecycle, and hidden modules. */
export interface MountOptions extends Partial<PersonProfileSummary> {
  readonly archived?: boolean;
  readonly hidden?: readonly PersonProfileSectionId[];
}

function props(
  { archived = false, hidden = [], ...summary }: MountOptions,
): SectionProps {
  return sectionProps({
    archived,
    initial: personProfile({
      person: {
        profileSections: hidden.map((id) => ({ id, status: "hidden" })),
        updatedAt: revision,
      },
      status: archived ? "archived" : "ready",
      summary: profileSummary(summary),
    }),
  });
}

const start = (mount: SectionMount, options: MountOptions) => () =>
  mount(element("#person-profile-ready"), props(options));

/** Mounts `mount` over the shell, waits for its first read, and answers its unmount. */
export function mountFacts(
  mount: SectionMount,
  options: MountOptions = {},
): Promise<() => void> {
  return mountSettled(start(mount, options));
}

/**
 * Mounts `mount` without waiting for its first read, for a test that holds
 * the read back; the answer resolves once it has settled.
 */
export function mountFactsLater(
  mount: SectionMount,
  options: MountOptions = {},
): Promise<() => void> {
  return mountPending(start(mount, options));
}

/** The section named `section` in the URL of a fact request. */
export function sectionOf(url: URL): string | undefined {
  return /\/facts\/([^/]+)/.exec(url.pathname)?.[1];
}
