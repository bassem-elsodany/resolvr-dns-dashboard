import type { ResolveResult } from "../api/technitium"

// Pure logic behind the Blocked Zones page: the block-list feed editor,
// domain validation, the "check a domain" verdict, and the history of how
// many domains the lists held after each refresh.

// ---------- feeds ----------

export interface FeedEntry {
  url: string
  state: "same" | "added" | "removed"
}

export interface FeedGroup {
  id: number
  name: string
  feeds: FeedEntry[]
}

let groupCounter = 0
export function newGroupId(): number {
  return ++groupCounter
}

// Technitium stores the feed list as one flat array. The admin's own
// "# Heading" lines sit in it as ordinary strings, so the page reads them
// back as group headings and writes them out the same way.
export function parseFeedLines(lines: string[]): FeedGroup[] {
  const groups: FeedGroup[] = []
  let current: FeedGroup | null = null
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith("#")) {
      current = { id: newGroupId(), name: line.replace(/^#\s*/, ""), feeds: [] }
      groups.push(current)
    } else {
      if (!current) {
        current = { id: newGroupId(), name: "", feeds: [] }
        groups.push(current)
      }
      current.feeds.push({ url: line, state: "same" })
    }
  }
  return groups
}

// What gets saved: removed feeds are dropped. A heading is kept even when
// nothing sits under it, because admins use headings on their own as
// section dividers (for example "# --- AdGuard parity ---"). A group with
// no name and no feeds is simply gone.
export function groupsToLines(groups: FeedGroup[]): string[] {
  const out: string[] = []
  for (const g of groups) {
    const kept = g.feeds.filter((f) => f.state !== "removed")
    const name = g.name.trim()
    if (!name && kept.length === 0) continue
    if (name) out.push(`# ${name}`)
    for (const f of kept) out.push(f.url)
  }
  return out
}

export interface FeedChanges {
  added: number
  removed: number
  renamed: number
  headingsAdded: number
  headingsRemoved: number
  reordered: boolean
  dirty: boolean
}

export function diffFeeds(savedLines: string[], draft: FeedGroup[]): FeedChanges {
  const next = groupsToLines(draft)
  const before = groupsToLines(parseFeedLines(savedLines))
  const urls = (ls: string[]) => ls.filter((l) => !l.startsWith("#"))
  const heads = (ls: string[]) => ls.filter((l) => l.startsWith("#"))
  const beforeUrls = new Set(urls(before))
  const nextUrls = new Set(urls(next))
  const added = [...nextUrls].filter((u) => !beforeUrls.has(u)).length
  const removed = [...beforeUrls].filter((u) => !nextUrls.has(u)).length
  const beforeHeads = new Set(heads(before))
  const nextHeads = new Set(heads(next))
  const headsAdded = [...nextHeads].filter((h) => !beforeHeads.has(h)).length
  const headsRemoved = [...beforeHeads].filter((h) => !nextHeads.has(h)).length
  const onlyHeadings = added === 0 && removed === 0
  const renamed = onlyHeadings ? Math.min(headsAdded, headsRemoved) : 0
  const headingsAdded = onlyHeadings ? headsAdded - renamed : 0
  const headingsRemoved = onlyHeadings ? headsRemoved - renamed : 0
  const dirty = JSON.stringify(next) !== JSON.stringify(before)
  const reordered = dirty && onlyHeadings && renamed === 0 && headingsAdded === 0 && headingsRemoved === 0
  return { added, removed, renamed, headingsAdded, headingsRemoved, reordered, dirty }
}

// The server stores the list as one comma-separated string, so a comma in
// a heading or address would split it in two. Returns what to fix.
export function findCommaProblems(groups: FeedGroup[]): string[] {
  const out: string[] = []
  for (const g of groups) {
    if (g.name.includes(",")) out.push(`the heading "${g.name.trim()}"`)
    for (const f of g.feeds) if (f.state !== "removed" && f.url.includes(",")) out.push(f.url)
  }
  return out
}

export function describeChanges(c: FeedChanges): string {
  const parts: string[] = []
  if (c.added) parts.push(`${c.added} added`)
  if (c.removed) parts.push(`${c.removed} removed`)
  if (c.renamed) parts.push(`${c.renamed} renamed`)
  if (c.headingsAdded) parts.push(`${c.headingsAdded} ${c.headingsAdded === 1 ? "heading" : "headings"} added`)
  if (c.headingsRemoved) parts.push(`${c.headingsRemoved} ${c.headingsRemoved === 1 ? "heading" : "headings"} removed`)
  if (c.reordered) parts.push("order changed")
  if (parts.length === 0 && c.dirty) parts.push("changed")
  return parts.join(", ")
}

export function validateFeedUrl(url: string, existing: string[]): string | null {
  const u = url.trim()
  if (!u) return "Enter the address of a feed."
  if (u.includes(",")) return "Feed addresses cannot contain commas."
  if (!/^https?:\/\/\S+\.\S+$/i.test(u)) return "That does not look like a web address. It should start with http:// or https://."
  if (existing.includes(u)) return "This feed is already in the list."
  return null
}

// ---------- domains ----------

export function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/\.$/, "")
}

const DOMAIN_RE = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/

export function isValidDomain(domain: string): boolean {
  return DOMAIN_RE.test(domain)
}

export type DomainStatus =
  | { kind: "empty" }
  | { kind: "invalid" }
  | { kind: "blocked" }
  | { kind: "covered"; by: string }
  | { kind: "new" }

