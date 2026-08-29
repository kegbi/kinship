# Kinship UX & Design Review — 2026-08-29

Full-codebase review of the web experience from a design, usability,
information-architecture, route-coverage, and loading-strategy perspective,
benchmarked against the Monica 4.x UI and against Kinship's own product
documents (`docs/product/*`). Produced from two code-research passes (frontend
inventory, coverage gap analysis), a Monica UI reference pass, and one
design-critique pass.

## 1. Executive summary

**Coverage is excellent; composition is the problem.** The page catalog is
effectively 100 % implemented (the five dynamic routes exist via gateway URL
rewrites; the only missing cataloged page is the explicitly deferred billing
module), every API capability has a wired UI, all 30 user flows are delivered
with Playwright coverage, and the accessibility foundation (skip links, 78 live
regions, focus management, forced-colors support) is genuinely strong. What
makes the app feel worse than Monica is not missing features — it is **layout,
hierarchy, and loading**:

1. **The person page renders 22 peer cards of identical visual weight** in one
   long content column, with the left rail spent on a table of contents instead
   of on content. Monica's "organized" feel came from density contrast: dense
   fact blocks in a 25 % sidebar, roomy streams in a 75 % main column, vital
   stats in the hero. Kinship's own `information-architecture.md` already
   specifies the five-zone grouping that the implementation flattened — the
   redesign in §7 is _implementing the accepted IA_, not a new direction.
2. **~25–26 HTTP requests per person-page load**, three sequential round trips
   before the name paints, a full-page "Opening person…" takeover instead of a
   shell, no session cache across navigations, no skeletons, a duplicate
   contact-methods fetch, and eager prefetches on every page (one of which, on
   failure, disables the Quick-capture button app-wide). The eager fan-out
   violates the IA doc's own "load identity first, lazy-load history" rule.
3. **The design-doc-mandated global people search was never built** — the header
   grid even reserves the space for it. This is the one requirement gap not
   tracked anywhere.
4. **No design tokens**: ~190 hex literals (~60 distinct colors, including 14
   interchangeable muted greens and several small-text contrast failures around
   3.3:1), a 77 px display heading scale applied to app pages, Inter declared
   but never loaded, and no dark mode — all downstream of the missing token
   layer.
5. **React/Tailwind/shadcn are dead weight** in `package.json` — never wired
   into the build. Recommendation: remove them and keep the hand-rolled
   vanilla-TS + tokens direction (rationale in §10.6), amending the design doc's
   component-list clause.

**Critical path: tokens → person-page three-zone layout → staged loading →
feedback/empty states**, with same-day quick wins (dead section-nav links,
reduced-motion spinner, menu stubs, dead deps) shipped in parallel. Full ranked
roadmap in §12.

---

## 2. Scope & method

- **Frontend inventory** — every page under `apps/web/src/pages`, all three
  layouts, all `apps/web/src/lib/*.ts` client modules, all three stylesheets,
  gateway rewrites.
- **Coverage gap analysis** — `apps/api/*` route surface vs `apps/web`
  pages/libs vs `docs/product/page-catalog.yaml`, `user-flows.yaml`,
  `docs/planning/roadmap.md` / `active-delivery.md` (so known deferrals are not
  reported as surprise gaps).
- **Monica reference** — the contact page, dashboard, and settings screens of
  Monica 4.x.
- **Design critique** — layout, IA, perceived performance, visual system,
  feedback patterns.

---

## 3. Current implementation inventory

### 3.1 Route map & rendering strategy

Framework: Astro 7.2.0, `output: "server"` with the Node standalone adapter
(`apps/web/astro.config.mjs`), but **34 of 39 pages are `prerender = true`
static shells**. Only five pages are true SSR, and only because they set
`Cache-Control: private, no-store` headers: `auth/verify-email`,
`auth/reset-password`, `auth/mfa`, `invite/[token]`, and `app/compliance`.

All dynamic behavior is delivered by hand-written vanilla-TypeScript "mount"
modules in `apps/web/src/lib/` (~46 modules), attached via inline `<script>`
tags per page. **React, Tailwind, shadcn, `@base-ui/react`,
`class-variance-authority`, and `tailwind-merge` are all declared in
`package.json` but completely unused** — nothing is wired into
`astro.config.mjs`, no `.tsx` exists under `apps/web`, and no Tailwind directive
exists in any stylesheet. All CSS is hand-written.

Page groups (39 pages):

| Area                  | Pages                                                                                                                                                                                                      | Layout            |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| Public                | `/`, `/features`, `/privacy`, `/terms`, `404`                                                                                                                                                              | PublicLayout      |
| Auth                  | `sign-in`, `sign-up`, `forgot-password`, `reset-password`, `verify-email`, `mfa`                                                                                                                           | AuthLayout        |
| Invitation            | `/invite/[token]`                                                                                                                                                                                          | AuthLayout        |
| App core              | `/app` (Today), `/app/compliance`                                                                                                                                                                          | ApplicationLayout |
| People                | `/app/people`, `/app/people/new`, `/app/people/archived`                                                                                                                                                   | ApplicationLayout |
| Journal / Tasks       | `/app/journal`, `/app/tasks`                                                                                                                                                                               | ApplicationLayout |
| Settings              | hub + 15 sub-pages (`profile`, `preferences`, `personalization`, `security`, `members`, `api`, `audit`, `export`, `import`, `import/new`, `integrations`, `storage`, `workspace`, `workspace/danger-zone`) | ApplicationLayout |
| Dynamic-entity shells | `internal/person-profile-shell`, `journal-item-shell`, `activity-report-shell`, `person-audit-shell`, `import-report-shell`                                                                                | ApplicationLayout |

**Role gating is client-side only.** Admin/owner settings pages carry
`data-requires-workspace-admin` / `data-requires-workspace-owner` attributes;
`app-shell.ts` strips the DOM or renders a "forbidden" view _after_ the session
fetch resolves. The prerendered HTML itself ships to anyone. No sensitive data
is in the static HTML (data is all fetched post-auth), but the page
structure/labels of admin surfaces are publicly retrievable, and the gate
depends entirely on JS running.

### 3.2 The internal-shell / URL-rewrite pattern

The five `internal/*-shell.astro` pages are **not orphans** — they are the real
implementations of the catalog's dynamic routes, served via URL rewriting at two
layers:

- **Dev:** a Vite middleware (`apps/web/astro.config.mjs` +
  `apps/web/src/lib/dev-static-shell-route.ts`) rewrites `/app/people/<uuid>` →
  `/internal/person-profile-shell` (and the other four) before Astro's router
  sees the request.
- **Prod:** `gateway/nginx.conf:175-233` uses identical UUID regexes with
  `try_files /internal/<shell>/index.html` — no HTTP redirect, so the address
  bar keeps the pretty URL. Raw `/internal/*` paths return 404 publicly.

User-facing dynamic URL scheme (all functional):

| Pretty URL                              | Shell                 |
| --------------------------------------- | --------------------- |
| `/app/people/:personId`                 | person-profile-shell  |
| `/app/people/:personId/activity-report` | activity-report-shell |
| `/app/people/:personId/audit`           | person-audit-shell    |
| `/app/journal/:journalItemId`           | journal-item-shell    |
| `/app/settings/import/:importId`        | import-report-shell   |

Client scripts re-parse `location.pathname` to extract the UUID. Section
navigation on the person page (`?section=…`) is `history.pushState` +
`scrollIntoView`/`focus()` — never a real navigation, consistent with the
accepted rule in `docs/product/person-workspace.md` (one canonical route +
deep-linkable sections).

### 3.3 Navigation & layout chrome

`ApplicationLayout.astro` (159 lines) renders a **top bar only — no sidebar**:

- Brand "K Kinship" → `/app`
- Primary nav: **Today · People · Tasks · Journal** (`aria-current="page"`
  active state)
