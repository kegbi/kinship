/**
 * Test support for the fact islands: the shell's markup for a fact section,
 * a mount that waits for the first read, and a fetch stub that answers by
 * method and path.
 */

import { act } from "@testing-library/react";
import { vi } from "vitest";
import type {
  PersonProfile,
  SectionMount,
  SectionProps,
} from "../section-mounts.ts";

export const personId = "00000000-0000-4000-8000-000000000100";
export const workspaceId = "00000000-0000-4000-8000-000000000003";
export const revision = "2026-08-16T12:00:00.000000Z";
export const nextRevision = "2026-08-16T12:00:00.000001Z";

export function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

export function problem(status: number, detail = "Private failure details") {
  return response({
    code: "rejected",
    detail,
    status,
    title: "Rejected",
    type: "about:blank",
  }, status);
}

/** A fact read answering `records` (with ids and revisions filled in). */
export function factRead(
  records: readonly object[],
  extra: Record<string, unknown> = {},
): Response {
  return response({
    options: [],
    personUpdatedAt: revision,
    records,
    status: "ready",
    ...extra,
  });
}

/** A fact record of `section` holding `value`. */
export function fact(
  section: string,
  value: object,
  id = personId,
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
  document.body.innerHTML =
    `<ul id="app-toasts"></ul><main id="person-profile-ready">${
      blocks.join("")
    }</main>`;
  return document.querySelector<HTMLElement>("#person-profile-ready")!;
}

/** The section element of `section`. */
export function block(section: string): HTMLElement {
  return document.querySelector<HTMLElement>(
    `[data-profile-fact-section="${section}"]`,
  )!;
}

export interface MountOptions {
  readonly archived?: boolean;
  readonly hidden?: readonly string[];
  readonly primaryContactMethods?: readonly object[];
  readonly sectionCounts?: readonly object[];
}

/** The profile answer a page loaded, as the section mounts receive it. */
export function profile(options: MountOptions = {}): PersonProfile {
  return {
    dueInformation: { detail: "", openTaskCount: 0, status: "ready" },
    person: {
      givenName: "Ada",
      id: personId,
      isDeceased: false,
      isPartial: false,
      isSelf: false,
      isStarred: false,
      profileSections: (options.hidden ?? []).map((id) => ({
        id,
        status: "hidden",
      })),
      tagCount: 0,
      tags: [],
      updatedAt: revision,
    },
    status: options.archived ? "archived" : "ready",
    summary: {
      primaryContactMethods: options.primaryContactMethods ?? [],
      relationshipCounts: [],
      sectionCounts: options.sectionCounts ?? [],
    },
  } as unknown as PersonProfile;
}

const mounted: Array<() => void> = [];

function props(options: MountOptions): SectionProps {
  return {
    archived: options.archived ?? false,
    initial: profile(options),
    personId,
    workspaceId,
  };
}

function container(): HTMLElement {
  return document.querySelector<HTMLElement>("#person-profile-ready")!;
}

/** Mounts `mount` over the shell and waits for its first read. */
export async function mountFacts(
  mount: SectionMount,
  options: MountOptions = {},
): Promise<void> {
  await act(async () => {
    mounted.push(await mount(container(), props(options)));
  });
}

/**
 * Mounts `mount` without waiting for its first read, for a test that holds
 * the read back; the answer resolves once it has settled.
 */
export function mountFactsLater(
  mount: SectionMount,
  options: MountOptions = {},
): Promise<void> {
  let settled!: Promise<() => void>;
  act(() => {
    settled = mount(container(), props(options));
  });
  return settled.then((unmount) => {
    mounted.push(unmount);
  });
}

/** Unmounts every island a test mounted. */
export function unmountFacts(): void {
  act(() => {
    for (const unmount of mounted.splice(0)) unmount();
  });
}

type Handler = (
  url: URL,
  init: RequestInit | undefined,
) => Response | Promise<Response>;

/**
 * Stubs `fetch` with `handler`, which sees each request's URL and init, and
 * answers the recorded calls as "METHOD /path?query" lines.
 */
export function stubFetch(handler: Handler): {
  readonly calls: () => readonly string[];
  readonly bodies: () => readonly Record<string, unknown>[];
  readonly mock: ReturnType<typeof vi.fn>;
} {
  const mock = vi.fn((resource: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(resource), "http://localhost");
    return Promise.resolve(handler(url, init));
  });
  vi.stubGlobal("fetch", mock);
  return {
    bodies: () =>
      mock.mock.calls.flatMap(([, init]) =>
        (init as RequestInit | undefined)?.body
          ? [JSON.parse(String((init as RequestInit).body))]
          : []
      ),
    calls: () =>
      mock.mock.calls.map(([resource, init]) => {
        const url = new URL(String(resource), "http://localhost");
        return `${
          (init as RequestInit | undefined)?.method ?? "GET"
        } ${url.pathname}${url.search}`;
      }),
    mock,
  };
}

/** The section named `section` in the URL of a fact request. */
export function sectionOf(url: URL): string | undefined {
  return /\/facts\/([^/]+)/.exec(url.pathname)?.[1];
}
