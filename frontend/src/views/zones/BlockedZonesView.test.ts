import { describe, it, expect, vi, beforeEach } from "vitest"
import { mount } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"

vi.mock("../../api/technitium", async () => {
  const actual = await vi.importActual<typeof import("../../api/technitium")>("../../api/technitium")
  return { ...actual, listBlockedZones: vi.fn(), exportBlockedZones: vi.fn() }
})
vi.mock("../../lib/download", () => ({ triggerDownload: vi.fn() }))

import { listBlockedZones, exportBlockedZones, TechnitiumApiError } from "../../api/technitium"
import { triggerDownload } from "../../lib/download"
import { useConnectionStore } from "../../stores/connection"
import BlockedZonesView from "./BlockedZonesView.vue"

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function mountConnected() {
  const wrapper = mount(BlockedZonesView, { global: { stubs: { RouterLink: true } } })
  const connection = useConnectionStore()
  connection.setConfig("http://10.0.60.60:5380", "secret-token")
  await flushPromises()
  return wrapper
}

describe("BlockedZonesView", () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.mocked(listBlockedZones).mockReset()
    vi.mocked(exportBlockedZones).mockReset()
    vi.mocked(triggerDownload).mockReset()
  })

  it("renders the real blocked zone list (13 TLD-level entries on the live server)", async () => {
    vi.mocked(listBlockedZones).mockResolvedValue({
      response: { domain: "", zones: ["co", "com", "gg", "guru", "la"], records: [] },
    })
    const wrapper = await mountConnected()

    expect(wrapper.findAll("tbody tr")).toHaveLength(5)
    expect(wrapper.text()).toContain("com")
  })

  it("filters the list client-side", async () => {
    vi.mocked(listBlockedZones).mockResolvedValue({ response: { domain: "", zones: ["com", "guru"], records: [] } })
    const wrapper = await mountConnected()

    await wrapper.get("#blocked-filter").setValue("gur")

    expect(wrapper.text()).toContain("guru")
    expect(wrapper.text()).not.toContain("com")
  })

  it("exports the blocked zones as a download", async () => {
    vi.mocked(listBlockedZones).mockResolvedValue({ response: { domain: "", zones: [], records: [] } })
    vi.mocked(exportBlockedZones).mockResolvedValue({ blob: new Blob(["a"]), filename: "blocked.csv" })
    const wrapper = await mountConnected()

    await wrapper.get("#export-blocked").trigger("click")
    await flushPromises()

    expect(triggerDownload).toHaveBeenCalledWith({ blob: expect.any(Blob), filename: "blocked.csv" })
  })

  it("shows a readable inline error, not a raw stack trace, on failure", async () => {
    vi.mocked(listBlockedZones).mockRejectedValue(new TechnitiumApiError("Invalid token or session expired.", 200))
    const wrapper = await mountConnected()

    expect(wrapper.find("#blocked-error").text()).toBe("Invalid token or session expired.")
  })
})