- Global actions: **Quick capture** button, **Add person** link
- Member menu popover: workspace name, **disabled "Profile" stub**, Settings
  link, **disabled "Help & what's new" stub**; Sign out
- Workspace switcher `<select>` — hidden unless the member has >1 workspaces
- A full-page access gate (`#access-state` "Opening Kinship…") hides the entire
  shell until the client-side session fetch resolves — on every page load

There are **no breadcrumbs** anywhere; detail pages have a single "← Back to X"
link. **There is no global search** in the shell — despite
`docs/product/dashboard-settings-design.md:19` mandating "a global people search
that can expand into command/search behavior" (see §5.3). Mobile: pure CSS
reflow — nav wraps to a horizontally scrollable row ≤1050px; three-row header
grid ≤760px; no hamburger/off-canvas.

Settings has **no persistent sub-navigation**: the hub (`/app/settings`) is a
searchable card directory (client-side text filter over `data-search`
attributes), and each of the 15 sub-pages is a standalone page whose only
wayfinding is "← All settings".

Every authenticated page also mounts a global quick-capture `<dialog>` which
**eagerly fetches `listPeople` (limit 20) + `listInteractionOptions` on every
page load**, whether or not the dialog is ever opened
(`interactions.ts:241-257`).

### 3.4 Person profile page today

`internal/person-profile-shell.astro` — 725 lines. Structurally the workspace
_is_ a two-column grid
(`.person-workspace-layout { grid-template-columns: minmax(13rem, 16rem)
minmax(0, 1fr) }`,
`application.css:1741`) — but the left rail holds only the **section-jump table
of contents**, while every piece of actual content sits in one long right-hand
column. Top to bottom:

1. "← Back to people" link
2. **Hero**: initials avatar, `<h1>` name, state badges
   (Favorite/Self/Deceased/Archived/Partial), description, tag chips
3. **Lifecycle panel**: Edit / Archive / Restore / Export vCard / Delete
   buttons + an inline (non-modal) edit form; native `<dialog>` for delete
   confirm with a manual focus trap
4. A single-line "Due information" summary
5. `<details open>` disclosure "Workspace sections" wrapping a section-jump nav
   (`?section=` anchors)
6. **All 22 sections stacked vertically, all always in the DOM, all visible at
   once**:
   `identity-summary, important-dates, contact-methods, addresses, relationships,
   first-meeting, work, food-preferences, pets, life-events, notes, conversations, calls,
   activities, tasks, reminders, stay-in-touch, gifts, debts, documents, photos,
   audit-summary`

Each section card: kicker + `<h2>` + state badge
(Loading/Ready/Error/Forbidden/Unavailable) + `role="status"` line + records +
an inline hidden add-form toggled by an "Add X" button. The tasks section
renders a full 3-column board (open/completed/cancelled) inside the stack.
Notes/activities buttons open the _global_ quick-capture dialog.

This is the structural root of the "less organized than Monica" complaint:
Monica splits the same content into a **hero + 25 % sidebar of profile facts +
75 % main column behind three tabs**, while Kinship spends its rail on link
labels and renders everything else as one undifferentiated ~22-card scroll. Two
sections' add-forms (`reminders`, `stay-in-touch`) also lack the `hidden`
attribute and are permanently open, unlike the other 20. And the section-nav
links for modules hidden via personalization are **dead**: clicking one updates
the URL via `pushState` but `focusSection` bails out on the hidden target —
nothing moves, nothing is announced (`profile-facts.ts:691`,
`people-profile.ts:243`). Confirmed defect.

### 3.5 Loading strategy

Person profile load sequence (`people-profile.ts:665-790`):

1. `resolveWorkspaceSession()` → `getSession()` (1 request; up to 3 on
   first-ever entry)
2. `getPerson()` — sequential, gated on session
3. Identity renders; `recordPersonView` fires (not awaited)
4. `Promise.all` of 11 section mounts firing **~23 parallel requests**:

| Mount                                                                     | Requests       | Notes                                                                                         |
| ------------------------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------- |
| profile facts                                                             | 7              | contact-methods, addresses, first-meeting, work, food-preferences, pets, tags — one call each |
| relationships                                                             | 2 (sequential) | types, then relationships                                                                     |
| interactions                                                              | 2              | activities + notes                                                                            |
| communications                                                            | 3              | communications, options, **contact-methods again — duplicate of the profile-facts fetch**     |
| gifts                                                                     | 3              | gifts + eagerly prefetches people list (limit 50) + files list for a form that may never open |
| important dates / tasks / reminders / files / life-events / audit-summary | 1 each         |                                                                                               |

**Total: ~25–26 HTTP requests per person-page load.** Plus the layout's own
session resolve (de-duplicated in-flight) and the quick-capture prefetch (2 more
requests on every page).

Other properties:

- **No caching across navigations** — the session is re-fetched from network on
  every page load; only the active-workspace _id_ persists (`sessionStorage`).
- **No skeletons** — every loading state is a text node ("Loading tasks…") in an
  `aria-live="polite"` region. One CSS spinner exists (people directory), and it
  is **not covered by the reduced-motion rule** (the rule only disables
  transitions/scroll-behavior).
- **No optimistic UI** — every mutation waits for the server before updating the
  DOM.
- Other pages are light: people directory = 2 parallel requests + cursor "load
  more"; journal = 1; tasks = 3; settings pages = 1 (+ session).

### 3.6 Styles & design-system state

- Three hand-written stylesheets: `application.css` (2,894 lines), `public.css`
  (657), `auth.css` (266). Semantic/BEM-ish classes, no utility framework.
- **Zero CSS custom properties.** Colors are dozens of hardcoded hex literals
  repeated inline (`#20352d`, `#f4f0e7`, `#a44730`, `#c88774`, …).
- `color-scheme` hardcoded to `light`; **no dark-mode support at all**.
- Font stack: `Inter, ui-sans-serif, system-ui` — but **Inter is never actually
  loaded** (no `@font-face`, no font link anywhere), so typography is silently
  platform-dependent (Segoe UI on Windows, SF on macOS). Display headings use
  Georgia at `clamp(2.6rem, 7vw, 4.8rem)` — up to **77 px** — on app pages
  including Settings.
- Desktop-first, `max-width: 1050px` / `760px` overrides.
- Positives: `forced-colors: active` focus-ring support; consistent focus
  styles.

### 3.7 States, feedback, accessibility

- Very consistent hand-rolled convention (~35+ occurrences): "Loading X…" →
  content or "No X recorded yet." → error copy ("…saved data was not changed") +
  Retry button; distinct 401/403 copy.
- **No toast/snackbar system.** All success/failure feedback is inline
  `role="status"` / `role="alert"` text adjacent to each form.
- Form UX: HTML5 validation attributes + server `ProblemDetails` field errors
  mapped to per-field `<small data-field-error>` + a top error summary on long
  forms.
- Accessibility is a genuine strength: skip links on all 39 pages, 78
  `aria-live`/`role=status|alert` occurrences, `tabindex="-1"` + programmatic
  focus after async loads, `aria-current` nav states, `aria-expanded/controls`
  popover wiring, native `<dialog>` usage. Gaps: the spinner animates under
  `prefers-reduced-motion`; only the delete dialog has an explicit focus trap.

---

## 4. Monica 4.x reference — what "organized" looked like

This covers the contact page, dashboard, shared header, and settings sidebar of
Monica 4.x.

### 4.1 Contact page layout

