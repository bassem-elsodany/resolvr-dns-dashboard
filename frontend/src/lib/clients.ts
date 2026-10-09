import type { QueryLogEntry } from "../api/technitium"
import { pathOf } from "./charts"

// Pure logic behind the Overview "Clients" tab: filtering, sorting and the
// summaries drawn from a client's logged queries. No DOM, no network.

export interface ClientRow {
  ip: string
  hostname: string | null
  hits: number
  blocked: number
  rateLimited: boolean
  lastSeen: string | null
}

export type ClientFilter = "all" | "heavy" | "limited" | "new" | "quiet" | "attention"
export type ClientSort = "queries" | "blocked" | "name" | "recent"

// Blocking above this share counts as "heavy", but only once there are
// enough queries for the share to mean something (one blocked request on a
// nearly silent device should not raise a flag).
export const HEAVY_BLOCK_SHARE = 0.15
export const HEAVY_MIN_QUERIES = 50
export const QUIET_AFTER_MS = 30 * 60 * 1000

export function blockedShare(c: ClientRow): number {
  return c.hits > 0 ? c.blocked / c.hits : 0
}

export function isHeavyBlocking(c: ClientRow): boolean {
  return c.hits >= HEAVY_MIN_QUERIES && blockedShare(c) > HEAVY_BLOCK_SHARE
}

export function isQuiet(c: ClientRow, now: number = Date.now()): boolean {
  if (!c.lastSeen) return true
  return now - new Date(c.lastSeen).getTime() >= QUIET_AFTER_MS
}

export function displayName(c: { ip: string; hostname: string | null }): string {
  return c.hostname || c.ip
}

export function matchesFilter(c: ClientRow, filter: ClientFilter, newIps: ReadonlySet<string>, now: number = Date.now()): boolean {
  switch (filter) {
    case "all":
      return true
    case "heavy":
      return isHeavyBlocking(c)
    case "limited":
      return c.rateLimited
    case "new":
      return newIps.has(c.ip)
    case "quiet":
      return isQuiet(c, now)
    case "attention":
      return c.rateLimited || newIps.has(c.ip)
  }
}

export function searchClients(list: ClientRow[], text: string): ClientRow[] {
  const q = text.trim().toLowerCase()
  if (!q) return list
  return list.filter((c) => c.ip.toLowerCase().includes(q) || (c.hostname ?? "").toLowerCase().includes(q))
}

export function sortClients(list: ClientRow[], sort: ClientSort): ClientRow[] {
  const out = [...list]
  const last = (c: ClientRow) => (c.lastSeen ? new Date(c.lastSeen).getTime() : 0)
  switch (sort) {
    case "blocked":
      return out.sort((a, b) => blockedShare(b) - blockedShare(a) || b.hits - a.hits)
    case "name":
      return out.sort((a, b) => displayName(a).localeCompare(displayName(b)))
    case "recent":
      return out.sort((a, b) => last(b) - last(a))
    default:
      return out.sort((a, b) => b.hits - a.hits)
  }
}

