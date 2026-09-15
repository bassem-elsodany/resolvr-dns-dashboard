// Every Technitium API path this app is allowed to reach, exactly as it appears
// after `/api` in the upstream URL. Read-only endpoints only — see tasks/plan.md
// ("Read-only is enforced at three layers"). Add a path here only when a page in
// the plan actually needs it.
export const ALLOWED_PATHS: ReadonlySet<string> = new Set([
  "/user/session/get",
  "/user/checkForUpdate",
  "/dashboard/stats/get",
  "/dashboard/stats/getTop",
  "/zones/list",
  "/zones/records/get",
  "/cache/list",
  "/allowed/list",
  "/allowed/export",
  "/blocked/list",
  "/blocked/export",
  "/dhcp/scopes/list",
  "/dhcp/leases/list",
  "/logs/query",
  "/logs/export",
  "/apps/list",
  "/settings/get",
  "/dnsClient/resolve",
  "/admin/sessions/list",
]);

export function isAllowedPath(path: string): boolean {
  return ALLOWED_PATHS.has(path);
}
