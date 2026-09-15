// Single source of truth for every Technitium API path this app calls.
// If Technitium ever changes a path (new API version, renamed route),
// this is the one place to update it — every function in technitium.ts
// looks its path up by key from here rather than hardcoding a literal
// string inline.
//
// The backend proxy (backend/src/proxyAllowlist.ts) keeps its own
// equivalent, keyed the same way. That's intentional duplication, not an
// oversight: the proxy is a security boundary (see tasks/plan.md, "Read-
// only is enforced at three layers") and must not simply trust whatever
// path this file happens to request — it needs its own explicit
// allowlist regardless of what the frontend sends. When you add or
// change an endpoint here, add or change the matching entry there too.
export const ENDPOINTS = {
  userSession: "/user/session/get",
  checkForUpdate: "/user/checkForUpdate",
  dashboardStats: "/dashboard/stats/get",
  dashboardTopStats: "/dashboard/stats/getTop",
  zonesList: "/zones/list",
  zoneRecords: "/zones/records/get",
  cacheList: "/cache/list",
  allowedList: "/allowed/list",
  allowedExport: "/allowed/export",
  blockedList: "/blocked/list",
  blockedExport: "/blocked/export",
  dhcpScopesList: "/dhcp/scopes/list",
  dhcpLeasesList: "/dhcp/leases/list",
  logsQuery: "/logs/query",
  logsExport: "/logs/export",
  appsList: "/apps/list",
  settingsGet: "/settings/get",
  dnsClientResolve: "/dnsClient/resolve",
  adminSessionsList: "/admin/sessions/list",
} as const

export type EndpointKey = keyof typeof ENDPOINTS
