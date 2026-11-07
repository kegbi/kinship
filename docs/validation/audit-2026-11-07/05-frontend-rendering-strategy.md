# Frontend rendering strategy and performance (SSG vs SSR vs islands)

Audit 5 of 5, finding prefix `FER`, 2026-11-07, branch
`t3/backend-security-performance-audit` at `bc8579ae`.

**Scope.** The question was: _are SSG, on-demand SSR and client-side (SPA-like)
parts used only where they are needed, and what does each choice cost the user?_
This audit covers (1) the rendering strategy of every page in
`apps/web/src/pages/**` against `docs/product/page-catalog.yaml` and the
gateway's routing, (2) the exact production client output page by page (scripts,
styles, import graph, where React is reachable, compression), (3) runtime
behavior in Chromium against the production-like gateway (FCP, LCP, CLS, long
tasks, hydration milestones, cold and warm cache, CPU and network throttling),
(4) delivery headers and caching, (5) island granularity and SPA-like behavior,
and (6) A/B experiments that put a measured number on each recommendation. It
does not cover the number or order of API calls (agent 1), SQL (agent 2) or
authentication and authorization (agents 3-4); where an API call gates
hydration, or a CSP detail came up, it is noted. It does not cover
Firefox/WebKit, real devices or real networks.

## Method

Read: `AGENTS.md`; ADR 0001 and ADR 0006; `docs/product/page-catalog.yaml`;
`docs/architecture/compose-contract.md` and
`docs/operations/private-production.md` (production topology);
`gateway/nginx.conf` and `gateway/security_headers.conf`; `Dockerfile.web`;
`compose.yaml`; `apps/web/astro.config.mjs`; the three layouts; all 41 page
files (40 `.astro` plus the OpenAPI endpoint);
`features/shell/application-shell/application-shell.ts`;
`lib/workspace-context.ts`; the island mount modules;
`tools/web_build_output_test.ts`; `packages/contracts/client/request.ts`.

Ran, against the shared stack at `https://127.0.0.1:18443` (APP_ENV=test,
production build, nginx gateway, private Node renderer):

- **Production bytes.**
  `docker cp kinship-audit-gateway-1:/usr/share/nginx/html` (35 prerendered HTML
  pages, the OpenAPI JSON, 133 JS chunks = 1,118 KB raw, 4 CSS files, 1 woff2).
  A Node script parsed every page's `<script>`/`<link>` tags and followed the
  static import graph of the minified chunks (raw, gzip level 5 as nginx does,
  brotli level 11, longest import chain).
- **Data.** Account `audit-fer-1@example.test`, seeded through the API: 60
  people; one rich person (3 contact methods, address, work, first meeting, 3
  important dates, 3 life events, 6 notes, 4 activities, 4 calls, 5 tasks, 2
  reminders and a stay-in-touch cadence, 3 gifts, 1 debt, 3 relationships);
  notes and tasks on 12 other people. Today therefore shows 12 attention items,
  7 recent people, 7 favorite notes and 20 recent interactions.
- **Runtime harness.** Playwright 1.62.1 with headless Chromium 151 on a 16-core
  Ryzen 9 9950X3D. Profiles: `desktop` (no throttling), `cpu4` (CDP
  `Emulation.setCPUThrottlingRate` 4), `phone` (4x CPU + 100 ms RTT, 9 Mbps
  down, 3 Mbps up), `slow4g` (4x CPU + 150 ms RTT, 1.6 Mbps, the Lighthouse
  mobile default). Cold = a fresh browser context (empty HTTP cache); warm = a
  second navigation in the same context (new tab, so the 60 s `sessionStorage`
  session accelerator is not used). 5 repetitions for `desktop`/`cpu4`, 3 for
  `phone`/`slow4g` in the main battery, 5 for each single-batch A/B variant, and
  6 per arm (three interleaved rounds of two) for the core arms of M5a. Medians
  are quoted; ranges where they matter. Chromium is started with
  `--ignore-certificate-errors-spki-list=<gateway key>` and not with
  `ignoreHTTPSErrors`, because Chromium does not store responses that have
  certificate errors, which makes every "warm" run a cold run.
- **Units.** KB means KiB (1024 bytes) throughout; transfer sizes are CDP
  `encodedDataLength` (response headers included), raw sizes are file sizes.
- **Milestones.** FCP, LCP and CLS from `PerformanceObserver`; long tasks from
  `longtask`; script time from CDP `Performance.getMetrics`; bytes from CDP
  `encodedDataLength` (so they include response headers). _Shell visible_ is
  `#protected-shell` losing `hidden`. _Ready_ per page: Today = shell visible
  and no section still reads "Loading…"; People = directory island hydrated and
  "N active people shown"; Person = hero and rail islands hydrated and the name
  rendered; Settings overview = the notification bell enabled (the last shell
  island); Settings preferences and Tasks = the page island hydrated; public and
  auth pages = `load` complete. The first version of the harness started its
  milestone watchers at DOMContentLoaded, so a milestone that happened earlier
  was reported as DOMContentLoaded. A re-run of the shipped stack with watchers
  that start at document start (5 repetitions, phone profile, cold) gives, shell
  visible / ready in ms: Today 1404 / 2158, People 1502 / 2078, Person 1384 /
  1972, Settings overview 1268 / 1367, Settings preferences 1397 / 1576, Tasks
  1400 / 1437 (M1 below: 1455 / 2203, 1632 / 2201, 1490 / 2191, 1358 / 1482,
  1597 / 1598, 1481 / 1482). The differences are within the run-to-run noise
  (Person varies by ~10% between batches) except the two page-island pages,
  whose reveal precedes DOMContentLoaded by 80-200 ms. Arms C4/C5 and the final
  B1 row use the corrected watchers.
- **Experiments.** A throw-away Node server (`variant-server.mjs`, inlined under
  Reproduction) serves the same files as the gateway and proxies `/api/v1/*` to
  it, with switchable HTTP/2, brotli, `modulepreload`, head scripts, an injected
  font preload and a patched client. Route-based what-ifs abort, stub or hold
  back the layout's island script. The core arms were interleaved (see M5a)
  because the shared machine drifts by 10-20% between batches. Further probes:
  JS/CSS coverage at ready, layout-shift sources, an identical-concurrent-GET
  probe, a simulated redeploy against cached HTML, and a CSP `style-src` sweep.
- Nothing in the repository or the shared stack was modified. The only stack
  commands were read-only (`docker cp`, `docker exec ... du|nginx -V`,
  `docker stats`, `docker images`).

Caveats. CDP network emulation delays each HTTP exchange but not TCP/TLS
connection setup, so the real cost of HTTP/1.1 (up to six connections, each with
a full TLS 1.3 handshake because `ssl_session_tickets off`) is understated.
Everything runs on localhost; a 4x slowdown of a 9950X3D is roughly a recent
laptop, so a real mid-range phone is slower than the `cpu4` rows. Repetitions
are few: the control arms A0 and A1 below differ by up to 10%, so smaller
differences are noise. The audit stack has no published legal document, so
`/privacy` was measured on its "unavailable" path, which makes the same request
chain.

## Summary

**Short answer.**

- **SSG is used where it should be and as documented.** All 39 delivered catalog
  pages are served with exactly the strategy the catalog names (one catalog
  page, `settings.billing`, is an undelivered optional module). The public and
  auth pages ship no React: 0-10 KB of vanilla JavaScript, and `/features`,
  `/docs/api` and `/404` ship none.
- **On-demand SSR is used where it is not needed** (FER-03): the five renderer
  routes return byte-identical HTML for every request, and the gateway already
  overrides the only thing the renderer adds (response headers). Conversely the
  only public pages whose body is request-time data, `/privacy` and `/terms`,
  are "static" shells filled by a client fetch (FER-10).
- **There is no SPA** (no client router, no `client:*` directive, no view
  transitions), but every protected static shell boots an application-sized
  React stack before anything needs it (FER-01): three always-on islands in the
  layout are 78-100% of every protected page's JavaScript and run even for
  signed-out visitors. Page data then arrives through a client-side waterfall
  (FER-02, FER-04).
- **Cost, on a throttled phone profile (4x CPU, 4G):** Today is ready at 2.2 s,
  the person workspace paints its name at 2.1-2.5 s (LCP), the Settings overview
  reveals its (static) header at 1.3 s. HTTP/2 plus lazy shell islands take
  Today to 1.1 s (-48%); the largest single lever is making the shell islands
  lazy (-37%).
- **Would SSR for the protected pages be the better answer?** The measurements
  do not argue for it. The time goes to JavaScript boot and a client API chain
  (FER-01, FER-02, FER-04), which cheaper changes remove: the combined arms
  reach Today ready at 1.1 s and Person at 1.1-1.3 s from 2.2 s and 1.9-2.5 s.
  Server-rendering personalized HTML could go further (first content at about
  HTML + CSS + one API round trip, an estimate that was not prototyped), but it
  would reopen ADR 0001, add per-request rendering with cookies in the renderer
  and keep the page dependent on it, so it is not recommended before those
  levers are spent.

**Recommended order, with the measured effect** (cold, `phone` profile):

| # | Change                                                                        | Measured effect                                                                                                                                | Finding |
| - | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1 | Mount the shell islands lazily (session-gated, on interaction/idle)           | Today ready -37% (HTTP/1.1) / -32% (HTTP/2), Person -18% / -30%; island-free pages: JS -91..-95%, long tasks -53..-59%, shell -45% on HTTP/1.1 | FER-01  |
| 2 | Stop identical concurrent reads serializing; issue independent reads together | Today ready -22% from one line (`cache: "no-store"`); Person first read ~550 ms earlier (estimate)                                             | FER-04  |
| 3 | `modulepreload` for each page's import closure (after #1)                     | Person -17%, `/privacy` content -40%, HTTP/1.1 Today -12%; alone it delays the island-free shell on HTTP/2 by 30%                              | FER-02  |
| 4 | HTTP/2 wherever the gateway is the TLS edge                                   | Today ready -23%, Settings shell -47%, Person -13% (production edge is probably already h2)                                                    | FER-07  |
| 5 | `Cache-Control: no-cache` on HTML                                             | removes stale-shell/lazy-chunk 404 after deploys                                                                                               | FER-05  |
| 6 | Reserve space on Today                                                        | CLS 0.26/0.38 to near 0                                                                                                                        | FER-06  |
| 7 | Prerender the five on-demand routes, drop the renderer                        | -1 container (49 MiB, 1.08 GB image), -1 health dependency                                                                                     | FER-03  |
| 8 | Split the 115 KB protected stylesheet                                         | render-blocking CSS -60..-75% bytes                                                                                                            | FER-09  |

