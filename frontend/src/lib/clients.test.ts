import { describe, it, expect, beforeEach } from "vitest"
import type { QueryLogEntry } from "../api/technitium"
import {
  isHeavyBlocking,
  isQuiet,
  matchesFilter,
  searchClients,
  sortClients,
  formatAgo,
  shareSegments,
  summarizeSample,
  median,
  bucketEntries,
  clientActivity,
  readKnownClients,
  newClientIps,
  rememberClients,
  knownAtPageLoad,
  resetKnownForTests,
  singleNode,
  mergeEntries,
  bucketByNode,
  type ClientRow,
} from "./clients"

const NOW = Date.parse("2026-10-09T12:00:00Z")
const ago = (min: number) => new Date(NOW - min * 60000).toISOString()

const c = (over: Partial<ClientRow>): ClientRow => ({ ip: "10.0.0.1", hostname: null, hits: 100, blocked: 0, rateLimited: false, lastSeen: ago(1), ...over })

describe("flags", () => {
  it("heavy blocking needs both a high share and enough queries", () => {
    expect(isHeavyBlocking(c({ hits: 100, blocked: 16 }))).toBe(true)
    expect(isHeavyBlocking(c({ hits: 100, blocked: 15 }))).toBe(false)
    expect(isHeavyBlocking(c({ hits: 10, blocked: 9 }))).toBe(false)
  })

  it("quiet means nothing heard for half an hour, or never", () => {
    expect(isQuiet(c({ lastSeen: ago(29) }), NOW)).toBe(false)
    expect(isQuiet(c({ lastSeen: ago(31) }), NOW)).toBe(true)
    expect(isQuiet(c({ lastSeen: null }), NOW)).toBe(true)
  })

  it("applies each filter, including 'needs a look' = rate limited or new", () => {
    const list = [c({ ip: "a", rateLimited: true }), c({ ip: "b" }), c({ ip: "c", hits: 100, blocked: 30 })]
    const news = new Set(["b"])
    const pick = (f: Parameters<typeof matchesFilter>[1]) => list.filter((x) => matchesFilter(x, f, news, NOW)).map((x) => x.ip)
    expect(pick("all")).toEqual(["a", "b", "c"])
    expect(pick("limited")).toEqual(["a"])
    expect(pick("new")).toEqual(["b"])
    expect(pick("heavy")).toEqual(["c"])
    expect(pick("attention")).toEqual(["a", "b"])
  })
})

describe("search and sort", () => {
  const list = [c({ ip: "10.0.0.5", hostname: "zeta.lan", hits: 5, blocked: 4, lastSeen: ago(50) }), c({ ip: "10.0.0.9", hostname: "alpha.lan", hits: 50, blocked: 1, lastSeen: ago(2) })]

  it("finds by name or address, ignoring case", () => {
    expect(searchClients(list, "ALPHA").map((x) => x.ip)).toEqual(["10.0.0.9"])
    expect(searchClients(list, "0.5").map((x) => x.ip)).toEqual(["10.0.0.5"])
    expect(searchClients(list, "  ")).toHaveLength(2)
  })

  it("sorts by queries, block rate, name and recency without changing the input", () => {
    expect(sortClients(list, "queries")[0]!.ip).toBe("10.0.0.9")
    expect(sortClients(list, "blocked")[0]!.ip).toBe("10.0.0.5")
    expect(sortClients(list, "name")[0]!.hostname).toBe("alpha.lan")
    expect(sortClients(list, "recent")[0]!.ip).toBe("10.0.0.9")
    expect(list[0]!.ip).toBe("10.0.0.5")
  })
})

describe("formatAgo", () => {
  it("speaks in minutes, hours and days", () => {
    expect(formatAgo(ago(0), NOW)).toBe("just now")
    expect(formatAgo(ago(6), NOW)).toBe("6 min ago")
    expect(formatAgo(ago(180), NOW)).toBe("3 h ago")
    expect(formatAgo(ago(60 * 24 * 3), NOW)).toBe("3 d ago")
    expect(formatAgo(null)).toBe("never")
  })
})

describe("shareSegments", () => {
  it("adds a remainder so the bar covers the whole total", () => {
    const segs = shareSegments([c({ ip: "a", hits: 30 }), c({ ip: "b", hits: 50 })], 100)
    expect(segs.map((s) => s.ip)).toEqual(["b", "a", null])
    expect(segs.reduce((a, s) => a + s.share, 0)).toBeCloseTo(1)
    expect(segs[2]!.hits).toBe(20)
  })

  it("has no remainder when everything is listed, and nothing for an empty total", () => {
    expect(shareSegments([c({ hits: 100 })], 100)).toHaveLength(1)
    expect(shareSegments([c({})], 0)).toEqual([])
  })
})

function entry(over: Partial<QueryLogEntry>): QueryLogEntry {
  return { rowNumber: 1, timestamp: ago(1), clientIpAddress: "10.0.0.1", protocol: "Udp", responseType: "Recursive", rcode: "NoError", qname: "a.example.com", qtype: "A", qclass: "IN", answer: null, ...over }
}

