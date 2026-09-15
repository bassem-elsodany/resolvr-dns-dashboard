import { describe, it, expect, vi, beforeEach } from "vitest"
import { mount } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"

vi.mock("../api/technitium", async () => {
  const actual = await vi.importActual<typeof import("../api/technitium")>("../api/technitium")
  return { ...actual, listAllowedZones: vi.fn(), exportAllowedZones: vi.fn() }
})
vi.mock("../lib/download", () => ({ triggerDownload: vi.fn() }))

import { listAllowedZones, exportAllowedZones, TechnitiumApiError } from "../api/technitium"
import { triggerDownload } from "../lib/download"
import { useConnectionStore } from "../stores/connection"
import AllowedZonesView from "./AllowedZonesView.vue"

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function mountConnected() {
  const wrapper = mount(AllowedZonesView, { global: { stubs: { RouterLink: true } } })
  const connection = useConnectionStore()
  connection.setConfig("http://10.0.60.60:5380", "secret-token")
  await flushPromises()
  return wrapper
}

describe("AllowedZonesView", () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.mocked(listAllowedZones).mockReset()
    vi.mocked(exportAllowedZones).mockReset()
    vi.mocked(triggerDownload).mockReset()
  })

  it("renders the real allowed zone list", async () => {
    vi.mocked(listAllowedZones).mockResolvedValue({ response: { domain: "", zones: ["ntp.org"], records: [] } })
    const wrapper = await mountConnected()

    expect(wrapper.text()).toContain("ntp.org")
  })

  it("falls back to record names when the API auto-descends into a single allowed entry (zones empty, records populated)", async () => {
    vi.mocked(listAllowedZones).mockResolvedValue({
      response: {
        domain: "lycamobileuklimited.data.adobedc.net",
        zones: [],
        records: [
          { name: "lycamobileuklimited.data.adobedc.net", type: "NS", ttl: 14400, rData: { nameServer: "dns.villa58.lan" } },
          { name: "lycamobileuklimited.data.adobedc.net", type: "SOA", ttl: 30, rData: {} },
        ],
      },
    })
    const wrapper = await mountConnected()

    expect(wrapper.text()).toContain("lycamobileuklimited.data.adobedc.net")
    // deduplicated — two records for the same name, one row
    expect(wrapper.findAll("tbody tr")).toHaveLength(1)
  })

  it("filters the list client-side", async () => {
    vi.mocked(listAllowedZones).mockResolvedValue({
      response: { domain: "", zones: ["ntp.org", "example.com"], records: [] },
    })
    const wrapper = await mountConnected()

    await wrapper.get("#allowed-filter").setValue("ntp")

    expect(wrapper.text()).toContain("ntp.org")
    expect(wrapper.text()).not.toContain("example.com")
  })

  it("exports the allowed zones as a download", async () => {
    vi.mocked(listAllowedZones).mockResolvedValue({ response: { domain: "", zones: [], records: [] } })
    vi.mocked(exportAllowedZones).mockResolvedValue({ blob: new Blob(["a"]), filename: "allowed.csv" })
    const wrapper = await mountConnected()

    await wrapper.get("#export-allowed").trigger("click")
    await flushPromises()

    expect(triggerDownload).toHaveBeenCalledWith({ blob: expect.any(Blob), filename: "allowed.csv" })
  })

  it("shows a readable inline error, not a raw stack trace, on failure", async () => {
    vi.mocked(listAllowedZones).mockRejectedValue(new TechnitiumApiError("Invalid token or session expired.", 200))
    const wrapper = await mountConnected()

    expect(wrapper.find("#allowed-error").text()).toBe("Invalid token or session expired.")
  })
})