| ID     | Severity | Title                                                                                                                  | Status                               |
| ------ | -------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| FER-01 | High     | Every protected page boots three React islands (search, Quick capture, bell), even for signed-out visitors             | Verified (dynamic)                   |
| FER-02 | Medium   | Module graph is a 7-8 level waterfall with no `modulepreload`; the session request queues behind React                 | Verified (dynamic)                   |
| FER-03 | Medium   | Five on-demand routes are server-rendered for byte-identical HTML; the renderer gates gateway health                   | Verified (dynamic)                   |
| FER-04 | Medium   | Identical concurrent reads serialize in Chromium's HTTP cache and gate hydration (Today 7x, Person 4x + serial awaits) | Verified (dynamic)                   |
| FER-05 | Medium   | HTML carries no `Cache-Control`: heuristic caching serves stale shells, and lazy chunks 404 after a deploy             | Verified (dynamic)                   |
| FER-06 | Medium   | Today's layout shift is 0.26 (desktop) and 0.38 (phone): loading states are much shorter than the data                 | Verified (dynamic)                   |
| FER-07 | Low      | The gateway terminates TLS with HTTP/1.1 only (the documented production edge is probably h2)                          | Verified (dynamic)                   |
| FER-08 | Low      | Compression is gzip-5 only; JSON and SVG are not compressed; no brotli, no pre-compression                             | Verified (dynamic)                   |
| FER-09 | Low      | One 115 KB render-blocking stylesheet for all protected pages; 59-79% unused at load                                   | Verified (dynamic)                   |
| FER-10 | Low      | `/privacy` and `/terms` are static shells whose entire body is a client fetch behind a 5-level import chain            | Verified (dynamic)                   |
| FER-11 | Low      | No byte or Web-Vitals budget is enforced although ADR 0006 and the quality plan require measured budgets               | Verified (static, code read)         |
| FER-12 | Low      | The Inter font is not preloaded: font swap shifts public pages by 0.015-0.035 CLS                                      | Verified (dynamic)                   |
| FER-13 | Info     | Pre-hydration window on forms; `bindSubmitEarly` is dead code; a native submit lands on nginx's 405                    | Verified (dynamic)                   |
| FER-14 | Info     | `/docs/api` ships no JS but needs 692 ms to first paint at 4x CPU; `content-visibility` halves it                      | Verified (dynamic)                   |
| FER-15 | Info     | `style-src 'unsafe-inline'` was not needed by any of 21 exercised pages                                                | Verified (dynamic), partial coverage |
| FER-16 | Info     | Every in-app navigation is a full document load: 0.4-0.9 s at 4x CPU, 0.9-1.4 s with 4G latency, even warm             | Verified (dynamic)                   |

Counts: 1 High, 5 Medium, 6 Low, 4 Info.

## Measurements (reference for the findings)

### M1. Runtime per page, `phone` profile, cold (HTTP/1.1 gateway as shipped)

Median of 3. All times in ms, from navigation start.

| Page           | FCP | LCP  | DCL  | Shell visible | Ready | Ready (warm) | JS KB | Total KB | Long tasks | Script | Req |
| -------------- | --- | ---- | ---- | ------------- | ----- | ------------ | ----- | -------- | ---------- | ------ | --- |
| home           | 592 | 592  | 589  | -             | 763   | 340          | 2     | 57       | 134        | 22     | 5   |
| features       | 456 | 456  | 153  | -             | 595   | 208          | 0     | 55       | 233        | 16     | 3   |
| docs-api       | 788 | 788  | 180  | -             | 929   | 492          | 0     | 72       | 691        | 17     | 4   |
| sign-in        | 380 | 380  | 748  | -             | 748   | 291          | 10    | 63       | 0          | 13     | 9   |
| today          | 428 | 1540 | 1396 | 1455          | 2203  | 1394         | 206   | 315      | 398        | 398    | 52  |
| people         | 432 | 1756 | 1612 | 1632          | 2201  | 1290         | 241   | 335      | 637        | 535    | 55  |
| person         | 444 | 2480 | 1417 | 1490          | 2191  | 1404         | 315   | 430      | 1154       | 618    | 87  |
| settings-pref  | 448 | 1568 | 1598 | 1597          | 1598  | 643          | 225   | 314      | 328        | 403    | 54  |
| settings-index | 420 | 1480 | 1294 | 1358          | 1482  | 734          | 194   | 278      | 393        | 333    | 40  |
| tasks          | 412 | 2192 | 1482 | 1481          | 1482  | 610          | 210   | 312      | 292        | 361    | 52  |

"Long tasks" is the summed duration of `longtask` entries and "Script" the CDP
script time, both in ms. Warm cache barely helps the protected pages (Today 2203
to 1394 ms): the cost is parse, execute and the API chain, not bytes.

### M2. The same pages across profiles (shell visible / ready / LCP, ms, cold)

| Page           | desktop (1x)    | 4x CPU           | 4x CPU + 4G (100 ms, 9 Mbps) | 4x CPU + slow 4G (150 ms, 1.6 Mbps) |
| -------------- | --------------- | ---------------- | ---------------------------- | ----------------------------------- |
| today          | 109 / 220 / 136 | 663 / 1004 / 772 | 1455 / 2203 / 1540           | 2460 / 3590 / 2060                  |
| people         | 122 / 210 / 152 | 584 / 827 / 680  | 1632 / 2201 / 1756           | 2789 / 3625 / 2328                  |
| person         | 99 / 186 / 224  | 486 / 839 / 1052 | 1490 / 2191 / 2480           | 2670 / 3671 / 3936                  |
| settings-index | 95 / 100 / 128  | 584 / 706 / 700  | 1358 / 1482 / 1480           | 2288 / 2400 / 2040                  |
| settings-pref  | 129 / 126 / 164 | 727 / 727 / 700  | 1597 / 1598 / 1568           | 2530 / 2530 / 2180                  |
| tasks          | 110 / 107 / 204 | 628 / 597 / 864  | 1481 / 1482 / 2192           | 2663 / 2663 / 3768                  |

Public and auth pages, FCP / ready: home 68/54 (desktop), 272/273 (4x), 592/763
(phone), 676/1094 (slow 4G); features 60/13, 232/233, 456/595, 588/995; docs-api
112/15, 692/731, 788/929, 1092/1477; sign-in 48/53, 208/283, 380/748, 576/1025.

On the unthrottled desktop everything is under 250 ms with no long task, so the
problems below are invisible on a developer machine and only show under CPU and
network pressure.

### M3. Static weight per page (production output)

Static import closure of each page's module scripts; gzip is level 5 (what nginx
sends), brotli is level 11. Full per-page table in the Reproduction section's
output; the groups are:

| Pages                               | JS files | JS raw / gz / br KB                     | CSS raw / gz / br KB              | React       | Import depth |
| ----------------------------------- | -------- | --------------------------------------- | --------------------------------- | ----------- | ------------ |
| `/features`, `/docs/api`, `/404`    | 0        | 0                                       | 13.5/3.7/3.2 (docs: 18.8/5.1/4.4) | no          | 0            |
| `/`                                 | 1        | 0.8 / 0.5 / 0.4                         | 13.5 / 3.7 / 3.2                  | no          | 1            |
| `/privacy`, `/terms`                | 6        | 5.2 / 2.3 / 1.9                         | 13.5 / 3.7 / 3.2                  | no          | 5            |
| `/auth/sign-in`, `/forgot-password` | 6        | 9.9 / 3.8 / 3.2                         | 8.3 / 2.5 / 2.2                   | no          | 5            |
| `/auth/sign-up`                     | 5        | 5.4 / 2.4 / 1.9                         | 8.3 / 2.5 / 2.2                   | no          | 3            |
| Settings overview (no page island)  | 32       | 492.6 / 166.7 / 146.5                   | 114.9 / 19.9 / 16.6               | yes         | 7            |
| Today                               | 35       | 523.9 / 176.5 / 155.2                   | 114.9 / 19.9 / 16.6               | yes         | 7            |
| People                              | 40       | 632.0 / 206.2 / 181.4                   | 114.9 / 19.9 / 16.6               | yes         | 8            |
| Person shell (static part only)     | 36       | 517.9 / 175.8 / 154.5                   | 114.9 / 19.9 / 16.6               | yes         | 7            |
| All 26 protected shells             | 32-42    | 492.6-641.3 / 166.7-214.5 / 146.5-189.0 | 114.9 / 19.9 / 16.6               | yes (26/26) | 7-8          |

The person shell additionally lazy-loads about 20 island chunks (315 KB JS
transferred in total on a cold load, 87 requests). Heavy chunks, raw / gzip /
brotli KiB: `client.*.js` (React + ReactDOM) 214.4 / 66.7 / 57.0; the layout's
island script (cmdk, search, Quick capture, bell) 75.7 / 25.0 / 22.4; `core.*`
(island kit, react-hook-form, JSX runtime) 65.9 / 22.2 / 19.9; `zod-jitless.*`
67.8 / 18.1 / 15.9 (only on People, Import and Personalization, and lazily on
the person page); Base UI popup stack (`popupTriggerMap`,
`useAnchoredPopupScrollLock`, `useScrollLock`, `dialog`, `useButton`) 89.4 /
33.7 / 30.6; `ComboboxItem` 37.5 / 13.4 / 12.2. `lucide-react` is tree-shaken
(one 3 KB helper plus 0.2-0.3 KB per icon).

### M4. What actually runs at load (V8 coverage at "ready", no interaction)