describe("summarizeSample", () => {
  const entries = [
    entry({ qname: "a.example.com", responseType: "Cached" }),
    entry({ qname: "a.example.com", responseType: "Recursive", responseRtt: 10 }),
    entry({ qname: "b.example.com", responseType: "Recursive", responseRtt: 30, protocol: "Https", qtype: "AAAA" }),
    entry({ qname: "ads.example.net", responseType: "Blocked" }),
    entry({ qname: "ads.example.net", responseType: "UpstreamBlocked" }),
  ]
  const s = summarizeSample(entries)

  it("counts domains separately for allowed and blocked queries", () => {
    expect(s.domains[0]).toEqual(["a.example.com", 2])
    expect(s.blockedDomains).toEqual([["ads.example.net", 2]])
  })

  it("reports cache share, median upstream time, protocols and types", () => {
    expect(s.cacheShare).toBeCloseTo(0.2)
    expect(s.medianRtt).toBe(20)
    expect(s.protocols).toEqual([{ label: "UDP", count: 4 }, { label: "DoH", count: 1 }])
    expect(s.types[0]).toEqual(["A", 4])
  })

  it("keeps the newest entries as the latest queries, and copes with an empty sample", () => {
    expect(s.recent).toHaveLength(5)
    const empty = summarizeSample([])
    expect(empty.cacheShare).toBeNull()
    expect(empty.medianRtt).toBeNull()
    expect(empty.domains).toEqual([])
  })

  it("finds the median of odd and even lists", () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([1, 2, 3, 4])).toBe(2.5)
    expect(median([])).toBeNull()
  })
})

describe("time slices", () => {
  const e = (min: number, over: Partial<QueryLogEntry> = {}) => entry({ timestamp: ago(min), ...over })

  it("splits the sample's own span into equal slices and counts blocked ones", () => {
    const b = bucketEntries([e(60), e(45, { responseType: "Blocked" }), e(30), e(0)], 4)!
    expect(b.counts).toEqual([1, 1, 1, 1])
    expect(b.blocked).toEqual([0, 1, 0, 0])
    expect(b.end - b.start).toBe(60 * 60000)
  })

  it("returns nothing when there is no span to split", () => {
    expect(bucketEntries([e(5)], 4)).toBeNull()
    expect(bucketEntries([e(5), e(5)], 4)).toBeNull()
  })

  it("ranks the busiest clients and aligns their slices", () => {
    const a = clientActivity([e(60, { clientIpAddress: "a" }), e(0, { clientIpAddress: "a" }), e(30, { clientIpAddress: "b" }), e(31, { clientIpAddress: "a" })], 2, 2)!
    expect(a.rows.map((r) => r.ip)).toEqual(["a", "b"])
    expect(a.rows[0]!.counts.reduce((x, y) => x + y, 0)).toBe(3)
    expect(a.rows[0]!.counts).toHaveLength(2)
  })
})

describe("new clients", () => {
  beforeEach(() => localStorage.clear())

  it("flags nothing on the first visit, then flags addresses it has not seen", () => {
    const first = readKnownClients()
    expect(first).toBeNull()
    expect(newClientIps(["a", "b"], first).size).toBe(0)
    rememberClients(["a", "b"], first)

    const second = readKnownClients()
    expect([...newClientIps(["a", "c"], second)]).toEqual(["c"])
    rememberClients(["a", "c"], second)
    expect([...readKnownClients()!].sort()).toEqual(["a", "b", "c"])
  })

  it("treats corrupt storage as a first visit", () => {
    localStorage.setItem("resolvr.knownClients", "{oops")
    expect(readKnownClients()).toBeNull()
  })
})

describe("knownAtPageLoad", () => {
  beforeEach(() => {
    localStorage.clear()
    resetKnownForTests()
  })

  it("is read once, so later writes do not change what counts as new this visit", () => {
    rememberClients(["a"], null)
    const first = knownAtPageLoad()
    rememberClients(["b"], first)
    expect([...knownAtPageLoad()!]).toEqual(["a"])
  })
})

describe("cluster helpers", () => {
  const base = { ip: "10.0.0.1", hostname: null, hits: 100, blocked: 0, rateLimited: false, lastSeen: null }

  it("a client that only ever used one node of a cluster is flagged, one that used both is not", () => {
    expect(singleNode({ ...base, byNode: { n1: 80, n2: 0 } })).toBe("n1")
    expect(singleNode({ ...base, byNode: { n1: 60, n2: 40 } })).toBeNull()
  })

  it("a standalone server, or a cluster of one, has no single-node clients", () => {
    expect(singleNode(base)).toBeNull()
    expect(singleNode({ ...base, byNode: { n1: 100 } })).toBeNull()
    expect(matchesFilter({ ...base, byNode: { n1: 5, n2: 0 } }, "single", new Set())).toBe(true)
    expect(matchesFilter(base, "single", new Set())).toBe(false)
  })

  it("merges nodes' logs latest first and keeps the limit", () => {
    const e = (t: string, node: string) => ({ timestamp: t, node }) as never
    const merged = mergeEntries(
      [
        [e("2026-10-12T10:00:00Z", "n1"), e("2026-10-12T08:00:00Z", "n1")],
        [e("2026-10-12T09:00:00Z", "n2")],
      ],
      2,
    )

    expect(merged.map((m) => m.timestamp)).toEqual(["2026-10-12T10:00:00Z", "2026-10-12T09:00:00Z"])
  })

  it("buckets each node's entries on one shared time axis", () => {
    const e = (t: string, node: string) => ({ timestamp: t, node, responseType: "Cached" }) as never
    const b = bucketByNode(
      [e("2026-10-12T00:00:00Z", "n1"), e("2026-10-12T00:30:00Z", "n2"), e("2026-10-12T01:00:00Z", "n1")],
      ["n1", "n2"],
      2,
    )!

    expect(b.series.n1).toEqual([1, 1])
    expect(b.series.n2).toEqual([0, 1])
    expect(b.end - b.start).toBe(3600_000)
  })
})
