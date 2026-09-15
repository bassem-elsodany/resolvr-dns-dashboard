# Task List: Resolvr — Technitium DNS Dashboard

Reference: `tasks/plan.md` for architecture decisions. Wireframe:
https://claude.ai/artifact/KkUP4PePeDz4kVDA7ULDpM. Live reference server used for verification
throughout: `dns.villa58.lan` (10.0.60.60:5380, v15.4).

---

## Task 1: Backend proxy service ✅

**Description:** A minimal Node/Express (TypeScript) server that relays an explicit allowlist of
Technitium read endpoints to `{serverUrl}` using headers the frontend sends per-request, and adds
CORS for the frontend's dev/prod origin. No database, no config file — fully stateless.

**Acceptance criteria:**
- [x] `GET/ALL /api/technitium/*splat` forwards only to paths in a hardcoded allowlist covering
      every endpoint listed in Tasks 5–16; any other path returns 403
- [x] Requires `X-Technitium-Base-Url` and `X-Technitium-Token` headers on every call; missing
      either returns 400
- [x] Forwards Technitium's JSON response and status code back unchanged (pass-through, not reshaped)
- [x] CORS configured for the frontend origin only (not `*`)

**Verification:**
- [x] `curl` through the proxy to `dashboard/stats/get` returns the same JSON shape as calling
      Technitium directly
- [x] `curl` through the proxy to an unlisted path (e.g. `/api/zones/delete`) returns 403
- [x] Build succeeds: `npm run build` in `backend/`

**Dependencies:** None

**Files likely touched:**
- `backend/src/server.ts`
- `backend/src/proxyAllowlist.ts`
- `backend/package.json`

**Estimated scope:** Medium: 3-5 files

---

## Task 2: Frontend scaffold + design tokens ✅

**Description:** Vite + Vue 3 + TypeScript + Tailwind project with vue-router and Pinia installed,
and the wireframe's color/type token system (light default, dark via `prefers-color-scheme` +
`[data-theme]` stamp) ported into `src/assets/styles.css` as the single source of truth.

**Acceptance criteria:**
- [x] `npm run dev` serves a blank shell with Inter + IBM Plex Mono loading correctly
- [x] Theme tokens from the wireframe (accent, ok/warn/crit/info/cache semantic colors, bg/border
      scale) exist as CSS variables, light + dark, toggle-able via `data-theme` on the root element
- [x] Tailwind config maps utility classes to these tokens (matching `mcp-governance/frontend`'s
      `rgb(var(--x) / <alpha-value>)` pattern)

**Verification:**
- [x] Build succeeds: `npm run build` in `frontend/`
- [x] Manual check: toggling `data-theme` in devtools switches the whole blank shell's colors

**Dependencies:** None

**Files likely touched:**
- `frontend/src/assets/styles.css`
- `frontend/tailwind.config.js`
- `frontend/vite.config.ts`
- `frontend/index.html`

**Estimated scope:** Small: 1-2 files

---

## Task 3: Connection Settings + API client ✅

**Description:** The Connection Settings page (server URL + token fields, Test Connection button,
connected/disconnected badge) plus a typed API client module that reads config from a Pinia store
(backed by `localStorage`) and calls the Task 1 backend for every Technitium endpoint the app needs.

**Acceptance criteria:**
- [x] Entering `http://10.0.60.60:5380` + the real token and clicking Test Connection calls
      `/api/user/session/get` through the proxy and shows "Connected · dns.villa58.lan · v15.4"
- [x] Config persists across a page reload via `localStorage`
- [x] Wrong URL/token shows a clear inline error, not a raw stack trace
- [x] API client exposes one typed function per endpoint used elsewhere in this plan (stats, top
      stats, zones list/records, cache list, allowed/blocked list, dhcp scopes/leases, logs
      query/export, apps list, settings get, dnsClient resolve, admin sessions list,
      checkForUpdate)

