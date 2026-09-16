import { describe, it, expect, vi, beforeEach } from "vitest"
import { mount } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"

vi.mock("../../api/technitium", async () => {
  const actual = await vi.importActual<typeof import("../../api/technitium")>("../../api/technitium")
  return { ...actual, listZones: vi.fn(), getZoneRecords: vi.fn() }
})
vi.mock("../../api/app", async () => {
  const actual = await vi.importActual<typeof import("../../api/app")>("../../api/app")
  return { ...actual, createZone: vi.fn(), addRecord: vi.fn(), deleteZone: vi.fn() }
})

import { listZones, getZoneRecords, TechnitiumApiError, type ZoneSummary } from "../../api/technitium"
import { createZone, addRecord, deleteZone, AppApiError } from "../../api/app"
import { useConnectionStore } from "../../stores/connection"
import { useAuthStore } from "../../stores/auth"
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
  connection.isConfigured = true
  await flushPromises()
  return wrapper
}

describe("ZonesView", () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.mocked(listZones).mockReset()
    vi.mocked(getZoneRecords).mockReset()
    vi.mocked(createZone).mockReset()
    vi.mocked(addRecord).mockReset()
    vi.mocked(deleteZone).mockReset()
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

  describe("host-to-IP mapping (admin only)", () => {
    it("hides the Add mapping form for a viewer", async () => {
      useAuthStore().user = { id: 2, username: "reader", role: "viewer" }
      vi.mocked(listZones).mockResolvedValue(zonesResult([]))

      const wrapper = await mountConnected()

      expect(wrapper.find("#new-mapping-hostname").exists()).toBe(false)
    })

    it("lets an admin create a host mapping by creating a zone then adding an A record", async () => {
      useAuthStore().user = { id: 1, username: "admin", role: "admin" }
      vi.mocked(listZones).mockResolvedValue(zonesResult([]))
      vi.mocked(createZone).mockResolvedValue({ status: "ok" })
      vi.mocked(addRecord).mockResolvedValue({ status: "ok" })

      const wrapper = await mountConnected()
      await wrapper.get("#new-mapping-hostname").setValue("nas2")
      await wrapper.get("#new-mapping-ip").setValue("10.0.10.201")
      await wrapper.get("form").trigger("submit")
      await flushPromises()

      expect(createZone).toHaveBeenCalledWith("nas2")
      expect(addRecord).toHaveBeenCalledWith({ domain: "nas2", zone: "nas2", type: "A", ipAddress: "10.0.10.201" })
      expect(listZones).toHaveBeenCalledTimes(2)
    })

    it("shows a readable error, not a raw stack trace, when creating a mapping fails", async () => {
      useAuthStore().user = { id: 1, username: "admin", role: "admin" }
      vi.mocked(listZones).mockResolvedValue(zonesResult([]))
      vi.mocked(createZone).mockRejectedValue(new AppApiError("Zone already exists.", 400))

      const wrapper = await mountConnected()
      await wrapper.get("#new-mapping-hostname").setValue("nas")
      await wrapper.get("#new-mapping-ip").setValue("10.0.10.200")
      await wrapper.get("form").trigger("submit")
      await flushPromises()

      expect(wrapper.find("#add-mapping-error").text()).toBe("Zone already exists.")
    })

    it("hides the Delete zone control for a viewer even with a zone selected", async () => {
      useAuthStore().user = { id: 2, username: "reader", role: "viewer" }
      vi.mocked(listZones).mockResolvedValue(
        zonesResult([{ name: "nas2", type: "Primary", dnssecStatus: "Unsigned", soaSerial: 1, disabled: false, lastModified: "" }]),
      )
      vi.mocked(getZoneRecords).mockResolvedValue({ response: { zone: { name: "nas2", type: "Primary" }, records: [] } })
      const wrapper = await mountConnected()

      await wrapper.get("tbody tr").trigger("click")
      await flushPromises()

      expect(wrapper.find("#delete-zone").exists()).toBe(false)
    })

    it("lets an admin delete a zone after confirming, then clears the selection", async () => {
      useAuthStore().user = { id: 1, username: "admin", role: "admin" }
      vi.mocked(listZones).mockResolvedValue(
        zonesResult([{ name: "nas2", type: "Primary", dnssecStatus: "Unsigned", soaSerial: 1, disabled: false, lastModified: "" }]),
      )
      vi.mocked(getZoneRecords).mockResolvedValue({ response: { zone: { name: "nas2", type: "Primary" }, records: [] } })
      vi.mocked(deleteZone).mockResolvedValue({ status: "ok" })
      const wrapper = await mountConnected()

      await wrapper.get("tbody tr").trigger("click")
      await flushPromises()
      await wrapper.get("#delete-zone").trigger("click")
      await wrapper.get("#confirm-delete-zone").trigger("click")
      await flushPromises()

      expect(deleteZone).toHaveBeenCalledWith("nas2")
      expect(wrapper.find("#delete-zone").exists()).toBe(false)
    })
  })
})
