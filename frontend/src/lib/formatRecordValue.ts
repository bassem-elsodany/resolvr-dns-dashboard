// Record rData shapes vary by type (A: {value}, SOA: {primaryNameServer,
// serial,...}, etc.) — Technitium doesn't normalize this, so render
// whatever fields are present rather than assuming a single "value" key.
export function formatRecordValue(rData: Record<string, unknown>): string {
  if (typeof rData.value === "string") return rData.value
  const entries = Object.entries(rData)
  if (entries.length === 0) return "–"
  return entries.map(([key, val]) => `${key}=${val}`).join(", ")
}
