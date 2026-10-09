import { describe, it, expect, beforeEach } from "vitest"
import type { ResolveResult } from "../api/technitium"
import {
  parseFeedLines,
  groupsToLines,
  diffFeeds,
  describeChanges,
  validateFeedUrl,
  findCommaProblems,
  normalizeDomain,
  isValidDomain,
  domainStatus,
  planBulk,
  parseVerdict,
  freshness,
  formatIn,
  readHistory,
  recordReading,
  changeSincePrevious,
} from "./blockLists"

const LINES = ["# Threat intel", "https://a.example.com/t.txt", "https://b.example.org/m.txt", "# Ads", "https://c.example.net/a.txt"]

describe("feed groups", () => {
  it("reads headings as groups and writes the same lines back", () => {
    const groups = parseFeedLines(LINES)
    expect(groups.map((g) => [g.name, g.feeds.length])).toEqual([["Threat intel", 2], ["Ads", 1]])
    expect(groupsToLines(groups)).toEqual(LINES)
  })

  it("puts feeds that come before any heading in an unnamed group, with no heading written back", () => {
    const groups = parseFeedLines(["https://a.example.com/t.txt", "", "# Ads", "https://c.example.net/a.txt"])
    expect(groups[0]!.name).toBe("")
    expect(groupsToLines(groups)).toEqual(["https://a.example.com/t.txt", "# Ads", "https://c.example.net/a.txt"])
  })

  it("drops removed feeds but keeps their headings", () => {
    const groups = parseFeedLines(LINES)
    groups[1]!.feeds[0]!.state = "removed"
    groups[0]!.feeds[1]!.state = "removed"
    expect(groupsToLines(groups)).toEqual(["# Threat intel", "https://a.example.com/t.txt", "# Ads"])
  })

  it("keeps heading-only lines used as dividers, in order, so saving never loses them", () => {
    const real = ["# --- AdGuard parity ---", "# ---AdGuard DNS filter---", "https://a.example.com/f.txt", "# --- Adult (multiple sources) ---", "# Hagezi NSFW", "https://b.example.org/n.txt"]
    const groups = parseFeedLines(real)
    expect(groups.map((g) => g.feeds.length)).toEqual([0, 1, 0, 1])
    expect(groupsToLines(groups)).toEqual(real)
    expect(diffFeeds(real, groups).dirty).toBe(false)
  })

  it("drops a group with no name and no feeds", () => {
    const groups = parseFeedLines(LINES)
    groups.push({ id: 99, name: "  ", feeds: [] })
    expect(groupsToLines(groups)).toEqual(LINES)
  })
})

describe("diffFeeds", () => {
  it("is clean when nothing changed", () => {
    const d = diffFeeds(LINES, parseFeedLines(LINES))
    expect(d).toMatchObject({ added: 0, removed: 0, renamed: 0, reordered: false, dirty: false })
  })

  it("counts added and removed feeds", () => {
    const g = parseFeedLines(LINES)
    g[0]!.feeds.push({ url: "https://d.example.com/n.txt", state: "added" })
    g[1]!.feeds[0]!.state = "removed"
    const d = diffFeeds(LINES, g)
    expect(d).toMatchObject({ added: 1, removed: 1, dirty: true })
    expect(describeChanges(d)).toBe("1 added, 1 removed")
  })

  it("counts headings added or removed on their own", () => {
    const g = parseFeedLines(LINES)
    g.splice(1, 1)
    expect(describeChanges(diffFeeds(LINES, g))).toContain("removed")
    const g2 = parseFeedLines(["# A", "https://a.example.com/t.txt"])
    g2.push({ id: 50, name: "New divider", feeds: [] })
    expect(describeChanges(diffFeeds(["# A", "https://a.example.com/t.txt"], g2))).toBe("1 heading added")
    const d = diffFeeds(["# A", "# B", "https://a.example.com/t.txt"], parseFeedLines(["# A", "https://a.example.com/t.txt"]))
    expect(describeChanges(d)).toBe("1 heading removed")
  })

  it("recognises a rename, and a pure reorder", () => {
    const g = parseFeedLines(LINES)
    g[1]!.name = "Ads and trackers"
    expect(describeChanges(diffFeeds(LINES, g))).toBe("1 renamed")

    const g2 = parseFeedLines(LINES)
    g2[0]!.feeds.reverse()
    const d2 = diffFeeds(LINES, g2)
    expect(d2.reordered).toBe(true)
    expect(describeChanges(d2)).toBe("order changed")
  })
})

