// Technitium's query log responseType distinguishes exactly three blocking
// mechanisms — "Blocked" itself conflates the Blocked Zone list, the
// subscribed Block List zone, and the Advanced Blocking app; there is no
// field anywhere in the API that tells you which of those three matched.
// Never expand this beyond what responseType actually reports (see
// tasks/plan.md, "Blocked by is mechanism-level, not list-level").
const LABELS: Record<string, string> = {
  Blocked: "Blocked",
  CacheBlocked: "Cache Block",
  UpstreamBlocked: "Upstream Block",
}

export function blockedByLabel(responseType: string): string | null {
  return LABELS[responseType] ?? null
}