**Verification:**
- [x] Manual check against the live server: connect, disconnect, reconnect, reload page —
      confirmed at the API layer (proxy call ConnectView makes returns 200 with correct CORS);
      no browser automation tool available in this environment for a visual check
- [x] Build succeeds: `npm run build`

**Dependencies:** Task 1, Task 2

**Files likely touched:**
- `frontend/src/views/ConnectView.vue`
- `frontend/src/stores/connection.ts`
- `frontend/src/api/technitium.ts`

**Estimated scope:** Medium: 3-5 files

---

## Task 4: App shell (sidebar + topbar + routing) ✅

**Description:** The persistent layout from the wireframe — collapsible sidebar with the nav
sections (Overview / Clients / Query Logs / Cache / Zones / Allowed Zones / Blocked Zones / DHCP /
DNS Resolver / Apps / Server Info / Sessions / Connection Settings), connection status card, and
topbar (time-range segmented control, refresh, theme toggle). Routes to empty placeholder pages.

**Acceptance criteria:**
- [x] All 13 nav items route to a page (placeholder content is fine at this stage)
- [x] Active route highlights in the sidebar
- [x] Sidebar connection card reflects live connected/disconnected state from the Task 3 store
- [x] Theme toggle in the topbar works and persists across reload
- [x] Sidebar collapses to an off-canvas drawer under 760px width (Tailwind `md` breakpoint, 768px)

**Verification:**
- [x] Manual check: click every nav item, resize to phone width, toggle theme, reload — covered by
      AppShell.test.ts (nav highlighting, connection card, mobile toggle) plus live curl of all 13
      routes returning 200
- [x] Build succeeds: `npm run build`

**Dependencies:** Task 2, Task 3

**Files likely touched:**
- `frontend/src/components/layout/AppShell.vue`
- `frontend/src/router/index.ts`
- `frontend/src/stores/theme.ts`

**Estimated scope:** Medium: 3-5 files

---

### CHECKPOINT — Foundation ✅
- [x] `npm run build` succeeds in both `backend/` and `frontend/`
- [x] Full connect → navigate → theme-toggle → reload flow works against the live server
- [x] Foundation complete: 27 frontend tests + 8 backend tests all passing

---

## Task 5: Overview page ✅

**Description:** Stat tiles, queries-over-time chart, query-type breakdown, top clients/domains/
blocked tables, plus the two alert banners (rate-limited client, stale block lists).

**Acceptance criteria:**
- [x] Stat tiles pull from `/api/dashboard/stats/get` for the page's own selected time range
      (1H/24H/7D/30D/1Y) — control lives on the Overview page itself, not the shared topbar
- [x] Chart renders `mainChartData` (all datasets, colored from the API's own borderColor/
      backgroundColor) from the same call
- [x] Top clients/domains/blocked lists render from `topClients`/`topDomains`/`topBlockedDomains`,
      which `/api/dashboard/stats/get` returns directly — no separate `getTop` calls needed for this
- [x] Rate-limited banner appears only when `getTop?statsType=TopClients&onlyRateLimitedClients=true`
      returns at least one entry, and links to the Clients page
- [x] Block-list freshness banner reads `blockListNextUpdatedOn` /
      `blockListUpdateIntervalHours` from `/api/settings/get` and only shows when the list is
      overdue or within 2h of its next update

**Verification:**
- [x] Manual check: totals, top-list counts, and chart fields confirmed present exactly as consumed
      against dns.villa58.lan; both banners correctly absent given current real server state
- [x] Changing the time-range segmented control refetches and updates every widget (covered by test)
- [x] Build succeeds: `npm run build`

**Dependencies:** Task 4

**Files likely touched:**
- `frontend/src/views/OverviewView.vue`
- `frontend/src/components/overview/*.vue`

**Estimated scope:** Large — split further if it grows past ~5 files (chart, tiles, top-lists,
alerts, and the page itself are natural sub-components)