describe("validateFeedUrl", () => {
  it("rejects empty input, non-web addresses and duplicates", () => {
    expect(validateFeedUrl("", [])).toMatch(/Enter the address/)
    expect(validateFeedUrl("ftp://x.example.com/a", [])).toMatch(/web address/)
    expect(validateFeedUrl("example", [])).toMatch(/web address/)
    expect(validateFeedUrl("https://a.example.com/t.txt", ["https://a.example.com/t.txt"])).toMatch(/already/)
    expect(validateFeedUrl("https://a.example.com/t,x.txt", [])).toMatch(/commas/)
  })

  it("accepts http and https feeds", () => {
    expect(validateFeedUrl(" https://a.example.com/t.txt ", [])).toBeNull()
    expect(validateFeedUrl("http://a.example.com/t.txt", [])).toBeNull()
  })
})

describe("domains", () => {
  it("normalises pasted addresses", () => {
    expect(normalizeDomain(" HTTPS://Ads.Example.NET/path?x=1 ")).toBe("ads.example.net")
    expect(normalizeDomain("example.com.")).toBe("example.com")
  })

  it("validates names", () => {
    expect(isValidDomain("example.com")).toBe(true)
    expect(isValidDomain("a-b.example.co.uk")).toBe(true)
    expect(isValidDomain("localhost")).toBe(false)
    expect(isValidDomain("-bad.example.com")).toBe(false)
    expect(isValidDomain("bad_name.example.com")).toBe(false)
  })

  it("says whether a domain is new, already blocked, or covered by a parent", () => {
    const blocked = new Set(["ads.example.net", "example.xxx"])
    expect(domainStatus("", blocked).kind).toBe("empty")
    expect(domainStatus("nope", blocked).kind).toBe("invalid")
    expect(domainStatus("ads.example.net", blocked).kind).toBe("blocked")
    expect(domainStatus("banner.ads.example.net", blocked)).toEqual({ kind: "covered", by: "ads.example.net" })
    expect(domainStatus("example.net", blocked).kind).toBe("new")
  })

  it("plans a bulk paste: new, already covered, invalid, duplicates once", () => {
    const plan = planBulk("a.example.com\nb.example.com, a.example.com\nads.example.net\nnot a domain\nx.ads.example.net", new Set(["ads.example.net"]))
    expect(plan.add).toEqual(["a.example.com", "b.example.com"])
    expect(plan.alreadyBlocked).toBe(2)
    expect(plan.invalid).toEqual(["not", "a", "domain"])
  })
})

function resolved(over: Record<string, unknown>): ResolveResult {
  return { response: { result: { Metadata: {}, RCODE: "NoError", Question: [], Answer: [], Authority: [], Additional: [], ...over } } } as unknown as ResolveResult
}

