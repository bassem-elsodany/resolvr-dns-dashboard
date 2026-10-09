import { describe, it, expect } from "vitest"
import {
  previousRange,
  countChange,
  shareChange,
  absChange,
  niceMax,
  sliceAngles,
  arcPath,
  bucketHeatmap,
  latencyBins,
  percentileBin,
  bucketEnd,
  tickLabel,
  stackNodes,
  pct,
} from "./charts"

describe("previousRange", () => {
  it("is the window of equal length that ends where the current one starts", () => {
    const now = new Date("2026-10-09T12:00:00Z")
    const r = previousRange("LastDay", now)!
    expect(r.end).toBe("2026-10-08T12:00:00.000Z")
    expect(r.start).toBe("2026-10-07T12:00:00.000Z")
  })

  it("has no comparison for a custom range", () => {
    expect(previousRange("Custom")).toBeNull()
  })
})

describe("changes", () => {
  it("shows a relative change for counts", () => {
    expect(countChange(112, 100)).toEqual({ dir: "up", text: "▲ 12.0%" })
    expect(countChange(50, 100)).toEqual({ dir: "down", text: "▼ 50.0%" })
    expect(countChange(100, 100)!.dir).toBe("flat")
  })

  it("returns null instead of dividing by an empty previous period", () => {
    expect(countChange(10, 0)).toBeNull()
    expect(shareChange(1, 10, 0, 0)).toBeNull()
    expect(absChange(5, 0)).toBeNull()
  })

  it("shows share changes in percentage points", () => {
    expect(shareChange(20, 100, 10, 100)).toEqual({ dir: "up", text: "▲ 10.0 pts" })
    expect(shareChange(5, 100, 10, 100)).toEqual({ dir: "down", text: "▼ 5.0 pts" })
  })

  it("shows absolute changes for small numbers", () => {
    expect(absChange(40, 38)).toEqual({ dir: "up", text: "▲ 2" })
  })
})

describe("niceMax", () => {
  it("rounds up to a readable axis maximum", () => {
    expect(niceMax(0)).toBe(1)
    expect(niceMax(87)).toBe(100)
    expect(niceMax(210)).toBe(400)
    expect(niceMax(1900)).toBe(2000)
  })
})

describe("sliceAngles", () => {
  it("splits the circle in proportion and keeps zero slices", () => {
    const s = sliceAngles([{ value: 75 }, { value: 25 }, { value: 0 }])
    expect(s[0]!.share).toBe(0.75)
    expect(s[0]!.end).toBeCloseTo(Math.PI * 1.5)
    expect(s[1]!.end).toBeCloseTo(Math.PI * 2)
    expect(s[2]!.start).toBe(s[2]!.end)
  })

  it("handles an all-zero set without NaN", () => {
    const s = sliceAngles([{ value: 0 }, { value: 0 }])
    expect(s.every((x) => x.share === 0 && x.end === 0)).toBe(true)
  })
})

describe("arcPath", () => {
  it("draws nothing for an empty slice", () => {
    expect(arcPath(0, 0, 5, 10, 1, 1)).toBe("")
  })

  it("can draw a single full-circle slice", () => {
    expect(arcPath(0, 0, 5, 10, 0, Math.PI * 2)).toMatch(/^M.*Z$/)
  })
})

describe("bucketHeatmap", () => {
  it("sums points into weekday (Monday first) by local hour", () => {
    // 2026-10-05 is a Monday.
    const mon9 = new Date(2026, 9, 5, 9, 0).toISOString()
    const sun23 = new Date(2026, 9, 11, 23, 0).toISOString()
    const g = bucketHeatmap([
      { time: mon9, value: 3 },
      { time: mon9, value: 4 },
      { time: sun23, value: 9 },
      { time: "garbage", value: 100 },
    ])
    expect(g[0]![9]).toBe(7)
    expect(g[6]![23]).toBe(9)
    expect(g.flat().reduce((a, b) => a + b, 0)).toBe(16)
  })
})

describe("latency", () => {
  it("bins round-trip times and finds percentile bins", () => {
    const bins = latencyBins([0.5, 3, 3, 4, 7, 12, 250])
    expect(bins.find((b) => b.label === "2–5")!.count).toBe(3)
    expect(bins.find((b) => b.label === ">200")!.count).toBe(1)
    expect(percentileBin(bins, 0.5)).toBe("2–5")
    expect(percentileBin(bins, 0.99)).toBe(">200")
  })

  it("reports a dash when there is no data", () => {
    expect(percentileBin(latencyBins([]), 0.5)).toBe("–")
  })
})

describe("time labels", () => {
  const hourly = ["2026-10-09T10:00:00Z", "2026-10-09T11:00:00Z"]
  it("computes the end of a bucket from the next label or one step on", () => {
    expect(bucketEnd(hourly, 0)).toBe("2026-10-09T11:00:00.000Z")
    expect(bucketEnd(hourly, 1)).toBe("2026-10-09T12:00:00.000Z")
  })

  it("uses dates, not clock times, for daily data", () => {
    const daily = ["2026-10-02T00:00:00Z", "2026-10-03T00:00:00Z"]
    expect(tickLabel(daily[0]!, daily)).not.toMatch(/:/)
    expect(tickLabel(hourly[0]!, hourly)).toMatch(/:/)
  })

  it("passes unparseable labels through", () => {
    expect(tickLabel("soon", hourly)).toBe("soon")
  })
})