```
Breadcrumb (Dashboard > Contacts > Name)
┌──────────────────────────────────────────────────────────────┐
│ HERO (full width, centered): 115px avatar · name + ⭐ ·      │
│ job (company) · inline stat row: age · last activity ·       │
│ last called · description · stay-in-touch · tag chips        │
│ [Edit contact] pinned to corner                              │
├───────────────┬──────────────────────────────────────────────┤
│ LEFT 25%      │ MAIN 75% — 3-tab switcher (persisted pref):  │
│ weather       │  [Life events] [Other] [Photos]              │
│ love rel.     │  "Other" tab, fixed order, module-gated:     │
│ family rel.   │   Notes (always-visible quick-add textarea)  │
│ other rel.    │   Conversations                              │
│ pets          │   Phone calls                                │
│ contact info  │   Activities                                 │
│ addresses     │   Reminders                                  │
│ how you met   │   Tasks                                      │
│ work          │   Gifts                                      │
│ food prefs    │   Debts                                      │
│ ───────────   │   Documents                                  │
│ audit logs    │                                              │
│ vCard export  │                                              │
│ archive       │                                              │
│ delete        │                                              │
└───────────────┴──────────────────────────────────────────────┘
```

Key properties: profile _facts_ live in narrow sidebar blocks; _streams/logs_
live in the wide main column; the main column is tabbed with the active tab
persisted per user (`profile_active_tab`); modules can be toggled on/off in
Settings → Personalization → Modules (show/hide only — **order is fixed**, there
is no reordering). Each module embeds its own inline add control.

### 4.2 Dashboard

Recently-updated-contacts avatar row (70%) + "Add a contact" CTA (30%); then
50/50: reminders-grouped-by-month | changelog card + a tabbed log card (Recent
calls / Favorite notes / Debts / Tasks — lazy-loaded per tab, active tab
persisted) + a 3-stat row (# contacts / # activities / # gifts). Kinship
deliberately replaced this with the "Today" action queue
(`docs/product/dashboard-settings-design.md` — "not an analytics dashboard"), so
the dashboard difference is **by accepted design, not a gap**.

### 4.3 Contact list

75/25 split: sortable, searchable, paginated table (30/50/100 per page) | right
sidebar with Add CTA, archived link, **tag cloud with counts**, "untagged"
filter, deceased toggle. Kinship's directory has search, tag filter, and cursor
"load more", but no tag cloud sidebar, no sort options, no deceased toggle.

### 4.4 Nav chrome & settings IA

Monica's single nav bar contains a **global contact autosuggest search** (select
→ navigate; a synthetic "add person" result parses `"First Last <email>"` and
prefills the create form) plus Dashboard/Family/Journal links and
settings/changelog/logout icons. Settings uses a **persistent 12-item left
sidebar** (Settings, Personalization, Storage, Export, Import, Users,
Subscriptions, Tags, API, DAV, Audit logs, Security).

### 4.5 Feature checklist (Monica domain entities vs Kinship)

| Monica entity                                                 | Kinship status                                                               |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Contacts, archive, avatar-initials, vCard export              | ✅ full                                                                      |
| Contact fields / addresses / work / food / pets / how-you-met | ✅ (profile facts sections)                                                  |
| Relationships (+types)                                        | ✅                                                                           |
| Reminders / stay-in-touch                                     | ✅                                                                           |
| Tasks (account + person)                                      | ✅                                                                           |
| Gifts / Debts                                                 | ✅                                                                           |
| Activities / Calls / Conversations+messages / Notes           | ✅                                                                           |
| Journal (entries, day ratings)                                | ✅                                                                           |
| Life events                                                   | ⚠️ **read-only** (mutation deferred, tracked in roadmap)                     |
| Documents / Photos                                            | ✅ (shared file-upload sections)                                             |
| Tags                                                          | ✅ (managed via personalization vocabularies)                                |
| Audit logs (account + person)                                 | ✅                                                                           |
| Favorites (people)                                            | ❌ badge exists on profile; no toggle/list surfaced anywhere                 |
| Global contact search in header                               | ❌ **missing (untracked — see §5.3)**                                        |
| Module show/hide preference                                   | ❌ not implemented (planned as `workspace_profile_modules` per analysis doc) |
| Dashboard stats/changelog                                     | ➖ intentionally replaced by "Today"                                         |
| Contact groups                                                | ➖ intentionally excluded (tags cover taxonomy)                              |
| Billing/subscriptions                                         | ➖ explicitly deferred (`BILLING-001`)                                       |

---

## 5. Gap analysis

### 5.1 Page-catalog coverage

Effectively **100 % of `docs/product/page-catalog.yaml` is implemented** (34
cataloged pages). The five dynamic routes exist via the rewrite pattern (§3.2).
The only missing cataloged page is `settings.billing` — explicitly
`availability: optional-module` and withheld by Phase 10 `APP-010C`. All 30 user
flows in `user-flows.yaml` are `delivered` with matching Playwright specs except
`BILLING-001` (no status, empty testRefs — consistent).

### 5.2 API-to-UI coverage

Every `apps/api` module has a wired client lib and a mounting page — **no
orphaned backend capability**. The one asymmetry:
`GET /api/v1/people/:personId/life-events` is read-only in both API and UI
(`person-life-events.ts` renders only) — a documented deferral pending a flow ID
(roadmap Slice 6 / DG-07).

### 5.3 Untracked gaps (the real findings)

1. **Global people search / command palette is missing.**
   `docs/product/dashboard-settings-design.md:19` requires it in the
   authenticated shell; `ApplicationLayout.astro` has no search input; people
   search exists only inside `/app/people`. This is the only design-doc
   requirement that is unimplemented **and not listed in any deferred-gates
   register** (`traceability.md`, `release-slices.md`).
2. **Duplicate contact-methods fetch** on every person-page load
   (`communications.ts:197-201` re-fetches what `profile-facts.ts` already
   loaded).
3. **Eager prefetching**: quick-capture dialog fetches people+options on every
   authenticated page; gifts section prefetches people (limit 50) + files for an
   unopened form.
4. **No module visibility preference** — `person-workspace.md` planned
   `workspace_profile_modules` toggles; nothing implements them; all 22 sections
   render for every person unconditionally.
5. **`docs/planning/traceability.md` is stale** — claims zero delivered flows
   and 39 cataloged pages (actual: 30 delivered flows, 34 pages). Risk: future
   analyses over-report gaps.
6. **Reduced-motion rule doesn't stop the directory spinner**
   (`application.css:2818-2825` omits `animation`).
7. Minor: disabled "Profile" and "Help & what's new" stubs in the member menu
   (the second is a tracked deferral; the first is redundant with
   `/app/settings/profile`).

### 5.4 Known deferrals (not gaps — do not re-report)

Billing (`APP-010C`), operations/admin UI (`APP-010D`), life-event mutation
(Slice 6), AI-mediated CRM interaction (DG-08), multi-workspace switching
semantics, avatar management, help/what's-new, saved filters,
romantic-relationship metadata, external Monica API parity
(`release-slices.md:189-207`). `OPS-001E` (deployment rollout) is the only
unchecked Phase 0–11 leaf.

---

## 6. Design critique — why the person page feels disorganized

Two framing facts first:

- **The rail exists but is spent on wayfinding, not content.** The grid is
  already Monica-shaped (`minmax(13rem,16rem) | 1fr`); Monica's left 25 % held
  real facts (contact methods, relationships, addresses, work) while Kinship's
  holds 22 link labels. We built the wayfinding aid _for_ the disorganized stack
  instead of removing the disorganization.
- **The target grouping is already accepted.**
  `docs/product/information-architecture.md` (Person Workspace section) groups
  these exact fields into five zones: _Identity and orientation → Profile facts
  → History and communication → Planning and practical details → Administrative
  actions_. `person-profile-shell.astro:6-29` flattens that into 22 peers.

Specific causes of the "disorganized" feeling:

1. **22 peer cards, zero hierarchy.** Every section uses the same
   `.profile-section-card` (`application.css:1799`) — same padding
   `clamp(1.1rem, 3vw, 1.6rem)`, border, radius, background. "Food preferences"
   and "Notes" carry identical visual weight. Monica's organization came almost
   entirely from _density contrast_ (dense small blocks left, roomy content
   right); Kinship has one density.
