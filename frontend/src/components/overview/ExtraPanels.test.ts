import { describe, it, expect, vi, beforeEach } from "vitest"
import { mount, flushPromises } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"

vi.mock("../../api/technitium", async () => {
  const actual = await vi.importActual<typeof import("../../api/technitium")>("../../api/technitium")
  return { ...actual, listDhcpScopes: vi.fn(), listDhcpLeases: vi.fn(), listZones: vi.fn() }
})

import { listDhcpScopes, listDhcpLeases, listZones } from "../../api/technitium"
import { useConnectionStore } from "../../stores/connection"
import { clearCache } from "../../lib/charts"
import DhcpUsagePanel from "./DhcpUsagePanel.vue"
import ZoneTypesPanel from "./ZoneTypesPanel.vue"
import CacheSizePanel from "./CacheSizePanel.vue"

function connect() {
  useConnectionStore().isConfigured = true
}

beforeEach(() => {
  clearCache()
  localStorage.clear()
  setActivePinia(createPinia())
  vi.mocked(listDhcpScopes).mockReset()
  vi.mocked(listDhcpLeases).mockReset()
  vi.mocked(listZones).mockReset()
})

const lease = (scope: string, n: number) => ({ scope, hardwareAddress: `aa:${scope}:${n}`, address: "x", hostName: null, leaseObtained: "", leaseExpires: "" })

describe("DhcpUsagePanel", () => {
  it("shows leases against scope size, flags nearly full scopes, and skips disabled ones", async () => {
    vi.mocked(listDhcpScopes).mockResolvedValue({
      response: {
        scopes: [
          { name: "LAN", enabled: true, startingAddress: "192.168.1.1", endingAddress: "192.168.1.10", subnetMask: "" },
          { name: "IoT", enabled: true, startingAddress: "10.0.0.1", endingAddress: "10.0.0.10", subnetMask: "" },
          { name: "Old", enabled: false, startingAddress: "10.9.0.1", endingAddress: "10.9.0.10", subnetMask: "" },
        ],
      },
    })
    vi.mocked(listDhcpLeases).mockResolvedValue({
      response: { leases: [...[1, 2, 3].map((n) => lease("LAN", n)), ...Array.from({ length: 10 }, (_, n) => lease("IoT", n))] },
    })
    const wrapper = mount(DhcpUsagePanel)
    connect()
    await flushPromises()

    expect(wrapper.findAll(".dhcp-row")).toHaveLength(2)
    expect(wrapper.text()).toContain("3/10")
    expect(wrapper.text()).toContain("10/10 ▲")
    expect(wrapper.findAll(".dhcp-hot")).toHaveLength(1)
    expect(wrapper.get("#dhcp-warning").text()).toContain("IoT is 100% full")
    expect(wrapper.text()).not.toContain("Old")
  })

  it("renders nothing when the server has no usable DHCP scopes", async () => {
    vi.mocked(listDhcpScopes).mockResolvedValue({ response: { scopes: [] } })
    vi.mocked(listDhcpLeases).mockResolvedValue({ response: { leases: [] } })
    const wrapper = mount(DhcpUsagePanel)
    connect()
    await flushPromises()
    expect(wrapper.text()).toBe("")
  })
})

describe("ZoneTypesPanel", () => {
  it("groups zones by type and counts the DNSSEC-signed ones, ignoring built-in zones", async () => {
    const z = (name: string, type: string, dnssecStatus = "Unsigned", internal = false) => ({ name, type, dnssecStatus, internal, soaSerial: 1, disabled: false, lastModified: "" })
    vi.mocked(listZones).mockResolvedValue({
      response: {
        pageNumber: 1,
        totalPages: 1,
        totalZones: 4,
        zones: [z("a", "Primary", "SignedWithNSEC"), z("b", "Primary"), z("c", "Forwarder"), z("localhost", "Primary", "Unsigned", true)],
      },
    })
    const wrapper = mount(ZoneTypesPanel)
    connect()
    await flushPromises()

    expect(wrapper.text()).toContain("3 zones, 1 DNSSEC signed")
    expect(wrapper.findAll(".zone-legend").map((l) => l.text())).toEqual(["Primary 2", "Forwarder 1"])
  })

  it("says so when zones cannot be loaded", async () => {
    vi.mocked(listZones).mockRejectedValue(new Error("boom"))
    const wrapper = mount(ZoneTypesPanel)
    connect()
    await flushPromises()
    expect(wrapper.text()).toContain("Could not load zones")
  })
})

describe("CacheSizePanel", () => {
  it("shows the current size and explains the missing trend on a first visit", () => {
    const wrapper = mount(CacheSizePanel, { props: { entries: 18420 } })
    expect(wrapper.get("#cache-entries").text()).toBe("18,420")
    expect(wrapper.find("#cache-trend-hint").exists()).toBe(true)
    expect(JSON.parse(localStorage.getItem("resolvr.cacheSamples")!)).toHaveLength(1)
  })

  it("draws a trend from earlier readings kept in this browser", () => {
    const now = Date.now()
    localStorage.setItem(
      "resolvr.cacheSamples",
      JSON.stringify([
        { t: now - 3 * 3600_000, v: 100 },
        { t: now - 2 * 3600_000, v: 200 },
      ]),
    )
    const wrapper = mount(CacheSizePanel, { props: { entries: 300 } })
    expect(wrapper.find("svg").exists()).toBe(true)
    expect(wrapper.find("#cache-trend-hint").exists()).toBe(false)
  })

  it("drops readings older than a day and survives corrupt storage", () => {
    localStorage.setItem("resolvr.cacheSamples", JSON.stringify([{ t: Date.now() - 3 * 86400_000, v: 1 }]))
    mount(CacheSizePanel, { props: { entries: 5 } })
    expect(JSON.parse(localStorage.getItem("resolvr.cacheSamples")!)).toHaveLength(1)

    localStorage.setItem("resolvr.cacheSamples", "{not json")
    expect(() => mount(CacheSizePanel, { props: { entries: 5 } })).not.toThrow()
  })
})
