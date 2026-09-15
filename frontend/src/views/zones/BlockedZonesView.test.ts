import { describe, it, expect, vi, beforeEach } from "vitest"
import { mount } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"

vi.mock("../../api/technitium", async () => {
  const actual = await vi.importActual<typeof import("../../api/technitium")>("../../api/technitium")
  return { ...actual, listBlockedZones: vi.fn(), exportBlockedZones: vi.fn(), getSettings: vi.fn() }
})
vi.mock("../../lib/download", () => ({ triggerDownload: vi.fn() }))
vi.mock("../../api/app", async () => {
  const actual = await vi.importActual<typeof import("../../api/app")>("../../api/app")
  return { ...actual, updateBlockListUrls: vi.fn() }
})

import { listBlockedZones, exportBlockedZones, getSettings, TechnitiumApiError } from "../../api/technitium"
import { updateBlockListUrls, AppApiError } from "../../api/app"
import { triggerDownload } from "../../lib/download"
import { useConnectionStore } from "../../stores/connection"
import { useAuthStore } from "../../stores/auth"
import BlockedZonesView from "./BlockedZonesView.vue"
import ZoneTreeNode from "../../components/zones/ZoneTreeNode.vue"

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
    vi.mocked(updateBlockListUrls).mockReset()
  })

  it("renders the real blocked zone list as a tree of root domains (13 TLD-level entries on the live server)", async () => {
    vi.mocked(listBlockedZones).mockResolvedValue({
      response: { domain: "", zones: ["co", "com", "gg", "guru", "la"], records: [] },
    })
    const wrapper = await mountConnected()

    const rootNodes = wrapper.findAllComponents(ZoneTreeNode).filter((c) => c.props("depth") === 0)
    expect(rootNodes).toHaveLength(5)
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

  it("expands a root domain into its real subdomains on click, instead of showing only the misleading top-level list", async () => {
    // Regression: the page used to show only the 13 root-level TLD
    // labels as if they were the full blocked list — "com" alone
    // actually holds 40+ blocked domains underneath it on the live
    // server, invisible in the old flat view.
    vi.mocked(listBlockedZones).mockImplementation((_creds, domain = "") => {
      if (domain === "") return Promise.resolve({ response: { domain: "", zones: ["com"], records: [] } })
      if (domain === "com") {
        return Promise.resolve({ response: { domain: "com", zones: ["pornhub.com", "tiktok.com"], records: [] } })
      }
      return Promise.resolve({ response: { domain, zones: [], records: [] } })
    })
    const wrapper = await mountConnected()

    await wrapper.get("#blocked-zone-tree button").trigger("click")
    await flushPromises()

    expect(listBlockedZones).toHaveBeenCalledWith(expect.anything(), "com")
    expect(wrapper.text()).toContain("pornhub.com")
    expect(wrapper.text()).toContain("tiktok.com")
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

    it("hides the Edit control for a viewer", async () => {
      useAuthStore().user = { id: 2, username: "reader", role: "viewer" }
      vi.mocked(listBlockedZones).mockResolvedValue({ response: { domain: "", zones: [], records: [] } })
      vi.mocked(getSettings).mockResolvedValue({ response: { blockListUrls: ["https://big.oisd.nl/"] } as never })

      const wrapper = await mountConnected()

      expect(wrapper.find("#edit-block-list-sources").exists()).toBe(false)
    })

    it("still shows the card for an admin even with no feeds configured, so they can add the first one", async () => {
      useAuthStore().user = { id: 1, username: "admin", role: "admin" }
      vi.mocked(listBlockedZones).mockResolvedValue({ response: { domain: "", zones: [], records: [] } })
      vi.mocked(getSettings).mockResolvedValue({ response: { blockListUrls: [] } as never })

      const wrapper = await mountConnected()

      expect(wrapper.find("#edit-block-list-sources").exists()).toBe(true)
      expect(wrapper.text()).toContain("No block list feeds configured.")
    })

    it("lets an admin edit the raw list (comments and URLs, one per line) and saves it", async () => {
      useAuthStore().user = { id: 1, username: "admin", role: "admin" }
      vi.mocked(listBlockedZones).mockResolvedValue({ response: { domain: "", zones: [], records: [] } })
      vi.mocked(getSettings)
        .mockResolvedValueOnce({
          response: { blockListUrls: ["# Hagezi PRO++", "https://raw.githubusercontent.com/hagezi/pro.plus.txt"] } as never,
        })
        .mockResolvedValueOnce({
          response: {
            blockListUrls: [
              "# Hagezi PRO++",
              "https://raw.githubusercontent.com/hagezi/pro.plus.txt",
              "https://big.oisd.nl/",
            ],
          } as never,
        })
      vi.mocked(updateBlockListUrls).mockResolvedValue({ status: "ok" })

      const wrapper = await mountConnected()
      await wrapper.get("#edit-block-list-sources").trigger("click")

      const textarea = wrapper.get("#block-list-sources-editor")
      expect((textarea.element as HTMLTextAreaElement).value).toBe(
        "# Hagezi PRO++\nhttps://raw.githubusercontent.com/hagezi/pro.plus.txt",
      )

      await textarea.setValue(
        "# Hagezi PRO++\nhttps://raw.githubusercontent.com/hagezi/pro.plus.txt\nhttps://big.oisd.nl/",
      )
      await wrapper.get("#save-block-list-sources").trigger("click")
      await flushPromises()

      expect(updateBlockListUrls).toHaveBeenCalledWith([
        "# Hagezi PRO++",
        "https://raw.githubusercontent.com/hagezi/pro.plus.txt",
        "https://big.oisd.nl/",
      ])
      expect(wrapper.find("#block-list-sources-editor").exists()).toBe(false)
      expect(wrapper.text()).toContain("https://big.oisd.nl/")
    })

    it("drops blank lines when saving, but keeps comment lines", async () => {
      useAuthStore().user = { id: 1, username: "admin", role: "admin" }
      vi.mocked(listBlockedZones).mockResolvedValue({ response: { domain: "", zones: [], records: [] } })
      vi.mocked(getSettings).mockResolvedValue({ response: { blockListUrls: [] } as never })
      vi.mocked(updateBlockListUrls).mockResolvedValue({ status: "ok" })

      const wrapper = await mountConnected()
      await wrapper.get("#edit-block-list-sources").trigger("click")
      await wrapper.get("#block-list-sources-editor").setValue("https://big.oisd.nl/\n\n  \n# Label")
      await wrapper.get("#save-block-list-sources").trigger("click")
      await flushPromises()

      expect(updateBlockListUrls).toHaveBeenCalledWith(["https://big.oisd.nl/", "# Label"])
    })

    it("shows a readable error, not a raw stack trace, when saving fails, and keeps the editor open", async () => {
      useAuthStore().user = { id: 1, username: "admin", role: "admin" }
      vi.mocked(listBlockedZones).mockResolvedValue({ response: { domain: "", zones: [], records: [] } })
      vi.mocked(getSettings).mockResolvedValue({ response: { blockListUrls: ["https://big.oisd.nl/"] } as never })
      vi.mocked(updateBlockListUrls).mockRejectedValue(new AppApiError("Permission denied.", 502))

      const wrapper = await mountConnected()
      await wrapper.get("#edit-block-list-sources").trigger("click")
      await wrapper.get("#save-block-list-sources").trigger("click")
      await flushPromises()

      expect(wrapper.find("#block-list-sources-save-error").text()).toBe("Permission denied.")
      expect(wrapper.find("#block-list-sources-editor").exists()).toBe(true)
    })

    it("cancels out of the editor without saving", async () => {
      useAuthStore().user = { id: 1, username: "admin", role: "admin" }
      vi.mocked(listBlockedZones).mockResolvedValue({ response: { domain: "", zones: [], records: [] } })
      vi.mocked(getSettings).mockResolvedValue({ response: { blockListUrls: ["https://big.oisd.nl/"] } as never })

      const wrapper = await mountConnected()
      await wrapper.get("#edit-block-list-sources").trigger("click")
      await wrapper.get("#block-list-sources-editor").setValue("something else entirely")
      await wrapper.find("button").exists() // sanity: buttons rendered
      const cancelBtn = wrapper.findAll("button").find((b) => b.text() === "Cancel")!
      await cancelBtn.trigger("click")

      expect(updateBlockListUrls).not.toHaveBeenCalled()
      expect(wrapper.find("#block-list-sources-editor").exists()).toBe(false)
      expect(wrapper.text()).toContain("https://big.oisd.nl/")
    })
  })
})