describe("parseVerdict", () => {
  const ede = (extra: string, code = "Blocked") => ({ EDNS: { Options: [{ Code: "EXTENDED_DNS_ERROR", Data: { InfoCode: code, ExtraText: extra } }] } })

  it("names the feed that blocked a domain", () => {
    const v = parseVerdict(resolved({ RCODE: "NxDomain", ...ede("source=block-list-zone; blockListUrl=https://v.example.com/list.txt; domain=ads.example.net") }))
    expect(v).toMatchObject({ kind: "blocked", source: "feed", feedUrl: "https://v.example.com/list.txt", matched: "ads.example.net" })
  })

  it("recognises the user's own blocked zone and other sources", () => {
    expect(parseVerdict(resolved({ RCODE: "NxDomain", ...ede("source=blocked-zone; domain=a.example.com") }))).toMatchObject({ kind: "blocked", source: "own" })
    expect(parseVerdict(resolved({ RCODE: "NxDomain", ...ede("source=advanced-blocking; group=kids", "Filtered") }))).toMatchObject({ kind: "blocked", source: "other" })
  })

  it("does not mistake an ordinary NxDomain for a block", () => {
    expect(parseVerdict(resolved({ RCODE: "NxDomain", EDNS: { Options: [] } })).kind).toBe("not-found")
  })

  it("reports the addresses of an allowed name, and other answers by code", () => {
    const v = parseVerdict(resolved({ Answer: [{ Name: "a", Type: "A", Class: "IN", RDATA: { IPAddress: "192.0.2.1" } }] }))
    expect(v).toEqual({ kind: "allowed", addresses: ["192.0.2.1"] })
    expect(parseVerdict(resolved({ RCODE: "ServerFailure" }))).toEqual({ kind: "other", rcode: "ServerFailure" })
  })
})

describe("freshness", () => {
  const now = Date.parse("2026-10-09T12:00:00Z")

  it("derives the last update from the next one and the interval", () => {
    const f = freshness("2026-10-09T16:00:00Z", 12, now)
    expect(f.next).toBe(Date.parse("2026-10-09T16:00:00Z"))
    expect(f.lastUpdated).toBe(Date.parse("2026-10-09T04:00:00Z"))
    expect(f.overdue).toBe(false)
  })

  it("flags an overdue update, and copes with missing data", () => {
    expect(freshness("2026-10-09T10:00:00Z", 12, now).overdue).toBe(true)
    expect(freshness(undefined, 12, now)).toEqual({ lastUpdated: null, next: null, overdue: false })
    expect(freshness("garbage", 12, now).next).toBeNull()
    expect(freshness("2026-10-09T16:00:00Z", undefined, now).lastUpdated).toBeNull()
  })

  it("formats time until the next update", () => {
    expect(formatIn(20_000)).toBe("in under a minute")
    expect(formatIn(5 * 60_000)).toBe("in 5 min")
    expect(formatIn(3 * 3600_000)).toBe("in 3 h")
    expect(formatIn(72 * 3600_000)).toBe("in 3 d")
  })
})

describe("history", () => {
  beforeEach(() => localStorage.clear())

  it("records a baseline, then only readings that changed", () => {
    expect(recordReading(100, 1000)).toEqual([{ t: 1000, total: 100 }])
    expect(recordReading(100, 2000)).toHaveLength(1)
    expect(recordReading(150, 3000)).toHaveLength(2)
    expect(readHistory()).toHaveLength(2)
  })

  it("can record a refresh that left the total unchanged, when forced", () => {
    recordReading(100, 1000)
    expect(recordReading(100, 2000, true)).toHaveLength(2)
  })

  it("reports the change since the previous reading, if there is one", () => {
    expect(changeSincePrevious([])).toBeNull()
    expect(changeSincePrevious([{ t: 1, total: 100 }])).toBeNull()
    expect(changeSincePrevious([{ t: 1, total: 100 }, { t: 2, total: 90 }])).toBe(-10)
  })

  it("keeps only the latest 30 and survives corrupt storage", () => {
    for (let i = 0; i < 35; i++) recordReading(i, i)
    expect(readHistory()).toHaveLength(30)
    localStorage.setItem("resolvr.blockListHistory", "{oops")
    expect(readHistory()).toEqual([])
  })
})

describe("findCommaProblems", () => {
  it("flags headings and addresses with a comma, ignoring removed feeds", () => {
    const g = parseFeedLines(["# Hagezi, NSFW", "https://a.example.com/x,y.txt", "https://b.example.org/ok.txt"])
    expect(findCommaProblems(g)).toEqual(['the heading "Hagezi, NSFW"', "https://a.example.com/x,y.txt"])
    g[0]!.feeds[0]!.state = "removed"
    expect(findCommaProblems(g)).toEqual(['the heading "Hagezi, NSFW"'])
    expect(findCommaProblems(parseFeedLines(LINES))).toEqual([])
  })
})