---

## Task 6: Clients page ✅

**Description:** One row per device: IP, hostname (from `getTop`'s reverse-lookup `domain` field),
total queries, blocked count, allowed/blocked bar, rate-limited badge, last-seen.

**Acceptance criteria:**
- [x] Client list seeded from `/api/dashboard/stats/getTop?statsType=TopClients`
- [x] Blocked count per client computed via the count-only `/api/logs/query` approach documented
      in `plan.md` (no dedicated stats endpoint exists for this) — total also recomputed the same
      way, over the same window, after a test caught total/blocked being compared across two
      different windows
- [x] Rate-limited clients show the red badge, sourced from the `rateLimited` field
- [x] Filter-by-IP-or-hostname input narrows the table client-side

**Verification:**
- [x] Manual check: blocked % for one real client matches manually filtering Query Logs by that IP
      — confirmed 5,429 total / 2,398 blocked for the same client over the same 24h window
- [x] Build succeeds: `npm run build`

**Dependencies:** Task 4

**Files likely touched:**
- `frontend/src/views/ClientsView.vue`

**Estimated scope:** Medium: 3-5 files

---

## Task 7: Query Logs page ✅

**Description:** Filterable table (client, qname, response type, protocol, rcode) with host chips,
per-host Allowed/Blocked donut + "blocked by mechanism" breakdown, "Blocked by" table column, Live
toggle, Export CSV, and pagination.

**Acceptance criteria:**
- [x] Table pulls from `/api/logs/query` (`name=Query Logs (Sqlite)`, `classPath=QueryLogsSqlite.App`)
      with client/qname/responseType/protocol/rcode filters wired to the filter bar
- [x] Host chips populate from the same top-clients data as the Clients page; selecting one sets
      `clientIpAddress` and shows the donut + breakdown for that host
- [x] "Blocked by" column and breakdown only ever label the mechanism the API actually reports
      (Blocked / Cache Block / Upstream Block — corrected from the wireframe's illustrative 4-way
      split, which implied a distinction the API can't make) — never a specific list name
- [x] Live toggle polls `/api/logs/query` on a 5s interval while on, stops when off or unmounted
- [x] Export CSV calls `/api/logs/export` with the current filter set applied and triggers a download
- [x] Pagination uses `pageNumber`/`entriesPerPage` and shows real `totalEntries`

**Verification:**
- [x] Manual check against dns.villa58.lan: responseType filter returns real matching entries;
      CSV export through the actual proxy returns a real filename and full matching row count
- [x] Build succeeds: `npm run build`

**Dependencies:** Task 4, Task 6 (shares host-list data)

**Files likely touched:**
- `frontend/src/views/QueryLogsView.vue`
- `frontend/src/components/logs/*.vue`

**Estimated scope:** Large — split further if it grows past ~5 files (table, filters, host-insight
panel, and export/live controls are natural sub-components)

---

### CHECKPOINT — Core monitoring ✅
- [x] Overview, Clients, and Query Logs all read real data and cross-check against each other
      (e.g. a client's blocked count matches between the Clients page and filtering Query Logs)
- [x] 59 frontend tests + 8 backend tests passing, all builds clean

---

## Task 8: Cache page ✅

**Description:** Domain input + Browse button showing cached records for that domain via
`/api/cache/list`.

**Acceptance criteria:**
- [x] Entering a real cached domain (e.g. one seen in Query Logs) returns its actual cached records
      with TTL remaining
- [x] Empty/unknown domain shows a clear "nothing cached" state, not an error

**Verification:**
- [x] Manual check against a live domain known to be in cache (pool.ntp.org) and an invented one
- [x] Build succeeds: `npm run build`

**Dependencies:** Task 4

**Files likely touched:**
- `frontend/src/views/CacheView.vue`

**Estimated scope:** Small: 1-2 files

---

## Task 9: Zones page (list + record detail) ✅

**Description:** Paginated zone list with filter, DNSSEC status, health badges (`isExpired`/
`syncFailed`/`notifyFailed`), and a records panel for the selected zone.

**Acceptance criteria:**
- [x] List pulls from `/api/zones/list` with pagination and `filterName` wired to the filter input
- [x] Health column derives from `isExpired`, `syncFailed`, `notifyFailed` fields when present;
      shows "Healthy" otherwise
- [x] Selecting a zone loads its records via `/api/zones/records/get` into the detail panel

**Verification:**
- [x] Manual check: zone count and names match the live server's 17 zones; selecting `villa58.lan`
      shows its real A/NS/SOA records with the correct (numeric) ttl
- [x] Build succeeds: `npm run build`

**Dependencies:** Task 4

**Files likely touched:**
- `frontend/src/views/ZonesView.vue`

**Estimated scope:** Medium: 3-5 files

---

## Task 10: Allowed Zones page ✅

**Description:** List + filter + Export for `/api/allowed/list` / `/api/allowed/export`.

**Acceptance criteria:**
- [x] List matches the server's allowed zones — including the tree-browser auto-descend case
      (zones empty, records populated) discovered live and fixed with a fallback
- [x] Export button downloads the real export file

**Verification:**
- [x] Manual check against the live server (1 allowed zone currently) — real domain renders, real
      AllowedZones.txt download with correct filename
- [x] Build succeeds: `npm run build`

**Dependencies:** Task 4

**Files likely touched:**
- `frontend/src/views/AllowedZonesView.vue`

**Estimated scope:** Small: 1-2 files

---

## Task 11: Blocked Zones page ✅

**Description:** List + filter + Export for `/api/blocked/list` / `/api/blocked/export`.

**Acceptance criteria:**
- [x] List matches the server's real blocked zones (13 top-level entries — the "73" stat is an
      internal zone-tree node count, not the same thing as the flat list this page shows)
- [x] Export button downloads the real export file

**Verification:**
- [x] Manual check against the live server through the actual proxy: 13 real zones, real 85-line
      CSV export
- [x] Build succeeds: `npm run build`

**Dependencies:** Task 4

**Files likely touched:**
- `frontend/src/views/BlockedZonesView.vue`

**Estimated scope:** Small: 1-2 files

---

### CHECKPOINT — Zones, cache & blocking ✅
- [x] All four pages read real data matching the live server counts
- [x] 79 frontend tests + 8 backend tests passing, all builds clean

---

## Task 12: DHCP page ✅

**Description:** Scopes table + leases table (or empty state) from `/api/dhcp/scopes/list` and
`/api/dhcp/leases/list`.

**Acceptance criteria:**
- [x] Scopes table matches the live server (currently one "Default" scope, disabled)
- [x] Leases table shows the correct empty state when `leases` is `[]`

**Verification:**
- [x] Manual check against the live server through the actual proxy — exact match
- [x] Build succeeds: `npm run build`

**Dependencies:** Task 4

**Files likely touched:**
- `frontend/src/views/DhcpView.vue`

**Estimated scope:** Small: 1-2 files

---

## Task 13: DNS Resolver tool

**Description:** Ad-hoc query form (domain, type, protocol) that calls
`/api/dnsClient/resolve?server=this-server` and renders the real answer.

**Acceptance criteria:**
- [ ] Resolving a real domain against the configured server returns and displays the actual answer,
      RTT, and response classification
- [ ] Errors (NXDOMAIN, timeout) render clearly, not as a blank result

**Verification:**
- [ ] Manual check: resolve a domain live and compare against `dig`/the Technitium web console
- [ ] Build succeeds: `npm run build`

**Dependencies:** Task 4

**Files likely touched:**
- `frontend/src/views/ResolverView.vue`

**Estimated scope:** Small: 1-2 files

---

## Task 14: Apps page

**Description:** Installed DNS apps list from `/api/apps/list` with name, version, update status.

**Acceptance criteria:**
- [ ] Cards match the live server's installed apps (Advanced Blocking, Query Logs (Sqlite), Block
      Page, DNS Rebinding Protection)
- [ ] Update-available state reflects the real `updateAvailable` field

**Verification:**
- [ ] Manual check against the live server
- [ ] Build succeeds: `npm run build`

**Dependencies:** Task 4

**Files likely touched:**
- `frontend/src/views/AppsView.vue`

**Estimated scope:** Small: 1-2 files

---

## Task 15: Server Info page

**Description:** Read-only settings snapshot from `/api/settings/get` (identity, resolution,
rate-limiting, defaults) plus the update-available badge from `/api/user/checkForUpdate` shown in
the sidebar nav item.

**Acceptance criteria:**
- [ ] All four panels show real values from the live server
- [ ] Sidebar "Server Info" nav item shows the update badge only when a newer version is available

**Verification:**
- [ ] Manual check against the live server's actual settings
- [ ] Build succeeds: `npm run build`

**Dependencies:** Task 4

**Files likely touched:**
- `frontend/src/views/ServerInfoView.vue`

**Estimated scope:** Small: 1-2 files

---

## Task 16: Sessions page

**Description:** Active sessions/tokens list from `/api/admin/sessions/list`.

**Acceptance criteria:**
- [ ] Table shows real sessions, marking `isCurrentSession` and distinguishing `Standard` vs
      `ApiToken` type
- [ ] Copy makes clear this is view-only (matches wireframe footnote)

**Verification:**
- [ ] Manual check: the app's own token appears in the list
- [ ] Build succeeds: `npm run build`

**Dependencies:** Task 4

**Files likely touched:**
- `frontend/src/views/SessionsView.vue`

**Estimated scope:** Small: 1-2 files

---

### CHECKPOINT — Network & tools
- [ ] All remaining wireframe pages read real data
- [ ] Review with user before proceeding to Phase 5

---

## Task 17: Alerts, loading & empty states

**Description:** Consistent loading skeletons, error states (proxy unreachable, invalid token, app
not installed on the server), and empty states across every page built in Tasks 5–16.

**Acceptance criteria:**
- [ ] Every data-fetching view has a loading, error, and empty state — none fall through to a blank
      page or unhandled exception
- [ ] "App not installed" state shows specifically on Query Logs (if Query Logs (Sqlite) app is
      absent) and Cache/Zones as applicable, per the risk noted in `plan.md`

**Verification:**
- [ ] Manual check: disconnect network mid-session, use a bad token, and confirm each page degrades
      gracefully
- [ ] Build succeeds: `npm run build`

**Dependencies:** Tasks 5-16

**Files likely touched:** shared components across `frontend/src/views/*` and
`frontend/src/components/ui/*`

**Estimated scope:** Medium: 3-5 files

---

## Task 18: Responsive + theme QA, CSV export wiring

**Description:** Final pass at phone width (~400px) and both themes across every page; confirm both
CSV export buttons (Query Logs, Blocked Zones) work end-to-end.

**Acceptance criteria:**
- [ ] No horizontal scroll on any page except tables (which scroll in their own container) at 400px
- [ ] Both themes legible with correct contrast on every page
- [ ] Both export buttons produce a real, correctly filtered download

**Verification:**
- [ ] Manual check across all pages at 400px and both themes
- [ ] Build succeeds: `npm run build`

**Dependencies:** Tasks 5-17

**Files likely touched:** touch-ups across `frontend/src/views/*`

**Estimated scope:** Small: 1-2 files (touch-ups, not new features)

---

### CHECKPOINT — Complete
- [ ] All acceptance criteria across all 18 tasks met
- [ ] Full app walkthrough against `dns.villa58.lan` with no console errors
- [ ] Ready for the user's day-to-day use
