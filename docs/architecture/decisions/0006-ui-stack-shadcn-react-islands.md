# ADR 0006: UI Stack — shadcn/ui In React Islands

- Status: accepted
- Date: 2026-09-23

## Context

[`AGENTS.md`](../../../AGENTS.md) and
[`technology-baseline.md`](../technology-baseline.md) name current stable
shadcn/ui components for interactive UI and confine React to Astro islands. The
accepted UX review of 2026-08-29 (§10.6, "Dead dependencies") recommended the
opposite: remove the unused React, Tailwind, and shadcn packages and keep
hand-written vanilla TypeScript plus CSS custom properties. The Phase 12
delivery ledger adopted that direction as a binding constraint, and `UXD-010`
removed the packages and amended the component clause of
[`dashboard-settings-design.md`](../../product/dashboard-settings-design.md).
The September repair plan and the architecture gap plan both recorded the
resulting conflict as an open decision.

The frontend measured on 2026-09-23:

- `apps/web/src/lib` holds 16,964 lines of non-test TypeScript that builds UI
  imperatively: 298 `createElement`, 627 `textContent =`, 239
  `addEventListener`, and about 530 `querySelector`/`querySelectorAll` calls. It
  is guarded by 32,761 lines of vitest DOM tests. The largest modules are
  `profile-facts.ts` (1,808 lines), `people-profile.ts` (1,552),
  `interactions.ts` (1,264), `tasks.ts` (1,116), `personalization.ts` (970), and
  `relationships.ts` (964). There are 3,099 lines of `.astro` and 5,987 lines of
  CSS.
- The planned vanilla Phase 4 (core kit, component library, test builders,
  reducers plus render, kit adoption) would build and roll out a homegrown form,
  dialog, section-mount, and state framework. React plus shadcn/ui, with
  react-hook-form over the same Zod schemas `packages/contracts/schemas` already
  publishes, provides those as maintained, accessible components.
- The recurring defect classes in this UI are structural to hand-wired DOM:
  async owners and generations (the `AGENTS.md` rule against a third async
  owner), focus handling (the GAP-023 LoadMore focus fix), and clicks landing
  before handlers are wired (REL-039).

On 2026-09-23 the product owner answered: "You can use shadcn/UI, no framework
free approach is needed if it will simplify our life dramatically."

## Decision

Adopt shadcn/ui in React islands and migrate the existing vanilla surfaces to
them incrementally, one surface per candidate. Astro stays static-first: React
runs only inside hydrated islands, the static-shell and gateway-rewrite routing
of [ADR 0001](0001-astro-personalized-rendering.md) and review §3.2 is
unchanged, and so are the page catalog's rendering modes. Components are
source-owned shadcn/ui built on one primitive family, styled by Tailwind CSS v4
over the existing design tokens, and forms validate against the published
contract schemas. The backend is still reached only through the generated
client.

- **Components.** shadcn/ui source-owned components live under
  `apps/web/src/components/ui/`, configured by `apps/web/components.json`.
- **Islands.** React is used only inside hydrated Astro islands under
  `apps/web/src/islands/`. There is no SPA and no application-wide SSR; static,
  public, and no-JavaScript pages ship no React. An island mounts in one of two
  ways (GAP-026): an Astro `client:*` island wrapped in `IslandRoot` where the
  page can pass props at render time, or, for a section of a static shell that
  needs runtime context and activates lazily with its zone,
  `mountIsland(container, name, element)` from `apps/web/src/islands/core/`,
  which renders a React root into the section the shell already drew.
- **Styling.** Tailwind CSS v4 through its Vite plugin, carrying the existing
  UXD-001 tokens as the shadcn theme variables in both the light and the dark
  theme. The tokens file stays the single source for existing CSS and Tailwind.
- **Primitive family.** One primitive family: whichever `shadcn init` selects at
  scaffold time. Families are never mixed component by component without a new
  ADR. This keeps the existing technology-baseline rule.
- **Forms.** react-hook-form with the Zod resolver over the schemas in
  `packages/contracts/schemas`. An RFC 9457 problem's field errors are mapped
  onto the matching fields.
- **API access.** `apps/web` still reaches the backend only through the
  generated client and never imports `packages/backend`.
- **Readiness.** Each island marks itself ready after hydration
  (`data-island-ready`), and E2E waits on that marker before interacting.
- **Migration.** Incremental, one surface per candidate. A migrated surface
  replaces its vanilla module and that module's tests in the same candidate.
  Vanilla and island code coexist until GAP-033 retires the vanilla DOM layer,
  but each surface has exactly one owner at every point.

## Answers To The Review's Objections

Review §10.6 raised four real costs. Each is answered as follows:

1. **Test rewrite cost.** A surface's tests are rewritten only when that surface
   migrates; there is no big-bang rewrite. Testing Library tests written by role
   are much shorter than the markup-builder tests they replace.
2. **Hand-tuned accessibility.** shadcn's primitives carry maintained WAI-ARIA
   behavior. axe checks plus keyboard E2E remain the gate on every migrated
   surface, and every accessibility clause in `dashboard-settings-design.md`
   stays verbatim.
3. **Zero-hydration static shells.** Static, public, and no-JavaScript pages
   ship no React. The app pages already run the vanilla mount modules, so an
   island replaces script rather than adding it. Every island's hydrated bytes
   are measured and recorded.
4. **Tailwind was not the fix for missing tokens.** Agreed. The UXD-001 tokens
   stay the single source, and Tailwind and the shadcn theme variables are
   mapped onto them.

## Consequences

- This decision supersedes the direction in review §10.6, the Phase 12
  constraint in the delivery ledger, and the `UXD-010` amendment of the
  component clause in `dashboard-settings-design.md`. The review and the ledger
  entries were later removed from the working tree and remain in git history.
- Costs: each surface's tests are rewritten when it migrates, every island
  carries a hydration budget that is measured and recorded, and a second styling
  layer (Tailwind beside the remaining component CSS) exists until that CSS is
  retired.
- REL-039's click-before-wired defect class is addressed by the readiness
  marker: E2E interacts with an island only after it reports hydration.
- Axe, keyboard E2E, the gateway and static-shell contract tests, and the
  React-hooks lint rules gate every migrated surface.
- The architecture gap plan's Phase 4 tickets are re-scoped to this decision
  with their IDs and dependency meaning preserved.

## Alternatives Rejected

- **The vanilla core kit** (the earlier GAP-026/027 scope): it would build and
  maintain a homegrown form, dialog, section-mount, and state framework that
  shadcn/ui and react-hook-form already provide, and it leaves the structural
  defect classes in place.
- **A big-bang rewrite:** it discards working, tested surfaces at once and
  blocks feature work; incremental migration keeps one owner per surface and a
  green suite throughout.
- **Another framework without shadcn/ui** (Preact, Solid, Svelte): it forfeits
  the maintained, source-owned accessible component set that motivates the
  change and contradicts the existing baseline naming shadcn/ui.
- **Full SSR or SPA rendering:** it discards the accepted static-first
  constraint and ADR 0001's static-shell routing.

## Compatibility Note

Measured on 2026-09-23: `@astrojs/react` 6.0.6 is built against Astro 7.3 and
Vite 8, and Tailwind 4.3 and `@tailwindcss/vite` accept Vite 8. React 19.3 is
older than pnpm's three-day `minimumReleaseAge`. Exact versions are chosen and
locked by GAP-026 in the manifests and lockfile, not by this ADR.