| Page           | JS loaded / executed  | CSS loaded / used    |
| -------------- | --------------------- | -------------------- |
| home           | 1 KB / 83%            | 14 KB / 60%          |
| features       | 0 KB / -              | 14 KB / 42%          |
| sign-in        | 10 KB / 13%           | 8 KB / 54%           |
| today          | 524 KB / 188 KB (36%) | 115 KB / 29 KB (25%) |
| people         | 632 KB / 225 KB (36%) | 115 KB / 29 KB (25%) |
| person         | 816 KB / 347 KB (43%) | 115 KB / 47 KB (41%) |
| settings-pref  | 557 KB / 195 KB (35%) | 115 KB / 27 KB (24%) |
| settings-index | 493 KB / 162 KB (33%) | 115 KB / 26 KB (23%) |
| tasks          | 520 KB / 174 KB (34%) | 115 KB / 25 KB (21%) |

Within the shell: `client.*` (React) is 30% executed, the layout island script
35%, `useAnchoredPopupScrollLock` 5%, `useScrollLock` 22%.

### M5. Delivery and loading A/B (cold, `phone` profile)

**M5a. Core arms, interleaved.** Seven arms, three rounds of two runs each,
alternating the arms inside every round so that drift of the shared machine hits
all arms equally (n = 6 per cell, median and range in ms). Today, the Settings
overview (a page with no island of its own; its end state is the shell reveal)
and the Person workspace.

| Arm                                                    | Today shell | Today ready (range) | Today LCP | Today JS KB | Today long tasks | Overview shell (range) | Overview JS KB | Overview long tasks | Person ready (range) | Person LCP |
| ------------------------------------------------------ | ----------- | ------------------- | --------- | ----------- | ---------------- | ---------------------- | -------------- | ------------------- | -------------------- | ---------- |
| A0 as shipped (nginx, HTTP/1.1, gzip)                  | 1444        | 2190 (2109-2269)    | 1514      | 206         | 368              | 1267 (1182-1365)       | 194            | 310                 | 1907 (1900-2012)     | 2064       |
| C1 A0 without the shell islands                        | 1041        | 1390 (1283-1456)    | 1110      | 133         | 231              | 698 (685-753)          | 18             | 147                 | 1562 (1472-1705)     | 1840       |
| C4 A0, shell islands imported after content is ready   | 1044        | 1397 (1302-1419)    | 1114      | 207         | 326              | 701 (690-711)          | 194            | 366                 | 1565 (1491-1654)     | 1838       |
| B1 HTTP/2                                              | 936         | 1679 (1589-1757)    | 1010      | 178         | 354              | 673 (641-697)          | 168            | 388                 | 1650 (1574-1946)     | 1818       |
| B3 B1 + `modulepreload` for each page's import closure | 896         | 1646 (1608-1707)    | 964       | 178         | 384              | 872 (770-917)          | 168            | 415                 | 1376 (1272-1475)     | 1582       |
| C2 B1 without the shell islands                        | 773         | 1142 (1008-1185)    | 846       | 115         | 256              | 705 (692-733)          | 9              | 160                 | 1147 (1066-1204)     | 1482       |
| C5 B1, shell islands imported after content is ready   | 779         | 1153 (1090-1219)    | 862       | 178         | 359              | 700 (659-726)          | 168            | 364                 | 1081 (1023-1183)     | 1340       |

A0 is production as shipped. B1 serves the same files over HTTP/2 from a
throw-away Node server. C1 and C2 abort the layout's island script: an upper
bound for making it lazy. C4 and C5 serve that script as an empty module and
import the real one once the page's content is ready: what "lazy, loaded at
idle" costs the header controls. When each control becomes usable (search / bell
/ Quick capture, median ms):

| Arm                       | Today              | Settings overview  | Person             |
| ------------------------- | ------------------ | ------------------ | ------------------ |
| A0 as shipped             | 1355 / 1519 / 1696 | 1217 / 1345 / 1516 | 1240 / 1470 / 1673 |
| C4 A0, lazy after content | 2045 / 2184 / 2328 | 1657 / 1803 / 1939 | 2904 / 3037 / 3174 |
| B1 HTTP/2                 | 885 / 1045 / 1172  | 982 / 1079 / 1322  | 1014 / 1162 / 1392 |
| C5 B1, lazy after content | 1701 / 1836 / 1978 | 1408 / 1549 / 1686 | 1922 / 2233 / 2354 |

**M5b. Further arms** (earlier single batches of 5 runs; between batches the
same arm drifts by 10-20%, most on Person, so only differences larger than that
are meaningful):

| Arm                                        | Today ready | Today LCP | Today JS KB | Person ready | Person LCP |
| ------------------------------------------ | ----------- | --------- | ----------- | ------------ | ---------- |
| A1 control: Node server, HTTP/1.1, gzip    | 2453        | 1800      | 202         | 2086         | 2376       |
| A2 A1 + `modulepreload`                    | 2157        | 1484      | 202         | 2022         | 2240       |
| B1 HTTP/2 (this batch)                     | 1725        | 1060      | 178         | 1765         | 1968       |
| B2 B1 + brotli                             | 1638        | 956       | 157         | 1757         | 1992       |
| B4 B1 + brotli + `modulepreload`           | 1681        | 1016      | 157         | 1520         | 1776       |
| B5 B1 + module scripts moved into `<head>` | 1823        | 1140      | 178         | -            | -          |
| B6 B3 + `preload as=fetch` for the session | 1887        | 696       | 178         | -            | -          |

B6 is explained in FER-02. All byte counts include response headers (HTTP/1.1
repeats about 790 B of them per asset).

## Findings

### FER-01 Every protected page boots three React islands, even for signed-out visitors

- **Severity:** High
- **Status:** Verified (dynamic)
- **Where:** `apps/web/src/layouts/ApplicationLayout.astro:171-181` (second
  layout script: unconditional calls to `mountGlobalPeopleSearch`,
  `mountQuickCapture` and `mountNotificationBell`);
  `apps/web/src/layouts/ApplicationLayout.astro:162-168` (the vanilla shell
  script that resolves the session separately);
  `apps/web/src/islands/global-people-search/mount.tsx`,
  `apps/web/src/features/interactions/mount.tsx`,
  `apps/web/src/features/shell/notifications/notification-bell.tsx`;
  `tools/web_build_output_test.ts:8-9` (still documents "one island in their
  layout, the people palette").

**What happens.** Each of the 26 protected shells (21 `app/*` pages and the 5
`internal/*` shells that serve the dynamic routes) is a static document. Its
layout carries two module scripts: a small vanilla one that resolves the session
and reveals the shell, and a second one that imports React and mounts the
header's search palette (cmdk), the Quick capture dialog (react-hook-form, Base
UI dialog and combobox) and the notification bell, unconditionally and at load.
The static header already draws the controls (a real search `<input>`, a
disabled Quick capture button, a disabled bell), so the three islands are only
needed once the user touches them.

**Evidence.**

1. _Weight._ The Settings overview, which has no island of its own, loads 32 JS
   files: 492.6 KB raw, 166.7 KB gzip, 146.5 KB brotli (M3). That is 78-100% of
   the JavaScript of every other protected page. `client.*` (React) is in the
   import closure of all 26 protected shells and of none of the public pages.
2. _Execution._ At ready only 33-43% of the loaded JavaScript has run (M4); the
   Base UI popup machinery (`useAnchoredPopupScrollLock`, 25 KB) is 5% executed.
   These are code paths for a dialog, a popover and an autocomplete nobody has
   opened.
3. _Signed-out visit to `/app`_ (an expired session, which the 12 h cookie makes
   a routine case): the page downloads 40 requests, 206 KB of JS (524 KB
   decoded, 35 scripts) and makes two API calls (`/api/v1/session` 401,
   `/api/v1/application-entry` 409) to show "Sign in to Kinship" with a link.
   `application-shell.ts:285-303` knows the session is missing before React
   finishes, but the layout script does not wait for it. The page's own script
   (`mountToday`) also loads React for its five data islands regardless. Phone
   profile, cold, median of 5:

   | Signed-out visit to `/app`        | As shipped (A0)     | Shell islands removed (C1) | HTTP/2 stack (B1)  |
   | --------------------------------- | ------------------- | -------------------------- | ------------------ |
   | "Sign in to Kinship" card visible | 1572 ms (1553-1663) | 1182 ms (1151-1200)        | 1042 ms (997-1080) |
   | JS KB / requests / long tasks     | 206 / 40 / 250 ms   | 133 / 29 / 111 ms          | 178 / 40 / 213 ms  |

   The 133 KB that remain in C1 are the page's own React islands, which also
   mount regardless of the session.
4. _What the islands cost (what-if: the layout island script aborted)._ From M5a
   (interleaved, n = 6 per cell, medians):

   | Metric                                      | A0 as shipped      | C1 without shell islands | B1 HTTP/2         | C2 HTTP/2 without |
   | ------------------------------------------- | ------------------ | ------------------------ | ----------------- | ----------------- |
   | Today: shell visible / ready / LCP (ms)     | 1444 / 2190 / 1514 | 1041 / 1390 / 1110       | 936 / 1679 / 1010 | 773 / 1142 / 846  |
   | Today: JS KB / long tasks (ms)              | 206 / 368          | 133 / 231                | 178 / 354         | 115 / 256         |
   | Settings overview: shell visible / LCP (ms) | 1267 / 1344        | 698 / 780                | 673 / 770         | 705 / 794         |
   | Settings overview: JS KB / long tasks (ms)  | 194 / 310          | 18 / 147                 | 168 / 388         | 9 / 160           |
   | Person: rail ready / LCP (ms)               | 1907 / 2064        | 1562 / 1840              | 1650 / 1818       | 1147 / 1482       |

   Today is ready 37% sooner on the shipped stack and 32% sooner on HTTP/2; the
   Person rail 18% and 30% sooner. The Settings overview reveals its shell 45%
   earlier on HTTP/1.1 (1267 to 698 ms); on HTTP/2 the reveal is already at
   about 0.7 s either way, but the page then ships 95% less JavaScript and 59%
   less long-task time, which is what keeps the main thread free for the first
   touch.
