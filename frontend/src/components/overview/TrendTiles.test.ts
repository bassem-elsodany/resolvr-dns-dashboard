import { describe, it, expect } from "vitest"
import { mount } from "@vue/test-utils"
import TrendTiles from "./TrendTiles.vue"

function stats(over: Partial<Record<string, number>> = {}) {
  return {
    totalQueries: 1000,
    totalNoError: 900,
    totalServerFailure: 0,
    totalNxDomain: 50,
    totalRefused: 0,
    totalAuthoritative: 10,
    totalRecursive: 400,
    totalCached: 500,
    totalBlocked: 200,
    totalDropped: 0,
    totalClients: 12,
    zones: 3,
    cachedEntries: 100,
    allowedZones: 0,
    blockedZones: 0,
    allowListZones: 0,
    blockListZones: 0,
    ...over,
  }
}

const chart = {
  labelFormat: "HH:mm",
  labels: ["2026-10-09T10:00:00Z", "2026-10-09T11:00:00Z", "2026-10-09T12:00:00Z"],
  datasets: [
    { label: "Total", data: [1, 3, 2] },
    { label: "Blocked", data: [0, 1, 1] },
    { label: "Cached", data: [1, 1, 1] },
    { label: "NX Domain", data: [0, 0, 1] },
    { label: "Clients", data: [4, 5, 6] },
  ],
}

function mountTiles(prev: ReturnType<typeof stats> | null) {
  return mount(TrendTiles, { props: { stats: stats(), prev, chart, duration: "LastDay" } })
}

describe("TrendTiles", () => {
  it("shows the five headline numbers, including the rates", () => {
    const text = mountTiles(null).text()
    expect(text).toContain("Total queries")
    expect(text).toContain("1,000")
    expect(text).toContain("Cache hit rate")
    expect(text).toContain("50.0%") // 500 / 1000
    expect(text).toContain("20.0% of queries") // blocked
    expect(text).toContain("5.0% of queries") // NXDomain
    expect(text).toContain("Active clients")
  })

  it("shows no change at all when there is no previous period to compare with", () => {
    expect(mountTiles(null).findAll(".tile-change")).toHaveLength(0)
  })

  it("compares against the previous period", () => {
    const wrapper = mountTiles(stats({ totalQueries: 800, totalCached: 300, totalClients: 10 }))
    const total = wrapper.get('[data-tile="total"]').text()
    expect(total).toContain("▲ 25.0%")
    expect(total).toContain("vs previous 24h")
    expect(wrapper.get('[data-tile="cache"]').text()).toContain("▲ 12.5 pts")
    expect(wrapper.get('[data-tile="clients"]').text()).toContain("▲ 2")
  })

  it("colours a rise in NXDomain as bad and a rise in cache hits as good", () => {
    const wrapper = mountTiles(stats({ totalNxDomain: 10, totalCached: 300 }))
    expect(wrapper.get('[data-tile="nx"] .tile-change').classes()).toContain("text-crit")
    expect(wrapper.get('[data-tile="cache"] .tile-change').classes()).toContain("text-ok")
    expect(wrapper.get('[data-tile="total"] .tile-change').classes()).toContain("text-gray-400")
  })

  it("draws a sparkline per tile that has a series", () => {
    expect(mountTiles(null).findAll("svg")).toHaveLength(5)
  })
})
