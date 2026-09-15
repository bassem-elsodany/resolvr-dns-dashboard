import { describe, it, expect, vi, beforeEach } from "vitest"
import { createPinia, setActivePinia } from "pinia"

vi.mock("../api/technitium", async () => {
  const actual = await vi.importActual<typeof import("../api/technitium")>("../api/technitium")
  return {
    ...actual,
    listZones: vi.fn(),
    listBlockedZones: vi.fn(),
    listApps: vi.fn(),
    getTopStats: vi.fn(),
  }
})

import { listZones, listBlockedZones, listApps, getTopStats } from "../api/technitium"
import { useSidebarCountsStore } from "./sidebarCounts"

const credentials = { baseUrl: "http://10.0.60.60:5380", token: "secret" }

describe("sidebarCounts store", () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(listZones).mockReset()
    vi.mocked(listBlockedZones).mockReset()
    vi.mocked(listApps).mockReset()
    vi.mocked(getTopStats).mockReset()
  })

  it("populates all four counts from real responses", async () => {
    vi.mocked(listZones).mockResolvedValue({ response: { pageNumber: 1, totalPages: 17, totalZones: 17, zones: [] } })
    vi.mocked(listBlockedZones).mockResolvedValue({
      response: { domain: "", zones: ["co", "com", "gg"], records: [] },
    })
    vi.mocked(listApps).mockResolvedValue({
      response: { apps: [{ name: "a", description: "", version: "1", updateAvailable: false }, { name: "b", description: "", version: "1", updateAvailable: false }] },
    })
    vi.mocked(getTopStats).mockResolvedValue({
      response: { topClients: [{ name: "10.0.10.30", hits: 1, rateLimited: true }] },
    })

    const store = useSidebarCountsStore()
    await store.load(credentials)

    expect(store.zonesTotal).toBe(17)
    expect(store.blockedZonesTotal).toBe(3)
    expect(store.appsTotal).toBe(2)
    expect(store.rateLimitedClients).toBe(1)
  })

  it("falls back to deduplicated record names for blocked zones when the API auto-descends (zones empty)", async () => {
    vi.mocked(listZones).mockResolvedValue({ response: { pageNumber: 1, totalPages: 1, totalZones: 1, zones: [] } })
    vi.mocked(listBlockedZones).mockResolvedValue({
      response: {
        domain: "single.example",
        zones: [],
        records: [
          { name: "single.example", type: "NS", ttl: 1, rData: {} },
          { name: "single.example", type: "SOA", ttl: 1, rData: {} },
        ],
      },
    })
    vi.mocked(listApps).mockResolvedValue({ response: { apps: [] } })
    vi.mocked(getTopStats).mockResolvedValue({ response: { topClients: [] } })

    const store = useSidebarCountsStore()
    await store.load(credentials)

    expect(store.blockedZonesTotal).toBe(1)
  })

  it("leaves a failing count as null/0 instead of throwing, so one bad endpoint doesn't blank the rest", async () => {
    vi.mocked(listZones).mockRejectedValue(new Error("boom"))
    vi.mocked(listBlockedZones).mockResolvedValue({ response: { domain: "", zones: ["co"], records: [] } })
    vi.mocked(listApps).mockResolvedValue({ response: { apps: [] } })
    vi.mocked(getTopStats).mockResolvedValue({ response: { topClients: [] } })

    const store = useSidebarCountsStore()
    await store.load(credentials)

    expect(store.zonesTotal).toBeNull()
    expect(store.blockedZonesTotal).toBe(1)
  })
})
