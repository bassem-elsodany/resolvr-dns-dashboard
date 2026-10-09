import { describe, it, expect, vi } from "vitest"
import type { DomainListResult } from "../api/technitium"
import { walkBlockedZones } from "./blockedTree"

// A tiny tree: com -> example.com (blocked) -> a.example.com (blocked); net -> ads.example.net (blocked)
const TREE: Record<string, { zones: string[]; own: boolean; domain?: string }> = {
  "": { zones: ["com", "net"], own: false },
  com: { zones: ["example.com"], own: false },
  "example.com": { zones: ["a.example.com"], own: true },
  "a.example.com": { zones: [], own: true },
  net: { zones: ["ads.example.net"], own: false },
  "ads.example.net": { zones: [], own: true },
}

function fetcher() {
  return vi.fn(async (d: string): Promise<DomainListResult> => {
    const n = TREE[d]!
    return { response: { domain: n.domain ?? d, zones: n.zones, records: n.own ? [{ name: d, type: "A", ttl: 1, rData: {} }] : [] } }
  })
}

describe("walkBlockedZones", () => {
  it("collects only nodes that hold a blocked entry, not grouping labels", async () => {
    const f = fetcher()
    const r = await walkBlockedZones(f)
    expect(r.domains).toEqual(["a.example.com", "ads.example.net", "example.com"])
    expect(r.truncated).toBe(false)
    expect(f).toHaveBeenCalledTimes(6)
  })

  it("uses the name the server resolves to when it skips through single-child zones", async () => {
    const f = vi.fn(async (d: string): Promise<DomainListResult> => ({
      response: d === "" ? { domain: "", zones: ["example"], records: [] } : { domain: "deep.example", zones: [], records: [{ name: "deep.example", type: "A", ttl: 1, rData: {} }] },
    }))
    expect((await walkBlockedZones(f)).domains).toEqual(["deep.example"])
  })

  it("reads entries directly when the root already holds them", async () => {
    const f = vi.fn(async (): Promise<DomainListResult> => ({ response: { domain: "", zones: [], records: [{ name: "x.example.com", type: "A", ttl: 1, rData: {} }] } }))
    expect((await walkBlockedZones(f)).domains).toEqual(["x.example.com"])
  })

  it("stops at the cap and says so", async () => {
    const f = fetcher()
    const r = await walkBlockedZones(f, { cap: 2 })
    expect(r.truncated).toBe(true)
  })

  it("reports progress and never runs more requests at once than allowed", async () => {
    let running = 0
    let peak = 0
    const f = vi.fn(async (d: string): Promise<DomainListResult> => {
      running++
      peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, 2))
      running--
      const n = TREE[d]!
      return { response: { domain: d, zones: n.zones, records: n.own ? [{ name: d, type: "A", ttl: 1, rData: {} }] : [] } }
    })
    const progress: number[] = []
    await walkBlockedZones(f, { concurrency: 1, onProgress: (n) => progress.push(n) })
    expect(peak).toBe(1)
    expect(progress.at(-1)).toBe(3)
  })

  it("lets a failing branch fail the walk", async () => {
    const f = vi.fn(async (d: string): Promise<DomainListResult> => {
      if (d === "net") throw new Error("boom")
      return fetcher()(d)
    })
    await expect(walkBlockedZones(f)).rejects.toThrow("boom")
  })
})
