import { describe, it, expect, vi, beforeEach } from "vitest"
import { mount } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"

vi.mock("../api/technitium", async () => {
  const actual = await vi.importActual<typeof import("../api/technitium")>("../api/technitium")
  return { ...actual, listZones: vi.fn(), getZoneRecords: vi.fn() }
})

import { listZones, getZoneRecords, TechnitiumApiError, type ZoneSummary } from "../api/technitium"
import { useConnectionStore } from "../stores/connection"
import ZonesView from "./ZonesView.vue"

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function zonesResult(zones: ZoneSummary[], overrides: Partial<{ totalPages: number; totalZones: number }> = {}) {
  return { response: { pageNumber: 1, totalPages: overrides.totalPages ?? 1, totalZones: overrides.totalZones ?? zones.length, zones } }
}

async function mountConnected() {
  const wrapper = mount(ZonesView, { global: { stubs: { RouterLink: true } } })
  const connection = useConnectionStore()
  connection.setConfig("http://10.0.60.60:5380", "secret-token")
  await flushPromises()
  return wrapper
}

describe("ZonesView", () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.mocked(listZones).mockReset()
    vi.mocked(getZoneRecords).mockReset()
  })

  it("shows Healthy for a zone with no health flags set", async () => {
    vi.mocked(listZones).mockResolvedValue(
      zonesResult([{ name: "villa58.lan", type: "Primary", dnssecStatus: "Unsigned", soaSerial: 1, disabled: false, lastModified: "" }]),
    )
    const wrapper = await mountConnected()

    expect(wrapper.text()).toContain("Healthy")
  })

  it("shows a Sync failed badge for a secondary zone with syncFailed: true", async () => {
    vi.mocked(listZones).mockResolvedValue(
      zonesResult([
        { name: "backup.villa58.lan", type: "Secondary", dnssecStatus: "Unsigned", soaSerial: 1, disabled: false, lastModified: "", syncFailed: true },
      ]),
    )
    const wrapper = await mountConnected()

    expect(wrapper.text()).toContain("Sync failed")
  })

  it("loads and displays a zone's records when a row is clicked", async () => {
    vi.mocked(listZones).mockResolvedValue(
      zonesResult([{ name: "villa58.lan", type: "Primary", dnssecStatus: "Unsigned", soaSerial: 1, disabled: false, lastModified: "" }]),
    )
    vi.mocked(getZoneRecords).mockResolvedValue({
      response: {
        zone: { name: "villa58.lan", type: "Primary" },
        records: [{ name: "villa58.lan", type: "A", ttl: 3600, rData: { ipAddress: "10.0.10.1" } }],
      },
    })
    const wrapper = await mountConnected()

    await wrapper.get("tbody tr").trigger("click")
    await flushPromises()

    expect(getZoneRecords).toHaveBeenCalledWith("villa58.lan", expect.anything())
    expect(wrapper.text()).toContain("10.0.10.1")
  })

  it("resets to page 1 and refetches when the name filter changes", async () => {
    vi.mocked(listZones).mockResolvedValue(zonesResult([]))
    const wrapper = await mountConnected()
    vi.mocked(listZones).mockClear()

    await wrapper.get("#zone-filter").setValue("villa58")
    await wrapper.get("#zone-filter").trigger("change")
    await flushPromises()

    expect(listZones).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ filterName: "villa58", pageNumber: 1 }),
    )
  })

  it("shows a readable inline error, not a raw stack trace, on failure", async () => {
    vi.mocked(listZones).mockRejectedValue(new TechnitiumApiError("Invalid token or session expired.", 200))
    const wrapper = await mountConnected()

    expect(wrapper.find("#zones-error").text()).toBe("Invalid token or session expired.")
  })
})