5. _Why the reveal waits for React._ JavaScript is single-threaded, so the
   vanilla shell's continuation (the `await` after the session response) queues
   behind the layout script's React boot. In the phone timeline of Today the
   session response arrives at 1162 ms, DCL is 1396 ms, and the shell is
   revealed at 1455 ms: roughly 300 ms of React evaluation sit between a ready
   session and a visible page. Module scripts also execute in document order, so
   the layout island script holds up the page's own script (Today's
   `mountToday`) that follows it: with that one script held back by 2.5 s (an
   extra what-if on the HTTP/2 stack, not in M5) Today's first data request
   moved from 862 ms to 3278 ms and the page was ready at 3573 ms.
6. _The repo's own gate does not see it._ The GAP-027 test asserts that React is
   reachable on a protected page only through the layout script, which is still
   true, but its comment and name say "only for the people palette"
   (`tools/web_build_output_test.ts:8`); the layout script now also carries
   Quick capture and the bell, and nothing bounds its size (FER-11).

**Impact.** On pages with no island of their own the shell islands are 91-95% of
the JavaScript (Settings overview 194 to 18 KB) and 53-59% of the long-task
time, and on HTTP/1.1 they hold the visible shell back by 45%; on pages with
islands they are about a third of the bytes (Today 206 to 133 KB) and 37% of the
time to ready, and they sit in front of the page's own script in the execution
order. Signed-out visitors pay the same to read a sign-in prompt. ADR 0006's
intent is that "static, public, and no-JavaScript pages ship no React" and that
islands activate lazily where they need runtime context; the shell islands are
the one place where an island is eager by default rather than by need.

**Recommendation.** No ADR change is needed (ADR 0006 already allows lazy
activation: `mountIsland` is documented for sections that "activate lazily").

1. Gate the islands on the shell's own outcome. `mountApplicationShell` knows
   when the session is ready, forbidden, unavailable or missing; have it
   dispatch one event (or return a promise) and `import()` the island modules
   only after a ready session. Apply the same gate to page-level islands, which
   also load React for a signed-out visitor.
2. Make each island load on demand. Search: keep the static input; import and
   mount on the first `pointerenter`, `focusin` or `keydown` on it, and prefetch
   the chunk at idle. `mount.tsx:30-35` already carries a typed query and focus
   into the island, so no keystroke is lost. Quick capture: the button is
   already `disabled` until wired (`ApplicationLayout.astro:125`); instead
   enable it and import the dialog on first click (pending state). Bell: read
   the unread count without React (or in the idle-loaded island) and load the
   panel on first click.
3. Split the layout script's chunk so the three features are separate dynamic
   imports (today they are one 75.7 KB entry), so a page that opens only search
   does not download the Quick capture form.
4. Update `tools/web_build_output_test.ts`: a protected page with no island of
   its own should reach no React chunk, and the signed-out path should reach
   none either.

Expected effect, from the what-if arms (M5a): Today ready -37% (HTTP/1.1) and
-32% (HTTP/2), Person ready -18% and -30%, island-free pages -91..-95% JS and
-53..-59% long tasks (shell -45% on HTTP/1.1), signed-out `/app` -25% in time
and -35% in bytes before the page-island gate (more after it). Importing the
script after content (arms C4/C5) keeps the whole content gain (Today ready 1397
and 1153 ms against 1390 and 1142 ms for removal) but makes the controls usable
later than today (Today: search 1355 to 2045 ms, bell 1519 to 2184, Quick
capture 1696 to 2328; Person: 1.2-1.7 s to 2.9-3.2 s), because the whole bundle
then loads and evaluates after the page. That is the worst timing for the
controls; loading each feature on first interaction, with an idle prefetch of
its chunk, lands between the two (not measured, it needs the code change).

### FER-02 Module graph is a 7-8 level waterfall with no `modulepreload`

- **Severity:** Medium
- **Status:** Verified (dynamic)
- **Where:** `apps/web/src/layouts/ApplicationLayout.astro:160-181` (module
  scripts sit after `</html>`); `apps/web/astro.config.mjs:36-52` (default
  Astro/Vite output, no preload step). The built HTML contains no
  `modulepreload` link at all.

**What happens.** Astro emits no `<link rel="modulepreload">` for page scripts,
so the browser discovers dependencies one import level at a time, and the
layout's `<script type="module">` tags are written after `</html>` (found only
when the preload scanner reaches the end of the document). Protected pages have
a longest static chain of 7-8 modules, for example

```text
ApplicationLayout...index_1 -> dialog -> useScrollLock -> popupTriggerMap
  -> shadowDom -> useButton -> client
```

and even the 12 KB vanilla shell script's own graph is 5 deep
(`index_0 -> theme -> workspace-context -> registration -> request`). 133 chunks
are emitted for the whole site and a protected page needs 32-42 of them.

**Evidence.** Today, cold, phone profile, HTTP/1.1 (the waterfall of the median
run; start-end in ms):

```text
   0-121  Document
 146-318  ApplicationLayout.css + the three entry scripts (requested 146-148)
 278-296  wave 2: 18 shell/island chunks            (after the entries parsed)
 427-435  wave 3: 13 more, incl. useButton, popupTriggerMap, registration.js
 435-1028 registration.js (0.4 KB) finishes: stuck in the six-connection queue
          behind the React chunks (client.* alone ends at 685)
1038-1162 GET /api/v1/session          <- starts only when the shell's last dependency arrived
1396      DOMContentLoaded
1440-2304 island API calls (start after React has mounted the islands)
```

The shell's session request cannot start before its deepest 0.4 KB dependency
has downloaded, and under HTTP/1.1 that dependency waits in the six-connection
queue behind the unrelated React chunks. Variants (M5):

- `modulepreload` for every module in each page's closure: -12% on HTTP/1.1
  (Today ready 2453 to 2157 ms, M5b A1 vs A2). On HTTP/2 (M5a, interleaved, B1
  vs B3) it is neutral for Today (1679 to 1646 ms), -17% for Person (1650 to
  1376 ms) and it makes the island-free Settings overview reveal its shell later
  (673 to 872 ms, +30%). The mechanism is the one in FER-01 item 5: with every
  module present early, React's evaluation lands before the session continuation
  instead of after it, so preloading helps whatever needs React and hurts the
  vanilla shell reveal until the islands are lazy.
- On the public `/privacy` page the 5-level chain alone is the content delay:
  FCP 372 ms but the legal text is written at 868 ms; with HTTP/2 +
  `modulepreload` it is written at 521 ms (-40%), same page, same API call.
- Moving the module `<script>` tags into `<head>` (B5): no measurable change on
  5-21 KB documents (Today ready 1823 vs 1725 ms in the same batch, inside the
  noise band). The person shell's HTML is 119 KB raw (11.3 KB gzip), where the
  scripts are discovered only after the whole document arrives; not measured
  separately.
- A `<link rel="preload" as="fetch" href="/api/v1/session">` hint (B6) was tried
  and rejected: the API answers `Cache-Control: private, no-store`, so the later
  `fetch()` does not reuse the preload; two network requests are made
  (initiators `parser` and `script`). It does not help and adds a request.

**Impact.** About 0.5 s of the 1.3-1.4 s the shell takes to appear on the
shipped stack is discovery and queueing latency, not bytes (the same files over
HTTP/2 reveal the Settings overview at 673 ms against 1267 ms); the shell
session request, which gates every protected page, is the most delayed request
of all.

**Recommendation.**

1. After `astro build`, add a post-build step (an Astro integration on
   `astro:build:done`, or a Vite plugin) that writes one
   `<link rel="modulepreload">` per module in each page's static import closure
   into that page's `<head>`. Links are not scripts, so the CSP hash policy is
   untouched. Measured: -12% Today on HTTP/1.1, -17% Person and -40% `/privacy`
   on HTTP/2; do it together with FER-01, otherwise the vanilla shell reveal can
   get slower.
2. For the person shell, which lazily imports about 20 island chunks only after
   `GET /api/v1/people/:id` returns (waterfall: session 1158, person 2167, then
   the chunk wave 2389-2872, then the section reads 2672-3290), add
   `modulepreload` for the chunks every person page needs (hero, rail, facts):
   their names are known at build time.
3. Optionally merge the tiny shell chunks (Rollup's `manualChunks` output
   option) so the vanilla shell is one file with no chain (Suspected, not
   measured).
4. Do not add a `preload as=fetch` for authenticated API reads while they are
   `no-store` (B6).

### FER-03 Five on-demand routes are server-rendered for byte-identical HTML

- **Severity:** Medium
- **Status:** Verified (dynamic) for the HTML and footprint; Verified (static,
  code read) for the coupling