describe("stackNodes", () => {
  it("stacks with gaps and a minimum height", () => {
    const n = stackNodes([100, 1], 0, 8, 1, 10)
    expect(n[0]).toMatchObject({ y: 8, h: 100 })
    expect(n[1]).toMatchObject({ y: 118, h: 3 })
  })
})

describe("pct", () => {
  it("guards against an empty total", () => {
    expect(pct(5, 0)).toBe("0%")
    expect(pct(1, 4)).toBe("25.0%")
  })
})

import { lastOccurrence, buildFlows, pathOf, outcomeOf, ipv4ToInt, scopeSize, groupZoneTypes, cached, clearCache } from "./charts"

describe("lastOccurrence", () => {
  it("finds the most recent matching weekday and hour, never in the future", () => {
    // Fri 9 Oct 2026, 10:30 local.
    const now = new Date(2026, 9, 9, 10, 30)
    const fri9 = lastOccurrence(4, 9, now)
    expect(new Date(fri9.start).getDate()).toBe(9)
    // Friday 11:00 has not happened yet today, so it is last week's.
    const fri11 = lastOccurrence(4, 11, now)
    expect(new Date(fri11.start).getDate()).toBe(2)
    const mon = lastOccurrence(0, 8, now)
    expect(new Date(mon.start).getDate()).toBe(5)
    expect(new Date(mon.end).getTime() - new Date(mon.start).getTime()).toBe(3600_000)
  })
})

describe("flows", () => {
  it("merges the three blocking flavours into one path and one outcome", () => {
    expect(pathOf("CacheBlocked")).toBe("Blocked")
    expect(pathOf("UpstreamBlocked")).toBe("Blocked")
    expect(pathOf("Cached")).toBe("Cached")
    expect(pathOf("Weird")).toBe("Other")
    expect(outcomeOf("Blocked", "NoError")).toBe("Blocked reply")
    expect(outcomeOf("Recursive", "NxDomain")).toBe("NXDomain")
  })

  it("counts path to outcome and drops empty nodes", () => {
    const f = buildFlows([
      { responseType: "Cached", rcode: "NoError" },
      { responseType: "Cached", rcode: "NoError" },
      { responseType: "Cached", rcode: "NxDomain" },
      { responseType: "Blocked", rcode: "NoError" },
    ])
    expect(f.total).toBe(4)
    expect(f.paths).toEqual([
      { name: "Cached", value: 3 },
      { name: "Blocked", value: 1 },
    ])
    expect(f.outcomes.map((o) => o.name)).toEqual(["No error", "NXDomain", "Blocked reply"])
    expect(f.links.reduce((a, l) => a + l[2], 0)).toBe(4)
    expect(f.links[0]).toEqual([0, 0, 2])
  })

  it("has no nodes for an empty sample", () => {
    expect(buildFlows([]).paths).toEqual([])
  })
})

describe("DHCP scope size", () => {
  it("counts the addresses in an IPv4 range, inclusive", () => {
    expect(ipv4ToInt("0.0.1.0")).toBe(256)
    expect(scopeSize("192.168.1.1", "192.168.1.254")).toBe(254)
    expect(scopeSize("10.0.0.1", "10.0.1.0")).toBe(256)
  })

  it("rejects anything that is not a plain IPv4 range", () => {
    expect(scopeSize("fe80::1", "fe80::ff")).toBeNull()
    expect(scopeSize("10.0.0.9", "10.0.0.1")).toBeNull()
    expect(ipv4ToInt("300.1.1.1")).toBeNull()
  })
})

describe("groupZoneTypes", () => {
  it("counts by type, skipping built-in zones, biggest first, unknown types as Other", () => {
    const g = groupZoneTypes([
      { type: "Primary" },
      { type: "Primary" },
      { type: "Forwarder" },
      { type: "Catalog" },
      { type: "Primary", internal: true },
    ])
    expect(g).toEqual([
      { type: "Primary", count: 2 },
      { type: "Forwarder", count: 1 },
      { type: "Other", count: 1 },
    ])
  })
})

describe("cached", () => {
  it("reuses a fresh result, and re-runs when forced", async () => {
    clearCache()
    let calls = 0
    const fn = async () => ++calls
    expect(await cached("k", 1000, fn)).toBe(1)
    expect(await cached("k", 1000, fn)).toBe(1)
    expect(await cached("k", 1000, fn, true)).toBe(2)
  })
})

import { labelYs } from "./charts"

describe("labelYs", () => {
  it("keeps labels at their node middle when there is room, and spaces crowded ones", () => {
    expect(labelYs([{ y: 8, h: 100 }])).toEqual([62])
    const ys = labelYs([
      { y: 100, h: 3 },
      { y: 113, h: 3 },
      { y: 126, h: 40 },
    ])
    expect(ys[1]! - ys[0]!).toBeGreaterThanOrEqual(14)
    expect(ys[2]! - ys[1]!).toBeGreaterThanOrEqual(14)
  })
})
