// Mirrors frontend/src/api/endpoints.ts key-for-key and path-for-path.
// Deliberately duplicated rather than imported across the frontend/
// backend package boundary: this list is a security allowlist (see
// tasks/plan.md, "Read-only is enforced at three layers") and must not
// simply trust whatever the frontend defines — it needs its own
// independent copy to actually act as a boundary. When you add or
// change an endpoint in the frontend's registry, add or change the
// matching entry here too.
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
} as const;

export type EndpointKey = keyof typeof ENDPOINTS;