- **Where:** `apps/web/src/pages/auth/verify-email.astro:3-5`,
  `auth/reset-password.astro:3-5`, `auth/mfa.astro:3-5`,
  `invite/[token].astro:3-5` (`export const prerender = false;` plus two
  `Astro.response.headers.set` calls); `app/compliance.astro:3`;
  `gateway/nginx.conf:119-140, 185-278` (the readiness auth request and the five
  proxy locations); `compose.yaml:136-160, 170-174` (the `web` service and the
  gateway's `depends_on: web: service_healthy`); `Dockerfile.web:23-32`; ADR
  0001 ("any other on-demand page requires ... a measured reason").

**What happens.** The page catalog and the gateway agree exactly: five
`on-demand` entries, five proxy locations (checked mechanically, see "Checked
and sound"). But none of the five pages reads the request. Their frontmatter
only sets `Cache-Control: private, no-store` and `Referrer-Policy: no-referrer`;
the token is read in the browser from `location.search` (`verify-email.ts:26`,
`auth-forms.ts:186`) and scrubbed with `history.replaceState`. The gateway then
hides the renderer's headers (`proxy_hide_header Cache-Control` and the security
headers) and sets `Cache-Control: private, no-store` itself
(`nginx.conf:196-197`, `215-216`, `234-235`, `253-254`, `272-273`), and
`Referrer-Policy: no-referrer` is already set for every response by
`security_headers.conf`. The renderer therefore produces a document that nginx
could serve as a file with one `add_header`.

**Evidence.**

```text
$ cmp <(curl -sk .../invite/aaa) <(curl -sk -H 'Cookie: kinship_session=bogus' .../invite/zzzzzzzzz-long-token)
IDENTICAL for all five route pairs with different tokens/queries/cookies:
  /invite/:token 2125 B, /auth/verify-email 1702 B, /auth/reset-password 2045 B,
  /auth/mfa 1929 B, /app/compliance?next=... 12321 B
TTFB p50 (30 requests, loopback): /auth/sign-in 7.7 ms (static)  /auth/mfa 9.3  /invite/abc 9.6  /app/compliance 9.7
docker stats web:   48.7 MiB RSS         docker images: web 1.08 GB, gateway 82.6 MB, api 388 MB
docker exec web du: /app/node_modules 579 MB (the entire pnpm devDependency tree: vitest, playwright, eslint, typescript, happy-dom ...), dist 3.9 MB
```

Coupling (static read): `/gateway-health` runs an `auth_request` to
`/_gateway_web_readiness`, which proxies to the renderer's `/auth/mfa`
(`nginx.conf:119-135`); the gateway container `depends_on` the `web` service
being healthy and its own healthcheck is `/gateway-health`
(`compose.yaml:170-197`). A renderer outage therefore marks the only public
entry point unhealthy even though 100% of the static app and the API still work,
and a request to any of the five routes during that outage returns
`503 Renderer temporarily unavailable`. Those five include the MFA step, email
verification, password reset and invitation acceptance.

**Impact.** There is no user-visible latency benefit (SSR adds about 1.5 ms of
TTFB); the cost is operational: one always-on Node process, a 1.08 GB image
whose `node_modules` carries the whole toolchain, and a health dependency that
couples the gateway's liveness to five identical pages. With `output: "server"`
any new page that forgets `prerender = true` silently becomes a renderer-only
route (the gateway would 404 it), which is a fail-closed but surprising default.

**Recommendation.** Needs an explicit decision because it amends ADR 0001 and
the catalog's "five on-demand pairs":

1. Prerender the four fixed pages (`prerender = true`, drop the
   `Astro.response.headers` lines) and serve them from the static root. Each
   existing proxy block already carries the headers, so it only changes its
   body:

   ```nginx
   location = /auth/mfa {
     include /etc/nginx/security_headers.conf;
     add_header Cache-Control "private, no-store" always;
     try_files /auth/mfa/index.html =404;
   }
   ```
2. For `/invite/:token`, add an `internal/invite-shell.astro` and an nginx
   `location ~ ^/invite/[^/]+$` that serves it, exactly like the person, journal
   and import-report shells already do.
3. Delete the `web` service, the Dockerfile `web` target, the readiness auth
   request and `depends_on: web`; set `output: "static"` and drop
   `@astrojs/node`; flip the catalog entries to `static-shell-islands`; update
   `tools/web_build_output_test.ts`, the gateway contract tests and
   `docs/architecture/compose-contract.md`. A new page then defaults to static.
4. If the renderer stays for any reason, copy only the runtime files into the
   image (`pnpm deploy --prod` or an explicit file list) instead of the whole
   `node_modules`, and decouple `/gateway-health` from it.

The opposite case is FER-10: the one public body that is request-time data.

### FER-04 Identical concurrent reads serialize in Chromium's HTTP cache and gate hydration

- **Severity:** Medium (the count of calls is agent 1's; the serialization and
  its effect on hydration are measured here)
- **Status:** Verified (dynamic)
- **Where:** `packages/contracts/client/request.ts:29` (the single `fetch` every
  generated client function uses);
  `apps/web/src/features/person/workspace.ts:949-974` (the session, then the
  preferences, then the person, awaited in series);
  `apps/web/src/lib/time-presentation.ts:11` (an unmemoized preferences read per
  call).

**What happens.** Today issues seven identical
`GET /api/v1/settings/preferences` requests (People 5, Person 4, Settings
preferences 5, Tasks 4, Settings overview 3), one per consumer: the shell's
layout read, the search palette, Quick capture, and each island that formats a
time (`apps/web/src/lib/time-presentation.ts:11` re-reads the preferences on
every call). The API answers `private, no-store`, yet Chromium's HTTP cache
still queues identical concurrent GETs behind the first one's cache entry, so N
identical reads cost N round trips instead of one.

**Evidence.**

1. _Probe_ (`dupfetch.mjs`, seven concurrent `fetch()` calls from a page,
   completion times in ms):

   | Mode (RTT 100 ms)                | Completion times                      |
   | -------------------------------- | ------------------------------------- |
   | 7 identical URLs                 | 121, 242, 365, 487, 609, 733, **855** |
   | 7 distinct URLs (`?_=i`)         | 121, 121, 136, 137, 137, 137, 243     |
   | 7 identical, `cache: "no-store"` | 122, 122, 122, 122, 122, 122, 242     |

   No throttling: 20..104 ms (identical) vs 21..39 ms (distinct). The same
   staircase appears over HTTP/2 (121..860 ms), so it is a browser cache-lock
   effect, not a connection limit.
2. _The staircase is on Today's critical path._ Phone profile, cold: the seven
   preference reads complete at 1564, 1688, 1811, 1934, 2059, 2182 and 2304 ms;
   every other read has finished by 1688 ms; Today is ready at 2203 ms. On the
   HTTP/2 stack the same pattern ends at 1705 ms against 981 ms for the
   attention read. Per page (median, ms): Today 7 reads end at 2304 (others
   1688, ready 2203); People 5 reads end 2232 (others 2231); Person 4 reads end
   2037 (others 3290); Settings preferences 5 end 2069.
3. _The person read starts after the staircase._ `workspace.ts:949-974` awaits
   the session, then the preferences, then `getPerson`, serially, though the
   last two need only the workspace id. On the phone profile the session returns
   at 1158 ms, the four preference reads end at 1984 ms, and the person read
   (`GET /api/v1/people/:id?include=summary`) starts at 2049 ms, 891 ms after
   the session. Everything downstream (the section chunks, the section reads)
   waits for it.
4. _Measured effect of the one-line fix._ The built `request.*.js` served with
   `cache:"no-store"` added to its single `fetch` (HTTP/2 stack, phone profile,
   cold, median of 5):

   | Page   | Ready, as shipped (range) | Ready with `cache: "no-store"` (range) |
   | ------ | ------------------------- | -------------------------------------- |
   | Today  | 1651 ms (1621-1685)       | **1280 ms (1211-1423), -22%**          |
   | People | 1564 ms (1555-1782)       | 1548 ms (1411-1651), no change         |
   | Person | 1683 ms (1592-1955)       | 1645 ms (1408-1846), within noise      |

   People's reads are not the last to finish, and the Person chain is dominated
   by the serial awaits above. On the HTTP/2 stack the person read starts at
   1539 ms although the shell's own session was answered at 647 ms: the page
   script asks for the session again (a second round trip, 976-1096 ms, because
   the session resolution is deliberately not a same-document memo), then three
   preference reads (1156-1529 ms), and only then `getPerson`. With
   `Promise.all([getMemberPreferences, getPerson])` and the shell's session
   promise reused, the first person read could start when the page script runs
   (about 980 ms): roughly 550 ms earlier (estimate).

**Impact.** On the main landing page the duplicated reads add up to 600-700 ms
of content delay at 100 ms RTT, and the delay scales with RTT. On the person
workspace the page's first read is postponed by roughly the session plus
preference round trips.

**Recommendation.**

1. In `packages/contracts/client/request.ts` add `cache: "no-store"` to the
   `fetch` options. The API already declares `private, no-store`; this documents
   it to the browser and bypasses the cache lock (the request then also carries
   `Cache-Control: no-cache`, which the API ignores). One line, then
   `deno task contracts:generate`.
2. Share one in-flight preferences promise per workspace in the island core (the
   session already has this, `workspace-context.ts` `activeResolution`), and
   give the person page
   `Promise.all([getMemberPreferences(...), getPerson(...)])`. These two changes
   belong to agent 1's call-count work; they are listed here because they decide
   hydration time.

### FER-05 HTML carries no `Cache-Control`: stale shells and lazy-chunk 404s after a deploy

- **Severity:** Medium
- **Status:** Verified (dynamic)
- **Where:** `gateway/nginx.conf:365-368` (`location /`) and the shell rewrites
  at `nginx.conf:336-363` (no `add_header Cache-Control`); `nginx.conf:293-298`
  (`/_astro/` is `public, max-age=31536000, immutable`).

**What happens.** Static HTML is served with `Last-Modified` and a weak `ETag`
but no `Cache-Control`. Browsers then apply heuristic freshness (about 10% of
`Date - Last-Modified`, RFC 9111 section 4.2.2) and reuse the cached document
without revalidating. A deploy replaces every fingerprinted `/_astro/*` file, so
a cached shell can point at assets that no longer exist.

**Evidence.**

- Response headers of `/app`: `Last-Modified`, `ETag: W/"..."`,
  `Vary: Accept-Encoding`, no `Cache-Control`. A second navigation in the same
  browser context fetched the document from the disk cache, 0 bytes, no
  conditional request (CDP `fromDiskCache: true`; checked on Today and the
  Settings overview in the `desktop` batch).
- Simulated redeploy (`deploy-skew2.mjs`, 3 of 3 runs): load the person
  workspace, replace the asset directory by an empty one, reload (the HTML comes
  from cache), open the "Things" zone. The lazily imported chunks 404
  (`mount.*.js`, `files.*.js`, `person-files.*.js`, `status-region.*.js`) and
  the Gifts section stays at "Loading gifts..." with no error state. Eagerly
  loaded assets that the browser had already cached (immutable) kept working,
  which hides the problem for the first screen and exposes it on the first lazy
  interaction.
- Window length: 0.1 x (age of the file at response time). An image built 20
  days before the visit gives a two-day window; a fresh build gives minutes.

**Impact.** After each deploy, returning users can run the old frontend against
the new API for hours or days, and any lazily loaded section fails permanently
until a hard reload. The failure is silent. It also means the app shell is never
revalidated, so a security fix to the shell's HTML or CSP-hash set reaches
returning browsers late.

**Recommendation.** Add `add_header Cache-Control "no-cache" always;` to
`location /`, the five shell rewrites and `/docs/api/openapi.json`
(`Last-Modified`/`ETag` already make the revalidation a cheap 304), keep
`immutable` on `/_astro/`, keep `private, no-store` on the proxied pages, and
give `/favicon.svg` `public, max-age=86400`. Note that `add_header` in a
`location` replaces the server-level headers, so repeat
`include security_headers.conf` as the existing blocks do.

### FER-06 Today's layout shift is 0.26 (desktop) and 0.38 (phone)

- **Severity:** Medium
- **Status:** Verified (dynamic)
- **Where:** `apps/web/src/pages/app.astro:20-83` (every section is drawn in a
  one-line "Loading..." state); the Today islands under
  `apps/web/src/features/today/`.

**What happens.** The shell and the five sections are revealed with one-line
loading states, then each island replaces its state with the real list. The
"Needs attention" card grows from 153 px to 1,207 px with 12 items and pushes
every card below it out of the viewport.

**Evidence.** Layout-shift sources (`cls.mjs`), seeded workspace: one shift at
t=149 ms, value 0.257 (viewport 1366x768; 0.246 in each of the 5 harness runs)
and 0.378 (412x915); sources are the Reconnect, Upcoming, Recent people and
Favorite notes cards moving out of view. Per-frame geometry (`frames.mjs`): page
height 951 px, then 1099, 2289, 2347, 3311, 5954 px as the attention card (153
to 1207 px), favorite notes (108 to 1235) and recent activity (108 to 2751)
fill. People, Settings and Tasks: 0.000-0.006; Person: 0.029-0.035. Google's
"good" threshold is 0.1, "poor" above 0.25.

**Impact.** The landing page jumps under the pointer while data arrives; it
scales with the amount of data (an empty workspace shifts far less).

**Recommendation.** Bound the first paint's height: cap "Needs attention" at a
fixed number of rows with "Show all" (a product-sound change, since the section
is a priority list), and give each section a `min-height` or skeleton rows sized
to a typical answer so the loading state and the loaded state occupy the same
box. Alternatively `content-visibility: auto` with `contain-intrinsic-size` on
the cards below the fold.

### FER-07 The gateway terminates TLS with HTTP/1.1 only

- **Severity:** Low (Medium for any deployment without an HTTP/2 edge)
- **Status:** Verified (dynamic)
- **Where:** `gateway/nginx.conf:96` (`listen 8443 ssl;`, no `http2`);
  `gateway/nginx.conf:109` (`ssl_session_tickets off`);
  `gateway/security_headers.conf` (about 0.5 KB of headers repeated on every
  asset response); `docs/architecture/compose-contract.md:54`.

**What happens.** `openssl s_client -alpn h2,http/1.1` against `:18443`
negotiates `http/1.1`. The nginx binary already includes `--with-http_v2_module`
and `--with-http_v3_module`. A protected page makes 40-55 requests (87 for the
person workspace), served over at most six connections, each response repeating
about 790 bytes of headers (CSP, Permissions-Policy, HSTS, ...).

**Evidence.** Same files, HTTP/1.1 vs HTTP/2 (M5a, interleaved, A0 vs B1): Today
ready 2190 to 1679 ms (-23%), LCP 1514 to 1010 (-33%), JS bytes 206 to 178 KB
(the difference is header overhead: HPACK removes about 28 KB of repeated
headers per cold page); Settings overview shell 1267 to 673 ms (-47%); Person
ready 1907 to 1650 (-13%). Against the Node server's own HTTP/1.1 arm (M5b A1,
an earlier batch) the gain on Today is -30%.