// Is this name already on the list, or covered because a parent domain is?
export function domainStatus(input: string, blocked: ReadonlySet<string>): DomainStatus {
  const d = normalizeDomain(input)
  if (!d) return { kind: "empty" }
  if (!isValidDomain(d)) return { kind: "invalid" }
  if (blocked.has(d)) return { kind: "blocked" }
  const parts = d.split(".")
  for (let i = 1; i < parts.length - 1; i++) {
    const parent = parts.slice(i).join(".")
    if (blocked.has(parent)) return { kind: "covered", by: parent }
  }
  return { kind: "new" }
}

export interface BulkPlan {
  add: string[]
  alreadyBlocked: number
  invalid: string[]
}

export function planBulk(text: string, blocked: ReadonlySet<string>): BulkPlan {
  const seen = new Set<string>()
  const add: string[] = []
  const invalid: string[] = []
  let alreadyBlocked = 0
  for (const item of text.split(/[\n,;\s]+/).map(normalizeDomain).filter(Boolean)) {
    if (seen.has(item)) continue
    seen.add(item)
    const s = domainStatus(item, blocked)
    if (s.kind === "invalid") invalid.push(item)
    else if (s.kind === "blocked" || s.kind === "covered") alreadyBlocked++
    else add.push(item)
  }
  return { add, alreadyBlocked, invalid }
}

// ---------- the verdict from asking the server ----------

export type Verdict =
  | { kind: "blocked"; source: "feed" | "own" | "other"; feedUrl: string | null; matched: string | null; detail: string }
  | { kind: "allowed"; addresses: string[] }
  | { kind: "not-found" }
  | { kind: "other"; rcode: string }

const BLOCKED_CODES = new Set(["Blocked", "Censored", "Filtered"])

function parseExtra(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of text.split(";")) {
    const i = part.indexOf("=")
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim()
  }
  return out
}

// A blocked answer carries an Extended DNS Error (RFC 8914) whose text
// names what matched, e.g. "source=block-list-zone; blockListUrl=…". An
// ordinary NxDomain has no such option, which is how the two are told apart.
export function parseVerdict(res: ResolveResult): Verdict {
  const r = res.response.result as ResolveResult["response"]["result"] & {
    EDNS?: { Options?: { Code?: string; Data?: { InfoCode?: string; ExtraText?: string } }[] }
  }
  const ede = (r.EDNS?.Options ?? []).find((o) => o.Code === "EXTENDED_DNS_ERROR" && o.Data?.InfoCode && BLOCKED_CODES.has(o.Data.InfoCode))
  if (ede) {
    const extra = parseExtra(ede.Data?.ExtraText ?? "")
    const source = extra.source === "block-list-zone" ? "feed" : extra.source === "blocked-zone" ? "own" : "other"
    return { kind: "blocked", source, feedUrl: extra.blockListUrl ?? null, matched: extra.domain ?? null, detail: ede.Data?.ExtraText ?? "" }
  }
  if (r.RCODE === "NoError") {
    const addresses = (r.Answer ?? [])
      .map((a) => (a.RDATA as { IPAddress?: string } | undefined)?.IPAddress)
      .filter((a): a is string => typeof a === "string")
    return { kind: "allowed", addresses }
  }
  if (r.RCODE === "NxDomain") return { kind: "not-found" }
  return { kind: "other", rcode: r.RCODE }
}

// ---------- freshness ----------

export interface Freshness {
  lastUpdated: number | null
  next: number | null
  overdue: boolean
}

// Technitium reports the next scheduled update and the interval, not the
// last update, so the last one is the next one minus one interval.
export function freshness(nextIso: string | undefined, intervalHours: number | undefined, now: number = Date.now()): Freshness {
  if (!nextIso) return { lastUpdated: null, next: null, overdue: false }
  const next = new Date(nextIso).getTime()
  if (Number.isNaN(next)) return { lastUpdated: null, next: null, overdue: false }
  const last = intervalHours ? next - intervalHours * 3600_000 : null
  return { lastUpdated: last, next, overdue: next < now }
}

export function formatIn(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60000))
  if (mins < 1) return "in under a minute"
  if (mins < 60) return `in ${mins} min`
  const h = Math.round(mins / 60)
  return h < 48 ? `in ${h} h` : `in ${Math.round(h / 24)} d`
}

// ---------- history of the domain total ----------

export interface Reading {
  t: number
  total: number
}

const HISTORY_KEY = "resolvr.blockListHistory"
const HISTORY_MAX = 30

export function readHistory(): Reading[] {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]")
    return Array.isArray(raw) ? raw.filter((r): r is Reading => typeof r?.t === "number" && typeof r?.total === "number") : []
  } catch {
    return []
  }
}

// Adds a reading when the total changed since the last one (or when forced,
// for a refresh that left the total as it was). The first visit records a
// baseline.
export function recordReading(total: number, now: number = Date.now(), force = false): Reading[] {
  const history = readHistory()
  const last = history[history.length - 1]
  if (last && last.total === total && !force) return history
  const next = [...history, { t: now, total }].slice(-HISTORY_MAX)
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
  } catch {
    // Storage blocked: the history just is not kept.
  }
  return next
}

export function changeSincePrevious(history: Reading[]): number | null {
  if (history.length < 2) return null
  return history[history.length - 1]!.total - history[history.length - 2]!.total
}