2. **14 distinct editorial kickers create fake taxonomy.** The `.section-kicker`
   line reads "Available now", "Known exactly as stated", "Available profile
   fact", "Directional connections", "Precision-aware history", "Shared
   context", "Communication history", "Person planning", "Calendar planning",
   "Relationship rhythm", "Practical relationship detail", "Private person
   attachment", "Administrative history", "Person workspace section" — 14
   unrelated category names for 22 items. Deleting them costs nothing.
3. **The state badge is overloaded.** The same `.state-badge` carries load
   status ("Loading", "Ready") _and_ descriptive subtitles ("Calendar
   recurrence" `:476`, "Contact cadence" `:510`, "Open and completed" `:443`).
   The eye learns "badge = status", then hits a badge that is a subtitle.
   Restrict badges to status only.
4. **Destructive actions rank second on the page.** `Delete person` (`:85`) is a
   red button in the second block, above all content; the lifecycle panel
   (`:74-113`) gives five admin buttons a full card with its own `<h2>`.
5. **"Due information" is a card wrapping one sentence** (`:115-121`) — a
   `<section>`, kicker, and `<h2>` for a single status line. It is orientation
   data; it belongs in the hero.
6. **The page is narrower than the header.** `.page-frame` is `min(1040px, …)`
   (`application.css:409`) while `.header-row` is `min(1280px, …)` (`:211`).
   After the 16 rem rail + gap, content gets ~760 px — the rail consumes a
   quarter of an already-narrow page to show links.
7. **761–1050 px is the worst range.** The only person-layout collapse lives in
   `@media (max-width: 760px)` (`application.css:2684`); a 900 px tablet keeps
   the 16 rem TOC and gets a ~600 px content column.
8. **Two forms are permanently open** (`data-reminder-form` `:480`,
   `data-cadence-form` `:514` lack `hidden`), unlike the other 20 — a visible
   inconsistency users can't explain.
9. **Dead section-nav links** for personalization-hidden modules (§3.4) — URL
   changes, nothing happens.
10. **Scroll cost.** A populated person is ~5,000–7,000 px of scroll; jumping
    section 1 → 22 smooth-scrolls the entire way
    (`html { scroll-behavior: smooth }`, `application.css:12`).

---

## 7. Person page — target layout

Three zones, named to match `information-architecture.md` (no doc churn needed).

```
┌──────────────────────────────────────────────────────────────────────────┐
│ People / Sarah Chen                                        (breadcrumb)   │
├──────────────────────────────────────────────────────────────────────────┤
│ ┌────┐  Sarah Chen  ★ · "Sarah"            [Log interaction] [Note] [⋯]  │
│ │ SC │  Product designer at Northwind                                     │
│ └────┘  badges: Favorite · Partial identity · Archived (read-only)        │
│                                                                           │
│  Age 34 · b. 12 Mar   Last contact 6 d ago   Next reminder in 9 d         │
│  Stay in touch: every 3 months — due in 11 d      Met 2019 · via Tom      │
│                                                                           │
│  #climbing  #ex-colleague  #berlin                             [Edit tags]│
└──────────────────────────────────────────────────────────────────────────┘
┌── ZONE B: Profile facts (300px) ──┐┌── ZONE C: Streams (1fr) ────────────┐
│ Contact methods              (+)  ││ [ All ][Timeline][Planning][Things] │
│  ✉ sarah@…        📞 +49 …        ││  ┌───────────────────────────────┐  │
│  + 2 more                         ││  │ Add a note…            [Note ▾]│  │
│ Relationships                (+)  ││  └───────────────────────────────┘  │
│  Family · Partner: Tom            ││ ## Timeline                         │
│  Work · Colleague: Ana, Ben       ││  ▸ 14 Mar  Call · 12 min            │
│ Important dates              (+)  ││  ▸ 02 Mar  Note · "she got the…"    │
│ Addresses                    (+)  ││  ▸ 28 Feb  Life event · New job     │
│ Work                         (+)  ││  [Load older]                       │
│ Pets                         (+)  ││ ## Planning                         │
│ Food preferences             (+)  ││  Tasks (3 open) · Reminders (2)     │
│ First meeting                (+)  ││ ## Things                           │
│ Stay in touch                (+)  ││  Gifts (4) Debts (0) Docs Photos    │
└───────────────────────────────────┘└─────────────────────────────────────┘
```

### 7.1 Hero (full width)

Absorbs and deletes four current page-level blocks: the lifecycle panel
(`:74-113`), the due-information card (`:115-121`), the identity-summary card
(`:136-167`), and the standalone back link (`:54`). Contents, in DOM order:

1. `<nav aria-label="Breadcrumb">` — `People / {name}`. Replaces
   `← Back to people`, which is wrong when the user arrived from Today or
   search.
2. Avatar 96 px (72 px < 900 px, 56 px < 560 px) | identity block | action
   cluster.
   - Identity: `<h1>` name (Georgia, 2 rem — §10.3), nickname inline, then state
     badges. Keep all six existing badge ids (`:63-67`) so JS is unchanged; the
     favorite star becomes a _toggle_ once people-favorites ships.
   - Actions: **`Log interaction`** (primary; reuses `data-quick-capture` +
     `data-interaction-intended-kind`, already wired at `:396-400`),
     **`Add note`** (secondary), and a **`⋯` overflow menu** holding Edit
     person, Export vCard, Archive/Restore, Audit history, Delete person. Delete
     moves from "second thing on the page" to "third item in an overflow menu" —
     where an irreversible action belongs.
3. **Vital-stats strip** — a `<dl>` with
   `display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr))`,
   label above value, no card borders. This is the Monica element the complaint
   actually describes. Slots: Age/birthday · Last contact · Next reminder ·
   Stay-in-touch state (absorbs "Due information") · Work (title @ company) ·
   First met. Each value links to its `?section=…`.
4. Tag chips + `Edit tags` (existing `data-profile-fact-section="tags"` markup
   moves here from `:161-165`).
5. Archived people get a full-width `--warning-soft` banner directly under the
   hero: "This person is archived. Editing is disabled. [Restore]".

### 7.2 Zone B — Profile-facts rail (300 px, `position: sticky`)

Nine sections become compact blocks, ordered by frequency of use × Monica
parity:

| # | Section id         | Summary shown                                                               | Expand rule    |
| - | ------------------ | --------------------------------------------------------------------------- | -------------- |
| 1 | `contact-methods`  | primary per type (1 email, 1 phone) as `mailto:`/`tel:` links + copy button | `+ n more`     |
| 2 | `relationships`    | grouped by type, 5 max                                                      | `+ n more`     |
| 3 | `important-dates`  | next upcoming + birthday                                                    | `Show all (n)` |
| 4 | `addresses`        | first address, 3 lines                                                      | `+ n more`     |
| 5 | `work`             | current role only                                                           | `Show history` |
| 6 | `pets`             | names + species, one line                                                   | —              |
| 7 | `food-preferences` | 2-line clamp                                                                | `More`         |
| 8 | `first-meeting`    | date + place, 2-line clamp                                                  | `More`         |
| 9 | `stay-in-touch`    | cadence editor (state already in hero)                                      | —              |

Block chrome: `<h3>` at .95 rem + a **count** + a `+` icon-button (44×44,
accessible name "Add contact method"). No kicker, no `.state-badge`, no `<h2>`.
Padding `.875rem` vs the main column's `1.25rem` — that density delta is what
will read as "organized".

`identity-summary` (given/middle/family/nickname/gender) **stops being a visible
card** — the hero shows the name; those fields exist to be edited and live in
the Edit-person dialog. `?section=identity-summary` resolves by opening that
dialog (§7.4).

**Empty rail blocks collapse to a single muted row** — `Contact methods — add +`
— not a heading + badge + empty paragraph. On a freshly created person this is
the difference between nine tidy rows and nine empty cards.

### 7.3 Zone C — Streams (1fr)

Four groups, each a real `<h2>`, all present in one scroll under the "All"
state:

- **Timeline** — `life-events`, `notes`, `conversations`, `calls`, `activities`
  merged into one reverse-chronological list (the IA doc already asks for "a
  compact chronological projection across relevant person events"). Type-filter
  chips (`All · Notes · Calls · Conversations · Activities · Life events`)
  filter the merged list client-side. Five cards become one surface.
- **Planning** — `tasks`, `reminders`. Tasks: open list always visible;
  `Show completed (n)`; **cancelled behind a filter, not a third peer column**
  (currently `:456-461` gives Cancelled equal billing with Open).
- **Things** — `gifts`, `debts`, `documents`, `photos`. Photos as an 8-thumbnail
  grid + `View all (n)`.
- **Admin** — `audit-summary` + identity field list + Export vCard +
  Archive/Restore + Delete. Reached from the hero overflow menu, `?view=admin`.

Sections experienced by the user: 22 flat cards → **1 hero + 9 rail rows + 4
group headings**.

### 7.4 Switching model — a filter, not tabs

`dashboard-settings-design.md:251,260` says tabs are "only for views of the same
dataset" and forbids hiding unrelated datasets behind them;
`person-workspace.md` records that person sections are deliberately not tabs
that hide each other. So: a **segmented filter with "All" as the first-class
default**, not a tab set.

- Control: `<div role="group" aria-label="Filter person sections">` with five
  buttons — `All · Timeline · Planning · Things · Admin` — each `aria-pressed`.
  Not `role="tablist"`: the semantics are filtering, and screen-reader users are
  never told content vanished.
- Default `All`; the member's last choice persists in
  `member_preferences.ui_state` (the mechanism `person-workspace.md` already
  reserves for this).
- Selecting a group sets `?view=<group>` via `pushState` and applies `hidden` to
  the other groups (`hidden`, not a CSS class — keeps them out of the a11y tree
  and tab order).
- The control is **sticky** below the app header once the hero scrolls out; a 24
  px avatar and name appear alongside so the user always knows whose page this
  is (IntersectionObserver on the hero, ~15 lines).

**`?section=` deep links keep working** (non-negotiable per
`person-workspace.md`) via a static section→zone map:

```ts
const SECTION_ZONE: Record<PersonProfileSectionId, Zone> = {
  "contact-methods": "facts",
  addresses: "facts",
  relationships: "facts",
  "important-dates": "facts",
  work: "facts",
  pets: "facts",
  "food-preferences": "facts",
  "first-meeting": "facts",
  "stay-in-touch": "facts",
  "life-events": "timeline",
  notes: "timeline",
  conversations: "timeline",
  calls: "timeline",
  activities: "timeline",
  tasks: "planning",
  reminders: "planning",
  gifts: "things",
  debts: "things",
  documents: "things",
  photos: "things",
  "audit-summary": "admin",
  "identity-summary": "admin",
};
```

Resolution order in `focusSection` (`people-profile.ts:239`): activate the zone
if the current filter hides it (the only new step) → trigger/await the zone's
lazy load → `scrollIntoView` + `focus({ preventScroll: true })` (unchanged).
Timeline sub-sections (`?section=calls`) additionally set the matching
type-filter chip.

**Fix the dead-link defect simultaneously:** remove nav entries for
personalization-hidden sections; if one is deep-linked, render an inline notice
— "Calls are turned off for this workspace. [Open personalization]" — never
silently swallow the click. Scope `scroll-behavior`: smooth for in-zone hops,
`instant` for cross-zone jumps.

### 7.5 Grid, breakpoints, collapse order

Widen the person page first:
`.people-profile-page { width: min(1280px, calc(100% - 2rem)) }` to match
`.header-row`.

```css
/* ≥ 1200px */
.person-workspace-layout {
  grid-template-columns: minmax(280px, 320px) minmax(0, 1fr);
  gap: 1.5rem; /* rail ≈ 24%, main ≈ 76% — Monica's 25/75 */
}
/* 900–1199px */
@media (max-width: 1199px) {
  .person-workspace-layout {
    grid-template-columns: minmax(240px, 260px) minmax(0, 1fr);
    gap: 1.25rem;
  }
}
/* < 900px — single column, DOM order preserved */
@media (max-width: 899px) {
  .person-workspace-layout {
    grid-template-columns: 1fr;
  }
  /* fact blocks 4–9 inside a closed <details> "More profile facts" */
  .zone-switcher {
    position: sticky;
    top: 3.5rem;
    overflow-x: auto;
    scroll-snap-type: x proximity;
  }
}
/* < 560px */
@media (max-width: 559px) {
  .person-profile-avatar {
    width: 3.5rem;
  }
  .person-profile-heading h1 {
    font-size: 1.6rem;
  }
  .vital-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
```

**Mobile order is DOM order — no CSS `order` tricks**
(`information-architecture.md` makes DOM order contractual, and `order` desyncs
focus from visuals). Stacking gives: hero → contact methods → relationships →
important dates → `<details>` "More profile facts" (blocks 4–9, closed) → sticky
zone switcher → streams. Right order for a phone: you open a person to _reach_
them.

### 7.6 Summary-first for heavy sections

| Section         | Summary state                                                           | Detail on demand                                          |
| --------------- | ----------------------------------------------------------------------- | --------------------------------------------------------- |
| Timeline        | 20 newest, each a `<details>` collapsed to date + type + 2-line excerpt | expand in place; `Load older` via existing cursor pattern |
| Photos          | 8 thumbnails, `loading="lazy"`                                          | `View all (n)`; fetch only on first "Things" activation   |
| Documents       | 5 rows + count                                                          | `Show all (n)`                                            |
| Tasks           | open only                                                               | `Show completed (n)`; cancelled via filter                |
| Relationships   | 5, grouped by type                                                      | `+ n more`                                                |
| Contact methods | primary per type                                                        | `+ n more`                                                |
| Audit           | 5 events + link to full history                                         | already close                                             |

### 7.7 Quick-add placement

- Hero: `Log interaction` (primary) + `Add note` — the two highest-frequency
  writes.
- Timeline: **always-visible composer at the top** — kind selector
  (Note/Call/Conversation/Activity) + one textarea + date defaulted to now +
  Save. Monica's always-open note box is a large part of its "usable"
  impression. Reuses the existing capture submit path.
- Planning/Things: one `Add …` button per block header.
- Rail: `+` icon-button per block; editor opens inline on desktop, as a bottom
  sheet (`<dialog>` with `inset: auto 0 0 0`) under 900 px.
- **One open editor per column at a time**; give reminders + stay-in-touch the
  `hidden` attribute so all 22 forms behave identically.

---

## 8. Navigation & IA

**Top bar vs sidebar — keep the top bar.** Four primary destinations; depth
lives inside People; a four-item sidebar is a permanent 240 px width tax.
`dashboard-settings-design.md:16-23` specifies exactly this shell — the defect
is that the shell is missing two of the five things that doc requires.

**Global search — the largest untracked gap.** `.header-row` reserves
`minmax(24rem, 1fr)` for the middle track (`application.css:209`) and fills it
with four nav links; that track was sized for the search field that was never
built. Target: `grid-template-columns: auto auto minmax(20rem, 1fr) auto` (brand
| nav | search | actions).

Design:

- **Entry:** header input, placeholder "Search people…". `Ctrl/Cmd+K` opens a
  centered palette overlay; `/` focuses the header input (ignored while an
  input/textarea/contenteditable has focus). Under 1050 px the input becomes an
  icon button opening the same full-screen palette.
- **Scope v1:** people only — `listPeople({ search, limit: 8 })` already exists
  (used by relationship search and quick-capture participant search).
- **Behavior:** 200 ms debounce, min 1 char, `AbortController` per keystroke
  (pattern already in `communications.ts`). Rows: initials avatar + name +
  secondary line (nickname · last contact). ↑/↓ move, Enter navigates to
  `/app/people/:id`, Esc closes and restores focus.
- **Empty query:** show the 5 most recently viewed people (the read model
  already powers Today's "Recently viewed") — the palette feels instant before a
  key is pressed.
- **Monica's synthetic add-result:** on no exact match, append
  `Add "Marie Dupont" as a new person` →
  `/app/people/new?givenName=Marie&familyName=Dupont`, with `people-create.ts`
  prefilling from those params. High delight, ~20 lines.
- **A11y:** `role="combobox"` + `aria-expanded/controls/activedescendant` over a
  `role="listbox"`; polite live region announcing "n people found"; "No people
  match" is an empty state, not an error.
- **v2 command mode:** `>` prefix (or zero matches) surfaces actions — Log
  interaction, Add task, settings destinations from the index
  `settings/index.astro` already declares. The doc's phrase is "can expand into
  command/search behavior"; leave room at v1.

**Breadcrumbs vs back links.** Breadcrumbs only where hierarchy is ≥2 deep
(`People / Sarah Chen`, `People / Sarah Chen / Audit history`,
`Settings / Personalization`); back links elsewhere. The current
`← Back to people` is actively wrong when the user arrived from Today or search.

**Settings.** Not an open question: `dashboard-settings-design.md:133-156`
already mandates a sticky 240–280 px grouped nav with content capped at 760–880
px. Generalize the existing `.personalization-layout` two-column grid
(`application.css:~2583`) into `.settings-layout`, apply to all subpages; keep
`/app/settings` as the mobile index and the host for settings search.

**Member menu & chrome fixes** (`ApplicationLayout.astro:81-97`):

- `Profile — Available from settings` is **not unavailable** —
  `/app/settings/profile` exists. Make it a link; a dead item pointing at a live
  page teaches users the menu lies.
- Remove `Help & what's new — Support is being prepared` until something exists.
- Replace the trigger's literal "Member menu" label with the member's initials
  avatar + name, `aria-haspopup="menu"`.
- Move the permanently visible red `Sign out` button (`.direct-sign-out`,
  `application.css:358`) inside the popover as the last item.
- Fold the workspace switcher into the popover (which already shows "Active
  workspace"); today it injects a second header row that changes header height
  between accounts.

**Mobile nav.** The horizontally scrollable row at ≤1050 px is the right call
for four items — better than a hamburger, and satisfies
`dashboard-settings-design.md:28-30`. Two fixes:
`scroll-snap-type: x proximity` + edge fades; below 560 px collapse
`Quick capture` + `Add person` into one `+` primary button with a two-item menu
so the header doesn't wrap to three rows.

---

## 9. Loading strategy & perceived performance

### 9.1 What is wrong

- **Three sequential round trips before the name paints**
  (`people-profile.ts:674` session → `:682` `getPerson` → `:710-788` fan-out).
  At 150 ms RTT that's ~450 ms of a **full-page "Opening person…" takeover** — a
  blank page, not a loading page.
- **Session refetched on every navigation** — `workspace-context.ts:72-79`
  memoizes only the in-flight promise. Every page is a full document load, so
  `/session` hard-blocks all 34 pages.
- **~23 responses land in arbitrary order into `aria-live="polite"` regions.**
  The sharpest finding: the a11y strength becomes an a11y _cost_ on load — a
  screen-reader user hears ~20 "…is loading" / "…5 saved" / "No pets saved"
  announcements in random order, none user-initiated. Live regions should
  announce changes the user caused, not initial render.
- **No skeletons → ~23 layout shifts** ("Loading X…" is one line; resolved
  content is 1–10 rows).
- **Measured waste:** duplicate contact-methods fetch (`communications.ts:200`);
  gifts prefetching people + files for a maybe-never-opened form; quick-capture
  prefetching `listPeople` + `listInteractionOptions` on **every** authenticated
  page (`interactions.ts:250-257`) — and on prefetch failure it runs
  `opener.disabled = true`, i.e. **a transient failure of an unused prefetch
  disables the primary Quick-capture action app-wide**. That is a robustness
  bug, not a perf nit.
- 20 of the 23 requests serve below-the-fold content — which
  `information-architecture.md` already forbids ("Load the identity summary and
  high-value due information first. Large history, files, photos, and reports
  may load lazily in focused islands"). The eager fan-out is a contract
  violation, making this an easy sell.

### 9.2 Staged design (vanilla TS, no framework)

- **Stage 0 — 0 ms, shell.** Kill the full-page takeover; render hero + rail +
  main skeletons immediately; reserve `#person-profile-state` for terminal
  states (forbidden/not-found/unavailable).
- **Stage 1 — session, cached.** Persist the resolved `SessionContext` to
  `sessionStorage` (`kinship.session`, 60 s TTL) in `workspace-context.ts`; use
  optimistically, revalidate in background, fall through to the existing
  access-lost path on 401. ~20 lines; removes one full RTT from every page in
  the app.
- **Stage 2 — one request above the fold.** `getPerson` already returns
  identity + `dueInformation` + `profileSections`; paint the hero from it. **The
  one backend ask:** extend it (`?include=summary` or a `/people/:id/overview`
  read model) with primary contact methods (≤3), next reminder, stay-in-touch
  state, relationship counts, and **a record count per section** — counts are
  what make "summary first" possible (`Notes (12)` without fetching a list).
- **Stage 3 — visible zone only.** Rail (profile-facts is already one batched
  call — keep that) + default zone's sources: ~3–5 requests.
- **Stage 4 — deferred.** Other zones load on first activation or deep-link;
  rail blocks below the fold via
  `IntersectionObserver({ rootMargin: "400px" })`; files, photos, gifts, debts,
  audit never load unless Things/Admin opens.

The refactor is mechanical: the `Promise.all` array at
`people-profile.ts:710-788` becomes a zone registry (`register(zone, mount)` /
`activate(zone)` — run once, resolve waiters). Every mount already takes
`(personId, workspaceId, …)`, so nothing inside them changes. Move
`recordPersonView` (`:700`) behind `requestIdleCallback`.

**Net: ~26 → ~5 requests to first meaningful paint; ~8 for a fully explored
session.**

### 9.3 Skeletons

```css
.skeleton {
  background: linear-gradient(90deg, var(--surface-2) 0%, var(--surface-3) 50%,
    var(--surface-2) 100%);
  background-size: 200% 100%;
  animation: skeleton-sweep 1.4s ease-in-out infinite;
  border-radius: var(--radius-sm);
}
@media (prefers-reduced-motion: reduce) {
  .skeleton {
    animation: none;
  }
}
```

Shapes: `.skeleton-line` (.9 rem; 100/80/60 % widths), `.skeleton-avatar`,
`.skeleton-chip`. Rules: skeletons only for **initial** load of a region with
predictable height (refreshes keep text states); skeleton nodes
`aria-hidden="true"` with the container `aria-busy="true"` and "Loading X…"
moved to an `sr-only` node; **set `aria-live` on section state paragraphs via JS
after first paint** so the initial fan-out is silent and user-initiated
refreshes still announce.

### 9.4 Optimistic UI — only where safe

Safe (single-field, server-authoritative, trivially reverted): favorite toggle;
task complete/reopen (flip + move row, revert with inline error);
note/quick-capture (prepend with `aria-busy` + muted style, replace with server
record); reminder and cadence saves. **Not** optimistic: anything threading
`expectedUpdatedAt` that can legitimately 409 — person edit
(`people-profile.ts:494-501`), archive/restore, relationship writes. The
optimistic-concurrency discipline is a strength; don't paper over conflicts.

### 9.5 Client-side-only role gating

Consequences: (a) on slow devices a non-admin sees a flash of admin UI before JS
strips it; (b) the _shape_ of admin surfaces ships to every authenticated
visitor. Not a data breach (the API authorizes independently;
`information-architecture.md` says "hiding a link is not authorization"), but an
information-disclosure smell and a late-arriving forbidden state. Cheap fix:
render gated regions inside `<template>` (parser-inert — no flash, no
focusability) and clone in after the session resolves; set `data-role` once on
the shell. If admin surfaces grow, move those routes to on-demand rendering (the
IA doc permits "Exceptional personalized first paint … by ADR").

---

## 10. Visual design system

### 10.1 Palette — good intent, undisciplined execution

The intent is worth protecting: warm paper ground `#f4f0e7`, near-white card
`#fffdf8`, deep forest ink `#20352d`, terracotta accent `#a44730` — a
distinctive, calm, non-SaaS palette suited to a personal-relationships product.

The execution: ~190 hex literals resolving to ~60 distinct values —

- **14 near-identical muted greens** for secondary text:
  `#425148 #4e6256 #536159 #56645d
  #5d6862 #5e6b64 #617069 #65716b #66736c #68756e #748078 #758078 #809087`.
  Accidents, not decisions.
- **9 off-white/cream surfaces**; **12 borders**; **6 accent reds**; one orphan
  teal `#35796b`.
- **Contrast failures to audit while tokenizing:** `#809087` on `#fffdf8` ≈
  **3.3:1** at .72–.82 rem text (needs 4.5:1); `#758078`/`#748078` are
  borderline.

### 10.2 Token set (~28 vars) — do this first

```css
:root {
  --ink-1: #20352d;
  --ink-2: #4a5a52;
  --ink-3: #6b7a72;
  --ink-inverse: #fffdf8;
  --surface-page: #f4f0e7;
  --surface-1: #fffdf8;
  --surface-2: #faf8f2;
  --surface-3: #f0ece4;
  --surface-sunken: #ece5d8;
  --line-1: #ded9cd;
  --line-2: #c8ccc5;
  --line-strong: #aeb7ae;
  --accent: #a44730;
  --accent-hover: #923d2e;
  --accent-soft: #fff1eb;
  --accent-line: #e4c5aa;
  --positive: #35796b;
  --positive-soft: #e8eee8;
  --warning: #7b4c00;
  --warning-soft: #f8e8b7;
  --danger: #9d2c2c;
  --danger-strong: #701d1d;
  --danger-soft: #fff1f0;
  --focus-ring: #a44730;
  --radius-sm: .55rem;
  --radius-md: .7rem;
  --radius-lg: 1rem;
  --radius-pill: 999px;
  --shadow-1: 0 .4rem 1.8rem rgb(45 55 46/7%);
  --shadow-2: 0 1.25rem 3rem rgb(32 53 45/18%);
  --space-1: .25rem;
  --space-2: .5rem;
  --space-3: .75rem;
  --space-4: 1rem;
  --space-5: 1.5rem;
  --space-6: 2rem;
  --space-7: 3rem;
  --space-8: 4rem;
}
```

Then a mechanical replace pass over the three stylesheets with a short manual
pass on the borderline greens. **Nothing else in this document should ship
before this** — it is the prerequisite for dark mode and makes the person-page
rewrite cheaper.

### 10.3 Typography

Two real problems: **(a) Inter is never loaded** — decide explicitly: self-host
Inter variable (woff2, `font-display: swap`, latin subset) in
`apps/web/public/fonts/`, or drop the name and design for the system stack.
Don't leave it aspirational. **(b) The display scale is a marketing scale** —
`clamp(2.6rem, 7vw, 4.8rem)` (`application.css:127-136`) puts a 77 px serif
"Settings" on an information-dense workspace.

Keep Georgia (a genuine asset against generic Inter-everything), restricted to
marketing/auth and the person's name:

| Role                       | Spec                                                        |
| -------------------------- | ----------------------------------------------------------- |
| Display (public/auth only) | Georgia, `clamp(2.4rem, 5vw, 3.4rem)`, 500                  |
| Page `h1`                  | Georgia 1.75 rem / 1.15, 500                                |
| Person name (hero)         | Georgia 2 rem / 1.1, 500 — the one place emphasis is earned |
| Group `h2`                 | Inter 1.15 rem / 1.3, 700                                   |
| Block `h3`                 | Inter .95 rem / 1.35, 700, `letter-spacing: .01em`          |
| Body                       | .95 rem / 1.5                                               |
| Meta                       | .82 rem / 1.45, `--ink-2`                                   |
| Micro (badges)             | .72 rem / 1.3, uppercase for status badges only             |

Also: `font-weight: 750` appears on nearly every control and link
(`application.css:55,
147, 158, 1458, 1507, 1783`); without a variable font it
silently rounds to 700, and applied everywhere it emphasizes nothing. Use 600
for controls, 700 for headings.

### 10.4 Spacing

Current values span `.1 … 1.5rem` in 17 arbitrary steps. Snap to the 4 px scale
(`--space-1…8`); `clamp()` only for page-level padding. Introduce **two card
densities** — `--pad-card: 1.25rem` (main column), `--pad-block: .875rem`
(rail). Today's uniform `clamp(1.1rem, 3vw, 1.6rem)` on every card is a direct
cause of the flat feel.

### 10.5 Dark mode

Blocked on tokens; afterwards it is one ~28-line override block per mechanism
(`prefers-color-scheme` + `[data-theme]`). Keep the warm bias rather than
flipping to neutral grey: `--surface-page:#121915`, `--surface-1:#1a231e`,
`--surface-2:#202b25`, `--ink-1:#e8e5dc`, `--ink-2:#b3bdb6`; terracotta lightens
to `#d0715a` for legibility. Remove `color-scheme: light` (`application.css:2`);
pair `<meta name="theme-color" media="(prefers-color-scheme: …)">` (currently
hardcoded at `ApplicationLayout.astro:48`). The explicit toggle belongs in
`settings.preferences`, which already owns "display density" per
`dashboard-settings-design.md:168`.

### 10.6 Dead dependencies — one direction: **remove**

Remove `react`, `react-dom`, `@astrojs/react`, `@base-ui/react`, `shadcn`,
`tailwindcss`, `@tailwindcss/vite`, `tailwind-merge`,
`class-variance-authority`, `clsx`, `@types/react`, `@types/react-dom`,
`eslint-plugin-react-hooks`. **Keep** `eslint-plugin-jsx-a11y` — live via
`astro.configs["flat/jsx-a11y-recommended"]` (`eslint.config.js:6`). Removal is
essentially free: neither `@astrojs/react` nor `@tailwindcss/vite` is registered
in `astro.config.mjs` — it's `pnpm remove` + lockfile.

Why remove rather than adopt:

1. **The test suite is the real cost** — ~14,000 lines of vitest assert against
   DOM built by `document.createElement` in the mount modules
   (`interactions.test.ts` alone is 2,915 lines). Adopting shadcn means
   rewriting the UI _and_ the tests protecting it.
2. **The a11y posture is hand-tuned and good**; swapping in `@base-ui` replaces
   known-good behavior with a second a11y model to re-verify from zero.
3. **Zero-hydration static shells are an architectural asset** for a
   privacy-oriented CRM.
4. **Tailwind wouldn't solve the actual problem** — the real defect is no
   tokens, fixed by 28 custom properties.

**Honest caveat:** `dashboard-settings-design.md:249-254` names shadcn/ui
components. That must be **amended, not silently violated** — replace the
component list with equivalent Kinship primitives (button, card, badge,
breadcrumb, segmented filter, dialog, sheet, menu, table, skeleton), keeping
every accessibility clause verbatim.

### 10.7 CSS organization + one-line bug

Split `application.css` into `tokens.css`, `base.css`, `shell.css`,
`components.css`, `person.css`, `settings.css` (imported from `application.css`;
Vite bundles anyway) — a 2,894-line file makes the person-page rewrite
unreviewable in diff.

Bug: the reduced-motion rule (`application.css:2818-2825`) resets `transition`
and `scroll-behavior` but **not `animation`** — `.directory-loading-mark` keeps
spinning for users who asked it not to. Add
`animation-duration: .01ms !important;
animation-iteration-count: 1 !important;`.
Matters more once skeletons exist.

---

## 11. Feedback & states

**Inline vs toasts — both, with a written rule.** Keep inline `role="status"`
next to forms as the record of truth (`dashboard-settings-design.md:232` rightly
forbids toast-only feedback for security/import/export). Add a toast region
**only** for actions whose result is off-screen or undoable. The infrastructure
is 90 % built: `.sr-status` (`application.css:383-396`) is already a fixed
bottom-right dark box with `role="status"` — promote it to `#app-toasts`: a
`<ul>` of dismissible items, `aria-live="polite"`, auto-dismiss 6 s (**never**
for errors), max 3 stacked, pause on hover/focus, keyboard-reachable dismiss.
Rule: _destructive or undoable → toast with Undo ("Archived Sarah Chen.
[Undo]"); form save → inline; blocking failure → inline, persistent._

**Empty states — the biggest first-impression fix after layout.** Today they are
single honest sentences ("No X recorded yet.") — good tone, zero teaching. A
**brand-new person is currently 22 identical cards each saying nothing — the
worst-looking screen in the product, and the one every new user sees first.**

- **Person-level first-run:** when a person has zero records anywhere, replace
  the stream zones with one onboarding card offering the three highest-value
  first actions — _Log how you met · Add a birthday · Set a stay-in-touch
  cadence_ (mirroring the Today success loop, `app.astro:36-41`).
- **Rail-level:** empty blocks collapse to one muted `Add contact method +` row.
- **Section-level:** one sentence + the add button + a muted example where it
  helps (Debts: _"Track money lent or borrowed — e.g. 'Lent 40 EUR for concert
  tickets'"_).

**Form UX.** The hidden-form-toggled-in-place pattern is right (keeps context,
no modal). Three fixes: (a) **no dirty-state protection** — required by
`dashboard-settings-design.md:224-226`; add `beforeunload` + intercepted in-page
navigation; (b) opening one form doesn't close others — enforce one per column;
(c) the two never-closing forms (§6.8). Keep `novalidate` + server
`ProblemDetails` mapping, but wire field-level `aria-invalid` +
`aria-describedby` and always focus the first invalid control from the error
summary.

**Error recovery.** Keep the hidden-Retry pattern; three upgrades: (1) don't
offer Retry on terminal 403/404 — only network/5xx; (2) failed sections get a
distinct `--danger-soft` treatment so they don't read as empty states; (3) when
≥3 sections fail, surface one page-level "Some sections could not load — [Retry
all]".

---

## 12. Prioritized roadmap

Impact = user-facing value. Effort: S ≤ 1 day, M = 2–5 days, L = 1–3 weeks.

### Do first (top 5)

| #     | Item                                                                                                                                                                                                         | Impact                                                                                                              | Effort | Depends on                                            |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------- |
| **1** | **Design tokens** — 28 CSS vars + mechanical replace across 3 stylesheets; fix the ~3.3:1 contrast failures in the same pass                                                                                 | High (unblocks 3 later items; fixes real contrast bugs)                                                             | M      | —                                                     |
| **2** | **Person page three-zone layout** — hero absorbs lifecycle/due/identity; 9 fact blocks → rail; 13 stream sections → 4 groups; zone filter; `?section=` mapping; delete 14 kickers; demote Delete to overflow | **Highest** — this is the stakeholder complaint                                                                     | L      | 1 (cheaper), 6 (dead links)                           |
| **3** | **Staged loading** — session cache, skeletons, lazy zones; kill duplicate contact-methods fetch, gifts prefetch, global quick-capture prefetch; silence initial live regions                                 | High — ~26 → ~5 requests to first paint; fixes the announcement storm and the prefetch-failure-disables-capture bug | M      | 2 for zone laziness; the deletions ship independently |
| **4** | **Global people search + ⌘K palette** — incl. Monica-style synthetic "Add … as a new person" row                                                                                                             | High — untracked design-doc gap; header track already reserved                                                      | M      | —                                                     |
| **5** | **Feedback pass** — promote `.sr-status` to a toast region with Undo; skeleton primitives; person-level first-run empty state; dirty-state guard                                                             | High — fixes the worst screen (empty person) and least-recoverable actions                                          | M      | 1, 3                                                  |

### Then

| #  | Item                                                                                                                                                                                                                                  | Impact                                             | Effort  | Depends on |
| -- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------- | ---------- |
| 6  | Fix dead section-nav links for personalization-hidden modules + inline "turned off" notice                                                                                                                                            | Med (correctness bug)                              | **S**   | —          |
| 7  | Quick-wins bundle: reduced-motion `animation` fix; enable Profile menu link; delete Help stub; move Sign out into popover; fold workspace switcher into popover; widen person frame to 1280 px; `hidden` on the two always-open forms | Med                                                | **S**   | —          |
| 8  | Settings persistent sidebar (generalize `.personalization-layout`)                                                                                                                                                                    | Med — closes an accepted-doc gap                   | M       | 1          |
| 9  | Breadcrumbs on ≥2-deep routes                                                                                                                                                                                                         | Med                                                | S       | —          |
| 10 | Remove dead deps + amend `dashboard-settings-design.md` component contract                                                                                                                                                            | Med (removes a false architectural signal)         | **S**   | —          |
| 11 | Decide the Inter question (self-host or drop the name)                                                                                                                                                                                | Med — typography is platform-random today          | S       | 1          |
| 12 | Split `application.css` into six files                                                                                                                                                                                                | Med (reviewability)                                | S       | 1          |
| 13 | Backend: `getPerson?include=summary` with per-section counts                                                                                                                                                                          | High for #2's summary-first blocks                 | M (API) | —          |
| 14 | Optimistic UI on the four safe mutations                                                                                                                                                                                              | Med                                                | M       | 3, 5       |
| 15 | Role gating via `<template>` + `data-role` on the shell                                                                                                                                                                               | Med (removes admin-UI flash and shape leak)        | M       | —          |
| 16 | Dark mode                                                                                                                                                                                                                             | Med                                                | M       | 1, 11      |
| 17 | Type-scale + spacing-rhythm pass; drop `font-weight: 750`                                                                                                                                                                             | Med                                                | M       | 1, 11      |
| 18 | Command mode (`>`) in the palette, reusing the settings search index                                                                                                                                                                  | Low–Med                                            | M       | 4          |
| 19 | Mobile bottom-sheet editors below 900 px                                                                                                                                                                                              | Med (mobile only)                                  | M       | 2          |
| 20 | Notifications centre; people favorites; life events write; tag-cloud/sort on directory                                                                                                                                                | Deferred features — product scope, not design debt | L       | —          |

**Critical path: 1 → 2 → 3 → 5**, with 6, 7, and 10 shipped immediately in
parallel as same-day fixes, and 13 opened with the API side at the same time as
1 so it lands before 2 needs it.

---

## 13. Appendix — key files

| Area              | Files                                                                                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Person page       | `apps/web/src/pages/internal/person-profile-shell.astro`, `apps/web/src/lib/people-profile.ts`, `profile-facts.ts`, `communications.ts`, `person-gifts.ts`, `relationships.ts`, `interactions.ts` |
| Shell / nav       | `apps/web/src/layouts/ApplicationLayout.astro`, `apps/web/src/lib/app-shell.ts`, `workspace-context.ts`                                                                                           |
| Styles            | `apps/web/src/styles/application.css`, `public.css`, `auth.css`                                                                                                                                   |
| Routing           | `apps/web/astro.config.mjs`, `apps/web/src/lib/dev-static-shell-route.ts`, `gateway/nginx.conf`                                                                                                   |
| Product contracts | `docs/product/information-architecture.md`, `dashboard-settings-design.md`, `person-workspace.md`, `page-catalog.yaml`, `user-flows.yaml`                                                         |
| Planning state    | `docs/planning/active-delivery.md`, `roadmap.md`, `release-slices.md`, `traceability.md` (stale — see §5.3)                                                                                       |