**Impact.** The documented production path is the Dokploy edge terminating TLS
"at gateway's private HTTP port" (`compose-contract.md:54`,
`private-production.md:55-60`), so browsers there speak the edge's HTTP/2 and
the gap above is mostly a local/test-topology effect. It still matters because
the repo's E2E and any performance baseline run against this listener, and
because the emulation here understates it (no per-connection TLS cost).
Per-connection full TLS 1.3 handshakes (`ssl_session_tickets off`) make
HTTP/1.1's six connections more expensive than in these numbers.

**Recommendation.** Add `http2 on;` to the `server` block (nginx 1.29 syntax;
the cleartext `:8080` listener is unaffected), and trim `/_astro/` responses to
`X-Content-Type-Options`, `Cache-Control` and `Cross-Origin-Resource-Policy` (a
CSP, `Permissions-Policy` and `X-Frame-Options` are meaningful for documents,
not for scripts and stylesheets). Confirm the edge's protocol in the production
runbook.

### FER-08 Compression is gzip-5 only

- **Severity:** Low
- **Status:** Verified (dynamic)
- **Where:** `gateway/nginx.conf:76-80` (`gzip_comp_level 5`,
  `gzip_types text/css application/javascript text/javascript`);
  `Dockerfile.web:16-20` (stock `nginx:alpine`, no brotli module;
  `--with-http_gzip_static_module` is present).

**What happens.** A client sending `Accept-Encoding: gzip, br` receives gzip,
compressed per request. `application/json` and `image/svg+xml` are not in
`gzip_types`: `/docs/api/openapi.json` (the integrator download) is 90,956 bytes
on the wire (7,124 gzipped). Pre-compressed files are not used.

**Evidence.** Brotli level 11 vs gzip level 5 over a protected page's closure
(Today): JS 176.5 to 155.2 KB (-12%), CSS 19.9 to 16.6 KB (-17%), HTML 3.8 to
3.1 KB; about 25 KB less per cold page. Time effect at 9 Mbps is inside noise
(B1 vs B2 1725 vs 1638 ms); it matters on slower links (25 KB is 130 ms at 1.6
Mbps).

**Recommendation.** Pre-compress at build time (gzip level 9 or zopfli) and
serve with `gzip_static on` (stock module), add `application/json image/svg+xml`
to `gzip_types`, and enable brotli at the TLS edge (Traefik's compress
middleware) or with an nginx build that includes `ngx_brotli`.

### FER-09 One 115 KB render-blocking stylesheet for all protected pages

- **Severity:** Low
- **Status:** Verified (dynamic)
- **Where:** `apps/web/src/styles/application.css` (imports `settings.css`,
  `person-*.css`, `people.css`, `pages.css` ... all unconditionally);
  `apps/web/src/layouts/ApplicationLayout.astro:3-4`.

**What happens.** `ApplicationLayout.astro` imports `application.css`, which
imports every feature stylesheet, so every protected page downloads the same
`ApplicationLayout.*.css`: 114.9 KB raw, 19.9 KB gzip, 16.6 KB brotli. It also
carries Tailwind's `theme/base/components/utilities` layers once per layout
bundle, not per page. Public and auth pages already get their own small bundles
(13.5 and 8.3 KB).

**Evidence.** CSS coverage at ready (M4): Today uses 29 of 115 KB (25%), People
29 KB, Settings 26-27 KB (23-24%), Tasks 25 KB (21%), Person 47 KB (41%). The
stylesheet is render-blocking; at 1.6 Mbps its 19.9 KB gzip is about 100 ms
before first paint. Related, markup weight: the person shell's HTML is 119 KB
raw, of which 73 KB are `class` attributes (one Tailwind skeleton gradient
string repeats 143 times); it gzips to 11.3 KB, so it costs DOM size and parse
time rather than bytes, and one `.skeleton` class would remove most of it.

**Recommendation.** Import `shell/base/tokens/components` from the layout and
let each page group import its own CSS (`settings.css` only on settings pages,
`person-*.css` only in the person shell, `people.css` on People). Astro emits
one stylesheet per page group automatically. Estimate from the coverage numbers:
25-45 KB raw per page instead of 115 KB.

### FER-10 `/privacy` and `/terms` are static shells whose body is a client fetch

- **Severity:** Low
- **Status:** Verified (dynamic)
- **Where:** `apps/web/src/pages/privacy.astro:1-18`, `terms.astro`;
  `apps/web/src/lib/legal.ts:19-41` (`getPublicLegalDocument` then
  `textContent`); `apps/web/src/pages/index.astro:93-111` (`checkApiReadiness`).

**What happens.** The catalog marks the legal pages `static`, but their HTML
contains only "Loading privacy policy..." and an empty `<article>`. The text is
operator-managed, versioned data in `crm.legal_documents` (served by
`GET /api/v1/legal-documents/{type}`), so a runtime fetch is justified, but it
starts only after a 5-level module chain (FER-02), needs JavaScript, and is
invisible to crawlers and no-JS readers. The home page also issues an
unauthenticated `GET /api/v1/health` on every view to print "API ready".

**Evidence.** Phone profile, cold: FCP 372 ms ("Loading privacy policy..."), the
text replaced at 868 ms (HTTP/1.1) and 864 ms (HTTP/2); with `modulepreload` 521
ms. Ten requests, 3-8 KB of JavaScript.

**Impact.** Small in bytes, but the one public page a visitor must read before
creating an account is the slowest public page to show its content, and it is
the one public route whose body genuinely is request-time data (the case SSR
exists for).

**Recommendation.** Cheap: `modulepreload` (FER-02) plus a `<noscript>` line
linking to the API document. Better: render these two routes through the
existing renderer with a short shared cache (for example `proxy_cache`, 5
minutes) so the HTML carries the text, needs no JS, and is crawlable; this is
the one public place where on-demand rendering earns its keep, and it would
replace the five that do not (FER-03). Decide whether the home page's health
badge is worth an API call per visit.

### FER-11 No byte or Web-Vitals budget is enforced

- **Severity:** Low
- **Status:** Verified (static, code read)
- **Where:** `docs/architecture/quality-gates.md:369`;
  `docs/architecture/decisions/0006-ui-stack-shadcn-react-islands.md:98,111`;
  `docs/planning/quality-and-operations.md:545`;
  `tools/web_build_output_test.ts:248-264` (`logHydratedBytes` only
  `console.log`s); `tests/e2e/perf.PERF-001.spec.ts` (server-side ceilings
  only).

