import { describe, it, expect, vi, beforeEach } from "vitest"
import { mount } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"

vi.mock("../../api/technitium", async () => {
  const actual = await vi.importActual<typeof import("../../api/technitium")>("../../api/technitium")
  return { ...actual, listApps: vi.fn() }
})
vi.mock("../../api/app", async () => {
  const actual = await vi.importActual<typeof import("../../api/app")>("../../api/app")
  return { ...actual, uninstallApp: vi.fn() }
})

import { listApps, TechnitiumApiError } from "../../api/technitium"
import { uninstallApp, AppApiError } from "../../api/app"
import { useConnectionStore } from "../../stores/connection"
import { useAuthStore } from "../../stores/auth"
import AppsView from "./AppsView.vue"

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function mountConnected() {
  const wrapper = mount(AppsView, { global: { stubs: { RouterLink: true } } })
  const connection = useConnectionStore()
  connection.isConfigured = true
  await flushPromises()
  return wrapper
}

describe("AppsView", () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.mocked(listApps).mockReset()
    vi.mocked(uninstallApp).mockReset()
  })

  it("renders the real installed apps", async () => {
    vi.mocked(listApps).mockResolvedValue({
      response: {
        apps: [
          { name: "Advanced Blocking", description: "Blocks domains via lists.", version: "11.1", updateAvailable: false },
          { name: "Query Logs (Sqlite)", description: "Logs requests.", version: "1.0", updateAvailable: false },
        ],
      },
    })
    const wrapper = await mountConnected()

    expect(wrapper.text()).toContain("Advanced Blocking")
    expect(wrapper.text()).toContain("Query Logs (Sqlite)")
  })

  it("shows a version badge for apps with no update available", async () => {
    vi.mocked(listApps).mockResolvedValue({
      response: { apps: [{ name: "Block Page", description: "d", version: "3.2", updateAvailable: false }] },
    })
    const wrapper = await mountConnected()

    expect(wrapper.text()).toContain("v3.2")
    expect(wrapper.text()).not.toContain("Update to")
  })

  it("shows an update-available badge only for apps the API flags", async () => {
    vi.mocked(listApps).mockResolvedValue({
      response: {
        apps: [{ name: "Advanced Blocking", description: "d", version: "11.0", updateVersion: "11.1", updateAvailable: true }],
      },
    })
    const wrapper = await mountConnected()

    expect(wrapper.text()).toContain("Update to v11.1")
  })

  it("shows a readable inline error, not a raw stack trace, on failure", async () => {
    vi.mocked(listApps).mockRejectedValue(new TechnitiumApiError("Invalid token or session expired.", 200))
    const wrapper = await mountConnected()

    expect(wrapper.find("#apps-error").text()).toBe("Invalid token or session expired.")
  })

  describe("uninstalling an app (admin only)", () => {
    it("hides the Uninstall control for a viewer", async () => {
      useAuthStore().user = { id: 2, username: "reader", role: "viewer" }
      vi.mocked(listApps).mockResolvedValue({
        response: { apps: [{ name: "Block Page", description: "d", version: "3.2", updateAvailable: false }] },
      })

      const wrapper = await mountConnected()

      expect(wrapper.find(".uninstall-app").exists()).toBe(false)
    })

    it("requires a two-step confirmation, then uninstalls and refreshes the list", async () => {
      useAuthStore().user = { id: 1, username: "admin", role: "admin" }
      vi.mocked(listApps)
        .mockResolvedValueOnce({
          response: { apps: [{ name: "Block Page", description: "d", version: "3.2", updateAvailable: false }] },
        })
        .mockResolvedValueOnce({ response: { apps: [] } })
      vi.mocked(uninstallApp).mockResolvedValue({ status: "ok" })

      const wrapper = await mountConnected()
      await wrapper.get(".uninstall-app").trigger("click")
      expect(uninstallApp).not.toHaveBeenCalled()
      expect(wrapper.text()).toContain("Uninstall this app?")

      await wrapper.get("button.text-crit").trigger("click")
      await flushPromises()

      expect(uninstallApp).toHaveBeenCalledWith("Block Page")
      expect(listApps).toHaveBeenCalledTimes(2)
      expect(wrapper.text()).not.toContain("Block Page")
    })

    it("shows a readable error, not a raw stack trace, when uninstalling fails", async () => {
      useAuthStore().user = { id: 1, username: "admin", role: "admin" }
      vi.mocked(listApps).mockResolvedValue({
        response: { apps: [{ name: "Block Page", description: "d", version: "3.2", updateAvailable: false }] },
      })
      vi.mocked(uninstallApp).mockRejectedValue(new AppApiError("Permission denied.", 502))

      const wrapper = await mountConnected()
      await wrapper.get(".uninstall-app").trigger("click")
      await wrapper.get("button.text-crit").trigger("click")
      await flushPromises()

      expect(wrapper.find("#uninstall-app-error").text()).toBe("Permission denied.")
    })

    it("cancels out without uninstalling", async () => {
      useAuthStore().user = { id: 1, username: "admin", role: "admin" }
      vi.mocked(listApps).mockResolvedValue({
        response: { apps: [{ name: "Block Page", description: "d", version: "3.2", updateAvailable: false }] },
      })

      const wrapper = await mountConnected()
      await wrapper.get(".uninstall-app").trigger("click")
      const cancelBtn = wrapper.findAll("button").find((b) => b.text() === "Cancel")!
      await cancelBtn.trigger("click")

      expect(uninstallApp).not.toHaveBeenCalled()
      expect(wrapper.text()).toContain("Block Page")
    })
  })
})
