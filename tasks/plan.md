# Implementation Plan: Resolvr — Technitium DNS Dashboard

## Overview

A read-only monitoring dashboard for a Technitium DNS Server, built to the approved wireframe
(https://claude.ai/artifact/KkUP4PePeDz4kVDA7ULDpM). The end user points the app at their server
URL + API token from a Connection Settings screen, then browses live DNS activity — query logs,
per-client breakdowns, cache, zones, blocking, DHCP, apps and server info — across a sidebar-driven
SPA styled after the user's existing `mcp-governance/frontend` app (Cloudflare One–inspired,
Inter + IBM Plex Mono, light/dark theme). The app never calls any create/update/delete endpoint —
only GET-style read endpoints from Technitium's API (confirmed against APIDOCS.md and the user's
live server at dns.villa58.lan, v15.4).

## Architecture Decisions

- **Frontend: Vue 3 + Vite + TypeScript + Tailwind + Pinia + vue-router.** Mirrors the stack and
  visual language of `mcp-governance/frontend` per the user's request to match that UI, and keeps
  the two codebases familiar to work across.
- **Thin Node/Express backend proxy is required — confirmed necessary, not optional.** Tested
  directly against the live server: `OPTIONS /api/user/session/get` with an `Origin` header returns
  no `Access-Control-Allow-Origin` header. Technitium's API sends no CORS headers at all, so a
  browser-only SPA cannot call it cross-origin. The backend is a minimal same-origin relay: it
  forwards only the specific read endpoints this app uses (explicit allowlist, rejects anything
  else) to `{serverUrl}` with the caller-supplied `Authorization: Bearer {token}` header, and adds
  permissive CORS for the frontend's own origin. This also avoids mixed-content issues if the
  dashboard is ever served over HTTPS while the DNS server is plain HTTP.
- **No server-side persistence.** Connection config (server URL + API token) lives in the browser's
  `localStorage` only, entered once on the Connection Settings screen and sent as request headers
  (`X-Technitium-Base-Url`, `X-Technitium-Token`) to the backend on every call. The backend is
  fully stateless — no database, no config file, nothing to secure at rest beyond the allowlist.
  This fits a single end user running the app locally; revisit if multi-user ever becomes a goal.
- **Read-only is enforced at three layers, not just by omission in the UI:** (1) the frontend never
  renders a create/edit/delete control anywhere, (2) the backend's endpoint allowlist only contains
  GET-style read paths, (3) any Technitium API call the backend doesn't recognize is rejected with
  403 before it reaches the DNS server.
- **"Blocked by" is mechanism-level, not list-level — a real API limitation, not a build gap.**
  Technitium's query log reports `responseType` (`Blocked` / `CacheBlocked` / `UpstreamBlocked`)
  but never which block list or rule matched. The Clients and Query Logs pages label this clearly
  so the limitation is visible, not silently approximated.
- **Per-client blocked-count is computed via count-only log queries**, not a dedicated stats
  endpoint (none exists). For each client shown on the Clients page, the app issues
  `/api/logs/query?clientIpAddress=X&entriesPerPage=1` (with and without `responseType=Blocked`)
  and reads `totalEntries` from each — cheap, since `entriesPerPage=1` returns counts without
  transferring rows.

## Task List

### Phase 1: Foundation

- [ ] Task 1: Backend proxy service
- [ ] Task 2: Frontend scaffold + design tokens
- [ ] Task 3: Connection Settings + API client
- [ ] Task 4: App shell (sidebar + topbar + routing)

### Checkpoint: Foundation
- [ ] `npm run build` succeeds in both `backend/` and `frontend/`
- [ ] Entering the real server URL + token on Connection Settings shows "Connected · dns.villa58.lan"
- [ ] Sidebar navigation switches between empty placeholder pages without console errors

### Phase 2: Core monitoring

- [ ] Task 5: Overview page
- [ ] Task 6: Clients page
- [ ] Task 7: Query Logs page

### Checkpoint: Core monitoring
- [ ] Overview shows live stats matching the Technitium web console for the same time range
- [ ] Clients page's blocked % for a given IP matches manually filtering Query Logs by that IP
- [ ] Query Logs filters (host, response type, protocol, rcode, qname) all narrow real results

### Phase 3: Zones, cache & blocking

- [ ] Task 8: Cache page
- [ ] Task 9: Zones page (list + record detail)
- [ ] Task 10: Allowed Zones page
- [ ] Task 11: Blocked Zones page

### Checkpoint: Zones, cache & blocking
- [ ] Zone count and names match `dns.villa58.lan`'s 17 zones
- [ ] Selecting a zone shows its real records
- [ ] Blocked Zones list matches the server's 73 entries

### Phase 4: Network & tools

- [ ] Task 12: DHCP page
- [ ] Task 13: DNS Resolver tool
- [ ] Task 14: Apps page
- [ ] Task 15: Server Info page
- [ ] Task 16: Sessions page

### Checkpoint: Network & tools
- [ ] DHCP scopes/leases match the server (Default scope, disabled, 0 leases)
- [ ] Resolver tool returns a real answer for a live query against the configured server
- [ ] Sessions page lists the actual active token(s), including the one the app itself uses

### Phase 5: Polish

- [ ] Task 17: Alerts, loading & empty states
- [ ] Task 18: Responsive + theme QA, CSV export wiring

### Checkpoint: Complete
- [ ] Every page from the approved wireframe is implemented and reads real data
- [ ] No page issues a non-GET call anywhere (verified by inspecting the backend allowlist + network tab)
- [ ] App works at phone width and in both light/dark themes
- [ ] Ready for the user to run day-to-day against dns.villa58.lan

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Technitium API has no CORS support | High — SPA can't call it directly | Backend proxy (Task 1), confirmed necessary via live test, not assumed |
| Per-client blocked-count via count-only queries adds latency with many clients | Medium | Cap Clients page to top N clients (from `getTop`), fetch counts lazily/on-demand, not for the whole client universe up front |
| "Blocked by" data is mechanism-level only | Low — sets wrong expectations if not labeled | UI copy explicitly states the limitation (see wireframe footnote); do not imply list-level attribution anywhere else |
| API token stored in `localStorage` | Medium — XSS would expose it | Acceptable for a single-user local tool; document it plainly in Connection Settings copy; no third-party scripts in the app |
| Query Logs app or Advanced Blocking app could be uninstalled on another server this app points at | Medium — pages would silently 404/empty | Detect via `/api/apps/list`; show a clear "app not installed" empty state instead of a raw error |

## Open Questions

- None outstanding — wireframe approved, stack and architecture confirmed against the live server.