**What happens.** ADR 0006 and the quality plan promise "a hydration budget that
is measured and recorded" and "public/static and authenticated-shell asset
budgets and Web Vitals". The build test records the bytes and asserts only that
React is not reachable from public pages; nothing fails when the shell grows.
FER-01 is exactly the unbounded growth this allows: the layout went from one
island to three without any check noticing.

**Recommendation.** Add thresholds to `web_build_output_test.ts` from the
numbers above (for example: a protected page with no island of its own <= 40 KB
brotli, the layout's eager JS <= 150 KB brotli today and lower after FER-01; the
protected stylesheet <= 30 KB gzip after FER-09) and one production-built
Playwright check for Today CLS < 0.1 and the person workspace LCP on the `cpu4`
profile.

### FER-12 The Inter font is not preloaded

- **Severity:** Low
- **Status:** Verified (dynamic)
- **Where:** `apps/web/src/styles/fonts.css`;
  `docs/planning/active-delivery.md:3458-3460` (an accepted decision: "no
  preload ... `font-display: swap` is the accepted strategy").

**Evidence.** One 48 KB variable woff2 (latin subset), `font-display: swap`,
requested only after the CSS is parsed (phone waterfall: 339-656 ms). The swap
shifts public text: CLS `/` 0.015, `/features` 0.035, `/docs/api` 0.030
(desktop). With one
`<link rel="preload" as="font" type="font/woff2" crossorigin href="/_astro/inter-latin-wght-normal.*.woff2">`
the same three pages measure 0.000.

**Recommendation.** Revisit the decision: all values are below the 0.1 "good"
line, so this is polish, but the fix is one link per layout (import the font URL
in the layout). Alternatively add a metric-matched fallback `@font-face`
(`size-adjust`).

### FER-13 Pre-hydration window on forms; `bindSubmitEarly` is dead code

- **Severity:** Info
- **Status:** Verified (dynamic)
- **Where:** `apps/web/src/lib/early-submit.ts` (referenced only by its own
  test); `apps/web/src/lib/form-method-contract.test.ts:5-10`;
  `apps/web/src/pages/auth/sign-in.astro:14`.

A sign-in form is visible at FCP but wired only when its 5-level module chain
has executed: 380 ms vs 748 ms (phone), 576 vs 1025 ms (slow 4G), a 370-450 ms
window. A submit in that window falls through to the browser's native POST,
which the gateway answers `405 Not Allowed` (checked: `POST /auth/sign-in` and
`POST /app/people/new` both 405). REL-041 chose that deliberately (no data in a
URL); `bindSubmitEarly`, the helper that held an early submission and replayed
it, is no longer imported by any production module. Shortening the chain
(FER-02) shrinks the window; re-adopting the helper in the auth forms removes
the dead end.

### FER-14 `/docs/api` ships no JS but needs 692 ms to first paint at 4x CPU

- **Severity:** Info
- **Status:** Verified (dynamic)
- **Where:** `apps/web/src/pages/docs/api/index.astro`.

The page is a single 168 KB document (16.6 KB gzip, 2,690 elements, 52
`<details>`, 202 `<pre>`) and the OpenAPI JSON is a separate prerendered file,
not embedded. On `cpu4` FCP is 692 ms (528 ms on the Node server) with 306-558
ms of long tasks, all HTML/style/layout. A CSS-only experiment
(`content-visibility: auto; contain-intrinsic-size: auto 600px` on
`.reference-operation`, `.reference-content > section`, `.reference-table`) took
FCP from 528 ms to 288 ms (-45%) and long tasks from 558 to 286 ms on `cpu4` (5
runs each, Node server, ranges 492-596 vs 280-368). Worth doing when the page is
next touched.

### FER-15 `style-src 'unsafe-inline'` was not needed by any exercised page

- **Severity:** Info (for the security agents)
- **Status:** Verified (dynamic) for the 21 pages and shell dialogs exercised;
  Suspected for the dialogs not opened
- **Where:** `gateway/security_headers.conf`
  (`style-src 'self' 'unsafe-inline'`).

The built HTML has no `style=""` attribute (0 in the person shell) and no
`<style>` element (the only one is nginx's own `50x.html`). Serving the same
files with `style-src 'self'` and driving 21 pages (public, auth, every top
level app page, Settings subpages), the search palette, Quick capture, the
notification bell and the member menu produced zero violations (positive
control: an injected `style=""` attribute and a `<style>` element are both
reported; CSSOM writes by React and Base UI are not blocked by CSP). Dropping
`'unsafe-inline'` looks free; test the avatar editors and date pickers first.

### FER-16 Every in-app navigation is a full document load

- **Severity:** Info
- **Status:** Verified (dynamic)
- **Where:** `location.assign` / links throughout `apps/web/src`; no
  `ClientRouter`, no prefetch, no `client:*`; `pushState` only for in-page
  section state (`features/person/workspace.ts:181, 801, 822`,
  `features/settings/personalization/personalization.tsx:394`).

A signed-in tab, warm HTTP cache and the 60 s session accelerator in effect
(`nav.mjs`: click a link, time until the destination is ready, median of 5;
requests include cache hits):

| Click                            | 4x CPU | 4x CPU + 4G (HTTP/1.1) | 4x CPU + 4G (HTTP/2 server) | Requests |
| -------------------------------- | ------ | ---------------------- | --------------------------- | -------- |
| Today to People (primary nav)    | 764 ms | 1367 ms                | 1406 ms                     | 56       |
| People to Person (row link)      | 911 ms | 1411 ms                | 1467 ms                     | 81       |
| Settings overview to Preferences | 383 ms | 900 ms                 | 973 ms                      | 51       |
| Person to Today (brand link)     | 488 ms | 1406 ms                | 1290 ms                     | 53       |

HTTP/2 does not change it: with warm caches the time is JavaScript evaluation
(parse, three shell React roots, module graph) plus the API chain of FER-04, not
bytes. This is the price of a multi-page app whose pages fetch their data
client-side, and it is the architecture the ADRs chose ("there is no SPA"). No
gratuitous reloads were found: directory filters, search, tabs, section deep
links, load-more and bulk actions update in place; a document load happens for
navigation, workspace switch (`application-shell.ts:417` navigates to the same
URL), sign-in and sign-out.

A client router would remove the repeated shell boot but contradicts ADR 0006
and brings its own lifecycle problems (the shell script and every island assume
a fresh document), so it is not recommended. The in-ADR levers are the ones
above: FER-01 (the shell boots only what the page needs) and FER-04 (no
serialized duplicate reads) shorten every click; Astro's built-in `prefetch` for
the four primary-nav links would only warm the HTML, which is already tiny and
cached.

## Checked and sound

- **Catalog conformance (scope 1), mechanical.** Parsing
  `docs/product/page-catalog.yaml` and resolving each path the way nginx does
  (`conformance.mjs`): 39 of 39 delivered pages are served with the strategy the
  catalog names; the 5 `on-demand` entries are exactly the 5 nginx locations
  that `proxy_pass $web_upstream` (plus the internal readiness location); no
  route reaches the renderer that is not on the catalog's on-demand list, and
  none is missing. `settings.billing` is `availability: optional-module` and not
  built. The five dynamic app routes (person, person audit, activity report,
  journal item, import report) resolve to prerendered `internal/*` shells and
  `/internal/*` is `404` to clients. `export const prerender` is `true` on every
  page except the five.
- **Public and auth pages ship no React.** Reachability through static and
  dynamic imports confirms it (`web_build_output_test.ts` GAP-026/033 gates, and
  the import closures in M3): `/features`, `/docs/api`, `/404` ship 0 B of
  JavaScript; `/` 0.8 KB; privacy/terms 5.2 KB; auth pages 5-10 KB of vanilla
  TypeScript.
- **No protected data reaches signed-out visitors, and nothing flashes.** The
  static shell markup is `hidden` and the access skeleton/card is shown until
  the session resolves; the signed-out result is a "Sign in to Kinship" card
  (CLS 0 on the skeleton swap), and all data is fetched with the cookie. The
  session accelerator (`workspace-context.ts:10`, 60 s `sessionStorage`) skips
  the session round trip on quick navigations.
- **Person workspace island granularity is good.** About 20 islands, each a
  separate dynamically imported chunk, activated by zone; on a narrow viewport
  the Timeline zone does not mount until needed. Section state uses
  `history.pushState`/`popstate` for deep links, which is what the catalog's
  `?section=` contract calls for.
- **No SPA behavior beyond what the product defines.** No client router, no
  `client:*` directive (30 `mountIsland` call sites), no view transitions, no
  prefetch; navigation is multi-page. The personalization page and the person
  workspace are the only pages with in-page navigation, and both are specified.
- **Asset delivery basics.** `/_astro/` is fingerprinted,
  `public, max-age=31536000, immutable`, `Vary: Accept-Encoding`; one font file;
  no images; the CSP forbids inline scripts except the single hashed theme
  bootstrap and `web_build_output_test.ts` verifies it for every page.
- **Bundle hygiene.** React exists once (`client.*`); `lucide-react` is
  tree-shaken; cmdk's Radix dialog is stubbed out (GAP-027 gate); the API
  reference page does not embed the OpenAPI document (the 91 KB JSON is a
  separate download); the generated client is tree-shaken per operation (about
  25 KB raw in total for Today); `zod-jitless` (69 KB) is only loaded by the
  three form-heavy pages and lazily on the person page; no development-only
  React refresh code is in the production output.

## Reproduction

Shared scratchpad `S` is temporary; the essentials are inlined. Everything runs
from Git Bash with `MSYS_NO_PATHCONV=1` where a URL path is passed as an
argument.

1. **Production bytes and static analysis.**
   `docker cp kinship-audit-gateway-1:/usr/share/nginx/html ./html`, then this
   script (`node analyze.mjs html`) prints the per-page table behind M3:

   ```js
   // analyze.mjs: static import closure per HTML page
   import fs from "node:fs";
   import path from "node:path";
   import zlib from "node:zlib";
   const root = process.argv[2];
   const imp =
     /(?:^|[;}\s,])(?:import|export)\s*(?:[^'"();]*?\bfrom\s*)?["'](\.\/[^"']+\.js)["']/g;
   const deps = new Map();
   const get = (f) =>
     deps.get(f) ??
       (deps.set(
         f,
         fs.existsSync(path.join(root, f))
           ? [
             ...new Set(
               [...fs.readFileSync(path.join(root, f), "utf8").matchAll(imp)]
                 .map((m) => "_astro/" + m[1].slice(2)),
             ),
           ]
           : [],
       ),
         deps.get(f));
   const closure = (entries) => {
     const seen = new Set(), q = [...entries];
     while (q.length) {
       const f = q.shift();
       if (seen.has(f) || !fs.existsSync(path.join(root, f))) continue;
       seen.add(f);
       q.push(...get(f));
     }
     return [...seen];
   };
   const depth = (f, stack = new Set()) =>
     stack.has(f)
       ? 0
       : 1 + Math.max(0, ...get(f).map((d) => (stack.add(f), depth(d, stack))));
   for (const page of walk(root)) { // walk(): every *.html outside _astro
     const html = fs.readFileSync(path.join(root, page), "utf8");
     const entries = [
       ...html.matchAll(/<script[^>]*\bsrc="\/(_astro\/[^"]+)"/g),
     ].map((m) => m[1]);
     const files = closure(entries);
     const size = (f, z) => z(fs.readFileSync(path.join(root, f))).length;
     const sum = (z) => files.reduce((s, f) => s + size(f, z), 0);
     console.log(
       page,
       files.length,
       sum((b) => b),
       sum((b) => zlib.gzipSync(b, { level: 5 })),
       sum((b) => zlib.brotliCompressSync(b)),
       Math.max(0, ...entries.map((e) => depth(e))),
       files.some((f) => /^_astro\/client\./.test(f)) ? "react" : "-",
     );
   }
   ```

2. **Account and seed.** `account.ts audit-fer-1@example.test "FER Workspace"`
   from the shared context, then a Node script that, with the cookie, calls
   `POST /api/v1/settings/personalization/{contact-method-types,activity-types, life-event-types}`,
   `POST /api/v1/people` (60 times), and for one person
   `POST .../facts/{contact-methods,addresses,work,first-meeting}`
   (`expectedPersonUpdatedAt` from the matching `GET`), `.../dates`,
   `.../life-events`, `POST /api/v1/interactions` (kinds `note`, `activity`,
   `call`), `POST /api/v1/tasks`, `/reminders`, `/stay-in-touch-cadences`,
   `.../gifts`, `.../debts`, `.../relationships`, and `POST .../view` (no body)
   for 7 people; all with header `Origin: https://127.0.0.1:18443`.

3. **Runtime harness (core of `measure.mjs`).**

   ```js
   const SPKI = "L90xdHAchGmxLP8kZjS3WDlvTcrFaiaIYPjlSy9KG2E="; // openssl x509 -pubkey | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64
   const browser = await chromium.launch({
     args: [`--ignore-certificate-errors-spki-list=${SPKI}`],
   });
   const ctx = await browser.newContext({
     viewport: { width: 412, height: 915 },
     isMobile: true,
     hasTouch: true,
     deviceScaleFactor: 2.625,
     serviceWorkers: "block",
   });
   await ctx.addCookies([{
     name: "kinship_session",
     value,
     domain: "127.0.0.1",
     path: "/",
     secure: true,
     httpOnly: true,
     sameSite: "Strict",
   }]);
   const page = await ctx.newPage();
   const cdp = await ctx.newCDPSession(page);
   await cdp.send("Network.enable");
   await cdp.send("Performance.enable");
   await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
   await cdp.send("Network.emulateNetworkConditions", {
     offline: false,
     latency: 100,
     downloadThroughput: 9e6 / 8,
     uploadThroughput: 3e6 / 8,
   });
   await page.addInitScript(() => { // observers + "ready" watchers, installed before any page script
     const perf = window.__perf = {
       lcp: [],
       fcp: null,
       longtasks: [],
       cls: 0,
       ready: {},
     };
     const obs = (type, cb) =>
       new PerformanceObserver((l) => l.getEntries().forEach(cb)).observe({
         type,
         buffered: true,
       });
     obs(
       "longtask",
       (e) => perf.longtasks.push({ s: e.startTime, d: e.duration }),
     );
     obs("largest-contentful-paint", (e) => perf.lcp.push(e.startTime));
     obs(
       "paint",
       (e) => e.name === "first-contentful-paint" && (perf.fcp = e.startTime),
     );
     obs("layout-shift", (e) => e.hadRecentInput || (perf.cls += e.value));
     const conds = {
       shell_visible: () => !document.querySelector("#protected-shell")?.hidden,
       /* ... */
     };
     const check = () => {
       for (const [k, f] of Object.entries(conds)) {
         if (perf.ready[k] === undefined && f()) {
           perf.ready[k] = performance.now();
         }
       }
     };
     // observe `document` (it exists before <html>) so milestones before DOMContentLoaded are timestamped when they happen
     new MutationObserver(check).observe(document, {
       attributes: true,
       childList: true,
       subtree: true,
       characterData: true,
     });
     (function tick() {
       check();
       requestAnimationFrame(tick);
     })();
   });
   await page.goto(origin + path, { waitUntil: "load" }); // cold = new context, warm = second goto in the same context
   ```

   Predicates passed to `page.waitForFunction` must be real functions, not
   strings: the page CSP (`script-src` without `unsafe-eval`) breaks
   Playwright's string form for most expressions. The first version of this
   harness started its watchers at DOMContentLoaded, so a milestone that
   happened earlier was reported as DOMContentLoaded; the shell-island arms
   C4/C5 and the validation re-run (see Method) use the watcher above.

4. **Delivery variants.** `variant-server.mjs` (about 100 lines) serves `html/`
   exactly like nginx (UUID shell rewrites, immutable `_astro`,
   `security_headers.conf`) and proxies `/api/v1/*` to the gateway with the
   `Origin` rewritten to the public origin:

   ```js
   // handler(req, res), condensed
   if (url.pathname.startsWith("/api/v1/")) return proxy(req, res); // https.request to 127.0.0.1:18443, Origin rewritten
   const rel = url.pathname.startsWith("/_astro/")
     ? url.pathname.slice(1)
     : UUID_PERSON.test(url.pathname)
     ? "internal/person-profile-shell/index.html" // + audit / activity-report / journal / import shells
     : firstExisting([p, `${p}/index.html`, `${p}.html`]);
   const e = load(rel); // read once, pre-compress gzip -5 (and brotli -11 when BR=1)
   headers = {
     ...securityHeaders,
     "content-type": mime,
     vary: "Accept-Encoding",
   };
   if (rel.startsWith("_astro/")) {
     headers["cache-control"] = "public, max-age=31536000, immutable";
   }
   // content-encoding by Accept-Encoding; LASTMOD=1 adds Last-Modified/ETag (+304) for the heuristic-caching probe
   const server = process.env.H2 === "1"
     ? http2.createSecureServer({ key, cert, allowHTTP1: true }, handler)
     : https.createServer({ key, cert }, handler);
   // BR=1: pre-compress brotli q11, answer by Accept-Encoding
   // PRELOAD=1: html.replace("</head>", closure.map(f => `<link rel="modulepreload" href="/${f}">`).join("") + "</head>")
   // HEADSCRIPTS=1: move the trailing <script type=module src> tags into <head>
   // PATCH_NOSTORE=1: serve request.*.js with `await fetch(e,{cache:"no-store",...t,`
   ```

   The interleaved core arms (M5a) are `measure.mjs` with `--coldonly`, run as
   three rounds over the arms, two runs per arm per round, then pooled:

   ```sh
   for round in 1 2 3; do
     for arm in A0 C1 C4 B1 B3 C2 C5; do          # origin / flags per arm:
       #  A0 :18443   C1 :18443 --abort "$ISLANDS"   C4 :18443 --lazy "$ISLANDS"
       #  B1 :18461   B3 :18465   C2 :18461 --abort  C5 :18461 --lazy
       node measure.mjs --profile phone --reps 2 --coldonly true \
         --only today,settings-index,person --origin "$origin" $flags --out il-$arm-$round.json
     done
   done   # ISLANDS='ApplicationLayout\.astro_astro_type_script_index_1_lang\..*\.js$'
   ```

   Ports used: 18461 h2, 18462 h1, 18463 h2+br, 18464 h1+preload, 18465
   h2+preload, 18466 h2+br+preload, 18468 head scripts, 18469 session preload,
   18467 `style-src 'self'`, 18470 font preload, 18472 `content-visibility`,
   18473 patched client. The shell-island what-ifs use
   `ctx.route(/ApplicationLayout\.astro_astro_type_script_index_1_lang\..*\.js$/, r => r.abort())`
   (arm C) and, for the lazy variant, a stub `export {};` response followed by
   `import(url + "?real")` once the page is ready.

5. **Probes.** Identical-GET serialization (seven `fetch()` calls from the page
   at `latency: 100`, three modes as in FER-04); layout-shift sources
   (`PerformanceObserver` `layout-shift` with `sources`); coverage
   (`page.coverage.startJSCoverage/startCSSCoverage`, painting V8 function
   ranges, outer functions first); redeploy (first server serves `html/`, a
   second one on the same port serves the same HTML with an empty `_astro/`;
   `Last-Modified`/`ETag` enabled so heuristic caching applies); CSP (a server
   sending `style-src 'self'` and a `securitypolicyviolation` listener while
   driving 21 pages and the shell dialogs); catalog conformance (parse the
   catalog's `id/path/rendering`, resolve with nginx's rules).

6. **Commands that were read-only on the shared stack:**
   `curl -sk -D - https://127.0.0.1:18443/<path>`,
   `openssl s_client -connect 127.0.0.1:18443 -alpn h2,http/1.1`,
   `docker exec kinship-audit-gateway-1 nginx -V`,
   `docker exec kinship-audit-web-1 du -sh /app/node_modules`,
   `docker stats --no-stream`, `docker images`.