export function formatAgo(iso: string | null, now: number = Date.now()): string {
  if (!iso) return "never"
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000))
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins} min ago`
  if (mins < 60 * 48) return `${Math.round(mins / 60)} h ago`
  return `${Math.round(mins / 1440)} d ago`
}

// ---------- traffic share ----------

export interface ShareSegment {
  ip: string | null // null for the "other clients" remainder
  label: string
  hits: number
  share: number
}

// One segment per client plus a remainder, so the bar always adds up to
// the server's own total even when only the busiest clients are listed.
export function shareSegments(list: ClientRow[], totalQueries: number): ShareSegment[] {
  if (totalQueries <= 0) return []
  const sorted = [...list].sort((a, b) => b.hits - a.hits)
  const segs: ShareSegment[] = sorted.map((c) => ({ ip: c.ip, label: displayName(c), hits: c.hits, share: c.hits / totalQueries }))
  const listed = sorted.reduce((a, c) => a + c.hits, 0)
  const rest = totalQueries - listed
  if (rest > 0) segs.push({ ip: null, label: "Other clients", hits: rest, share: rest / totalQueries })
  return segs
}

// ---------- one client's logged queries ----------

const PROTOCOL_LABEL: Record<string, string> = { Udp: "UDP", Tcp: "TCP", Tls: "DoT", Https: "DoH", Quic: "DoQ" }

export interface SampleSummary {
  total: number
  cacheShare: number | null
  medianRtt: number | null
  domains: [string, number][]
  blockedDomains: [string, number][]
  types: [string, number][]
  protocols: { label: string; count: number }[]
  recent: QueryLogEntry[]
}

function topCounts(values: string[], n: number): [string, number][] {
  const m = new Map<string, number>()
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1)
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n)
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

export function isBlockedEntry(e: { responseType: string }): boolean {
  return pathOf(e.responseType) === "Blocked"
}

// Entries are expected newest first, as the log API returns them.
export function summarizeSample(entries: QueryLogEntry[], topN = 7, recentN = 8): SampleSummary {
  const allowed = entries.filter((e) => !isBlockedEntry(e))
  const blocked = entries.filter(isBlockedEntry)
  const rtts = entries.map((e) => e.responseRtt).filter((r): r is number => typeof r === "number")
  const cached = entries.filter((e) => e.responseType === "Cached").length
  const protocols = topCounts(entries.map((e) => PROTOCOL_LABEL[e.protocol] ?? e.protocol), 6).map(([label, count]) => ({ label, count }))
  return {
    total: entries.length,
    cacheShare: entries.length ? cached / entries.length : null,
    medianRtt: median(rtts),
    domains: topCounts(allowed.map((e) => e.qname), topN),
    blockedDomains: topCounts(blocked.map((e) => e.qname), topN),
    types: topCounts(entries.map((e) => e.qtype), 5),
    protocols,
    recent: entries.slice(0, recentN),
  }
}

// ---------- activity over time ----------

export interface Buckets {
  start: number
  end: number
  counts: number[]
  blocked: number[]
}

// Splits the sample's own time span into n equal slices. A sample only
// reaches back as far as its newest entries, so the span is whatever the
// entries actually cover, not the whole selected range.
export function bucketEntries(entries: { timestamp: string; responseType: string }[], n = 24): Buckets | null {
  const times = entries.map((e) => new Date(e.timestamp).getTime()).filter((t) => !Number.isNaN(t))
  if (times.length < 2) return null
  const start = Math.min(...times)
  const end = Math.max(...times)
  if (end <= start) return null
  const counts = Array<number>(n).fill(0)
  const blocked = Array<number>(n).fill(0)
  const width = (end - start) / n
  for (const e of entries) {
    const t = new Date(e.timestamp).getTime()
    if (Number.isNaN(t)) continue
    const i = Math.min(n - 1, Math.floor((t - start) / width))
    counts[i]!++
    if (isBlockedEntry(e)) blocked[i]!++
  }
  return { start, end, counts, blocked }
}

export interface ClientActivity {
  ip: string
  counts: number[]
}

// The busiest clients in a shared sample, each split into the same n
// time slices so rows line up column for column.
export function clientActivity(
  entries: { timestamp: string; clientIpAddress: string }[],
  topN = 8,
  n = 24,
): { start: number; end: number; rows: ClientActivity[] } | null {
  const times = entries.map((e) => new Date(e.timestamp).getTime()).filter((t) => !Number.isNaN(t))
  if (times.length < 2) return null
  const start = Math.min(...times)
  const end = Math.max(...times)
  if (end <= start) return null
  const width = (end - start) / n
  const byIp = new Map<string, number[]>()
  for (const e of entries) {
    const t = new Date(e.timestamp).getTime()
    if (Number.isNaN(t)) continue
    let row = byIp.get(e.clientIpAddress)
    if (!row) byIp.set(e.clientIpAddress, (row = Array<number>(n).fill(0)))
    row[Math.min(n - 1, Math.floor((t - start) / width))]!++
  }
  const rows = [...byIp]
    .map(([ip, counts]) => ({ ip, counts }))
    .sort((a, b) => b.counts.reduce((x, y) => x + y, 0) - a.counts.reduce((x, y) => x + y, 0))
    .slice(0, topN)
  return { start, end, rows }
}

// ---------- "new" clients ----------

const KNOWN_KEY = "resolvr.knownClients"

// Technitium keeps no first-seen date, so "new" means "this browser had
// not seen this address when the page was opened". Read once per page
// load: a client stays marked new for the whole visit and the mark clears
// the next time. The first ever visit just records a baseline and flags
// nothing, so a fresh browser does not label every device new.
export function readKnownClients(): Set<string> | null {
  try {
    const raw = localStorage.getItem(KNOWN_KEY)
    if (raw === null) return null
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? new Set(parsed.filter((x): x is string => typeof x === "string")) : null
  } catch {
    return null
  }
}

export function newClientIps(ips: string[], known: ReadonlySet<string> | null): Set<string> {
  if (known === null) return new Set()
  return new Set(ips.filter((ip) => !known.has(ip)))
}

export function rememberClients(ips: string[], known: ReadonlySet<string> | null): void {
  try {
    const all = new Set([...(known ?? []), ...ips])
    localStorage.setItem(KNOWN_KEY, JSON.stringify([...all].slice(-500)))
  } catch {
    // Storage blocked: nothing is flagged new, which is the safe failure.
  }
}

let knownAtLoad: Set<string> | null | undefined

// The set of addresses known when this page was opened, read once and
// reused, so a client stays marked new while you move between tabs.
export function knownAtPageLoad(): Set<string> | null {
  if (knownAtLoad === undefined) knownAtLoad = readKnownClients()
  return knownAtLoad
}

export function resetKnownForTests(): void {
  knownAtLoad = undefined
}
