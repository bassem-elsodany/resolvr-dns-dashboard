import { describe, it, expect, vi, beforeEach } from "vitest"
import { mount } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"

vi.mock("../../api/technitium", async () => {
  const actual = await vi.importActual<typeof import("../../api/technitium")>("../../api/technitium")
  return { ...actual, listApps: vi.fn() }
})

import { listApps, TechnitiumApiError } from "../../api/technitium"
import { useConnectionStore } from "../../stores/connection"
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
})
