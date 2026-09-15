import { describe, it, expect, vi, beforeEach } from "vitest"
import { mount } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"

vi.mock("../../api/technitium", async () => {
  const actual = await vi.importActual<typeof import("../../api/technitium")>("../../api/technitium")
  return { ...actual, listBlockedZones: vi.fn(), exportBlockedZones: vi.fn(), getSettings: vi.fn() }
})
vi.mock("../../lib/download", () => ({ triggerDownload: vi.fn() }))

import { listBlockedZones, exportBlockedZones, getSettings, TechnitiumApiError } from "../../api/technitium"
import { triggerDownload } from "../../lib/download"
import { useConnectionStore } from "../../stores/connection"
import BlockedZonesView from "./BlockedZonesView.vue"

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function mountConnected() {
  const wrapper = mount(BlockedZonesView, { global: { stubs: { RouterLink: true } } })
  const connection = useConnectionStore()
  connection.isConfigured = true
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
    vi.mocked(getSettings).mockReset().mockResolvedValue({ response: {} as never })
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

  describe("block list sources", () => {
    it("lists the configured block list feed URLs, matching the real server's mix of comments and URLs", async () => {
      vi.mocked(listBlockedZones).mockResolvedValue({ response: { domain: "", zones: [], records: [] } })
      vi.mocked(getSettings).mockResolvedValue({
        response: {
          enableBlocking: true,
          blockingType: "NxDomain",
          blockListUrls: [
            "# Hagezi PRO++",
            "https://raw.githubusercontent.com/hagezi/dns-blocklists/main/hosts/pro.plus.txt",
            "# OISD Big",
            "https://big.oisd.nl/",
          ],
        } as never,
      })

      const wrapper = await mountConnected()

      expect(wrapper.text()).toContain("Blocking enabled")
      expect(wrapper.text()).toContain("NxDomain")
      expect(wrapper.text()).toContain("Hagezi PRO++")
      expect(wrapper.text()).toContain("https://big.oisd.nl/")
      const link = wrapper.get("#block-list-sources a[href='https://big.oisd.nl/']")
      expect(link.attributes("target")).toBe("_blank")
    })

    it("shows a 'Blocking disabled' badge when the server has blocking turned off", async () => {
      vi.mocked(listBlockedZones).mockResolvedValue({ response: { domain: "", zones: [], records: [] } })
      vi.mocked(getSettings).mockResolvedValue({
        response: { enableBlocking: false, blockListUrls: ["https://big.oisd.nl/"] } as never,
      })

      const wrapper = await mountConnected()

      expect(wrapper.text()).toContain("Blocking disabled")
    })

    it("hides the block list sources card entirely when no feeds are configured", async () => {
      vi.mocked(listBlockedZones).mockResolvedValue({ response: { domain: "", zones: [], records: [] } })
      vi.mocked(getSettings).mockResolvedValue({ response: { blockListUrls: [] } as never })

      const wrapper = await mountConnected()

      expect(wrapper.find("#block-list-sources").exists()).toBe(false)
    })

    it("shows a readable error, not a raw stack trace, when the block list sources fail to load", async () => {
      vi.mocked(listBlockedZones).mockResolvedValue({ response: { domain: "", zones: [], records: [] } })
      vi.mocked(getSettings).mockRejectedValue(new TechnitiumApiError("Invalid token or session expired.", 200))

      const wrapper = await mountConnected()

      expect(wrapper.find("#block-list-sources-error").text()).toBe("Invalid token or session expired.")
    })
  })
})
